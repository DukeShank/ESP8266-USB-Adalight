
#include <Arduino.h>
#include <NeoPixelBus.h>

// Hardware configuration
constexpr uint16_t LED_COUNT = 111;

constexpr uint32_t SERIAL_BAUD = 230400;
constexpr uint16_t SERIAL_RX_BUFFER = 1024;

// Protocol and timeout configuration
constexpr uint32_t ADALIGHT_TIMEOUT_MS = 2500;
constexpr uint32_t FRAME_GAP_RESET_US = 20000;

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

bool hasValidFrame = false;
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

void displayFrame() {
    for (uint16_t i = 0; i < LED_COUNT; i++) {
        const uint16_t offset = i * 3;

        strip.SetPixelColor(
            i,
            RgbColor(
                frameData[offset],
                frameData[offset + 1],
                frameData[offset + 2]
            )
        );
    }

    strip.Show();

    lastValidFrameMillis = millis();
    hasValidFrame = true;
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
    if (hasValidFrame && outputActive &&
        static_cast<uint32_t>(millis() - lastValidFrameMillis) >=
            ADALIGHT_TIMEOUT_MS) {

        strip.ClearTo(RgbColor(0));
        strip.Show();

        outputActive = false;
        hasValidFrame = false;
    }

    yield();
}
