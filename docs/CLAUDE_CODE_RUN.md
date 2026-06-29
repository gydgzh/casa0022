# CLAUDE_CODE_RUN.md — single-page execution prompt

> Paste this into Claude Code in the project root. The goal is to take the
> dissertation from "code written, hardware in a box" to "iPad app running
> with TEMT6000 + PIR feeding into the dashboard."

---

## What's on Yidan's desk

| Item | Role |
|---|---|
| Mac (this machine) | Mosquitto broker, Xcode for iPad build |
| iPad (USB-connected) | Native app target via Capacitor |
| Arduino MKR WiFi 1010 | Wi-Fi + MQTT publisher of light + motion |
| Arduino MKR WAN 1310 | unused this round (LoRa, parked) |
| TEMT6000 breakout | analog ambient light → A0 |
| HC-SR501 PIR | digital motion → D2 |

## What Claude Code does, top to bottom

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"
```

### Phase 1 — Mac broker (5 min)

```bash
# 1. Install once
brew install mosquitto cloudflared            # cloudflared only for web fallback
brew tap homebrew/services
# 2. Start broker
brew services restart mosquitto || mosquitto -c "$DLL/mosquitto/mosquitto.conf" -d
# 3. Sanity check
lsof -nP -iTCP:1883 -sTCP:LISTEN | head -2
lsof -nP -iTCP:9001 -sTCP:LISTEN | head -2
# 4. Mac LAN IP — this goes into arduino_secrets.h AND into the app's
#    Settings panel.
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1)
echo "Mac LAN IP for Arduino + iPad app: $LAN_IP"
```

### Phase 2 — Arduino flash (15 min, one-off)

The sketch is already at `arduino/library_sensors.ino`.
Claude Code can't drive Arduino IDE itself, so it should:

1. Print this checklist to chat:
   - Open Arduino IDE.
   - Tools → Board → Arduino MKR WiFi 1010 (install SAMD core if missing).
   - Tools → Manage Libraries → install **WiFiNINA** + **ArduinoMqttClient**.
   - Open `arduino/library_sensors.ino`.
   - Edit `arduino/arduino_secrets.h` — fill `WIFI_SSID` / `WIFI_PASS` / `MQTT_HOST=<Mac LAN IP>` from Phase 1.
   - Upload (⌘U).
   - Open Serial Monitor at 115200 baud; verify `[wifi] OK` and `[mqtt] OK`.

2. Show wiring (also in `arduino/wiring.txt`):
   ```
   MKR 3V3 → TEMT6000 VCC
   MKR GND → TEMT6000 GND, PIR GND
   MKR A0  → TEMT6000 SIG
   MKR 5V  → PIR VCC          ⚠ PIR wants 5 V
   MKR D2  → PIR OUT
   ```

3. Verify from the Mac:
   ```bash
   brew install mosquitto-clients
   mosquitto_sub -h localhost -t 'ucl/library/dissertation/#' -v
   ```
   Should print `…/lux <value>`, `…/lux_raw <0..1023>`, `…/motion 0|1` once a second.

### Phase 3 — Capacitor build to iPad (30 min, one-off)

```bash
# 3.1 One-time tooling
xcode-select --install
sudo gem install cocoapods

# 3.2 npm + iOS project
cd "$DLL"
npm install
npx cap add ios

# 3.3 Edit ios/App/App/Info.plist
#     Paste the contents of docs/ios_info_plist_snippet.xml between the
#     existing top-level <dict> ... </dict>. Without those keys iOS will
#     silently deny camera/mic/speech/LAN.

# 3.4 Build web bundle + sync into Xcode project
npm run ios:sync

# 3.5 Open Xcode
npm run ios:open

# 3.6 In Xcode:
#     - top bar: scheme = App, target = connected iPad
#     - App ▸ Signing & Capabilities ▸ Team = Yidan's free Apple ID
#     - ▶ to build + install
#     - on the iPad: Settings → General → VPN & Device Management → trust
#       Apple ID (free tier; valid 7 days, refresh by re-running ▶).
```

### Phase 4 — In-app configuration (2 min)

On the iPad:

1. Tap the new "Virtual Librarian" app icon.
2. Allow Camera / Microphone / Speech Recognition when prompted.
3. Tap the ⚙︎ gear (top-right) →
   - **Mac IP** = `LAN_IP` from Phase 1
   - **Default mode** = Both
   - **Default avatar URL** = `/3D_/ryu2.vrm` (if you bundled it; otherwise leave empty)
   - Tap **Save & reload**.

4. Use the top-centre capsule to live-switch:
   - 👤 Mirror — camera → avatar
   - 🎤 Listen — voice → mood + book recommendation
   - ✨ Both — default

### Phase 5 — Verification (5 min)

Expected end state on the iPad:

- Capsule at top shows Mirror / Listen / Both (✨ Both highlighted).
- Virtual librarian visible centre, follows face when in Mirror or Both.
- Right-side dashboard shows:
  - Arduino · live · mqtt (green dot)
  - Light: live lux reading + sparkline
  - Reader present / No motion pill
  - Sound: live dB bar from iPad mic
  - Last heard: live transcript
  - Suggested reading: a book appears when topic keywords match
  - Mood pill: neutral / happy / sad / thinking
- Wave a hand in front of PIR → "Reader present" lights up green within 1 s.
- Cover TEMT6000 → Light value drops within 1 s.
- Say "what is the history of the Silk Road" → after the sentence ends,
  *The Silk Roads* by Peter Frankopan shows up, mood = thinking, avatar
  raises brows and looks up briefly.

### Phase 6 — Stop / teardown

```bash
brew services stop mosquitto
# Arduino keeps running on USB power; unplug to stop.
# iPad app stays installed for 7 days on free Apple ID.
```

---

## Failure recovery cheatsheet

| Symptom | Where to look |
|---|---|
| Arduino Serial: `[mqtt] failed err=-2` | Mac firewall blocking :1883 — *System Settings → Network → Firewall → Allow `mosquitto`* |
| Arduino Serial: stuck on dots after `[wifi] connecting` | wrong WIFI_PASS, or network is 5 GHz only (MKR is 2.4 GHz only) |
| iPad app: dashboard says `Arduino · waiting (mqtt)` | wrong Mac IP in Settings, or both not on same Wi-Fi, or broker not running |
| iPad app: black screen, no avatar | open Safari → Develop → iPad → check JS console (need Safari → Settings → Advanced → "Show Develop menu" + iPad → Safari → Advanced → "Web Inspector" on) |
| iPad app: camera permission shown but no preview | check Info.plist `NSCameraUsageDescription` present; uninstall + reinstall the app |
| iPad app: speech never transcribes | needs WAN; iOS Web Speech goes to Apple's cloud |
| iPad battery dying during demo | put it on a charger; WKWebView + WebGL + mic + camera is ~5 W |

---

## What NOT to do

- Don't enable the MKR WAN 1310 yet — the WAN board doesn't have Wi-Fi
  and would silently brick the existing sketch.
- Don't hand-edit `ios/App/App/public/` — it's auto-generated by
  `npm run ios:sync` from the Vite `dist/` output.
- Don't commit `arduino_secrets.h` with real passwords.
