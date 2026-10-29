# WLED USB Adalight for SignalRGB

A custom SignalRGB serial plugin and WLED firmware patch for controlling an ESP8266-based addressable RGB LED strip directly over USB using the Adalight protocol. The intended setup operates without Wi-Fi.

**Status:** End-to-end operation has been tested with SignalRGB on Windows 11, a 111-LED WS281x strip, and a custom WLED 0.15.4 ESP8266 build. The repository is based on that working setup; other boards and LED configurations may need changes.

## Disclaimer

This repository is provided for informational and educational purposes only. The plugin, source patch, build instructions, and any firmware binaries are provided “AS IS” and “AS AVAILABLE,” without warranties of any kind, express or implied, to the maximum extent permitted by applicable law. **Use them at your own risk.** You are responsible for evaluating, testing, building, flashing, modifying, and using these materials, including verifying compatibility and keeping suitable backups and recovery firmware. Custom firmware can disable normal control and recovery paths; applying it incorrectly may cause loss of configuration, device malfunction, or hardware damage. The authors and contributors are not responsible for loss or damage arising from the use, misuse, or inability to use these materials, to the maximum extent permitted by law. Nothing in this notice excludes liability that cannot legally be excluded.

This is an independent community project and is not an official WLED or SignalRGB project, nor is it endorsed by either. No ongoing support or compatibility with future versions is promised.

## How it works

The SignalRGB plugin reads colours from a 2D canvas, packages them as Adalight frames, and sends them over the controller's USB serial connection. WLED receives those frames and drives the strip. The custom firmware disables the normal Wi-Fi connection and access-point paths while retaining Adalight serial input.

This is a custom firmware build, not an official WLED binary. The firmware patch is provided separately from the SignalRGB plugin.

## Tested hardware and configuration

| Property | Tested value |
| --- | --- |
| Controller | ESP8266 development board |
| USB-to-serial adapter | CH340 |
| USB Vendor ID | `0x1A86` |
| USB Product ID | `0x7523` |
| LED chipset | WS281x addressable RGB |
| LED count | 111 |
| LED data output | GPIO2 (often labelled D4) |
| WLED colour order | GRB |
| Serial protocol | Adalight |
| Baud rate | 115200 |
| Serial format | 8 data bits, no parity, 1 stop bit (8-N-1) |
| SignalRGB layout | 37 × 22 canvas |

The Windows COM port can change when the controller is reconnected. The plugin matches the USB VID/PID rather than a hard-coded COM port. Other CH340 devices may use the same identifiers and could cause a device match conflict.

## Physical LED order and SignalRGB mapping

The tested 111-LED strip follows the perimeter of a monitor, starting at the bottom-left corner:

| LED indices | LEDs | Physical direction |
| --- | ---: | --- |
| 1–20 | 20 | Left edge, bottom to top |
| 21–55 | 35 | Top edge, left to right |
| 56–75 | 20 | Right edge, top to bottom |
| 76–111 | 36 | Bottom edge, right to left |

The plugin maps these LEDs to a 37 × 22 SignalRGB canvas so effects follow the physical strip path. Different LED counts or physical routing require edits to the constants and `ledPositions` array in `WLED-USB-Adalight.js`.

## Install the SignalRGB plugin

1. Download [`WLED-USB-Adalight.js`](./WLED-USB-Adalight.js) from this repository.
2. Copy it to SignalRGB's user plugin directory:

   ```text
   %USERPROFILE%\Documents\WhirlwindFX\Plugins
   ```

3. Close other programs that might have the controller's COM port open, including serial monitors or firmware tools.
4. Restart SignalRGB.
5. Confirm that **WLED USB Adalight (111 LEDs)** appears and check SignalRGB's device console if it fails to connect.
6. Run a perimeter effect and confirm that its direction follows the LED order described above.

The plugin uses SignalRGB's built-in serial API. It requests 115200 baud and limits frame-send attempts to one every 40 ms (approximately 25 FPS maximum before other processing and transmission overhead).

## Custom WLED USB-only firmware

The firmware change is a patch for **WLED v0.15.4**, targeting the ESP8266 `nodemcuv2` PlatformIO environment. The patch is in [`wled-0.15.4-usb-serial-only.patch`](./wled-0.15.4-usb-serial-only.patch). It has been checked against a clean WLED 0.15.4 source tree.

The patch:

- Defines the project-specific `WLED_USB_SERIAL_ONLY` flag. This is not a standard WLED build option.
- Sets Wi-Fi to `WIFI_OFF` during setup and skips normal station initialisation and connection handling.
- Prevents normal access-point initialisation and skips Improv Wi-Fi scanning in the main loop.
- Disables ESP-NOW.
- Retains Adalight serial input and WLED transition handling.

Because Wi-Fi and the normal access-point path are disabled, do not expect the usual WLED web interface, wireless control, or Wi-Fi recovery to be available on this build.

### Before building

1. Obtain the official [WLED v0.15.4 source](https://github.com/Aircoookie/WLED/tree/v0.15.4).
2. Configure and verify the strip in normal WLED first: 111 WS281x LEDs, GPIO2/D4 data output, and GRB colour order. Save the settings and keep a stock firmware image available before switching to the custom build.
3. Apply the patch from this repository to the WLED source tree. If the patch does not apply cleanly, stop and confirm you are using the v0.15.4 source rather than forcing it onto a different version.
4. Build with PlatformIO from the WLED source directory.

### Build and flash

Build the firmware:

```powershell
pio run -e nodemcuv2
```

Upload it over USB serial (replace `COM4` if Windows assigned a different port):

```powershell
pio run -e nodemcuv2 -t upload --upload-port COM4
```

The normal build output is under `.pio\build\nodemcuv2\`. Keep the exact source version, patch, and resulting firmware image together so the build can be reproduced.

### Recovery

The custom build is not intended to be managed through the WLED web interface or Wi-Fi. If recovery is needed, flash a known-good stock WLED image built for the same ESP8266 target over USB serial using PlatformIO or an appropriate serial flashing tool. Keep the stock image and original source backup before flashing the USB-only build.

## Troubleshooting

### The device does not appear in SignalRGB

- Check Windows Device Manager for the CH340 USB serial device.
- Confirm its hardware IDs are `VID_1A86` and `PID_7523`.
- Confirm the plugin is in the user Plugins directory and restart SignalRGB.

### SignalRGB cannot connect to the serial device

- Close other applications that may have opened the COM port.
- Unplug and reconnect the controller, then check the current COM port in Device Manager.
- Inspect SignalRGB's device console for connection errors.

### The strip shows the wrong colours

- Verify the strip is configured in WLED for 111 LEDs, GPIO2/D4, and the correct hardware colour order.
- The plugin sends RGB triplets; WLED handles the configured strip colour order separately.

### Effects run in the wrong physical direction

- Check that the physical LED numbering matches the four sections in **Physical LED order and SignalRGB mapping**.
- If your strip starts elsewhere, runs in the opposite direction, or uses different segment lengths, adjust `ledPositions` in the plugin.

### Flicker or dropped frames

- Start with the configured 115200 baud rate and 40 ms frame interval.
- Close other software using the serial device.
- Change one variable at a time; the effective frame rate depends on SignalRGB render cadence and serial transmission time.

## Licence and attribution

The SignalRGB plugin in this repository is distributed under the MIT Licence; see [`LICENSE`](./LICENSE). WLED is a separate project licensed under the [European Union Public Licence (EUPL) v1.2 or later](https://github.com/Aircoookie/WLED/blob/v0.15.4/LICENSE). The firmware patch modifies WLED source; the plugin's MIT licence does not replace WLED's licence or notice requirements.

If you redistribute a compiled custom WLED firmware image, clearly identify it as a modified WLED v0.15.4 build, include the required WLED licence and attribution notices, and provide a readily accessible link to the corresponding source and patch for as long as the binary is distributed.
