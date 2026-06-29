# PROJECT_HANDOFF.md — Read this first

You are taking over a UCL CASA MSc dissertation project mid-way through.
This file is the only thing you need to read to understand state. The
codebase root is `/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D`.

---

## 1. Who + what

* **Student**: Yidan Gao (gydwei220@gmail.com), UCL CASA MSc, dissertation
  due mid-2026.
* **Supervisor**: Andy Hudson-Smith (Director of CASA). Communicates via
  Slack; wants daily progress photos + Wednesday meetings.
* **Project title**: *Holographic Virtual Librarian*. A library-themed
  installation where:
  * an iPad sits flat on a desk,
  * an acrylic Pepper's-Ghost pyramid rests on top → makes a 3D virtual
    librarian (VRM avatar) appear to float in mid-air,
  * the avatar mirrors the visitor's face (camera) and converses (mic),
  * a separate Arduino sensor box on the desk senses the reading
    environment (light, distance, temperature, humidity, book RFID) and
    feeds those readings to the iPad to drive film/book recommendations.
* **Marking emphasis** (Andy is explicit): the **physical artefact** —
  custom PCB + 3D-printed/laser-cut enclosure + sensor wiring — is the
  primary deliverable. The iPad app is "good enough" already; further
  app-side polish is not where marks are.

---

## 2. Final deployment topology (no Mac at runtime)

```
┌───────────────────────────────────────────────┐
│  SENSOR BOX (Arduino MKR WiFi 1010 + sensors) │
│  HTTP server :80  GET /sensors → JSON         │
└───────────────────┬───────────────────────────┘
                    │ Wi-Fi (same network)
                    ▼
┌───────────────────────────────────────────────┐
│  iPad (native Capacitor app)                  │
│  - Camera → MediaPipe → VRM face tracking     │
│  - Microphone → native SFSpeechRecognizer     │
│  - Polls Arduino HTTP every 1 s               │
│  - Three.js Pepper's-Ghost 4-viewport render  │
└───────────────────────────────────────────────┘
```

No Mac, no Mosquitto, no tunnel, no certificate, at runtime. Mac is only
used once to flash the Arduino and once to build/install the iPad app
via Xcode.

---

## 3. Codebase layout

```
1111D/
├── PROJECT_HANDOFF.md         ← this file
├── AGENT.md                   ← older end-to-end run guide, still useful
├── BUILD_APP.md               ← Capacitor build instructions
├── capacitor.config.json
├── package.json               ← @capacitor-community/speech-recognition added
├── vite.config.js
├── index.html                 ← brand bar + mode capsule + dashboard canvas
├── public/3D_/                ← bundled VRM models (ryu2.vrm, 195_Uta01.vrm)
│
├── arduino/library_sensors/   ← Arduino sketch folder (arduino-cli compatible)
│   ├── library_sensors.ino    ← HTTP server, TEMT6000 + PIR currently
│   └── arduino_secrets.h      ← WiFi creds (gitignored)
├── arduino/wiring.txt
│
├── docs/
│   ├── HARDWARE_PLAN.md       ← full sensor + PCB + enclosure spec (READ THIS)
│   ├── SENSOR_EXPANSION_PLAN.md
│   ├── CLAUDE_CODE_REDEPLOY_*.md  ← rebuild + reinstall scripts (numbered 1-8)
│   └── ios_info_plist_snippet.xml
│
├── scripts/
│   ├── sync-public-assets.sh  ← copies 3D_/ to public/3D_/ before build
│   ├── patch-ios-plist.sh     ← auto-edits Info.plist for camera/mic/speech perms
│   ├── flash-arduino.sh       ← arduino-cli: compile + upload + read serial
│   ├── verify-arduino.sh      ← curl Arduino /sensors 5 times
│   └── start-tunnel.sh        ← legacy, not used in current architecture
│
└── src/                       ← Vite/JS web app (bundled into the iOS IPA)
    ├── main.js                ← module orchestrator
    ├── speech.js              ← Web Speech wrapper (browser fallback)
    ├── speechNative.js        ← Capacitor native plugin wrapper (used on iPad)
    ├── bookDb.js              ← 26 books + 15 films + Chinese alias map +
    │                            recommendBookFromSpeech + recommendFilmFromSensors
    ├── sensors.js             ← Arduino HTTP poller
    ├── dashboard.js           ← right-side canvas dashboard
    ├── pyramid.js             ← 4-viewport Pepper's-Ghost renderer (DO NOT EDIT)
    ├── avatarScene.js         ← Three.js scene + VRM loader
    ├── faceCapture.js         ← MediaPipe FaceLandmarker
    ├── poseCapture.js
    ├── audio.js               ← mic dB analyser (off on Capacitor)
    ├── demoMode.js            ← procedural idle animation
    ├── oneEuro.js             ← jitter filter
    └── streaming.js           ← legacy WebSocket relay, not currently used
```

---

## 4. What the iPad app currently does

* Boots into a "Both" mode by default (face mirroring + voice listening).
* Top-centre capsule lets the user switch between **Mirror / Listen / Both**.
* Bottom-left shows app status pill ("tracking", "loading avatar 60%",
  etc.) instead of the old debug HUD.
* Top-left has a brand mark ("VL · Virtual Librarian").
* Right-edge dashboard shows:
  * Arduino sensors (currently Light + Motion; will expand)
  * Sound dB level from iPad mic (audio.js disabled on Capacitor, shows —)
  * "Last heard" transcript (speech path)
  * Suggested book (from speech) — `recommendBookFromSpeech`
  * Suggested film (from sensors) — `recommendFilmFromSensors`, rotates every 8 s
  * Mood pill (happy / sad / thinking / neutral)
* Tap **⚙︎** for Settings: Arduino IP, default mode, default avatar URL,
  speech language (en-US / en-GB / zh-CN).
* `?debug=1` URL flag unhides the old FPS/Tracker/Layout/Avatar dev panels.

### Speech recognition

* On iPad we use `NativeSpeechRecognizer` (wraps
  `@capacitor-community/speech-recognition` → native SFSpeechRecognizer).
* The Web Speech API path is preserved for desktop browser testing only;
  on the iPad it was unreliable (sessions fired, results were 0 — a
  known WKWebView issue) so we replaced it.
* The native wrapper is **event-driven**: `start()` returns immediately;
  transcripts come via `partialResults` listener; auto-restart on
  `listeningState 'stopped'`.

### Mic exclusivity

* On Capacitor the `audio` analyser is `null` — SFSpeechRecognizer needs
  exclusive `AVAudioEngine` access. The dB row in the dashboard therefore
  shows "—" on iPad. On browser dev mode, audio + Web Speech coexist fine.

### Long-run stability

* `navigator.wakeLock` keeps the screen on.
* `visibilitychange` listener resumes audio + restarts speech on
  return-to-foreground.
* `webglcontextlost` triggers a soft page reload.

---

## 5. What the recommender currently does

`src/bookDb.js` has:

* **MEDIA** = 26 books + 15 films. Each film has a `mood` tag:
  `atmospheric / contemplative / classic / energetic`.
* **`recommendBookFromSpeech(text)`** — returns the best-matching BOOK from the
  user's speech transcript. English keywords or Chinese (via the
  `ZH_TO_TOPIC` alias map, e.g. 物理 → physics, 电影 → film).
* **`recommendFilmFromSensors({lux, motion}, seed)`** — picks a FILM whose
  mood bucket matches the current ambient state. Re-evaluates every 8 s
  with an advancing seed so the panel feels alive.
* **`classifySentiment(text)`** — returns `happy / sad / thinking / neutral`,
  drives the avatar mood overlay for ~4 s after each utterance.

Currently the film mapping only uses lux + motion. **The next iteration
will add distance (VL53L1X), temperature/humidity (BME280), and RFID
book UID into the mapping**.

---

## 6. Arduino current state

`arduino/library_sensors/library_sensors.ino`:

* Runs HTTP server on port 80.
* `GET /sensors` → JSON `{ lux, lux_raw, motion, uptime_ms }`.
* Two Wi-Fi modes via `#define USE_AP`:
  * 0 = station mode (join the venue Wi-Fi)
  * 1 = access-point mode (creates "VirtualLibrarian" Wi-Fi for offline use)
* Uses only `WiFiNINA` library — nothing else right now.
* Compiles with `arduino-cli` via `bash scripts/flash-arduino.sh`.

Hardware on hand (already wired):
* Arduino MKR WiFi 1010
* TEMT6000 ambient light sensor (A0)
* HC-SR501 PIR motion sensor (D2)

Arduino MKR WAN 1310 is in reserve for a future LoRa extension (not used).

---

## 7. Andy's most recent feedback (in priority order)

1. **PCB is the focus** — "design a custom shield, not loose wires in a
   box". Standard CASA PCB lead time is ~2 weeks; must order this week.
2. **3D-printed or laser-cut enclosure** for the iPad-pyramid base AND a
   separate sensor module enclosure.
3. **Sensors he named** in conversation: light + temperature + sound + PIR.
   We later dropped sound because the iPad mic handles audio.
4. **Avatar should only appear when a reader is present.** Currently the
   PIR can't tell distance; he complained about avatar showing even when
   no one was in front of the device. Replacing PIR with a VL53L1X
   time-of-flight sensor will fix this.
5. **"Show what books people are reading"** — direct quote from him.
   We're adding MFRC522 RFID + NFC stickers in books to do exactly this.
6. **Don't spend more time on the avatar / AI code side.** Hardware,
   enclosure, presentation are the marks.
7. **Photo every step.** He wants the methodology chapter backed by a
   continuous photo log.
8. **Slack daily.** He says student goes silent for days; wants regular
   posts with photos.
9. **Literature review** — explicitly mentioned. Already started. Anchor
   refs are in earlier `docs/LIT_REVIEW.md` and `HARDWARE_PLAN.md` §8.

---

## 8. Procurement state — what's been decided

See `docs/HARDWARE_PLAN.md` for the full spec. The decided shopping list
(student is ordering now):

| Part | £ | Why |
|---|---|---|
| BME280 (I²C temp+humidity+pressure) | 12 | Andy's "temperature" |
| VL53L1X ToF (I²C distance) | 7 | Replaces PIR; fixes presence-detection bug |
| MFRC522 RFID reader | 3 | Books-on-desk recognition |
| 50 × NTAG213 NFC stickers | 3 | Tagged demo books |
| 0.96" SSD1306 OLED (I²C) | 4 | On-box diagnostic display |
| WS2812B 8-LED ring | 5 | Ambient feedback for exhibition |
| JST PH connectors + headers + LED + button | 9 | PCB assembly bits |
| **5 × custom PCBs + DHL Express shipping (JLCPCB)** | 22 | The supervisor-mandated part |
| **Total** | **~£65** | |

Dropped: MAX9814 mic (£6 saved) — iPad mic covers audio.

Already had: TEMT6000, HC-SR501, MKR WiFi 1010, acrylic Pepper's-Ghost
pyramid, iPad with the Capacitor app installed.

---

## 9. PCB plan

Form factor: **MKR-WiFi-1010 sensor shield**, 60 × 40 mm, double-sided,
plugs onto the MKR via two 14-pin female headers.

I²C bus shared by BME280 + OLED + VL53L1X + (future DS3231 RTC) — all
on the same SDA(11)/SCL(12) pair. RFID on SPI (D5/D6 + MOSI/MISO/SCK).
TEMT6000 on A0 analog. PIR on D2 (kept as fallback). WS2812B on D3.

Designed in **EasyEDA Pro** (free, integrates with JLCPCB one-click
ordering). Step-by-step in `docs/HARDWARE_PLAN.md` §3.

PCB drawn → DRC pass → export Gerber → upload to JLCPCB → choose DHL
Express (5–7 days to UK) → cost ~£22.

---

## 10. Enclosure plan

Two parts:

**Sensor box** (85 × 60 × 30 mm) — houses MKR + PCB. Lid has windows for
each sensor (TEMT6000 ⌀10 mm transparent, PIR ⌀22 mm half-sphere, OLED
rectangular cut-out, BME280 ventilation slits). USB-C cutout on side.

**iPad-pyramid base** (280 × 200 × 5 mm) — iPad sinks into a recess;
small mount plate (80 × 80 mm) holds the acrylic pyramid centred over
the iPad's display area.

Designed in **Fusion 360**. Andy explicitly suggested **laser-cut MDF**
as a fast alternative to 3D printing (20 min vs 6-8 h). CASA workshop
has both. Step-by-step in `docs/HARDWARE_PLAN.md` §4-5.

---

## 11. Timeline (two weeks from "now")

| Week | Mon | Tue | Wed | Thu | Fri | Weekend |
|---|---|---|---|---|---|---|
| 1 | order parts + EasyEDA | submit PCB to JLCPCB Express | start Fusion enclosure | laser-cut v1 | trial-fit | iPad base CAD |
| 2 | print base | parts + PCB arrive | solder PCB | wire sensors + test | full assembly | demo |

Parallel: literature review chapter, photo log, weekly Slack updates.

---

## 12. Decisions already locked

* Native iPad app (Capacitor + WKWebView) — **not** web/tunnel/Safari.
* Native SFSpeechRecognizer for STT (Web Speech proved unreliable in
  WKWebView).
* HTTP-JSON from Arduino, not MQTT (no Mac in final deployment).
* MKR WiFi 1010 as the only sensor-side MCU (MKR WAN 1310 reserved).
* Pepper's-Ghost pyramid, not full 3D holographic display.
* iPad app's avatar URL defaults to `/3D_/ryu2.vrm`.
* CASA0018 (the earlier course-work face-mocap pipeline) is **demoted**
  to "lip-sync layer" inside the dissertation; the dissertation's
  original contribution is the sensor-driven recommender + Pepper's-Ghost
  installation. This was a deliberate choice to avoid reusing course-work
  outputs (Andy specifically flagged that policy).

---

## 13. Open questions / pending work

* `recommendFilmFromSensors` currently only reads `lux` + `motion`. After
  the new sensors arrive, extend to use distance / temperature / humidity
  / RFID UID.
* Add `temp`, `humidity`, `distance_cm`, `book_uid` fields to the
  Arduino's JSON output. The iPad dashboard already has placeholder
  slots ready (see `dashboard.js` ROWS_ARDUINO comment).
* Avatar visibility gate: when distance > 100 cm OR no PIR for > 5 s,
  fade out the avatar (CSS opacity transition + speech.stop()).
* Update Settings panel with a "Test Arduino" button that calls
  /sensors and shows the JSON in a toast.

---

## 14. How to run things today

### iPad app rebuild + reinstall

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"
npm run ios:sync      # vite build → cap sync ios
npm run ios:open      # opens Xcode
# In Xcode: select iPad target → ▶ Build & Run
```

The numbered `docs/CLAUDE_CODE_REDEPLOY_N.md` files document each round.
The latest is `REDEPLOY_8.md` (native speech recognition).

### Arduino flash

```bash
bash scripts/flash-arduino.sh
# Auto-installs arduino-cli + WiFiNINA, finds USB port, compiles,
# uploads, reads serial for 15 s, prints the Arduino's IP for the
# iPad Settings panel.
```

### Browser-mode dev (Mac Safari, for fast iteration)

```bash
npm run dev:http
# Open http://127.0.0.1:5173/?mode=demo  for procedural face animation
# Open http://127.0.0.1:5173/?mode=capture&sensors=mock for full UI
```

---

## 15. Files you should NOT edit

* `src/pyramid.js` — the user has iterated on the camera framing themselves.
  Don't change FOV, distance, or the `single` layout cam config.
* `arduino_secrets.h` — contains Wi-Fi password.
* `ios/App/App/public/` — auto-generated by `cap sync`; edits get overwritten.

---

## 16. Things the user finds annoying

* Reverting working code because of an incorrect diagnosis. The "Web
  Speech + audio.js" combo on iPad caused two rounds of bad fixes.
  Confirm the symptom before swapping known-good logic.
* Long-running rebuild loops. If a fix is a single config tweak, say
  so — don't repackage it as another sweeping refactor.
* English jargon without Chinese context. The user is bilingual; mix
  Chinese explanation with English technical terms.

---

## 17. Things the user is good with

* Direct diagnostic asks ("paste the Xcode console log filtered by
  `[speech]`"). The user will paste.
* Numbered execution plans (`docs/CLAUDE_CODE_REDEPLOY_N.md`) — keeps
  Claude Code on rails.
* Verification commands. Always include `grep -c` / `curl` / `node --check`
  steps in the run plan so failures surface fast.

---

## 18. Where to start in the new conversation

If the user comes in with no specific question:

1. Read this file.
2. Read `docs/HARDWARE_PLAN.md` (long, but the canonical hardware spec).
3. Ask: "Where are you on the hardware order — have parts arrived?
   want me to (a) extend the Arduino sketch for BME280/VL53L1X/RFID/OLED,
   (b) update the iPad recommender to use the new fields,
   (c) draft the EasyEDA schematic JSON, or (d) write the Slack update
   to Andy?"

The user will pick one of those four; don't blast all four at once.
