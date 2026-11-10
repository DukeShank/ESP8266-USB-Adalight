/*
 * ESP8266 USB Adalight — SignalRGB Plugin
 * Copyright (c) 2026 DukeShank
 * https://github.com/DukeShank/ESP8266-USB-Adalight
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
 * - This repository's standalone ESP8266 firmware (firmware/)
 * - The legacy WLED 0.15.4 build (legacy/) accepts the same frames
 * - No WLED installation required
 *
 * SERIAL CONFIGURATION
 * - Protocol: Adalight
 * - Baud rate: 230400
 * - Format: 8 data bits, no parity, 1 stop bit (8-N-1)
 * - Minimum frame gap: 20 ms. SignalRGB calls Render() every 30 ms
 *   by default, so one frame is sent per Render() call.
 *
 * SETTINGS
 * - Lighting Mode: "Canvas" (effect colours) or "Forced" (one colour)
 * - Forced Color: colour used in Forced mode
 *
 * EXIT AND SLEEP
 * Shutdown() sends one all-black frame and then closes the port, so
 * the strip turns off at once. If that frame does not arrive, the
 * firmware's 2500 ms timeout turns the strip off.
 *
 * INSTALLATION
 * Copy this file into the custom user-plugin directory opened
 * through SignalRGB's Device Information > Plugins button.
 * Delete WLED-USB-Adalight.js (the file name before version 1.0.0)
 * from that directory. Fully exit and restart SignalRGB.
 *
 * LIMITATIONS
 * - Hardware is identified by USB VID/PID, not a fixed COM port.
 * - Other CH340 devices may use the same identifiers.
 * - Physical LED geometry is defined by ledPositions below.
 * - The controller has no Wi-Fi, web interface, or network control.
 *
 * STATUS
 * Version 1.0.0. See README.md for tested configuration and results.
 *
 * LICENCE
 * MIT. See the repository's LICENSE file.
 */
import serial from "@SignalRGB/serial";

/* global
device:readonly, LightingMode:readonly, forcedColor:readonly
*/

const LOG_PREFIX = "[ESP8266 USB Adalight]";

// Hardware configuration
const LED_COUNT = 111;
const BAUD_RATE = 230400;

// One 339-byte frame needs about 14.7 ms on the wire at 230400 baud
// (10 bits per byte). Writing 111 LEDs takes about 3.3 ms in the
// firmware. A 20 ms minimum gap keeps the serial line below its limit
// and still sends a frame on every Render() call at the default 30 ms
// interval.
const MIN_FRAME_INTERVAL_MS = 20;

// Time between connection attempts while the port is not open.
const RECONNECT_INTERVAL_MS = 2000;

// Device image: 1024x1024 transparent PNG, artwork in the central
// 920x920 area, hosted in this repository.
const IMAGE_URL =
    "https://raw.githubusercontent.com/DukeShank/ESP8266-USB-Adalight/main/images/esp8266-usb-adalight.png";

// Physical monitor perimeter.
//
// LED 1 starts at the bottom-left.
// 1–20:   left edge, bottom to top     (20 LEDs)
// 21–55:  top edge, left to right      (35 LEDs)
// 56–75:  right edge, top to bottom    (20 LEDs)
// 76–111: bottom edge, right to left   (36 LEDs)
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

// Adalight frame: "Ada", LED count minus one (big-endian),
// checksum (high XOR low XOR 0x55), then 3 RGB bytes per LED.
// The header never changes, so it is written once. The colour bytes
// are overwritten in place for every frame.
const HEADER_LENGTH = 6;
const FRAME_LENGTH = HEADER_LENGTH + LED_COUNT * 3; // 339 bytes

const frame = createFrame();

function createFrame() {
    const buffer = new Array(FRAME_LENGTH).fill(0);
    const countMinusOne = LED_COUNT - 1;
    const high = (countMinusOne >> 8) & 0xFF;
    const low = countMinusOne & 0xFF;

    buffer[0] = 0x41; // "A"
    buffer[1] = 0x64; // "d"
    buffer[2] = 0x61; // "a"
    buffer[3] = high;
    buffer[4] = low;
    buffer[5] = high ^ low ^ 0x55;

    return buffer;
}

let serialConnected = false;
let lastFrameTime = 0;
let lastConnectAttempt = -Infinity;
let connectionWarningLogged = false;
let writeWarningLogged = false;

// Device identity
export function Name() {
    return "ESP8266 USB Adalight (111 LEDs)";
}

export function Version() {
    return "1.0.0";
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

export function ImageUrl() {
    return IMAGE_URL;
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

// User settings
export function ControllableParameters() {
    return [
        {
            property: "LightingMode",
            group: "lighting",
            label: "Lighting Mode",
            type: "combobox",
            values: ["Canvas", "Forced"],
            default: "Canvas"
        },
        {
            property: "forcedColor",
            group: "lighting",
            label: "Forced Color",
            min: "0",
            max: "360",
            type: "color",
            default: "#009bde"
        }
    ];
}

function log(message) {
    device.log(`${LOG_PREFIX} ${message}`);
}

// Close the port if it is open. Errors are ignored because the port
// may already be gone (for example, after the USB cable is removed).
function closeSerial() {
    try {
        if (serial.isConnected()) {
            serial.disconnect();
        }
    } catch (error) {
        // Nothing else to do; the next connect attempt starts clean.
    }

    serialConnected = false;
}

// Open the USB serial connection, at most once per RECONNECT_INTERVAL_MS.
function connectSerial() {
    const now = Date.now();

    if (now - lastConnectAttempt < RECONNECT_INTERVAL_MS) return;
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
            log(
                `Connected on ${serial.getPortName()} ` +
                `at ${serial.getBaudRate()} baud.`
            );

            // Log the next connection or write problem again.
            connectionWarningLogged = false;
            writeWarningLogged = false;
        } else if (!connectionWarningLogged) {
            log("Serial connection failed; will retry every 2 s.");
            connectionWarningLogged = true;
        }
    } catch (error) {
        serialConnected = false;

        if (!connectionWarningLogged) {
            log(`Connection error: ${String(error)}; will retry every 2 s.`);
            connectionWarningLogged = true;
        }
    }
}

// Return true when the port is open; otherwise try to reconnect.
function ensureConnected() {
    try {
        if (serialConnected && serial.isConnected()) return true;
    } catch (error) {
        // Treated as disconnected below.
    }

    serialConnected = false;
    connectSerial();

    return serialConnected;
}

// Convert a colour channel to a valid 8-bit value.
function toByte(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) return 0;

    return Math.max(0, Math.min(255, Math.round(number)));
}

// Convert "#rrggbb" to [r, g, b]. Invalid input gives black.
function hexToRgb(hex) {
    const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
        .exec(String(hex));

    if (!match) return [0, 0, 0];

    return [
        parseInt(match[1], 16),
        parseInt(match[2], 16),
        parseInt(match[3], 16)
    ];
}

// Fill the colour bytes of the frame. Adalight expects RGB byte
// order; the firmware converts to the strip's GRB order.
function fillFrameColors() {
    const forced = typeof LightingMode !== "undefined" &&
        LightingMode === "Forced";
    const forcedRgb = forced ? hexToRgb(forcedColor) : null;

    let offset = HEADER_LENGTH;

    for (let index = 0; index < LED_COUNT; index++) {
        let color = forcedRgb;

        if (!forced) {
            // Colour at the physical LED's mapped canvas position.
            const [x, y] = ledPositions[index];
            color = device.color(x, y);
        }

        frame[offset++] = toByte(color && color[0]);
        frame[offset++] = toByte(color && color[1]);
        frame[offset++] = toByte(color && color[2]);
    }
}

// Send the frame buffer. On an error the port is closed so that the
// next Render() call reconnects.
function writeFrame() {
    try {
        const written = serial.write(frame);

        if (
            typeof written === "number" &&
            written < frame.length &&
            !writeWarningLogged
        ) {
            log(`Short serial write: ${written}/${frame.length} bytes.`);
            writeWarningLogged = true;
        }

        return true;
    } catch (error) {
        if (!writeWarningLogged) {
            log(`Serial write error: ${String(error)}`);
            writeWarningLogged = true;
        }

        closeSerial();

        return false;
    }
}

export function Initialize() {
    connectSerial();
}

// Send one Adalight frame to the ESP8266 controller.
export function Render() {
    if (!ensureConnected()) return;

    const now = Date.now();

    if (now - lastFrameTime < MIN_FRAME_INTERVAL_MS) return;
    lastFrameTime = now;

    fillFrameColors();
    writeFrame();
}

// Called on exit, on system sleep and when streaming is turned off.
// All three cases turn the strip off.
export function Shutdown() {
    try {
        if (serial.isConnected()) {
            frame.fill(0, HEADER_LENGTH);
            writeFrame();
        }
    } catch (error) {
        log(`Shutdown error: ${String(error)}`);
    }

    closeSerial();
}
