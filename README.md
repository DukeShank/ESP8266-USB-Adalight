# WLED USB Adalight for SignalRGB

An experimental SignalRGB hardware plugin for controlling an ESP8266-based
addressable RGB LED strip over USB serial using WLED's Adalight protocol.

The goal is to provide direct USB control without relying on Wi-Fi.

## Status

Experimental. The target ESP8266 has been flashed with a custom WLED 0.15.4
build, and direct Adalight serial transmission has been verified. End-to-end
operation through the SignalRGB plugin still requires testing.

## Hardware

| Property | Value |
|---|---|
| Controller | ESP8266 development board |
| USB-to-serial adapter | CH340 |
| USB Vendor ID | `0x1A86` |
| USB Product ID | `0x7523` |
| Serial port | Windows COM port; currently COM4 |
| LED chipset | WS281x |
| LED count | 111 |
| Data output | GPIO2 (typically labelled D4) |
| Colour order | GRB in the WLED configuration |
| Serial protocol | Adalight |
| Baud rate | 115200 |
| Serial format | 8-N-1 |

The Windows COM port number may change when the controller is reconnected.

## How it works

SignalRGB provides a colour value for each LED. The plugin packages the 111
RGB pixels into Adalight frames and sends them over USB serial.

Each frame contains:

1. The ASCII header `Ada`
2. A two-byte LED-count field containing the LED count minus one
3. An XOR checksum for the count field
4. An RGB triplet for each LED

The plugin currently uses a 40 ms minimum interval between send attempts.
The effective frame rate depends on SignalRGB's render cadence and serial
transmission time.

## Firmware

The target firmware is based on WLED 0.15.4 with local USB-serial-only
modifications.

The custom build:

- Keeps Adalight serial input enabled.
- Sets Wi-Fi to `WIFI_OFF` during setup.
- Skips normal Wi-Fi station initialization and connection handling.
- Prevents the normal access-point initialization path.
- Skips Improv Wi-Fi scanning in the main loop.
- Disables ESP-NOW.

The local modifications are guarded by `WLED_USB_SERIAL_ONLY`. This is a
project-specific flag, not a standard WLED build option.

### Build

Build the WLED source with PlatformIO using the ESP8266 NodeMCU environment:

```powershell
pio run -e nodemcuv2
```

Upload the custom firmware through the controller's current serial port,
for example COM4:

```powershell
pio run -e nodemcuv2 -t upload --upload-port COM4
```

These commands must be run from the WLED source directory after applying
the USB-only changes.

Keep a known-good stock WLED firmware image available before flashing.
The custom firmware is not intended to be managed through the normal WLED
web interface or Wi-Fi.

## SignalRGB plugin installation

1. Download `WLED-USB-Adalight.js` from this repository.
2. Copy it to:

   `%USERPROFILE%\Documents\WhirlwindFX\Plugins`

3. Close other applications that might be using the controller's COM port.
4. Restart SignalRGB.
5. Check the device list and SignalRGB device console for connection errors.

The plugin identifies the USB serial adapter by Vendor ID and Product ID.
Other devices using the same identifiers may create a matching conflict.

## Troubleshooting

### Device not detected

- Check Device Manager for the USB serial adapter.
- Confirm its Vendor ID and Product ID.
- Confirm the plugin is in SignalRGB's user Plugins directory.
- Restart SignalRGB after installing or updating the plugin.

### Serial connection fails

- Close other applications using the COM port.
- Reconnect the USB cable.
- Check the current COM port in Device Manager.
- Inspect SignalRGB's device console for errors.

### Colours are incorrect

- Confirm the LED count and WLED chipset settings.
- Confirm that the physical strip's colour order matches the firmware.
- The plugin sends RGB triplets; WLED applies the configured strip colour order.

### Flicker or dropped frames

- Start with 115200 baud.
- Change the frame interval only after confirming stable operation.
- Test one variable at a time.

## Recovery

If the custom firmware fails, reflash a known-good stock WLED firmware image
built for the same ESP8266 target using USB serial.

Keep the stock image and source backup available. Do not rely on Wi-Fi
recovery when using the USB-only firmware.

## Licence

The plugin source is distributed under the MIT Licence. WLED is a separate
project and retains its own licence and attribution requirements.
