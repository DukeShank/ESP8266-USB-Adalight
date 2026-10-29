/*
 * WLED USB Adalight — SignalRGB Plugin
 * Copyright (c) 2026 DukeShank
 *
 * PURPOSE
 * Streams per-LED RGB colour data from SignalRGB to a compatible
 * ESP8266-based LED controller over USB serial using the Adalight
 * real-time LED protocol.
 *
 * TARGET HARDWARE
 * - Controller: ESP8266 with CH340 USB-to-serial adapter
 * - USB Vendor ID: 0x1A86
 * - USB Product ID: 0x7523
 * - LED strip: 111 WS281x addressable RGB LEDs
 * - LED data pin: GPIO2
 * - WLED colour order: GRB
 *
 * FIRMWARE REQUIREMENTS
 * - WLED 0.15.4 with the project's custom USB-serial-only changes
 * - Adalight serial input must remain enabled
 * - Wi-Fi startup and reconnection are disabled in the custom build
 *
 * SERIAL CONFIGURATION
 * - Protocol: Adalight
 * - Baud rate: 115200
 * - Format: 8 data bits, no parity, 1 stop bit (8-N-1)
 * - Frame rate: approximately 25 FPS, subject to USB and
 *   SignalRGB rendering performance
 *
 * INSTALLATION
 * Copy this file to:
 * %USERPROFILE%\Documents\WhirlwindFX\Plugins
 *
 * Close other applications using the controller's COM port,
 * then restart SignalRGB to load the plugin.
 *
 * LIMITATIONS
 * - The plugin identifies hardware by USB VID/PID, not by COM
 *   number. Other CH340 devices may share these identifiers.
 * - The controller must be running compatible Adalight firmware.
 * - Real-time mode may end when serial frames stop arriving.
 * - The custom firmware does not provide the normal WLED web UI
 *   or Wi-Fi management functionality.
 *
 * STATUS
 * Experimental. The direct Adalight transmission to the target
 * firmware has been verified; SignalRGB integration still needs
 * end-to-end testing.
 *
 * LICENCE
 * See the repository's LICENSE file.
 */
import serial from "@SignalRGB/serial";

// Hardware configuration
const LED_COUNT = 111;
const BAUD_RATE = 115200;

// A 339-byte frame takes about 29.4 ms at 115200 baud.
// Start at approximately 25 FPS to leave some serial overhead.
const FRAME_INTERVAL_MS = 40;

// One horizontal row of 111 LEDs in the SignalRGB canvas.
const ledNames = [];
const ledPositions = [];

for (let index = 0; index < LED_COUNT; index++) {
    ledNames.push(`LED ${index + 1}`);
    ledPositions.push([index, 0]);
}

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
    return [LED_COUNT, 1];
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

// Send one Adalight frame to WLED.
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
    for (let index = 0; index < LED_COUNT; index++) {
        const color = device.color(index, 0);

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
