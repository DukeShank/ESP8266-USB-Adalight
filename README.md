# ESP8266 USB Adalight for SignalRGB

A standalone ESP8266 firmware and SignalRGB plugin for driving an addressable RGB LED strip over USB serial using the Adalight protocol.

The primary firmware is a small PlatformIO project built with the ESP8266 Arduino framework and NeoPixelBus. It does not use WLED and does not provide Wi-Fi, a web interface, presets, or network control.

## Tested configuration

This repository documents one tested installation:

| Property | Tested value |
| --- | --- |
| Controller | ESP8266 NodeMCU-style board (ESP-12E) |
| USB-to-serial interface | CH340 |
| USB Vendor ID / Product ID | `0x1A86` / `0x7523` |
| LED chipset | WS2812B / compatible WS281x RGB strip |
| LED count | 111 |
| LED output | UART1 TX, GPIO2 (often labelled D4) |
| LED colour order | GRB |
| Host serial input | UART0 RX, GPIO3 |
| Runtime serial baud | 230400 baud, 8-N-1 |
| Adalight frame size | 339 bytes (6-byte header + 333-byte RGB payload) |
| Requested plugin frame interval | 40 ms (25 FPS cap) |
| No-valid-frame timeout | 2500 ms |
| PlatformIO environment | `nodemcuv2` |
| ESP8266 PlatformIO platform | `espressif8266@4.2.1` |
| LED library | `makuna/NeoPixelBus@2.8.4` |

Other boards, USB-to-serial interfaces, LED chipsets, LED counts, wiring layouts, and software versions may require changes and additional testing.

## Repository layout

```text
.
├── firmware/
│   ├── platformio.ini
│   └── src/
│       └── main.cpp
├── plugin/
│   └── WLED-USB-Adalight.js
├── legacy/
│   └── wled-0.15.4/
│       ├── README.md
│       ├── wled-0.15.4-usb-serial-only.patch
│       └── WLED-LICENSE-EUPL-1.2.txt
├── LICENSE
└── README.md
```

`firmware/` is the recommended implementation. `legacy/wled-0.15.4/` preserves the earlier WLED-based approach for reference; it is not required by the standalone firmware.

## How it works

The SignalRGB plugin samples the colours at the configured physical LED positions, assembles an Adalight frame, and sends it over USB serial. The ESP8266 firmware validates the Adalight header and checksum, receives the complete RGB payload into a staging buffer, and then updates the LED strip.

The firmware handles the sequential LED data only. It does not know the monitor's physical geometry. LED placement, direction, and screen-to-LED mapping are defined by the SignalRGB plugin's `ledPositions` array. The existing plugin contains the mapping for the tested installation; adapt that array for a different physical layout.

### ESP8266 peripheral allocation

The firmware uses the ESP8266's two UARTs for separate jobs:

- **UART0 RX / GPIO3:** receives Adalight data from SignalRGB at 230400 baud.
- **UART1 TX / GPIO2:** outputs the WS2812-compatible LED waveform through NeoPixelBus's `NeoEsp8266Uart1Ws2812xMethod`.

UART1's WS2812 output method is fixed to GPIO2 on this target. The LED output pin is therefore not a freely configurable GPIO setting in this implementation.

## Firmware behaviour

The standalone firmware is deliberately limited to the functions required by this installation:

- Receives Adalight over UART0 at 230400 baud, 8-N-1.
- Uses a 1024-byte UART receive buffer, configured before serial initialisation.
- Accepts frames for exactly 111 LEDs.
- Checks the Adalight header and XOR checksum before accepting a payload.
- Buffers the full 333-byte RGB payload before displaying a frame.
- Sends the pixel data to the LED strip in GRB order using NeoPixelBus and UART1.
- Starts with the LED output cleared.
- Clears the strip after 2500 ms without a complete valid frame.
- Does not emit debug text on the Adalight serial port; debug output would corrupt the protocol stream.

The current implementation is fixed to 111 LEDs, GPIO2/UART1 output, GRB order, 230400 baud, and a 2500 ms timeout. To use different hardware or settings, modify the source and rebuild.

## Hardware and power considerations

Use a suitable regulated 5 V supply for the LED strip. The ESP8266 and LED strip must share a common ground, and the data signal must be connected to the strip's data input. Ensure the supply and wiring are sized for the strip's possible current draw.

The tested installation powers the NodeMCU VIN and LED strip from the same external 5 V supply in parallel, with a common ground. The USB connection is made through a powered USB hub because this particular development board feeds power back onto the USB bus. NodeMCU clones vary: inspect the power-path design of your board rather than assuming its USB 5 V and VIN rails are isolated.

GPIO2 is an ESP8266 boot-strapping pin. Keep the LED data wiring and attached strip circuitry in a state that permits the board to enter its normal boot mode. If serial flashing fails to connect, temporarily isolating the LED data connection can help determine whether an attached circuit is affecting boot.

## Build

Install Git and PlatformIO Core, or install the PlatformIO IDE extension (which provides a managed PlatformIO Core CLI).

From the repository root, open a terminal and run:

```powershell
cd firmware
pio run -e nodemcuv2
```

The compiled firmware is written to:

```text
firmware/.pio/build/nodemcuv2/firmware.bin
```

The `firmware/.gitignore` excludes generated PlatformIO build output from Git. The standalone firmware was successfully compiled for `nodemcuv2` and tested on the hardware configuration listed above.

## Flash

1. Close SignalRGB and any other application that may have the controller's COM port open.
2. Identify the controller's current COM port in Windows Device Manager.
3. From the `firmware` directory, upload the firmware (replace `COM4` if necessary):

```powershell
pio run -e nodemcuv2 -t upload --upload-port COM4
```

The PlatformIO upload speed is 115200 baud. This is separate from the firmware's runtime Adalight baud rate of 230400 baud.

The ESP8266 serial ROM bootloader provides a recovery path if the application firmware is not functioning. Keep a known-good firmware image and, where practical, a full-flash backup before experimenting with firmware changes. The firmware does not provide Wi-Fi or a web-based recovery interface.

## Install the SignalRGB plugin

1. Download `plugin/WLED-USB-Adalight.js` from this repository.
2. In SignalRGB, open the controller's **Device Information** page and click **Plugins**. This opens the custom user-plugin directory SignalRGB is using. Copy `WLED-USB-Adalight.js` into that directory; do not assume the directory is on the Windows system drive.
3. Fully exit SignalRGB from its system-tray icon and launch it again.
4. Confirm the controller appears as **WLED USB Adalight (111 LEDs)** and that the plugin origin is **User**.
5. Check the device console for a successful connection to the controller's COM port at **230400 baud**.

The plugin identifies the USB device by VID/PID (`1A86:7523`), not by a fixed COM port. Other CH340 devices can use the same identifiers and may cause a device-match conflict. Close serial monitors, firmware tools, and other applications that may hold the COM port before starting SignalRGB.

The existing plugin's name retains “WLED” for continuity with the original device definition; **the standalone firmware does not require WLED**.

## Adalight frame format

Each frame consists of:

1. The three ASCII signature bytes `Ada`.
2. A two-byte big-endian LED count encoded as `LED_COUNT - 1`.
3. A checksum byte equal to `count_high XOR count_low XOR 0x55`.
4. Three RGB bytes per LED.

For 111 LEDs, the payload is 333 bytes and the complete frame is 339 bytes. The plugin sends RGB triplets; the firmware/library applies the strip's GRB output order.

## Verification performed

The following checks were completed on the tested installation:

- Built the standalone PlatformIO project successfully for `nodemcuv2`.
- Flashed the firmware over COM4 using PlatformIO; esptool reported that the flash hash was verified.
- Confirmed the strip remained dark after a full power cycle.
- Sent direct Adalight test frames at 230400 baud; the first 30 LEDs displayed dim red and the remaining 81 displayed dim blue.
- Confirmed the strip turned off after the 2500 ms timeout when the test stream stopped.
- Confirmed SignalRGB loaded the custom User plugin and connected at 230400 baud.
- Confirmed SignalRGB effects displayed correctly across the full 111-LED physical layout.
- Confirmed the LEDs turned off after SignalRGB was fully exited.

These checks establish operation on the tested installation. They are not a guarantee of compatibility or identical performance on other hardware and software versions. Long-duration stability and performance optimisation remain areas for further testing.

## Performance notes

The plugin currently requests a 40 ms frame interval (25 FPS cap). A 339-byte 8-N-1 frame at 230400 baud requires approximately 14.7 ms of serial wire time, excluding host, driver, and firmware overhead. The observed SignalRGB Inspector rate was around 21 FPS in the tested session. The Inspector value is not a direct measurement of the physical LED update rate. Performance diagnostics and higher frame-rate testing are separate ongoing work; no higher rate is promised by this configuration.

## Troubleshooting

### The device does not appear in SignalRGB

- Check Windows Device Manager for the CH340 serial device.
- Confirm the hardware IDs are `VID_1A86` and `PID_7523`.
- Use the device's **Plugins** button in SignalRGB's Device Information page to open the actual custom plugin directory.
- Fully exit and restart SignalRGB after replacing the plugin.

### SignalRGB cannot open the serial port

- Close other applications using the COM port, including PlatformIO serial monitors and Python serial scripts.
- Check the current COM port in Device Manager.
- Inspect the SignalRGB device console for serial connection errors.

### LEDs remain dark

- Confirm the external 5 V supply is on and the controller and strip share ground.
- Confirm the strip data input is connected to GPIO2/D4.
- Confirm SignalRGB reports a successful connection at 230400 baud.
- Remember that the firmware turns the strip off after 2500 ms without a complete valid Adalight frame.

### Colours or physical direction are wrong

- Confirm the strip is GRB WS2812B/compatible WS281x and has 111 LEDs.
- Check the `ledPositions` array in the SignalRGB plugin. Physical geometry is a host-side mapping and is not configured in the ESP8266 firmware.

### Serial flashing fails

- Close SignalRGB and all other applications using the COM port.
- Confirm the board is detected on the expected COM port.
- Check whether attached circuitry on GPIO2 is interfering with ESP8266 boot mode; temporarily disconnecting the LED data wire can help isolate this.
- Use the board's serial ROM bootloader and PlatformIO/esptool for recovery.

## Legacy WLED implementation

An earlier version of this project used a modified WLED v0.15.4 build with Wi-Fi disabled. It is retained under [`legacy/wled-0.15.4/`](legacy/wled-0.15.4/) for historical reference only. It is not required to build or use the standalone firmware described in this README. The legacy patch is version-specific and should only be applied to the corresponding upstream WLED v0.15.4 source.

## Licence and third-party components

The repository's root `LICENSE` applies to the project materials it covers. The archived WLED patch and WLED source modifications are subject to WLED's EUPL licensing terms; the corresponding licence notice is retained in `legacy/wled-0.15.4/`. PlatformIO, the ESP8266 Arduino framework, NeoPixelBus, and SignalRGB are separate projects/components and remain subject to their respective terms. Consult their upstream repositories for current licence and attribution requirements.
