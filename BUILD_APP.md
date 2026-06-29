# BUILD_APP.md — Package the dissertation as a native iPad app

> Audience: Yidan + her local AI agent. Goal: take the existing web project
> and ship it as a real iPad app that launches from the home screen, asks
> for camera/mic permissions natively, and connects to the Mac's Mosquitto
> broker over the LAN — no Vite, no cert pop-ups, no tunnel.

---

## Why Capacitor (and not a from-scratch SwiftUI app)

* Re-uses every line of the existing Vite project untouched.
* Apple-developer **free tier** is enough to install on your own iPad
  (7-day cert; refresh by re-building from Xcode whenever you visit
  the lab). Paid Developer Program (£79/yr) gives permanent installs.
* Native `getUserMedia` permissions: camera/mic are asked once via real
  iOS dialogs and remembered, no Safari security theatre.
* Web Speech API, MediaPipe, three-vrm, WebGL — all work inside
  `WKWebView` exactly like in mobile Safari.

---

## 0. One-time setup on the Mac

```bash
# 1. Xcode + command-line tools (~10 GB, gets it from the App Store)
xcode-select --install
# (open Xcode once, accept the licence, install iOS platform when asked)

# 2. CocoaPods (Capacitor uses it for iOS native deps)
sudo gem install cocoapods

# 3. iOS deployment tools
brew install ios-deploy
```

Then sign in to your Apple ID in **Xcode → Settings → Accounts**.
The free tier is fine for installing on your own iPad.

---

## 1. One-time setup in the project

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# Install Capacitor + iOS platform (already added to package.json)
npm install

# Generate the iOS Xcode project (creates the ./ios folder)
npx cap add ios
```

After `cap add ios`, **manually open `ios/App/App/Info.plist`** in Xcode and
add these four permission descriptions (or paste the snippet from
`docs/ios_info_plist_snippet.xml` — see next section):

| Key | Sample value |
|---|---|
| `NSCameraUsageDescription` | "Used to mirror your facial expressions onto the virtual librarian." |
| `NSMicrophoneUsageDescription` | "Used to detect ambient noise and recognise spoken topics for book recommendations." |
| `NSSpeechRecognitionUsageDescription` | "Used to transcribe what you say so the librarian can suggest a relevant book." |
| `NSLocalNetworkUsageDescription` | "Used to read environment sensors (temperature/light/motion) published by the Arduino on the same Wi-Fi." |

iOS **will refuse to start the camera or mic at all** without these strings.

---

## 2. Build + install on the iPad

```bash
# Vite build → dist/ → copied into ios/App/App/public/
npm run ios:sync

# Open the project in Xcode
npm run ios:open
```

In Xcode:

1. Top bar: select the **App** scheme, target = your physical iPad
   (must be plugged in via USB-C or trusted over Wi-Fi).
2. Click **App** in the file tree → **Signing & Capabilities** tab →
   set **Team** to your personal Apple ID. Bundle ID can stay
   `uk.ac.ucl.casa.virtuallibrarian`.
3. Press ▶ (Build & Run).

First launch on iPad:

1. iPad will say "Untrusted Developer" → on iPad go to
   *Settings → General → VPN & Device Management* → tap your Apple ID →
   *Trust*.
2. Re-launch the app from the home screen.
3. iOS asks for **Camera**, **Microphone**, **Speech Recognition** —
   tap Allow on each.
4. The dissertation app opens fullscreen, no Safari chrome.

---

## 3. Configure the Mac IP inside the app

After launch, tap the **⚙︎ gear** in the top-right and set:

* **Mac IP** — the LAN IP printed by `ipconfig getifaddr en0` on the Mac.
* **Default mode** — Mirror / Listen / Both (you can also switch live with
  the capsule at the top).
* **Default avatar URL** — leave blank for the placeholder, or paste
  e.g. `/3D_/ryu2.vrm` once you bundle a model into `public/3D_/`.

Tap **Save & reload**. The setting persists across app launches.

---

## 4. Bundled assets vs. live-served

`capacitor.config.json` has `webDir: "dist"`, so `npm run build` packages
everything (HTML, JS, 3D models in `public/3D_/`, MediaPipe `.task` files
if you put them in `public/`) into the IPA. The app is fully offline-capable.

**Two caveats:**

* MediaPipe loads its WASM from `https://cdn.jsdelivr.net/...` by default
  (see `src/faceCapture.js`). The app needs Wi-Fi for the **first** load;
  subsequent loads come from the WKWebView cache. For a fully offline
  build, host the MediaPipe assets locally in `public/`.
* The Pixiv sample VRM at `?avatar=…vrm-sample` is also a CDN URL. Put any
  avatar you want shipped in `public/3D_/` and reference it by relative
  path (`/3D_/your.vrm`).

---

## 5. Demo-day routine (no Vite, no tunnel)

```bash
# On the Mac, only this:
brew services start mosquitto       # or: mosquitto -c mosquitto/mosquitto.conf

# Power on the Arduino. It auto-connects to the broker over Wi-Fi.

# On the iPad: tap the app icon. Done.
```

Mode switch and book recommendations all happen on the iPad. The Mac is
only the sensor data sink.

---

## 6. Updating the code after a change

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"
npm run ios:sync         # rebuild web bundle + sync into Xcode project
npm run ios:open         # opens Xcode if not already
# Then ▶ in Xcode to reinstall on the iPad.
```

If only the web code changed (no native config, no plugin install), you
can also use `npx cap copy ios` instead of `cap sync ios` — it's faster
because it skips the CocoaPods step.

---

## 7. NOT to do

* **Don't** hard-code Wi-Fi credentials or the Mac IP into the app — use
  the Settings panel; the user will demo on different networks.
* **Don't** commit `ios/App/Pods/` to git (it's regenerated by CocoaPods).
* **Don't** check in the auto-generated `ios/App/App/public/` — it's
  produced by `npm run ios:sync` from `dist/`.
* **Don't** raise the deployment target above iOS 14.5 — the iPad 7/8
  (your target devices) stop at iOS 16 / 17 depending on model; iOS 14.5
  is the floor for Web Speech API support.
