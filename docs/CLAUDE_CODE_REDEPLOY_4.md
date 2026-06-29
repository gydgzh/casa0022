# CLAUDE_CODE_REDEPLOY_4.md  —  Last-heard fix + long-run stability

> Two issues, addressed together:
>   1. **"Last heard" never updated**, even when the recogniser was
>      pulsing. Root cause: on iPad Safari, having both an open
>      `AudioContext` analyser (for the dB bar) and an active
>      `webkitSpeechRecognition` session competes for the microphone, and
>      iOS silently denies the second consumer. Speech now pauses the
>      AudioContext for the duration of each session.
>   2. **iPad lifecycle**: when the iPad goes to sleep, gets locked, or
>      the user swipes home, the AudioContext suspends, the speech
>      recogniser dies, and (eventually) the WebGL context can be lost.
>      The app now:
>        - acquires a Wake Lock so the screen stays on,
>        - resumes the AudioContext + restarts the recogniser on
>          `visibilitychange` back-to-foreground,
>        - reloads on `webglcontextlost` to recover from GPU resets.
>
> Plus a dashboard diagnostics line so you can see at a glance whether the
> recogniser is firing: `sessions N · results M · last Xs ago`.

---

## Files changed this round

| File | Change |
|---|---|
| `src/audio.js`     | Added `pause()` and `resume()` methods on AudioContext |
| `src/speech.js`    | Added `sessionCount` and `resultCount`; emits them in `onStateChange` |
| `src/main.js`      | Wake Lock + visibilitychange handler + WebGL-context-lost reload + audio↔speech pause coordination + diagnostics |
| `src/dashboard.js` | Final results render solid; interim results render italic green; diagnostics line under "Last heard" |

---

## Claude Code: run this

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# 1. Quick syntax check
for f in src/*.js; do node --check "$f" || echo "FAIL $f"; done

# 2. Rebuild + push into Xcode project (prebuild also re-syncs 3D_)
npm run ios:sync

# 3. Confirm the new symbols are in the bundle
grep -c 'wakeLock\|webglcontextlost\|visibilitychange\|audio\.pause\|sessionCount' \
       ios/App/App/public/assets/*.js
# Expect >= 5

# 4. Open Xcode to deploy
npm run ios:open
```

In Xcode:

5. Confirm iPad target. ▶ Build & Run.

---

## On the iPad — what to check

### Test A — "Last heard" actually updates

1. Switch to **Both** or **Listen**.
2. Watch the dashboard's right column:
   - The dot in the mood-badge should *pulse* — that's the recogniser
     mid-session indicator.
   - Under "Last heard" you should see `sessions N · results M`. After
     ~2 seconds, `sessions` should already be ≥ 1.
3. Say *"physics and the universe"* slowly and clearly:
   - First you'll see your **interim transcript in italic green** (the
     recogniser is sending partial results).
   - When the sentence finishes, it settles to **solid white** and the
     mood pill changes; 📖 *A Brief History of Time* appears in
     "Suggested book".
4. The `results` counter should have advanced by at least 1; `last Xs
   ago` should reset to a small number.

### Test B — long-run stability

1. Open the app, set Mode to Both, wave at the camera so face tracking
   kicks in.
2. Set the iPad face-up on a table and walk away for **10 minutes**.
   Don't touch it.
3. Come back. The screen should still be on (Wake Lock), the avatar
   should still be tracking your face, and saying *"library"* should
   still trigger a book suggestion.
4. Press the iPad's home button to send the app to background. Wait 30 s.
   Re-open. Within 1-2 seconds you should see *"back to foreground —
   restoring"* in Xcode console, AudioContext resumes, recogniser starts
   a new session.

### Test C — if "Last heard" still won't update

The diagnostics line is the smoking gun:

| What you see | What it means |
|---|---|
| `sessions 0` and never increments | recogniser couldn't start at all; mic permission denied OR iPad has no network for Apple cloud STT |
| `sessions 5 · results 0` | recogniser is starting but never hears anything; microphone-input level is too low, or background noise is hiding speech; try Settings → Sounds → check input volume |
| `sessions 5 · results 5 · last 30s ago` | recogniser worked initially but stopped getting results; audio context conflict still present, OR another app is using the mic (Bluetooth headset?) |
| `results > 0` but transcript text is still blank | bug — please send me the Xcode console log filtered by `[speech]` |

---

## Why this works long-term off the Mac

Once the IPA is installed, the iPad can be unplugged. The app itself
runs entirely on-device:

- All inference (MediaPipe face landmarks, Apple speech-to-text) runs
  through OS or cloud APIs — no laptop in the loop.
- Wake Lock keeps the screen on for the duration of the app session.
  iPadOS allows wake-lock from WKWebView in iOS 16.4+.
- visibilitychange triggers a "warm restart" of any pipeline that
  iPadOS suspended (mic, AudioContext, speech).
- WebGL context loss (rare but happens after long backgrounding) triggers
  an auto-reload that re-spins up the whole app in ~3 s.

In short: tap the app icon → leave it on a desk → it stays alive until
the battery runs out or you tap home. For an exhibition you want to add
a charger; the WKWebView + WebGL + camera + mic stack draws about 5 W,
so a 4-hour show drains roughly half of an iPad 8's battery.

---

## Things NOT to do

- Don't revert the `audio.pause()` call in `onStateChange` — that's the
  fix for the silent "Last heard" failure.
- Don't disable the wake lock in production. For dev you can append
  `?debug=1` and watch the FPS HUD; the wake lock is separate.
- Don't add a long polling interval (>15s) to `getSensorState()` —
  the film-from-mood rotator wants fresh sensor data.
- Don't touch `src/pyramid.js`.
