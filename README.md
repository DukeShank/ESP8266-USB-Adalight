# ESP8266 USB Adalight for SignalRGB

<img src="images/esp8266-usb-adalight.png" alt="Monitor with an LED strip around its edge" width="160" align="right">

A standalone ESP8266 firmware and SignalRGB plugin for driving an addressable RGB LED strip over USB serial using the Adalight protocol.

The primary firmware is a small PlatformIO project built with the ESP8266 Arduino framework and NeoPixelBus. It does not use WLED and does not provide Wi-Fi, a web interface, presets, or network control.

## Tested configuration

This repository documents one tested installation:

| Property | Tested value |
| --- | --- |
| Host | Windows 11, SignalRGB 2.5.86 |
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
| Minimum plugin frame gap | 20 ms |
| No-valid-frame timeout | 2500 ms |
| Firmware current limit | 2000 mA total (estimated, strip + ESP8266) |
| Power supply | One 5 V supply for the strip and NodeMCU VIN |
| PlatformIO environment | `nodemcuv2` |
| ESP8266 PlatformIO platform | `espressif8266@4.2.1` |
| LED library | `makuna/NeoPixelBus@2.8.4` |

Other boards, USB-to-serial interfaces, LED chipsets, LED counts, wiring layouts, and software versions may require changes and additional testing. See [Status](#status) for the tests of version 1.0.0.

## Repository layout

```text
.
├── firmware/
│   ├── .gitignore
│   ├── platformio.ini
│   └── src/
│       └── main.cpp
├── images/
│   └── esp8266-usb-adalight.png
├── plugin/
│   └── ESP8266-USB-Adalight.js
├── legacy/
│   └── wled-0.15.4/
│       ├── README.md
│       ├── wled-0.15.4-usb-serial-only.patch
│       └── WLED-LICENSE-EUPL-1.2.txt
├── .gitattributes
├── LICENSE
└── README.md
```

- `firmware/` is the recommended implementation.
- `plugin/` contains the SignalRGB plugin.
- `images/` contains the device image shown in SignalRGB.
- `legacy/wled-0.15.4/` preserves the earlier WLED-based approach for reference; it is not required by the standalone firmware.
- `.gitattributes` stores text files with LF line endings and keeps images binary.

## How it works

The SignalRGB plugin samples the colours at the configured physical LED positions, assembles an Adalight frame, and sends it over USB serial. The ESP8266 firmware validates the Adalight header and checksum, receives the complete RGB payload into a staging buffer, applies the current limit, and then updates the LED strip.

The firmware handles the sequential LED data only. It does not know the monitor's physical geometry. LED placement, direction, and screen-to-LED mapping are defined by the SignalRGB plugin's `ledPositions` array.

### ESP8266 peripheral allocation

The firmware uses the ESP8266's two UARTs for separate jobs:

- **UART0 RX / GPIO3:** receives Adalight data from SignalRGB at 230400 baud.
- **UART1 TX / GPIO2:** outputs the WS2812-compatible LED waveform through NeoPixelBus's `NeoEsp8266Uart1Ws2812xMethod`.

UART1's WS2812 output method is fixed to GPIO2 on this target. The LED output pin is therefore not a freely configurable GPIO setting in this implementation.

## Physical LED order and SignalRGB mapping

The tested 111-LED strip follows the perimeter of a monitor, starting at the bottom-left corner:

| LED numbers | LEDs | Physical direction | Canvas positions (x, y) |
| --- | ---: | --- | --- |
| 1–20 | 20 | Left edge, bottom to top | (0, 20) to (0, 1) |
| 21–55 | 35 | Top edge, left to right | (1, 0) to (35, 0) |
| 56–75 | 20 | Right edge, top to bottom | (36, 1) to (36, 20) |
| 76–111 | 36 | Bottom edge, right to left | (36, 21) to (1, 21) |

The plugin maps these LEDs onto a 37 × 22 SignalRGB canvas so effects follow the physical strip path. For a different LED count or routing, change `LED_COUNT` and `ledPositions` in the plugin and `LED_COUNT` in the firmware, then rebuild the firmware.

## Firmware behaviour

The standalone firmware is deliberately limited to the functions required by this installation:

- Receives Adalight over UART0 at 230400 baud, 8-N-1.
- Uses a 1024-byte UART receive buffer, configured before serial initialisation.
- Accepts frames for exactly 111 LEDs.
- Checks the Adalight header and XOR checksum before accepting a payload.
- Discards a partly received frame if no byte arrives for 20 ms.
- Buffers the full 333-byte RGB payload before displaying a frame.
- Limits the estimated current of each frame (see [Current limit](#current-limit)).
- Sends the pixel data to the LED strip in GRB order using NeoPixelBus and UART1.
- Starts with the LED output cleared.
- Clears the strip after 2500 ms without a complete valid frame.
- Does not emit debug text on the Adalight serial port; debug output would corrupt the protocol stream.
- Does not use Wi-Fi. ESP8266 Arduino core 3.x keeps Wi-Fi off at boot unless the sketch starts it, and this firmware never does.

The current implementation is fixed to 111 LEDs, GPIO2/UART1 output, GRB order, 230400 baud, a 2500 ms timeout and a 2000 mA current limit. To use different hardware or settings, modify the constants at the top of `firmware/src/main.cpp` and rebuild.

### Current limit

Full white on all 111 LEDs draws roughly 6.1 A (about 55 mA per LED). The firmware estimates the current of every frame with the same model as WLED's automatic brightness limiter and scales all LEDs down by one factor when the estimate exceeds the limit:

| Constant in `main.cpp` | Value | Meaning |
| --- | ---: | --- |
| `POWER_LIMIT_MA` | 2000 | Total current allowed for strip and ESP8266; `0` disables the limit |
| `ESP_CURRENT_MA` | 80 | Reserved for the ESP8266 board (WLED's value for ESP8266) |
| `LED_IDLE_MA` | 1 | Per LED with all channels at 0 |
| `LED_FULL_WHITE_MA` | 55 | Per LED at 255/255/255 (WLED's default for WS2812B) |

With these values, 1809 mA is available for the LEDs above their idle current. Effects below that estimate are shown unchanged. Full white is reduced to about 29 % (channel value 74 of 255). Colours keep their proportions because all channels and LEDs use the same factor.

The calculation is an estimate, not a measurement. Real strips vary. Keep `POWER_LIMIT_MA` below the supply's rated current and size the wiring with a margin. Raise the value only if the supply and wiring are rated for it.

For comparison, the legacy WLED build used WLED's default limit of 850 mA unless it was changed in the WLED settings.

## Hardware and power considerations

Use a suitable regulated 5 V supply for the LED strip. The ESP8266 and LED strip must share a common ground, and the data signal must be connected to the strip's data input. Ensure the supply and wiring are sized for the strip's possible current draw; the firmware's current limit is an estimate and does not replace a correctly rated supply.

The tested installation powers the NodeMCU VIN and LED strip from the same external 5 V supply in parallel, with a common ground. If the strip draws more than the supply can deliver, the voltage drops and the ESP8266 can reset. The USB connection is made through a powered USB hub because this particular development board feeds power back onto the USB bus. NodeMCU clones vary: inspect the power-path design of your board rather than assuming its USB 5 V and VIN rails are isolated.

GPIO2 is an ESP8266 boot-strapping pin. Keep the LED data wiring and attached strip circuitry in a state that permits the board to enter its normal boot mode. If serial flashing fails to connect, temporarily isolating the LED data connection can help determine whether an attached circuit is affecting boot.

## Build

Install Git and PlatformIO Core, or install the PlatformIO IDE extension (which provides a managed PlatformIO Core CLI).

From the repository root, open a terminal and run:

```powershell
cd firmware
pio run -e nodemcuv2
```

- `cd firmware` changes into the PlatformIO project folder, where `platformio.ini` is.
- `pio run -e nodemcuv2` compiles the `nodemcuv2` environment defined in `platformio.ini`. On the first run, PlatformIO downloads the ESP8266 platform and NeoPixelBus at the pinned versions.

The compiled firmware is written to:

```text
firmware/.pio/build/nodemcuv2/firmware.bin
```

The `firmware/.gitignore` excludes generated PlatformIO build output from Git.

## Flash

1. Close SignalRGB and any other application that may have the controller's COM port open.
2. Identify the controller's current COM port in Windows Device Manager.
3. From the `firmware` directory, upload the firmware (replace `COM4` if necessary):

```powershell
pio run -e nodemcuv2 -t upload --upload-port COM4
```

- `-t upload` builds the firmware if needed and then flashes it.
- `--upload-port COM4` selects the serial port of the controller.

The PlatformIO upload speed is 115200 baud. This is separate from the firmware's runtime Adalight baud rate of 230400 baud.

The ESP8266 serial ROM bootloader provides a recovery path if the application firmware is not functioning. Keep a known-good firmware image and, where practical, a full-flash backup before experimenting with firmware changes. The firmware does not provide Wi-Fi or a web-based recovery interface.

## Install the SignalRGB plugin

1. Download `plugin/ESP8266-USB-Adalight.js` from this repository.
2. In SignalRGB, open the controller's **Device Information** page and click **Plugins**. This opens the custom user-plugin directory SignalRGB is using. Copy `ESP8266-USB-Adalight.js` into that directory; do not assume the directory is on the Windows system drive.
3. **Updating from a version before 1.0.0:** delete `WLED-USB-Adalight.js` from the same directory. Both files match the same USB VID/PID, so keeping both causes a device-match conflict.
4. Fully exit SignalRGB from its system-tray icon and launch it again.
5. Confirm the controller appears as **ESP8266 USB Adalight (111 LEDs)**, version **1.0.0**, and that the plugin origin is **User**.
6. Check the device console for a successful connection to the controller's COM port at **230400 baud**.
7. **Updating from a version before 1.0.0:** the device name changed from "WLED USB Adalight (111 LEDs)", so SignalRGB treats it as a new device. Place and scale it again on the **Layouts** page.

The plugin identifies the USB device by VID/PID (`1A86:7523`), not by a fixed COM port. Other CH340 devices can use the same identifiers and may cause a device-match conflict. Close serial monitors, firmware tools, and other applications that may hold the COM port before starting SignalRGB.

## Plugin settings

The settings are on the device's page in SignalRGB.

| Setting | Values | Default | Effect |
| --- | --- | --- | --- |
| Lighting Mode | Canvas, Forced | Canvas | **Canvas:** each LED shows the effect colour at its canvas position. **Forced:** all LEDs show Forced Color. |
| Forced Color | Any colour | `#009bde` | Colour used in Forced mode. |

The firmware's current limit also applies in Forced mode.

## Plugin behaviour

- **Frame timing:** SignalRGB calls the plugin's `Render()` function every 30 ms by default. The plugin sends a frame when at least 20 ms have passed since the previous frame. At the default interval this is one frame per `Render()` call, about 33 frames per second.
- **Reconnect:** if the COM port is not open (for example, after the controller is unplugged), the plugin tries to open it every 2 s. The first failure is logged once; the next successful connection is logged again.
- **Exit, sleep and streaming off:** SignalRGB calls `Shutdown()` in all three cases. The plugin sends one all-black frame and then closes the port, so the strip turns off at once. If that frame does not arrive, the firmware's 2500 ms timeout turns the strip off.

## Adalight frame format

Each frame consists of:

1. The three ASCII signature bytes `Ada`.
2. A two-byte big-endian LED count encoded as `LED_COUNT - 1`.
3. A checksum byte equal to `count_high XOR count_low XOR 0x55`.
4. Three RGB bytes per LED.

For 111 LEDs, the header is `41 64 61 00 6E 3B`, the payload is 333 bytes and the complete frame is 339 bytes. The plugin sends RGB triplets; the firmware/library applies the strip's GRB output order.

## Status

### Version 1.0.0

Changes compared with the previous version:

- Plugin renamed to **ESP8266 USB Adalight (111 LEDs)** (`ESP8266-USB-Adalight.js`), version 1.0.0, device image added.
- Plugin: minimum frame gap 20 ms (was 40 ms); all-black frame on exit and sleep; Lighting Mode and Forced Color settings; frame buffer built once and reused; write errors logged again after a reconnect.
- Firmware: current limit of 2000 mA (estimated); code cleanup.

Tested on Windows 11 with SignalRGB 2.5.86 and the hardware listed in [Tested configuration](#tested-configuration). Passed:

- Firmware built and flashed with PlatformIO (`nodemcuv2`).
- Plugin loads as **ESP8266 USB Adalight (111 LEDs)**, version 1.0.0, after the old `WLED-USB-Adalight.js` was removed.
- Effects run without flicker or dropped frames at the 20 ms minimum frame gap.
- Strip turns off at once on SignalRGB exit, on sleep and when streaming is turned off.
- A bright white effect is limited and the ESP8266 does not reset.
- Forced mode shows the Forced Color.

Host tests (no hardware) also passed for: Adalight parser, checksum and LED-count checks, stalled-frame reset, timeout, current-limit scaling, plugin frame contents, LED mapping, frame timing, Forced mode, reconnect and shutdown.

The device image is loaded from the `main` branch, so it is visible in SignalRGB only once version 1.0.0 is on `main`.

### Verification of the previous version

The following checks were completed on the tested installation before version 1.0.0:

- Built the standalone PlatformIO project successfully for `nodemcuv2`.
- Flashed the firmware over COM4 using PlatformIO; esptool reported that the flash hash was verified.
- Confirmed the strip remained dark after a full power cycle.
- Sent direct Adalight test frames at 230400 baud; the first 30 LEDs displayed dim red and the remaining 81 displayed dim blue.
- Confirmed the strip turned off after the 2500 ms timeout when the test stream stopped.
- Confirmed SignalRGB loaded the custom User plugin and connected at 230400 baud.
- Confirmed SignalRGB effects displayed correctly across the full 111-LED physical layout.
- Confirmed the LEDs turned off after SignalRGB was fully exited.

These checks establish operation on the tested installation. They are not a guarantee of compatibility or identical performance on other hardware and software versions.

## Performance notes

A 339-byte 8-N-1 frame at 230400 baud needs about 14.7 ms on the serial line (10 bits per byte), excluding host, driver, and firmware overhead. Writing 111 LEDs to the strip takes about 3.3 ms in the firmware. The 20 ms minimum frame gap leaves room for both.

At the default 30 ms `Render()` interval, the plugin sends about 33 frames per second, which uses about half of the serial line's capacity. If SignalRGB calls `Render()` more often, the 20 ms gap limits the rate to at most 50 frames per second.

Before version 1.0.0, the minimum gap was 40 ms. At a 30 ms `Render()` interval this sent a frame on every second call, about every 60 ms. The SignalRGB Inspector showed about 21 FPS in that session; the Inspector value is not a direct measurement of the physical LED update rate.

## Troubleshooting

### The device does not appear in SignalRGB

- Check Windows Device Manager for the CH340 serial device.
- Confirm the hardware IDs are `VID_1A86` and `PID_7523`.
- Use the device's **Plugins** button in SignalRGB's Device Information page to open the actual custom plugin directory.
- Fully exit and restart SignalRGB after replacing the plugin.

### Two devices appear, or the device does not connect after updating

- Delete `WLED-USB-Adalight.js` (the plugin file name before version 1.0.0) from the custom plugin directory, so that only `ESP8266-USB-Adalight.js` matches the controller.
- Fully exit and restart SignalRGB.

### The device moved or lost its position after updating

- The device name changed in version 1.0.0, so SignalRGB treats it as a new device. Place and scale it again on the **Layouts** page.

### SignalRGB cannot open the serial port

- Close other applications using the COM port, including PlatformIO serial monitors and Python serial scripts.
- Check the current COM port in Device Manager.
- Inspect the SignalRGB device console for serial connection errors. The plugin retries every 2 s.

### LEDs remain dark

- Confirm the external 5 V supply is on and the controller and strip share ground.
- Confirm the strip data input is connected to GPIO2/D4.
- Confirm SignalRGB reports a successful connection at 230400 baud.
- Remember that the firmware turns the strip off after 2500 ms without a complete valid Adalight frame.

### Bright or white effects look dimmer than expected

- This is the firmware's current limit. Full white is reduced to about 29 % with the default 2000 mA limit.
- Raise `POWER_LIMIT_MA` in `firmware/src/main.cpp` only if the power supply and wiring are rated for the higher current, then rebuild and flash.

### The controller resets during bright effects

- The supply voltage is dropping under load. Lower `POWER_LIMIT_MA`, or use a supply with a higher current rating.

### All LEDs show one colour and ignore the effect

- Check that **Lighting Mode** is set to **Canvas** on the device's settings page.

### Colours or physical direction are wrong

- Confirm the strip is GRB WS2812B/compatible WS281x and has 111 LEDs.
- Check the `ledPositions` array in the SignalRGB plugin against [Physical LED order and SignalRGB mapping](#physical-led-order-and-signalrgb-mapping). Physical geometry is a host-side mapping and is not configured in the ESP8266 firmware.

### Serial flashing fails

- Close SignalRGB and all other applications using the COM port.
- Confirm the board is detected on the expected COM port.
- Check whether attached circuitry on GPIO2 is interfering with ESP8266 boot mode; temporarily disconnecting the LED data wire can help isolate this.
- Use the board's serial ROM bootloader and PlatformIO/esptool for recovery.

## Legacy WLED implementation

An earlier version of this project used a modified WLED v0.15.4 build with Wi-Fi disabled. It is retained under [`legacy/wled-0.15.4/`](legacy/wled-0.15.4/) for historical reference only. It is not required to build or use the standalone firmware described in this README. The legacy patch is version-specific and should only be applied to the corresponding upstream WLED v0.15.4 source. The current plugin also works with that build: it uses the same Adalight frames, LED count and baud rate.

## Disclaimer

This repository is provided for informational and educational purposes only. The plugin, firmware, patch and instructions are provided "as is", without warranties of any kind, to the extent permitted by applicable law. Use them at your own risk. You are responsible for building, flashing and using them, for checking compatibility, and for keeping backups and recovery firmware. Incorrect firmware, wiring or power supply sizing can cause device malfunction or hardware damage.

This is an independent community project. It is not an official WLED or SignalRGB project and is not endorsed by either.

## Licence and third-party components

The repository's root `LICENSE` (MIT) applies to the plugin, the standalone firmware, the device image and the documentation. The archived WLED patch and WLED source modifications are subject to WLED's EUPL licensing terms; the corresponding licence notice is retained in `legacy/wled-0.15.4/`. PlatformIO, the ESP8266 Arduino framework, NeoPixelBus, and SignalRGB are separate projects/components and remain subject to their respective terms. Consult their upstream repositories for current licence and attribution requirements.
