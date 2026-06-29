# CLAUDE_CODE_FLASH_ARDUINO.md

> The MKR WiFi 1010 is plugged into the Mac via USB. Goal: flash the
> HTTP-server sketch, read its IP from the serial log, and confirm the
> iPad app's dashboard goes from "Arduino · mock" to "Arduino · live"
> after typing that IP into Settings.
>
> Final deployment is iPad + Arduino only — the Mac is here purely for
> the one-time flash.

---

## Pre-flight (Claude Code prints + verifies)

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# 1. arduino-cli is the official Arduino command-line tool. Install once.
command -v arduino-cli >/dev/null || brew install arduino-cli
arduino-cli version | head -1   # should print "arduino-cli  Version: 0.35+"

# 2. The MKR WiFi 1010 should appear:
arduino-cli board list
# Expect a row like:  /dev/cu.usbmodem14101  Serial  Arduino MKR WiFi 1010  arduino:samd:mkrwifi1010
# If not: the cable is power-only OR the board needs a double-tap reset.
```

If `board list` returns nothing, double-tap the small **RESET** button on
the MKR WiFi 1010 (LED pulses) and run `arduino-cli board list` again.

---

## Step 1 — Fill Wi-Fi credentials (you, on the Mac)

```bash
$EDITOR "$DLL/arduino/library_sensors/arduino_secrets.h"
```

Edit:

```c
#define WIFI_SSID    "your-2.4GHz-network"     // MKR can't see 5 GHz
#define WIFI_PASS    "your-password"
```

Save. **Both iPad and MKR must be on this same Wi-Fi** for the iPad app
to reach the Arduino at the IP DHCP gives it. (If your network is enterprise
WPA2 / eduroam, set `USE_AP=1` in the .ino — Arduino creates its own
"VirtualLibrarian" Wi-Fi at `192.168.4.1` instead.)

---

## Step 2 — Flash + monitor + extract IP (Claude Code runs this)

```bash
bash "$DLL/scripts/flash-arduino.sh"
```

This script:

* installs the SAMD board core + WiFiNINA library (idempotent),
* auto-detects the USB port,
* refuses to flash if `arduino_secrets.h` still has the placeholder strings,
* compiles + uploads,
* opens the serial monitor for 15 s,
* greps the boot log for the Arduino's IP and prints a banner like:

```
════════════════════════════════════════════════════════════════
  ✅ Arduino reachable at  http://192.168.1.42/sensors

  Test from this Mac:
    curl http://192.168.1.42/sensors

  On the iPad: ⚙︎ Settings → Arduino IP → 192.168.1.42 → Save & reload
════════════════════════════════════════════════════════════════
```

Take note of that IP — you need it in Step 4.

---

## Step 3 — Verify the HTTP endpoint (Claude Code runs this)

```bash
bash "$DLL/scripts/verify-arduino.sh" <IP-from-step-2>
```

You should see five lines like:

```
[1/5] {"lux":312.4,"lux_raw":97,"motion":0,"uptime_ms":24561}
[2/5] {"lux":311.9,"lux_raw":97,"motion":0,"uptime_ms":25602}
[3/5] {"lux":102.3,"lux_raw":32,"motion":0,"uptime_ms":26644}    ← finger over TEMT6000
[4/5] {"lux":312.0,"lux_raw":97,"motion":1,"uptime_ms":27689}    ← wave hand for PIR
[5/5] {"lux":312.0,"lux_raw":97,"motion":1,"uptime_ms":28732}
```

If you cover the TEMT6000 you should see `lux` drop, and if you wave at
the PIR you should see `motion` flip to `1` and latch for ~3 s.

---

## Step 4 — Wire it through to the iPad

On the iPad (already has the new app):

1. Tap **⚙︎ Settings** (top-right).
2. In **Arduino IP**, type the IP from Step 2 → tap **Save & reload**.
3. The dashboard's top label flips from `Arduino · mock` to `Arduino · arduino-http`.
4. Light value should update once a second; motion pill should light up
   green when something moves in front of the PIR.

**No app re-install needed** for this transition.

---

## Step 5 — One physical sensor check

* **TEMT6000**: cover it with a finger → `Light` in the dashboard drops
  within 1 s; uncover → it bounces back.
* **PIR**: wave a hand from ~30 cm above the dome → `Reader present` pill
  lights up for 3 s.
* **Heartbeat**: LED_BUILTIN on the MKR blinks once per HTTP response —
  basically once per iPad poll.

---

## If something doesn't work

| Symptom | Where to look |
|---|---|
| `flash-arduino.sh: brew: command not found` | install Homebrew first: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| `arduino-cli upload` errors with "no device on port" | double-tap RESET on the MKR; the bootloader is only available for ~8 s after reset |
| Serial monitor shows endless `.` after `[wifi] connecting to …` | wrong SSID/PASS, or the network is 5 GHz only (MKR is 2.4 GHz only) |
| Serial monitor finishes but no IP printed | check the `[wifi] OK ip=…` line in `/var/folders/.../*` (look at the temp file path the script prints); if missing, the WiFi handshake didn't complete |
| `verify-arduino.sh` returns "Connection refused" | the Arduino is on a different subnet than the Mac — same SSID but different VLAN? try the AP-mode fallback |
| `lux` is wedged at 0 or 1023 | TEMT6000 SIG wire is on the wrong pin or power isn't 3 V3 |
| `motion` never goes to 1 | PIR needs ~30 s to settle on first power-up; also confirm 5 V on VCC (not 3 V3) |
| iPad dashboard says "Arduino · waiting" forever | iPad and Mac/Arduino on different Wi-Fi networks; check both |

---

## What NOT to do this round

- Don't restructure `arduino/library_sensors/` — `arduino-cli` only
  compiles when the folder name matches the `.ino` filename.
- Don't delete the old top-level `arduino/library_sensors.ino` and
  `arduino/arduino_secrets.h` — they're harmless leftovers from the old
  layout. (Optional cleanup: `rm arduino/library_sensors.ino arduino/arduino_secrets.h`.)
- Don't enable the MKR WAN 1310 yet — it doesn't have Wi-Fi, would
  silently brick this sketch.
- Don't commit `arduino_secrets.h` with real credentials.
