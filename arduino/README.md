# arduino/ — Library Sensor Node (current parts)

Reads **ambient light (TEMT6000)** and **motion (HC-SR501 PIR)** on the
**Arduino MKR WiFi 1010** and publishes them at 1 Hz over MQTT.

Sound is captured directly on the iPad's microphone (Web Audio + speech
recognition), so it is not on the Arduino here. The **MKR WAN 1310** is
held in reserve for a follow-up where a second sensor node sits across
the room and reports back via LoRa.

## Files

| File | Purpose |
|---|---|
| `library_sensors.ino` | Main sketch (TEMT6000 + PIR) |
| `arduino_secrets.h`   | Wi-Fi + MQTT host config (edit this) |
| `wiring.txt`          | ASCII wiring diagram |

## Hardware you have

| Part | Role |
|---|---|
| Arduino MKR WiFi 1010 | Primary node — Wi-Fi + MQTT to Mac |
| Arduino MKR WAN 1310  | Reserved — LoRa extension experiment (not used) |
| TEMT6000              | Ambient light (analog) |
| HC-SR501 PIR          | Motion (digital, latched 3 s) |
| Breadboard + jumpers  | — |

## Arduino IDE setup (one-time)

1. **Board Manager** → install *Arduino SAMD Boards (32-bit ARM Cortex-M0+)*.
2. **Library Manager** (Tools → Manage Libraries…) → install:
   - `WiFiNINA` by Arduino
   - `ArduinoMqttClient` by Arduino
3. **Board / Port** → select *Arduino MKR WiFi 1010* + the USB port that
   appears when you plug it in.

## Flash

1. Edit `arduino_secrets.h`:
   - `WIFI_SSID` / `WIFI_PASS` — 2.4 GHz network (the MKR can't see 5 GHz)
   - `MQTT_HOST` — your Mac's LAN IP. Get with `ipconfig getifaddr en0`.
2. Hit **Upload** (⌘U).
3. Open Serial Monitor at **115200 baud**. You should see:
   ```
   [boot] library_sensors.ino  (TEMT6000 + PIR)
   [wifi] connecting to …
   [wifi] OK ip=192.168.1.42 rssi=-58
   [mqtt] connecting to 192.168.1.100:1883
   [mqtt] OK
   ```

## MQTT topics

All under base `ucl/library/dissertation/`:

| Topic        | Unit | Notes |
|---|---|---|
| `…/lux`      | lux  | derived from TEMT6000 (rough calibration; see wiring.txt) |
| `…/lux_raw`  | 0-1023 | raw 10-bit ADC value, useful for calibration |
| `…/motion`   | 0/1  | latched HIGH for 3 s after PIR triggers |

All published with the **retain** flag so a late-joining viewer sees the
last value immediately.

## Sanity check from the Mac

With Mosquitto running on the Mac (see project root `mosquitto/`):

```bash
brew install mosquitto-clients
mosquitto_sub -h localhost -t 'ucl/library/dissertation/#' -v
```

You should see two or three lines per second.

## What about the MKR WAN 1310?

Hold for the follow-up. Easiest "DL story" angle: the WAN 1310 sits at
the far end of the library carrying the same TEMT6000/PIR + a second
TEMT6000 on a windowsill, and reports lux + motion over LoRa at 0.1 Hz to
a base WiFi gateway, which republishes onto the same MQTT topic tree.
This shows the *Sense → Deploy* layer scaling beyond Wi-Fi reach. None of
this is required for the upcoming supervisor demo.
