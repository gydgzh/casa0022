# AGENT.md — local AI run instructions

> Audience: a local AI coding agent (Claude Code / Cursor / similar)
> running on Yidan's Mac, with shell + file access to this project
> folder. The user is about to demo this to a supervisor.
>
> **Goal:** start the project, open the demo URL, and verify the avatar
> is visibly animating with face tracking + full head rotation.
>
> **Current mode: Face-only tracking (no body).** The tracker dropdown
> defaults to **Face only**. Head rotation (nod / turn / roll) is fully
> active and mirrors-corrected (user turning right → avatar turns right).
>
> **If the previous attempt failed with "browser won't open the page",
> follow the HTTP-first path in section 1.** It bypasses the self-signed
> HTTPS cert that Safari/Chrome silently refuse on the first visit.

---

## 0. Sanity checks (run once, in this order)

```bash
cd "/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D"
node --version   # expect v18+ (v20 ideal)
npm --version    # expect v9+
ls node_modules >/dev/null 2>&1 || npm install
```

Then make sure port 5173 isn't already held by a stale Vite:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN || echo "port 5173 free"
# if a PID prints, kill it:  kill -9 <pid>
```

If `npm install` is needed, run it and wait for it to finish before
moving on. Expect ~20–30 s with cached registry, ~2 min cold.

---

## 1. Start the project — HTTP path (RECOMMENDED for first verification)

Demo mode does **not** call `getUserMedia`, so HTTPS is not required when
loading on the Mac itself. HTTP avoids the self-signed cert popup that
was the most likely cause of "browser won't open the page" last time.

```bash
cd "/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D"
npm run start:http    # runs relay + vite in HTTP mode together
# Expected lines:
#   [relay] listening on ws://0.0.0.0:8787
#   ➜  Local:   http://127.0.0.1:5173/
```

Leave it running in a background process; do **not** block on it.

### 1a. Preflight — confirm the server actually answered

This is the step the previous run probably skipped. `open <url>` returns
immediately whether or not the page loaded — you must verify with curl:

```bash
sleep 2
curl -sS -o /dev/null -w "HTTP %{http_code}\n" "http://127.0.0.1:5173/?mode=demo"
# Expect:  HTTP 200
```

If you see `HTTP 200`, the server is alive and serving HTML. Proceed.
If you see `Connection refused` or a non-200 code, scroll to section 5.

---

## 2. Open the demo URL (single-model, face + body)

```bash
open "http://127.0.0.1:5173/?mode=demo"
```

**Success criteria** (verify visually before declaring done):

- A black page with ONE model centred in the viewport (head in upper half,
  upper body / torso visible in lower half).
- The placeholder head blinks every ~2–4 s, occasionally smiles, and the
  jaw moves in short bursts that look like talking.
- HUD top-left shows: `Mode: demo`, `FPS: 50+`, `Status: demo (procedural)`.
- Controls panel (top-right): Tracker shows **Face + Body**; Layout shows
  **Single (centre)**.

If you see all of that → **the demo is working, hand back to user.**

---

## 2b. Test VRM avatar — single model, face + body tracking

### Step A — Preflight

```bash
curl -sI "http://127.0.0.1:5173/3D_/ryu2.vrm" | head -3
# Expect: HTTP/1.1 200 OK  Content-Length: 25330752
```

### Step B — Primary test: ryu2.vrm (24 MB, VRM 0.x, 22 ARKit blendshapes)

```bash
open "http://127.0.0.1:5173/?mode=demo&avatar=/3D_/ryu2.vrm"
```

**Success criteria:**

| What | Expected |
|---|---|
| HUD loading sequence | `loading avatar 0%` → `avatar ready (vrm)` |
| Layout | **One** VRM model centred on screen, head in upper half |
| Face | Blinks every 2–4 s, occasional smile, jaw opens in talking bursts |
| Head | Slow left-right sweep (procedural) |
| Upper body | Spine gently rolls with demo shoulder data |
| FPS | ≥ 45 |

### Step C — Secondary test: 195_Uta01.vrm (34 MB)

```bash
open "http://127.0.0.1:5173/?mode=demo&avatar=/3D_/195_Uta01.vrm"
```

Same criteria as Step B.

### Step D — Switch to live capture (holistic Face + Body)

Restart in HTTPS mode first (section 3 below), then:

```bash
open "https://localhost:5173/?mode=capture&avatar=/3D_/ryu2.vrm"
```

**Additional live-capture criteria:**

| Channel | Expected behaviour |
|---|---|
| Face blendshapes | Avatar mirrors your blink, jaw, smile in real time |
| Head rotation | Avatar follows your head tilt / nod / turn |
| Shoulder roll | Avatar spine rolls when you tilt your shoulders (spine + chest bones) |
| Arm elevation | Raise either arm → avatar's corresponding arm lifts (uses 3D world landmarks) |
| Forearm bend | Bicep-curl gesture → forearm angle changes on avatar |
| FPS | ≥ 25 |

### Troubleshooting pose / arm issues

| Symptom | Fix |
|---|---|
| Arm lifts in wrong direction | Negate `elevL` / `elevR` sign in `applyPose` (`avatarScene.js` ~line 410) |
| Forearm bends backward | Negate the `bendL` / `bendR` sign (same file ~line 429) |
| Arms frozen / not moving | `poseCap` not initialised — check tracker dropdown is **Face + Body** |
| World landmarks `null`, arms use fallback | PoseLandmarker built without `outputWorldLandmarks` — set it in `poseCapture.js` if needed |
| Spine snaps too fast | Increase LERP constant (currently 0.12) in `applyPose` |

### Why VRM works and plain GLBs don't

| Model | Format | Rig | Morph targets | Result |
|---|---|---|---|---|
| `ryu2.vrm` | VRM 0.x | ✓ humanoid | ✓ 22 ARKit-named | full face + head + body |
| `195_Uta01.vrm` | VRM 0.x | ✓ humanoid | ✓ 22 ARKit-named | full face + head + body |
| plain `.glb` | GLB | ✗ no skin | ✗ none | shoulder roll on head pivot only |

### If the head is mispositioned

Tell me which model and roughly where it lands; I'll add a per-URL Y offset.

### Switching back to placeholder

```bash
open "http://127.0.0.1:5173/?mode=demo"
```

---

## 2c. Mac webcam — live Face capture + Head Rotation (primary test path)

> **本次修复的两个 bug（转头不生效的根本原因）：**
> 1. `vrm.humanoid.update()` 从未被调用。three-vrm v3 的 `getNormalizedBoneNode()` 返回的是虚拟节点，写入旋转后必须调用此方法才能传播到实际骨骼网格——否则视觉上完全无效。
> 2. MediaPipe 的 `facialTransformationMatrixes` 数据是 row-major，Three.js 的 `fromArray()` 读的是 column-major，导致旋转矩阵被转置读取，完全错误。
>
> 两个修复都已提交到 `avatarScene.js` 和 `main.js`。

> **This is the main test.** The ?mode=demo page uses procedural animation only.
> Switch to capture mode to see real face tracking with full head rotation.

### Option A — HTTP on localhost (Chrome / Arc, fastest, no cert warning)

`getUserMedia` is allowed over HTTP on `127.0.0.1` in Chrome-based browsers.

```bash
# Make sure start:http server is still running (section 1 above).
open -a "Google Chrome" "http://127.0.0.1:5173/?mode=capture&avatar=/3D_/ryu2.vrm"
```

1. Browser prompts **"Allow camera"** → click **Allow**.
2. Bottom-left shows a small mirrored video preview of your face.
3. Wait for HUD: `Status: tracking`.
4. Controls panel: Tracker = **Face only**, Layout = **Single (centre)**.

---

### Head rotation test sequence (do in order)

> Each sub-test: hold the position for 1–2 seconds, watch the avatar, then return to neutral.

**Test 1 — Static neutral**

- Sit upright, face the camera straight on.
- **Expected**: Avatar's head is centred, no drift.

**Test 2 — Nod (pitch)**

- Slowly nod down (chin to chest), then tilt head up.
- **Expected**: Avatar's head nods down then tilts up, matching your pitch.
- **Wrong if**: Head rocks sideways instead (would indicate X/Z axis swap).

**Test 3 — Turn left / right (yaw)**

- Slowly turn your head to YOUR left, pause, then to YOUR right.
- **Expected**: Avatar's head turns to *its* left when you turn left, right when you turn right (same direction mirror-corrected).
- **Wrong if**: Avatar turns the *opposite* way (mirror flip — coordinate correction not applied). Report the failure and note which direction is swapped.

**Test 4 — Tilt / roll**

- Tilt your right ear toward your right shoulder, then left ear to left shoulder.
- **Expected**: Avatar's head tilts to match — right ear down when yours goes right.
- **Wrong if**: Avatar tilts opposite direction.

**Test 5 — Combined motion**

- Look up-and-left (diagonal).
- Look down-and-right.
- **Expected**: Avatar tracks the compound motion smoothly, no jitter, body stays still.

**Test 6 — Body stability under head motion**

- Make an exaggerated head nod while keeping your shoulders perfectly still.
- **Expected**: Only the avatar's head and neck move. Torso / arms / hips stay fixed.
- **Wrong if**: The whole body leans or rotates (headPivot still driving body — check `applyHeadTransform` in `avatarScene.js`).

---

### Face expression test sequence

| What you do | Expected avatar response |
|---|---|
| Blink one eye | Avatar blinks that eye; other stays open |
| Blink both eyes | Avatar blinks both |
| Open mouth wide (jaw) | Avatar's jaw drops noticeably |
| Big smile | Avatar smiles; cheeks puff slightly (muscle coupling) |
| Raise eyebrows | Both brows lift visibly |
| Frown / pull corners down | Mouth corners pull down; lower lip follows |
| Puff cheeks | Avatar cheeks puff (cheekPuffLeft/Right) |
| Wrinkle nose (sneer) | Nose wrinkles on the side you sneer |

Expression amplitude should be **exaggerated** — a slight real smile should produce a clearly visible smile on the avatar. If expressions look too subtle, report it (the GAIN / POW constants in `applyBlendshapes` may need tuning).

---

**If camera permission was previously denied:**
- Chrome: click the 🔒 icon in the address bar → Camera → Allow → Reload.
- Safari: Preferences → Websites → Camera → localhost → Allow.

### Option B — HTTPS (Safari / iPad-compatible, needed for LAN access)

```bash
pkill -f vite; pkill -f "node server/relay.js"; sleep 1
cd "/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D"
npm run start &
sleep 4
curl -ksSo /dev/null -w "HTTPS %{http_code}\n" "https://localhost:5173/?mode=capture"
open "https://localhost:5173/?mode=capture&avatar=/3D_/ryu2.vrm"
```

Safari cert warning → click **Show Details → visit this website**.

Run the same head rotation and face expression test sequences as Option A.

---

## 2a. Native iPad app (Capacitor) — **RECOMMENDED for the supervisor demo**

Web + tunnel is too fragile for a live demo (cert popups, mic/cam refused
when iOS gets suspicious, tunnel TTL). The robust path is to wrap the
same web project in a native iPad app via Capacitor — camera/mic are
native iOS permissions, no Vite, no tunnel, no cert.

**Full step-by-step:** see `BUILD_APP.md` in the project root. Short version:

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# one-time
xcode-select --install
sudo gem install cocoapods
npm install                # pulls in @capacitor/* (already in package.json)
npx cap add ios            # creates ./ios/ Xcode project

# every time the web code changes
npm run ios:sync           # vite build + cap sync ios
npm run ios:open           # opens Xcode → ▶ to install on iPad
```

Before the first run, paste `docs/ios_info_plist_snippet.xml` into
`ios/App/App/Info.plist` (Camera / Microphone / Speech / LocalNetwork
usage descriptions). Without these iOS silently denies the
getUserMedia / SpeechRecognition / MQTT calls.

On the iPad once installed:

1. Settings → General → VPN & Device Management → trust your Apple ID
   (only on first install, only for free Apple ID).
2. Open the app → grant Camera / Microphone / Speech permission.
3. Tap the ⚙︎ gear (top-right) and enter your Mac's LAN IP for sensor MQTT.
4. The capsule at the top switches **Mirror / Listen / Both** live.

On the Mac during demo: only Mosquitto is needed (`brew services start
mosquitto` or `mosquitto -c mosquitto/mosquitto.conf`). Vite is not used.

---

## 2b'. (Fallback) Cloudflare Tunnel one-shot script — web mode

> If `https://<mac-ip>:5173/` on the iPad shows "This Connection Is Not
> Private" and *Visit Website* doesn't appear or doesn't stick, iOS
> Safari is silently refusing the self-signed cert (it does this when
> permission is needed for camera + mic). The robust fix is to put a
> real, trusted HTTPS cert in front via Cloudflare's free Trycloudflare
> tunnel. No Cloudflare account needed. The tunnel URL is usable
> immediately on iPad.

### One-time install

```bash
brew install mosquitto cloudflared
```

### Run

```bash
bash /Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D/scripts/start-tunnel.sh
```

The script:
1. Kills stale ports.
2. Starts Mosquitto (broker for the Arduino).
3. Starts Vite in HTTP mode on `127.0.0.1:5173` (Cloudflare adds TLS).
4. Starts `cloudflared tunnel --url http://127.0.0.1:5173`.
5. Prints **four** iPad URLs (Mirror / Listen / Both / Both + VRM) using
   the freshly-issued `https://*.trycloudflare.com` hostname.

Open one of the printed URLs on the iPad — Safari treats it as a normal
trusted HTTPS site, so the *Allow camera / mic* prompts appear normally.

### Stop after the demo

```bash
pkill -f vite ; pkill -f cloudflared ; pkill -f mosquitto
```

### If `brew install cloudflared` is slow / times out

Fallback options that also produce a trusted HTTPS URL:

| Tool | Install | Run |
|---|---|---|
| Cloudflare (preferred) | `brew install cloudflared` | `cloudflared tunnel --url http://127.0.0.1:5173` |
| localtunnel | `npm i -g localtunnel` | `lt --port 5173` |
| serveo (no install) | — | `ssh -R 80:localhost:5173 serveo.net` |

In each case the script above can be adapted by swapping the cloudflared
command for the chosen tool. The Vite proxy `/mqtt` works transparently
through any of these because they all upgrade WebSocket transparently.

---

## 2c. iPad-as-camera-and-microphone mode + sensor dashboard

**This is what the supervisor will see at the next meeting.** iPad runs
face capture, microphone capture, speech-to-text, and rendering. The Mac
just serves the page and the MQTT broker.

Pipeline:

```
iPad camera ─► MediaPipe FaceLandmarker ─► avatar blendshapes ─┐
iPad mic ─────► Web Audio (RMS → dB)      ───► dashboard sound │
        └─────► SpeechRecognition (Apple) ───► transcript ────►│ → mood/book
                                                                ▼
Arduino MKR (BME280 + BH1750 + PIR) ─MQTT─► Mosquitto on Mac ─► Vite /mqtt ─► dashboard

```

Sensors are optional — use `?sensors=mock` for synthetic Arduino data
when the hardware isn't wired yet; the iPad mic + speech still work.

### 2c.1 — Start the Mac side (HTTPS Vite + Mosquitto)

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# 1) Free any stale ports
lsof -ti :5173 :8787 :1883 :9001 2>/dev/null | xargs -r kill -9
sleep 1

# 2) Mosquitto broker (skip if you'll only test ?sensors=mock)
brew list mosquitto >/dev/null 2>&1 || brew install mosquitto
(mosquitto -c "$DLL/mosquitto/mosquitto.conf" -v > /tmp/mosq.log 2>&1 &)

# 3) HTTPS Vite (iPad needs HTTPS for getUserMedia over LAN)
(cd "$DLL" && npm run start > /tmp/vite.log 2>&1 &)

sleep 4
```

### 2c.2 — Preflight

```bash
# Vite serving:
curl -kSs -o /dev/null -w "vite: HTTP %{http_code}\n" "https://localhost:5173/?mode=capture"
# Mosquitto listening:
lsof -nP -iTCP:1883 -sTCP:LISTEN | head -2   # Arduino's TCP listener
lsof -nP -iTCP:9001 -sTCP:LISTEN | head -2   # browser's WS listener
# Find the Mac's LAN IP (iPad will use this):
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1)
echo "iPad URL: https://${LAN_IP}:5173/?mode=capture&sensors=mock"
```

### 2c.3 — Open on the iPad

The iPad must be on the **same Wi-Fi** as the Mac.

In iPad Safari, type the URL printed by the preflight step:

```
https://<LAN_IP>:5173/?mode=capture&sensors=mock
```

- First visit shows "This Connection Is Not Private" → tap *Show Details*
  → *visit this website* → *Visit Website*.
- Safari prompts in order:
  1. **Camera** → Allow (drives face tracking)
  2. **Microphone** → Allow (drives sound level + speech-to-text)

**Success criteria:**

- Avatar visible (placeholder head by default) and reacting to the iPad's
  front camera (turn head, blink, smile).
- Dashboard panel on the right edge showing:
  - **Arduino sensors** (top): Temperature, Humidity, Light, Motion pill —
    real values via MQTT, or smoothly animated mock values.
  - **Heard on iPad** (middle): a live sound-dB bar that rises when you
    speak, plus the last sentence Safari transcribed.
  - **Suggested reading** (bottom): a book title appears whenever any of
    the speech keywords matches the curated book database (`src/bookDb.js`).
  - **Mood pill** at the bottom flips between *neutral / happy / sad /
    thinking* based on sentiment of the last sentence; the avatar's smile
    or frown is overlaid on the MediaPipe-driven blendshapes for ~4 s.
- HUD top-left: `Mode: capture`, `FPS: ≥ 25`, `Status: tracking`.
- **Top-centre capsule** `👤 Mirror · 🎤 Listen · ✨ Both` lets the user
  switch between the three features live:
  - **Mirror** — camera drives avatar's face; speech recognition is paused
    and the dashboard's audio/book sections fade out.
  - **Listen** — camera is ignored, avatar uses a procedural idle
    (breathing, slow look-around); mic + speech are active and the
    suggested-book panel updates as you speak.
  - **Both** (default) — both running together.
- A small **mood pill** under the capsule shows the live transcript and the
  detected mood (`happy / sad / thinking / neutral`).

### What to say to demo it

| Say something like… | Should trigger |
|---|---|
| "I love this book about evolution" | Mood: happy → avatar smiles; book: *The Selfish Gene* |
| "What is the history of the Silk Roads" | Mood: thinking → brows down/look up; book: *The Silk Roads* |
| "I'm tired and the room is too noisy" | Mood: sad → frown; no book match |
| "Tell me about quantum physics" | Mood: thinking; book: *A Brief History of Time* |
| "Show me a book on urban planning" | Mood: thinking; book: *Image of the City* or *Soft City* |

### 2c.4 — Switch from mock to live sensors (once Arduino is flashed)

```
https://<LAN_IP>:5173/?mode=capture&sensors=1
```

The dashboard header switches from `live · mock` to `live · mqtt`. Each
value updates at 1 Hz as the Arduino publishes. Use this to verify the
whole pipeline (sensor → MKR → MQTT → Vite proxy → iPad).

### 2c.5 — Quick MQTT debug from the Mac

```bash
# install once
brew install mosquitto-clients
# tail all topics
mosquitto_sub -h localhost -t 'ucl/library/dissertation/#' -v
# publish a fake value to sanity-check the iPad dashboard:
mosquitto_pub -h localhost -t ucl/library/dissertation/temp -m 23.5
```

---

## 3. Switch to HTTPS + live face capture (when supervisor wants to see it react)

`getUserMedia` requires a secure context on non-localhost origins, and
the iPad bridge also needs HTTPS. Restart in HTTPS mode:

```bash
# stop the HTTP servers first
pkill -f "vite" || true
pkill -f "node server/relay.js" || true
sleep 1

cd "/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D"
npm run start         # HTTPS variant (self-signed cert)
```

Preflight (the `-k` skips cert verification — that's fine for self-signed):

```bash
sleep 3
curl -kSs -o /dev/null -w "HTTP %{http_code}\n" "https://localhost:5173/?mode=capture"
# Expect:  HTTP 200
```

Then open the page:

```bash
open "https://localhost:5173/?mode=capture"
```

The browser will warn about the self-signed cert.
**On the warning page click:** *Advanced* → *Proceed to localhost (unsafe)*.
Then **allow camera** when prompted.

**Success criteria:**
- Bottom-left preview shows the camera feed (mirrored).
- The avatar mirrors the operator's facial expressions in real time.
- HUD: `Mode: capture`, `Status: tracking`, FPS ≥ 25.

If camera permission was previously blocked, reset it:
- Safari → Settings → Websites → Camera → localhost → Allow
- Chrome: click the camera icon at the right end of the address bar

---

## 4. iPad display path (optional, for the full hologram demo)

The iPad needs HTTPS (LAN origin), so make sure section 3's HTTPS
server is running, not the HTTP one.

1. On the Mac, find the LAN IP:
   ```bash
   ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1
   ```
2. iPad must be on the **same WiFi** as the Mac.
3. In iPad Safari, open:
   ```
   https://<that-ip>:5173/?mode=display
   ```
4. Tap **Show Details → visit this website** on the cert warning.
5. Tap the **Fullscreen** button in the top-right HUD.
6. Lay the iPad face-up, place the acrylic pyramid on top.

The Mac drives capture; the iPad only renders. Latency in HUD
("Latency: NN ms") should read 30–120 ms over good WiFi.

---

## 5. Quick-fire troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl ... Connection refused` after `npm run start:http` | Vite didn't actually boot — missing deps or port in use | check the relay/vite output; `lsof -i :5173`; `kill -9 <pid>`; rerun |
| Browser opens but page is blank / "can't connect to server" | URL scheme doesn't match running server | match the URL to the running script: HTTP → `http://127.0.0.1:5173`, HTTPS → `https://localhost:5173` |
| Safari/Chrome shows "This connection is not private" and won't proceed | Self-signed cert never accepted | click *Advanced → Proceed*; or use HTTP path in section 1 for first verification |
| HUD says `Status: starting…` and never changes | JS module failed to load — check DevTools console (⌥⌘I) | usually a stale Vite cache: `rm -rf node_modules/.vite` and restart |
| `npm run dev` fails with `EADDRINUSE` on 5173 | stale Vite process | `lsof -i :5173` then `kill -9 <pid>` |
| Camera permission denied | Site blocked previously | use `?mode=demo` for the demo; reset Safari/Chrome permission later |
| "Top-level await" build error | already fixed in `vite.config.js` (`target: es2022`) | re-pull if it returns |
| iPad cert refused | Safari hides the bypass on the first screen | tap *Show Details* under the warning, then *visit this website* |
| Avatar tilted/upside-down on iPad | viewport rotation mismatch | layout dropdown → **Single (debug)** first to confirm tracking; then back to **4-view pyramid** |
| Latency >300 ms on iPad | slow WiFi | both devices on 5 GHz WiFi; close other tabs on iPad |
| **Head completely static / no rotation** | `vrm.humanoid.update()` not called | Confirm `avatarScene.update(delta)` is called in `main.js` loop BEFORE `pyramid.render()`. This is the most common cause. |
| **Head turns wrong direction** (avatar turns opposite to user) | Axis sign wrong | In `applyHeadTransform`, the Euler correction is `(-euler.x, -euler.y, -euler.z)`. If yaw is reversed, try `+euler.y`. If pitch is reversed, try `+euler.x`. |
| **Head roll wrong direction** | Z-axis sign wrong | Try `+euler.z` instead of `-euler.z` in `applyHeadTransform`. |
| **Head moves but body wobbles** | headPivot still receiving rotation | Confirm `this.headPivot.quaternion.set(0,0,0,1)` is called inside the `vrm?.humanoid` branch. |
| **Head snaps or jitters** | SLERP too high | Lower `SLERP` from 0.25 toward 0.15 in `applyHeadTransform`. |
| **Head barely moves / very laggy** | SLERP too low | Raise `SLERP` toward 0.4. |
| **Face expressions too subtle** | GAIN/POW too conservative | In `applyBlendshapes`, increase `FACE_GAIN` (currently 1.5) or decrease `FACE_POW` (currently 0.78 → try 0.65). |
| **Neck not following head** | neckTarget quaternion built incorrectly | The `new THREE.Quaternion().slerp(q, 0.35)` interpolates from identity to 35% of target. If neck is frozen, open DevTools console and check `getNormalizedBoneNode('neck')` is non-null. |

---

## 5b. iPad 7/8 转移测试指导（USB 数据线连接）

> 目标：把正在 Mac 上运行的项目，通过 Lightning 数据线在 iPad 7 或 iPad 8 的
> Safari 上打开，测试面部捕捉 + 头部转动效果，以及 Pepper's Ghost 四视角布局。
>
> **为什么用 USB 而不是 WiFi：** USB 连接走本地虚拟网卡（bridge100），延迟低、
> 无需在同一 WiFi，适合单机演示。

---

### 步骤 0 — 前置条件

```bash
node --version    # 需要 v18+
sw_vers           # 确认 macOS 版本（Ventura/Sonoma 均可）
```

iPad 侧：
- iOS 15 或以上（iPad 7 出厂 iOS 13，建议升级到 15+）
- Safari（不要用 Chrome iOS — iOS 上所有浏览器内核都是 WebKit，但 Safari 的 
  `getUserMedia` 支持最好）

---

### 步骤 1 — 用 USB 建立信任连接

1. 用 Lightning 数据线把 iPad 接到 Mac。
2. iPad 屏幕弹出 **"信任此电脑？"** → 点**信任** → 输入 iPad 密码确认。
3. Mac 终端验证连接：

```bash
system_profiler SPUSBDataType | grep -A5 iPad
# 应该能看到 iPad 的设备条目
```

4. 检查 Mac 上的 USB 网卡是否出现：

```bash
ifconfig | grep -A3 bridge
# 找 bridge100（或 bridge101）接口，记录其 inet 地址
# 示例输出：  inet 192.168.2.1 netmask 0xffffff00
```

如果没有 bridge100，打开 Mac 的 **系统设置 → 通用 → 共享 → 互联网共享**，
把"共享来自"设为 WiFi，"共享给"勾选 iPad USB 那个接口，启用。
再重新运行上面的 ifconfig 命令。

---

### 步骤 2 — 在 Mac 上启动 HTTPS 服务

iPad 的 Safari 要求 `getUserMedia`（摄像头）必须在 HTTPS 下使用，即使是本地 IP。

```bash
# 停掉之前可能在跑的 HTTP 服务
pkill -f vite; pkill -f "node server/relay.js"; sleep 1

cd "/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D"
npm run start        # 启动 HTTPS Vite (0.0.0.0:5173) + WebSocket relay (8787)

# 等几秒后确认服务起来了
sleep 4
curl -ksSo /dev/null -w "HTTP %{http_code}\n" "https://localhost:5173/"
# 期望输出：HTTP 200
```

---

### 步骤 3 — 找到正确的访问 IP

```bash
# Mac 在 USB 网卡上的 IP（iPad 用这个 IP 访问 Mac）
ipconfig getifaddr bridge100
# 示例：192.168.2.1

# 备用方法（如果 bridge100 不存在）
ipconfig getifaddr en0   # WiFi IP（需要 iPad 和 Mac 在同一 WiFi）
```

**记住这个 IP，下一步用。**

---

### 步骤 4 — 在 iPad Safari 上打开页面

在 iPad Safari 地址栏输入（替换 `<MAC_IP>` 为上面找到的 IP）：

```
https://<MAC_IP>:5173/?mode=capture&avatar=/3D_/ryu2.vrm
```

**处理自签名证书警告（必做）：**

1. Safari 显示"此连接不安全" / "无法验证网站身份"。
2. 点 **显示详细信息**（或 Advanced）。
3. 点 **访问此网站**（Visit Website）。
4. 再次确认。

如果没有出现"显示详细信息"选项，说明 Safari 完全拒绝了。解决方法：

```bash
# 在 Mac 上把证书导出给 iPad 信任（可选，一劳永逸）
# 1. 找到 Vite 生成的证书
ls node_modules/.vite/
# 通常在 node_modules/.vite/cert.pem 或 vite 配置里指定的路径

# 2. 用 AirDrop 或邮件把 cert.pem 发到 iPad
# 3. iPad：设置 → 通用 → VPN与设备管理 → 安装描述文件 → 安装
# 4. iPad：设置 → 通用 → 关于本机 → 证书信任设置 → 开启完全信任
```

---

### 步骤 5 — 在 iPad 上允许摄像头

Safari 会弹出 **"'网站'想要访问摄像头"** → 点**允许**。

如果没弹出或之前点了拒绝：
- iPad：**设置 → Safari → 摄像头** → 改为"询问"或"允许"
- 关闭 Safari，重新打开页面

---

### 步骤 6 — 测试检查清单

等 HUD 显示 `Status: tracking` 后依次验证：

| 项目 | 期望效果 |
|---|---|
| 模型加载 | HUD：`loading avatar 0%` → `avatar ready (vrm)` |
| 面部表情 | iPad 前置摄像头照到脸，avatar 跟随眨眼、张嘴、微笑 |
| 点头 | 低头 → avatar 低头；仰头 → avatar 仰头（方向一致） |
| 左右转头 | 向左转 → avatar 向左转 |
| 侧歪 | 右耳向右肩 → avatar 右歪 |
| 身体稳定 | 转头时躯干不晃动 |
| FPS | ≥ 20（iPad 7/8 性能比 Mac 弱，20+ 流畅可接受） |

---

### 步骤 7 — 切换到 Pepper's Ghost 四视角布局

在 iPad Safari 右上角控制面板，把 **Layout** 下拉改为 **4-view pyramid**。
然后点 **Fullscreen** 全屏。把 iPad 平放，将亚克力棱锥放在屏幕中央。

或者直接用 URL：

```
https://<MAC_IP>:5173/?mode=capture&avatar=/3D_/ryu2.vrm&layout=pyramid
```

（注：layout URL 参数需要在 main.js 里手动支持，目前 layout 默认 single，
可以在页面加载后用 UI 切换，或事后把 `const MODE` 那块加一行 layout 读取。）

---

### 步骤 8 — 双设备模式（Mac 采集 + iPad 显示，推荐演示用）

这样 Mac 负责跑 MediaPipe（重计算），iPad 只负责渲染（轻），帧率更高。

**Mac**（捕捉端）：

```bash
open -a "Google Chrome" "https://localhost:5173/?mode=capture&avatar=/3D_/ryu2.vrm"
```

**iPad**（显示端，在 Safari 输入）：

```
https://<MAC_IP>:5173/?mode=display&avatar=/3D_/ryu2.vrm
```

iPad 的 HUD **Latency** 应在 30–80 ms（USB），超过 200 ms 说明网络有问题。

---

### 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| Safari 完全无法打开页面 | bridge100 IP 不通 | 换 WiFi IP（`ipconfig getifaddr en0`），确保 iPad 和 Mac 同一 WiFi |
| "无法建立安全连接"死循环 | 证书不信任 | 按步骤 4 的 AirDrop 证书流程安装并信任 |
| 摄像头弹窗不出现 | Safari 缓存了拒绝 | iPad 设置 → Safari → 摄像头 → 允许 → 重新加载 |
| FPS < 10 | iPad 7/8 跑 MediaPipe GPU 稍慢 | URL 加 `&lowend=1`（480p 采集），或改用双设备模式 |
| avatar 加载卡在 0% | ryu2.vrm 24 MB 走 USB 很快，但首次解析慢 | 等 15–20 秒；如果超过 60 s 报错，检查文件路径 `/3D_/ryu2.vrm` |
| HUD 不显示（display mode） | display 模式隐藏了所有 panel | 正常；切回 capture 模式才有 HUD |

---

## 6. URL flag reference

| Flag | Effect |
|---|---|
| `?mode=demo` | Procedural animation, no webcam needed. **Use this first.** |
| `?mode=capture` | Mac with webcam → MediaPipe → avatar (default) |
| `?mode=display` | iPad — receives frames over WebSocket, renders only |
| `?lowend=1` | 480×360 capture (use on weaker hardware) |
| `?tracker=face\|pose\|holistic` | Pick tracker on load |
| `?avatar=/3D_/<file>.glb` | Load a .glb / .vrm from project root on startup |
| `?sensors=mock` | Show dashboard with synthetic Arduino sensor data (no broker needed) |
| `?sensors=1` | Show dashboard subscribed to live MQTT via Vite proxy `/mqtt` |
| `?audio=0` | Skip mic/speech (force "speech off" — useful if a venue can't grant mic permission) |
| `?features=mirror` | Boot in face-tracking-only mode (camera drives avatar; no audio) |
| `?features=listen` | Boot in audio-only mode (idle face, voice → mood + book recommendation) |
| `?features=both` | Boot with both features active (default) |

---

## 7. npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite only, HTTPS on `0.0.0.0:5173` (needed for iPad + getUserMedia) |
| `npm run dev:http` | Vite only, HTTP on `127.0.0.1:5173` (no cert popup; demo mode only) |
| `npm run relay` | Node WebSocket relay on `:8787` |
| `npm run start` | Relay + HTTPS Vite together (full setup) |
| `npm run start:http` | Relay + HTTP Vite together (first-verification setup) |
| `npm run build` | Production build to `dist/` |

---

## 8. Files the agent may need to touch

```
/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D/
├── AGENT.md                 ← this file
├── README.md                ← human-facing run guide
├── index.html               ← UI + HUD
├── package.json             ← deps + scripts
├── vite.config.js           ← dev server config (HTTPS by default; HTTP_ONLY=1 switches)
├── server/relay.js          ← Node WS relay :8787
└── src/
    ├── main.js              ← wires everything; loop()
    ├── demoMode.js          ← procedural blendshapes for demo
    ├── faceCapture.js       ← MediaPipe FaceLandmarker (Apache 2.0)
    ├── poseCapture.js       ← MediaPipe PoseLandmarker (Apache 2.0)
    ├── oneEuro.js           ← 1-Euro filter for jitter reduction
    ├── avatarScene.js       ← Three.js scene + placeholder head + VRM loader
    ├── pyramid.js           ← 4-camera + composite renderer
    └── streaming.js         ← WS client (capture sends, display receives)
```

---

## 9. What NOT to do

- **Do not** run `npm audit fix --force` — the transitive findings are
  benign and the breaking-changes path will replace MediaPipe.
- **Do not** delete `node_modules` mid-demo to "fix" anything; re-install
  takes long enough to derail the meeting.
- **Do not** edit `pyramid.js` rotations live during the demo — wrong
  rotations only show up clearly once the physical pyramid is in place.
- **Do not** commit the `dist/` or `dist2/` folders.
- **Do not** claim success based on `open <url>` alone — that command
  returns instantly whether or not the page actually loaded. Always run
  the `curl` preflight in section 1a first.

---

## 10. After the demo

```bash
# Kill the servers
pkill -f "vite" || true
pkill -f "node server/relay.js" || true
```

Hand the project back to the user with a one-liner summary of what
worked and what (if anything) didn't.
