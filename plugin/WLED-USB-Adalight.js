/*
 * ESP8266 USB Adalight — SignalRGB Plugin
 * Copyright (c) 2026 DukeShank
 *
 * PURPOSE
 * Streams per-LED RGB colour data from SignalRGB to an ESP8266
 * controller over USB serial using the Adalight protocol.
 *
 * TARGET HARDWARE
 * - Controller: ESP8266 NodeMCU / ESP-12E
 * - USB-to-serial interface: CH340
 * - USB Vendor ID: 0x1A86
 * - USB Product ID: 0x7523
 * - LED strip: 111 WS2812B / compatible WS281x LEDs
 * - LED output: GPIO2 (UART1 TX)
 * - LED colour order: GRB
 *
 * FIRMWARE REQUIREMENTS
 * - Project's standalone ESP8266 Adalight firmware
 * - UART0 RX for serial reception (GPIO3)
 * - UART1 TX for WS2812 LED output (GPIO2)
 * - No WLED installation required
 *
 * SERIAL CONFIGURATION
 * - Protocol: Adalight
 * - Baud rate: 230400
 * - Format: 8 data bits, no parity, 1 stop bit (8-N-1)
 * - Frame interval: 40 ms (25 FPS requested maximum)
 *
 * INSTALLATION
 * Copy this file into the custom user-plugin directory opened
 * through SignalRGB's Device Information > Plugins button.
 * Fully exit and restart SignalRGB after replacing the plugin.
 *
 * LIMITATIONS
 * - Hardware is identified by USB VID/PID, not a fixed COM port.
 * - Other CH340 devices may use the same identifiers.
 * - Physical LED geometry is defined by ledPositions below.
 * - The controller has no Wi-Fi, web interface, or network control.
 *
 * STATUS
 * End-to-end operation verified on Windows 11 with SignalRGB,
 * standalone ESP8266 firmware, and a 111-LED WS281x strip.
 *
 * LICENCE
 * See the repository's LICENSE file.
 */
import serial from "@SignalRGB/serial";

// Hardware configuration
const LED_COUNT = 111;
const BAUD_RATE = 230400;

// A 339-byte frame takes about 14.7 ms at 230400 baud.
// Start at approximately 25 FPS to leave some serial overhead.
const FRAME_INTERVAL_MS = 40;

// Physical monitor perimeter, matching the original WLED layout.
//
// LED 1 starts at the bottom-left.
// 1–20:   left edge, bottom to top
// 21–55:  top edge, left to right
// 56–75:  right edge, top to bottom
// 76–111: bottom edge, right to left
//
// Grid coordinates run from x=0..36 and y=0..21.
const CANVAS_WIDTH = 37;
const CANVAS_HEIGHT = 22;

const ledNames = Array.from(
    { length: LED_COUNT },
    (_, index) => `LED ${index + 1}`
);

const ledPositions = [
    // LEDs 1–20: left edge, bottom to top.
    ...Array.from(
        { length: 20 },
        (_, index) => [0, 20 - index]
    ),

    // LEDs 21–55: top edge, left to right.
    ...Array.from(
        { length: 35 },
        (_, index) => [index + 1, 0]
    ),

    // LEDs 56–75: right edge, top to bottom.
    ...Array.from(
        { length: 20 },
        (_, index) => [36, index + 1]
    ),

    // LEDs 76–111: bottom edge, right to left.
    ...Array.from(
        { length: 36 },
        (_, index) => [36 - index, 21]
    )
];

let serialConnected = false;
let lastFrameTime = 0;
let lastConnectAttempt = 0;
let connectionWarningLogged = false;
let writeWarningLogged = false;

// Device identity
export function Name() {
    return "WLED USB Adalight (111 LEDs)";
}

export function Publisher() {
    return "DukeShank";
}

export function VendorId() {
    return 0x1A86; // WCH/QinHeng CH340
}

export function ProductId() {
    return 0x7523; // USB-SERIAL CH340
}

export function Type() {
    return "serial";
}

export function DeviceType() {
    return "lightingcontroller";
}
// Device layout
export function Size() {
    return [CANVAS_WIDTH, CANVAS_HEIGHT];
}

export function DefaultPosition() {
    return [0, 0];
}

export function DefaultScale() {
    return 1.0;
}

export function LedNames() {
    return ledNames;
}

export function LedPositions() {
    return ledPositions;
}

// Establish the USB serial connection.
function connectSerial() {
    const now = Date.now();

    // Avoid repeatedly attempting a failed connection every frame.
    if (now - lastConnectAttempt < 2000) return;
    lastConnectAttempt = now;

    try {
        const opened = serial.connect({
            baudRate: BAUD_RATE,
            parity: "None",
            dataBits: 8,
            stopBits: "One"
        });

        serialConnected = !!opened && serial.isConnected();

        if (serialConnected) {
            device.log(
                `[WLED USB Adalight] Connected on ` +
                `${serial.getPortName()} at ${serial.getBaudRate()} baud.`
            );
            connectionWarningLogged = false;
        } else if (!connectionWarningLogged) {
            device.log(
                "[WLED USB Adalight] Serial connection failed; will retry."
            );
            connectionWarningLogged = true;
        }
    } catch (error) {
        serialConnected = false;

        if (!connectionWarningLogged) {
            device.log(
                `[WLED USB Adalight] Connection error: ${String(error)}`
            );
            connectionWarningLogged = true;
        }
    }
}

export function Initialize() {
    connectSerial();
}

// Convert a colour channel to a valid 8-bit value.
function toByte(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) return 0;

    return Math.max(0, Math.min(255, Math.round(number)));
}

// Send one Adalight frame to the ESP8266 controller.
export function Render() {
    if (!serialConnected) {
        connectSerial();
        return;
    }

    try {
        if (!serial.isConnected()) {
            serialConnected = false;
            connectSerial();
            return;
        }
    } catch (error) {
        serialConnected = false;
        connectSerial();
        return;
    }

    const now = Date.now();

    if (now - lastFrameTime < FRAME_INTERVAL_MS) return;
    lastFrameTime = now;

    // Adalight header: "Ada", LED-count-minus-one, XOR checksum.
    const countMinusOne = LED_COUNT - 1;
    const high = (countMinusOne >> 8) & 0xFF;
    const low = countMinusOne & 0xFF;
    const checksum = high ^ low ^ 0x55;

    const frame = [
        0x41, 0x64, 0x61,
        high, low, checksum
    ];

    // Adalight expects RGB triples. WLED handles the strip's GRB
    // hardware colour order separately.
    // Read the colour from the physical LED's mapped 2D position.
    for (let index = 0; index < LED_COUNT; index++) {
        const [x, y] = ledPositions[index];
        const color = device.color(x, y);

        // Adalight expects RGB byte order.
        frame.push(
             toByte(color && color[0]),
             toByte(color && color[1]),
            toByte(color && color[2])
    );
}

    try {
        const written = serial.write(frame);

        if (
            typeof written === "number" &&
            written < frame.length &&
            !writeWarningLogged
        ) {
            device.log(
                `[WLED USB Adalight] Short serial write: ` +
                `${written}/${frame.length} bytes.`
            );
            writeWarningLogged = true;
        }
    } catch (error) {
        serialConnected = false;

        if (!writeWarningLogged) {
            device.log(
                `[WLED USB Adalight] Serial write error: ${String(error)}`
            );
            writeWarningLogged = true;
        }
    }
}

export function Shutdown() {
    try {
        if (serial.isConnected()) {
            serial.disconnect();
        }
    } catch (error) {
        device.log(
            `[WLED USB Adalight] Disconnect error: ${String(error)}`
        );
    }

    serialConnected = false;
}
