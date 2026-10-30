# WLED USB Adalight for SignalRGB

A custom SignalRGB serial plugin and WLED firmware patch for controlling an ESP8266-based addressable RGB LED strip directly over USB using the Adalight protocol. The intended setup operates without Wi-Fi.

**Tested configuration:** Windows 11, SignalRGB, an ESP8266 NodeMCU-style board with a CH340 USB-to-serial interface, and a 111-LED WS2812B/WS281x strip. The custom firmware is based on WLED v0.15.4 and was built for the `nodemcuv2` PlatformIO environment. The firmware and plugin were tested together at 230400 baud.

This repository records one tested installation. Other controllers, USB-to-serial interfaces, LED chipsets, LED counts, wiring layouts, and SignalRGB versions may require changes and additional testing.

## Disclaimer

This repository is provided for informational and educational purposes only. The plugin, source patch, build instructions, and any firmware binaries are provided “AS IS” and “AS AVAILABLE,” without warranties of any kind, express or implied, to the maximum extent permitted by applicable law. **Use them at your own risk.** You are responsible for evaluating, testing, building, flashing, modifying, and using these materials, including verifying compatibility and keeping suitable backups and recovery firmware. Custom firmware can disable normal control and recovery paths; applying it incorrectly may cause loss of configuration, device malfunction, or hardware damage. The authors and contributors are not responsible for loss or damage arising from the use, misuse, or inability to use these materials, to the maximum extent permitted by law. Nothing in this notice excludes liability that cannot legally be excluded.

This is an independent community project. It is not an official WLED or SignalRGB project and is not endorsed by either. No ongoing support or compatibility with future versions is promised.

## How it works

The SignalRGB plugin reads colours from a 2D canvas, packages them as Adalight frames, and sends them over the controller's USB serial connection. WLED receives those frames and drives the strip. The custom firmware disables Wi-Fi and the normal access-point/connection paths while retaining WLED's Adalight serial input and LED output handling.

This is a **modified WLED build**, not a standalone Adalight firmware and not an official WLED binary. The firmware patch is provided separately from the SignalRGB plugin.

## Tested hardware and configuration

| Property | Tested value |
| --- | --- |
| Controller | ESP8266 NodeMCU-style development board (ESP-12E) |
| USB-to-serial interface | CH340 |
| USB Vendor ID | `0x1A86` |
| USB Product ID | `0x7523` |
| LED chipset | WS2812B / WS281x addressable RGB |
| LED count | 111 |
| LED data output | GPIO2 (often labelled D4) |
| LED colour order | GRB |
| Serial protocol | Adalight |
| Serial baud rate | 230400 baud |
| Serial format | 8 data bits, no parity, 1 stop bit (8-N-1) |
| SignalRGB canvas | 37 × 22 |
| Plugin frame-send interval | 40 ms (25 FPS maximum requested rate) |
| Firmware Adalight timeout | 2500 ms (2.5 seconds) |
| Boot state | LEDs forced off; no boot preset |
| PlatformIO environment | `nodemcuv2` |
| WLED source version | `v0.15.4` |

The Windows COM port can change when the controller is reconnected. The plugin matches the USB VID/PID rather than a hard-coded COM port. Other CH340 devices may use the same identifiers and could cause a device-match conflict. Close serial monitors and other applications that may have the port open before starting SignalRGB.

## Physical LED order and SignalRGB mapping

The tested 111-LED strip follows the perimeter of a monitor, starting at the bottom-left corner:

| LED indices | LEDs | Physical direction |
| --- | ---: | --- |
| 1–20 | 20 | Left edge, bottom to top |
| 21–55 | 35 | Top edge, left to right |
| 56–76 | 21 | Right edge, top to bottom |
| 77–111 | 35 | Bottom edge, right to left |

The plugin maps these LEDs to a 37 × 22 SignalRGB canvas so effects follow the physical strip path. Different LED counts or physical routing require edits to the hardware constants and `ledPositions` array in `WLED-USB-Adalight.js`.

## Install the SignalRGB plugin

1. Download [`WLED-USB-Adalight.js`](./WLED-USB-Adalight.js) from this repository.
2. In SignalRGB, open the WLED USB Adalight device's **Device Information** page and click **Plugins**. This opens the custom user-plugin directory SignalRGB uses. Copy `WLED-USB-Adalight.js` into that directory. Do not assume that the directory is under the Windows system drive; it may be on another drive or redirected with the user's Documents folder.
3. Close other programs that might have the controller's COM port open, including serial monitors and firmware tools.
4. Fully exit SignalRGB from its system-tray icon, then launch it again.
5. Confirm that **WLED USB Adalight (111 LEDs)** appears. The device information should identify the plugin origin as **User** when the custom user plugin is loaded.
6. Check the SignalRGB device console for a successful connection to the controller's COM port at **230400 baud**.
7. Run a perimeter effect and confirm that its direction follows the physical LED order described above.

The plugin uses SignalRGB's built-in serial API. It requests 230400 baud and limits frame-send attempts to one every 40 ms (25 FPS maximum requested rate). Actual frame rate depends on SignalRGB's render cadence, serial transmission, and device processing.

## Custom WLED USB-only firmware

The firmware patch is [`wled-0.15.4-usb-serial-only.patch`](./wled-0.15.4-usb-serial-only.patch). It targets **WLED v0.15.4** and the ESP8266 `nodemcuv2` PlatformIO environment. The patch contains both the original USB-only changes and the installation-specific settings listed below. It has been tested against a clean checkout of the upstream `v0.15.4` tag; applying it reproduced byte-for-byte identical versions of all four modified source files.

### Firmware behaviour and fixed settings

When `WLED_USB_SERIAL_ONLY` is defined, the patch:

- Disables Wi-Fi station operation and access-point initialisation.
- Skips normal Wi-Fi connection handling and Improv Wi-Fi scanning.
- Disables ESP-NOW.
- Retains WLED's Adalight serial input and LED transition handling.
- Forces one physical LED bus with 111 WS2812B/WS281x RGB LEDs on GPIO2, using GRB colour order.
- Forces the serial baud rate to 230400 baud, regardless of the saved WLED baud setting.
- Forces the Adalight realtime timeout to 2500 ms. When valid frames stop arriving, the realtime session times out and the LEDs return to the non-realtime brightness state; this installation is configured to remain off outside realtime playback.
- Forces LEDs off at boot and disables boot-preset activation.

The LED count, output pin, LED type, colour order, serial baud rate, and timeout are deliberately fixed in this build. The WLED configuration file cannot override these values. To use different hardware, edit the patch/source and rebuild the firmware.

Because Wi-Fi and the normal access-point path are disabled, do not expect the usual WLED web interface, wireless control, or Wi-Fi recovery to be available on this build.

### Before building

1. Install Git and PlatformIO Core (or the PlatformIO IDE extension, which provides its managed PlatformIO Core CLI).
2. Obtain the official [WLED v0.15.4 source](https://github.com/Aircoookie/WLED/tree/v0.15.4). For example, from the parent directory where you want the source checkout:

   ```powershell
   git clone --branch v0.15.4 --depth 1 https://github.com/Aircoookie/WLED.git WLED-0.15.4
   ```

3. Confirm the checkout is exactly at the `v0.15.4` tag:

   ```powershell
   git -C .\WLED-0.15.4 describe --tags --exact-match
   ```

4. Copy `wled-0.15.4-usb-serial-only.patch` from this repository into the WLED source directory, or use its full path in the following commands.
5. Check and apply the patch from the WLED source directory. Stop if the check fails; do not force the patch onto a different WLED version:

   ```powershell
   git apply --check ..\WLED-USB-Adalight\wled-0.15.4-usb-serial-only.patch
   git apply ..\WLED-USB-Adalight\wled-0.15.4-usb-serial-only.patch
   ```

   Adjust the relative path if your repositories are in different directories.
6. Keep a known-good recovery image and a backup of the controller's flash/configuration before flashing the custom build.

### Build

Run from the WLED source directory:

```powershell
pio run -e nodemcuv2
```

The firmware binary is created at:

```text
.pio\build\nodemcuv2\firmware.bin
```

The tested build completed successfully with a binary size of 878,496 bytes. Build output and size may vary with toolchain versions or source changes. Keep the exact WLED source version, patch, PlatformIO environment, and resulting firmware image together to make the build reproducible.

### Flash

Connect the ESP8266 over USB serial and identify its current COM port in Windows Device Manager. Close SignalRGB and any other application that may have the port open. From the WLED source directory, upload with PlatformIO, replacing `COM4` if necessary:

```powershell
pio run -e nodemcuv2 -t upload --upload-port COM4
```

The tested controller used a CH340 interface on COM4. Do not assume Windows will assign the same COM port on another computer or after reconnecting the device.

### Recovery

The custom build is not intended to be managed through the WLED web interface or Wi-Fi. If recovery is needed, flash a known-good stock WLED image built for the same ESP8266 target over USB serial using PlatformIO or an appropriate serial flashing tool. Keep the stock image, original source, and a full flash backup before flashing the USB-only build.

## Verification performed

The following checks were completed on the tested installation:

- Built WLED v0.15.4 successfully for `nodemcuv2`.
- Uploaded the firmware over USB serial and verified the flashed firmware image against the build binary.
- Performed a full power cycle; the LED strip remained dark at boot.
- Sent Adalight frames directly to the controller over COM4 at 230400 baud. The 111 LEDs displayed the expected two-colour test pattern, confirming the full strip was addressable.
- Confirmed that the LEDs turned off after the 2.5-second realtime timeout when frames stopped.
- Confirmed that SignalRGB loaded the custom **User** plugin, opened COM4 at 230400 baud, and reported a successful connection.
- Confirmed that the consolidated patch applies to a clean WLED `v0.15.4` worktree and reproduces the same four modified source files byte-for-byte.

These results establish the tested configuration; they are not a guarantee of identical performance or compatibility on other hardware and software versions.

## Troubleshooting

### The device does not appear in SignalRGB

- Check Windows Device Manager for the CH340 USB serial device.
- Confirm its hardware IDs are `VID_1A86` and `PID_7523`.
- Use the device's **Plugins** button in SignalRGB's Device Information page to open the actual custom plugin directory, and confirm the JavaScript file is there.
- Fully exit and restart SignalRGB after changing the plugin.

### SignalRGB cannot connect to the serial device

- Close other applications that may have opened the COM port, including PlatformIO serial monitors and Python serial test scripts.
- Unplug and reconnect the controller, then check the current COM port in Device Manager.
- Inspect SignalRGB's device console for serial connection errors.
- Confirm the console reports a successful connection at 230400 baud.

### The strip shows the wrong colours

- Confirm that the firmware is built with 111 LEDs, GPIO2/D4, and GRB colour order.
- The plugin sends RGB triplets; WLED handles the configured strip colour order separately.

### Effects run in the wrong physical direction

- Check that the physical LED numbering matches the four sections in **Physical LED order and SignalRGB mapping**.
- If the strip starts elsewhere, runs in the opposite direction, or uses different segment lengths, adjust `ledPositions` in the plugin.

### Flicker or dropped frames

- The plugin requests 230400 baud and uses a 40 ms frame-send interval (25 FPS maximum requested rate).
- Close other software using the serial device.
- Actual frame rate depends on SignalRGB render cadence, serial transmission, and device processing. Change one variable at a time when testing.

## Licence and attribution

The SignalRGB plugin in this repository is distributed under the MIT Licence; see [`LICENSE`](./LICENSE). WLED is a separate project licensed under the [European Union Public Licence (EUPL) v1.2 or later](https://github.com/Aircoookie/WLED/blob/v0.15.4/LICENSE). The firmware patch modifies WLED source; the plugin's MIT licence does not replace WLED's licence or notice requirements.

If you redistribute a compiled custom WLED firmware image, clearly identify it as a modified WLED v0.15.4 build, include the required WLED licence and attribution notices, and provide a readily accessible link to the corresponding source and patch for as long as the binary is distributed.
