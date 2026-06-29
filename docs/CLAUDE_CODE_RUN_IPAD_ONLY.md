# CLAUDE_CODE_RUN_IPAD_ONLY.md

> Use this prompt when you want to test the iPad-side UI today, without
> having the Arduino wired up. The dissertation's final deployment topology
> is **iPad + Arduino, no Mac**. The Mac is only here today to build the
> Capacitor app and push it onto the iPad over USB; after install, the
> Mac is no longer in the loop.
>
> Outcome of this run: the dissertation app is installed on the iPad. It
> shows the avatar, face tracking, voice → mood + book recommendation, and
> a sensor dashboard fed by mock data. When the Arduino cable arrives, you
> just open Settings, type the Arduino IP, and the dashboard switches to
> live data — no rebuild needed.

---

## Pre-flight checks (Claude Code prints + verifies)

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# Xcode must be installed AND its command-line tools must be selected
xcode-select -p             # should print /Applications/Xcode.app/Contents/Developer
xcodebuild -version         # should print Xcode 14+

# CocoaPods (needed by `cap sync ios`)
gem list cocoapods | grep -q cocoapods || sudo gem install cocoapods

# Node / npm
node --version              # ≥ 18
npm --version               # ≥ 9

# Make sure iPad is paired in Xcode (run once if first time)
# Xcode > Window > Devices and Simulators → confirm iPad is "Connected"
```

If any of those fail, fix that first before continuing.

---

## Step 1 — Install JS deps + create iOS project (~2 min, one-off)

```bash
cd "$DLL"
npm install                 # pulls @capacitor/{core,ios,cli} and the rest
[ -d ios ] || npx cap add ios
```

`cap add ios` creates `ios/App/App.xcodeproj` and runs `pod install` under
the hood. Expect ~60 s.

---

## Step 2 — Patch Info.plist (Claude Code does this, no Xcode UI)

```bash
bash "$DLL/scripts/patch-ios-plist.sh"
```

This injects:

* `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` /
  `NSSpeechRecognitionUsageDescription` — required usage strings.
* `NSLocalNetworkUsageDescription` — needed to talk to the Arduino later.
* `NSAppTransportSecurity` with `NSAllowsLocalNetworking = true` and
  `NSAllowsArbitraryLoads = true` — lets WKWebView fetch plain HTTP from
  the Arduino's `http://<ip>/sensors` endpoint.
* `UISupportedInterfaceOrientations~ipad` = Landscape only — Pepper's
  Ghost pyramid lies flat on the iPad screen.

Re-run any time you re-create `ios/`.

---

## Step 3 — Build the web bundle + sync into Xcode (~30 s)

```bash
cd "$DLL"
npm run ios:sync
# = npm run build  +  npx cap sync ios
```

Outputs go to `dist/` and are copied into `ios/App/App/public/`.

---

## Step 4 — Open Xcode (Claude Code can't sign for you)

```bash
npm run ios:open
```

In Xcode (one-off setup):

1. Top-bar device picker → choose **Yidan's iPad** (or whatever the
   device's name is).
2. File tree → click the blue **App** root → tab **Signing & Capabilities**
   → tick **Automatically manage signing** → **Team** dropdown → choose
   your personal Apple ID (free tier is fine).
3. Press **▶ Build & Run** (⌘R).

The first build takes 2–5 min. The IPA installs to the iPad over USB.

If Xcode complains "Untrusted Developer" on the iPad, go to
*iPad Settings → General → VPN & Device Management → Apple Development:
your@email → Trust*. Re-launch the app.

---

## Step 5 — Configure in-app (on the iPad, ~30 s)

When the app opens:

1. Allow Camera, Microphone, Speech Recognition (three prompts, all Allow).
2. Tap the **⚙︎ gear** (top-right).
3. **Arduino IP**: **leave blank** for today (no Arduino) — the app falls
   back to a smooth mock-data stream.
4. **Default mode**: Both.
5. **Default avatar URL**: `/3D_/ryu2.vrm` (if the VRM is in `public/3D_/`)
   or leave blank for the placeholder head.
6. Tap **Save & reload**.

That's the full configuration.

---

## Step 6 — Visual acceptance checklist (you on the iPad)

| What | Expected |
|---|---|
| Top-centre capsule | `👤 Mirror · 🎤 Listen · ✨ Both` with Both highlighted |
| Avatar | Visible centre, follows your head when you move |
| Right-edge dashboard | Title "Library Sensors" + `Arduino · mock` label, Light value gently changing, Reader-present pill flickering |
| iPad-mic section | Sound dB bar reacts when you speak |
| Speak a topic | After the sentence ends, a book pops up under "Suggested reading" + mood pill colour changes; the avatar overlays a smile / frown / thinking-look for ~4 s |
| Tap **Mirror** | Mic + speech section dim, avatar still follows face |
| Tap **Listen** | Camera preview disappears, avatar starts a procedural idle (breathing, blinks), speech still active |
| Tap **Both** | Both run again |
| Power-cycle the iPad | App icon stays on home screen; on free Apple ID it expires after 7 days; refresh by re-running Step 3 + 4 |

---

## Step 7 — When the Arduino cable arrives

1. Wire TEMT6000 (→ A0, 3V3) and PIR (→ D2, 5V) per `arduino/wiring.txt`.
2. Edit `arduino/arduino_secrets.h` — fill `WIFI_SSID` / `WIFI_PASS` for
   the same network the iPad is on (or leave `AP_SSID` + flip
   `USE_AP = 1` in `library_sensors.ino` for the offline-AP path).
3. Open `arduino/library_sensors.ino` in Arduino IDE → Tools → Manage
   Libraries → install **WiFiNINA**.
4. Upload (⌘U). Serial Monitor @ 115200 → look for the line:
   ```
   [http] listening on http://192.168.x.y:80/sensors
   ```
5. On the iPad app → ⚙︎ Settings → **Arduino IP** = the IP from step 4 →
   Save. Dashboard label flips from `Arduino · mock` to `Arduino · live`.

No app re-install needed for this transition.

---

## Failure recovery

| Symptom | Where to look |
|---|---|
| `xcode-select -p` returns `xcode-select: error` | run `xcode-select --install` and re-open this doc |
| `pod install` fails in `cap add ios` | `sudo gem install cocoapods`, then `cd ios/App && pod install` |
| Xcode "no provisioning profile" | tab Signing & Capabilities → tick Automatically manage signing → pick a Team |
| App crashes on launch | Xcode → ▶ run with debug → console; usually a missing Info.plist key — re-run `patch-ios-plist.sh` |
| iPad shows black screen, never asks for camera | Info.plist usage descriptions missing — re-run `patch-ios-plist.sh`, re-build |
| Dashboard says `Arduino · waiting` after typing IP | Arduino + iPad on different Wi-Fi networks; or Arduino not on; check Arduino Serial Monitor for the IP |
| Web Speech never transcribes | needs Wi-Fi (Apple's cloud STT); on AP-mode Arduino-only Wi-Fi this won't work |
| MediaPipe never loads (HUD stuck on `loading MediaPipe…`) | needs Wi-Fi on first launch (CDN fetch); after first launch it's cached |

---

## Things NOT to do

- Don't `brew install mosquitto` or run `start-tunnel.sh` for this flow —
  both are leftovers from the previous web-only architecture and are not
  needed in the iPad-app path.
- Don't enable the MKR WAN 1310 yet — it lacks Wi-Fi and would
  silently fail.
- Don't hard-code your Wi-Fi password into `library_sensors.ino` outside
  `arduino_secrets.h`; that file is `.gitignore`d.
- Don't tap Trust on a developer profile that isn't yours.
