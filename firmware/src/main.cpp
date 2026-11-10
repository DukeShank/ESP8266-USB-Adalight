/*
 * ESP8266 USB Adalight — standalone firmware
 * Copyright (c) 2026 DukeShank
 * https://github.com/DukeShank/ESP8266-USB-Adalight
 *
 * PURPOSE
 * Receives Adalight frames from SignalRGB over USB serial and drives a
 * WS2812B-compatible LED strip. No Wi-Fi, web interface or presets.
 *
 * TARGET HARDWARE
 * - ESP8266 NodeMCU / ESP-12E with a CH340 USB-to-serial interface
 * - 111 WS2812B / compatible WS281x LEDs, GRB colour order
 * - LED data: GPIO2 (UART1 TX, often labelled D4)
 * - Host serial: GPIO3 (UART0 RX), 230400 baud, 8-N-1
 *
 * FRAME HANDLING
 * - Accepts only frames for exactly LED_COUNT LEDs with a valid
 *   header and checksum.
 * - Buffers the complete payload before updating the strip.
 * - Clears the strip after ADALIGHT_TIMEOUT_MS without a valid frame.
 *
 * CURRENT LIMIT
 * Estimates the strip current for every frame with the same model as
 * WLED's automatic brightness limiter (55 mA per LED at full white,
 * 1 mA per LED idle, 80 mA for the ESP8266). If the estimate exceeds
 * POWER_LIMIT_MA, all LEDs are scaled down by the same factor.
 * This is an estimate, not a measurement: size the supply and wiring
 * with a margin.
 *
 * WI-FI
 * Not used. ESP8266 Arduino core 3.x keeps Wi-Fi off at boot unless
 * the sketch starts it, and this firmware never does.
 *
 * VERSION
 * 1.0.0
 *
 * LICENCE
 * MIT. See the repository's LICENSE file.
 */
#include <Arduino.h>
#include <NeoPixelBus.h>

// Hardware configuration
constexpr uint16_t LED_COUNT = 111;

constexpr uint32_t SERIAL_BAUD = 230400;
constexpr uint16_t SERIAL_RX_BUFFER = 1024;

// Protocol and timeout configuration
constexpr uint32_t ADALIGHT_TIMEOUT_MS = 2500;
constexpr uint32_t FRAME_GAP_RESET_US = 20000;

// Current limit configuration.
// POWER_LIMIT_MA is the total current allowed from the 5 V supply for
// the strip and the ESP8266 board together. 2000 mA leaves a margin
// on a 5 V 2.4 A supply. Set it to 0 to disable the limit.
constexpr uint32_t POWER_LIMIT_MA = 2000;
constexpr uint32_t ESP_CURRENT_MA = 80;     // WLED MA_FOR_ESP (ESP8266)
constexpr uint32_t LED_IDLE_MA = 1;         // per LED, all channels 0
constexpr uint32_t LED_FULL_WHITE_MA = 55;  // per LED at 255/255/255

constexpr uint32_t RESERVED_MA = ESP_CURRENT_MA + LED_COUNT * LED_IDLE_MA;

static_assert(POWER_LIMIT_MA == 0 || POWER_LIMIT_MA > RESERVED_MA,
              "POWER_LIMIT_MA must be 0 or larger than RESERVED_MA");

// Current available for lighting LEDs above their idle current.
constexpr uint32_t LED_BUDGET_MA =
    (POWER_LIMIT_MA == 0) ? 0 : POWER_LIMIT_MA - RESERVED_MA;

// UART1 drives WS2812B output on GPIO2.
// UART0 remains available for Adalight reception on GPIO3.
NeoPixelBus<NeoGrbFeature, NeoEsp8266Uart1Ws2812xMethod>
    strip(LED_COUNT);

// Complete Adalight RGB payload: 3 bytes per LED.
uint8_t frameData[LED_COUNT * 3];

// Parser state
enum class ParserState : uint8_t {
    WAIT_A,
    WAIT_D,
    WAIT_A2,
    READ_COUNT_HIGH,
    READ_COUNT_LOW,
    READ_CHECKSUM,
    READ_PIXEL_DATA
};

ParserState parserState = ParserState::WAIT_A;

uint8_t countHigh = 0;
uint8_t countLow = 0;
uint16_t payloadBytesRead = 0;

uint32_t lastByteMicros = 0;
uint32_t lastValidFrameMillis = 0;

// True while the strip shows a received frame; cleared by the timeout.
bool outputActive = false;

void resetParser() {
    parserState = ParserState::WAIT_A;
    payloadBytesRead = 0;
}

void restartParserFromByte(uint8_t value) {
    resetParser();

    if (value == 'A') {
        parserState = ParserState::WAIT_D;
    }
}

// Return the brightness scale (1..256, where 256 means unchanged) that
// keeps the estimated LED current within LED_BUDGET_MA.
//
// channelSum is the sum of all R, G and B bytes in the frame. One LED
// at 255/255/255 contributes 765 and draws LED_FULL_WHITE_MA.
uint16_t currentLimitScale(uint32_t channelSum) {
    if (LED_BUDGET_MA == 0) return 256;

    // Estimated current in mA = channelSum * LED_FULL_WHITE_MA / 765.
    // Both sides are multiplied by 765 to avoid a division here.
    // channelSum is at most 333 * 255 = 84915, so demand is at most
    // 4,670,325.
    const uint32_t demand = channelSum * LED_FULL_WHITE_MA;
    const uint32_t budget = LED_BUDGET_MA * 765;

    if (demand <= budget) return 256;

    // Here budget < demand, so budget * 256 stays below 1.2e9 and fits
    // in uint32_t. Rounding down keeps the scaled frame within budget.
    return static_cast<uint16_t>((budget * 256) / demand);
}

// Apply a scale from currentLimitScale() to one colour channel.
uint8_t scaleChannel(uint8_t value, uint16_t scale) {
    return static_cast<uint8_t>((value * scale) >> 8);
}

void displayFrame() {
    uint32_t channelSum = 0;

    for (uint16_t i = 0; i < sizeof(frameData); i++) {
        channelSum += frameData[i];
    }

    const uint16_t scale = currentLimitScale(channelSum);

    for (uint16_t i = 0; i < LED_COUNT; i++) {
        const uint16_t offset = i * 3;

        strip.SetPixelColor(
            i,
            RgbColor(
                scaleChannel(frameData[offset], scale),
                scaleChannel(frameData[offset + 1], scale),
                scaleChannel(frameData[offset + 2], scale)
            )
        );
    }

    strip.Show();

    lastValidFrameMillis = millis();
    outputActive = true;
}

void processSerialByte(uint8_t value) {
    const uint32_t nowMicros = micros();

    // Discard an incomplete header or payload if reception stalls.
    // Normal inter-frame gaps are ignored while waiting for a header.
    if (parserState != ParserState::WAIT_A &&
        static_cast<uint32_t>(nowMicros - lastByteMicros) >
            FRAME_GAP_RESET_US) {
        resetParser();
    }

    lastByteMicros = nowMicros;

    switch (parserState) {

        case ParserState::WAIT_A:
            if (value == 'A') {
                parserState = ParserState::WAIT_D;
            }
            break;

        case ParserState::WAIT_D:
            if (value == 'd') {
                parserState = ParserState::WAIT_A2;
            } else {
                parserState =
                    (value == 'A') ? ParserState::WAIT_D
                                   : ParserState::WAIT_A;
            }
            break;

        case ParserState::WAIT_A2:
            if (value == 'a') {
                parserState = ParserState::READ_COUNT_HIGH;
            } else {
                parserState =
                    (value == 'A') ? ParserState::WAIT_D
                                   : ParserState::WAIT_A;
            }
            break;

        case ParserState::READ_COUNT_HIGH:
            countHigh = value;
            parserState = ParserState::READ_COUNT_LOW;
            break;

        case ParserState::READ_COUNT_LOW:
            countLow = value;
            parserState = ParserState::READ_CHECKSUM;
            break;

        case ParserState::READ_CHECKSUM: {
            const uint8_t expectedChecksum =
                countHigh ^ countLow ^ 0x55;

            if (value != expectedChecksum) {
                restartParserFromByte(value);
                break;
            }

            const uint16_t encodedCount =
                (static_cast<uint16_t>(countHigh) << 8) | countLow;

            const uint16_t receivedLEDCount = encodedCount + 1;

            if (receivedLEDCount != LED_COUNT) {
                restartParserFromByte(value);
                break;
            }

            payloadBytesRead = 0;
            parserState = ParserState::READ_PIXEL_DATA;
            break;
        }

        case ParserState::READ_PIXEL_DATA:
            frameData[payloadBytesRead++] = value;

            if (payloadBytesRead >= sizeof(frameData)) {
                displayFrame();
                resetParser();
            }
            break;
    }
}

void setup() {
    // Configure UART0 reception before starting serial.
    Serial.setRxBufferSize(SERIAL_RX_BUFFER);
    Serial.begin(SERIAL_BAUD, SERIAL_8N1);
    Serial.setDebugOutput(false);

    // Initialise UART1 LED output and clear the strip.
    strip.Begin();
    strip.ClearTo(RgbColor(0));
    strip.Show();
}

void loop() {
    // Process incoming Adalight bytes incrementally.
    while (Serial.available() > 0) {
        const int incomingByte = Serial.read();

        if (incomingByte >= 0) {
            processSerialByte(
                static_cast<uint8_t>(incomingByte)
            );
        }
    }

    // Turn off LEDs after the realtime stream stops.
    if (outputActive &&
        static_cast<uint32_t>(millis() - lastValidFrameMillis) >=
            ADALIGHT_TIMEOUT_MS) {

        strip.ClearTo(RgbColor(0));
        strip.Show();

        outputActive = false;
    }

    yield();
}
