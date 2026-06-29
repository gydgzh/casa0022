# CLAUDE_CODE_REDEPLOY_6.md  —  Revert to the version that worked

> User feedback: rounds 4 + 5 made things worse. The original V1 of
> `speech.js` (continuous = true, simple onend → restart) plus the dB
> analyser running alongside was the configuration that actually heard
> speech on this iPad. So this round is a deliberate rollback to that
> shape, while keeping every other improvement made along the way:
>
>   - book / film recommendation split
>   - Wake Lock + visibilitychange recovery
>   - mood-badge pulse + diagnostic counters
>   - "Last heard" smart fallback strings (offline / no audio detected / …)
>   - sensor-driven film picker every 8 s
>
> Net result: speech recognition is back to what worked, dashboard keeps
> all the new visuals.

---

## Files changed this round

| File | What |
|---|---|
| `src/speech.js`   | **Rolled back** to the V1 shape: `continuous=true`, restart inside `onend`. Removed per-utterance restart, watchdog, exponential backoff. Kept `sessionCount`, `resultCount`, `onStateChange`, `setLang` so dashboard + main.js don't break. |
| `src/main.js`     | **Re-enabled** the audio analyser: `audio = AUDIO_ON ? new AudioCapture() : null` (was being nulled when speech was supported). The previous `audio.pause()` / `audio.resume()` calls in the `onStateChange` callback are already removed. |
| `src/dashboard.js` | **Restored** the Sound dB row (since audio.js is on again). The bilingual + smart-fallback "Last heard" line is kept from the previous round. |

---

## Claude Code: run these in order

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# 1. Syntax check
for f in src/*.js; do node --check "$f" || echo "FAIL $f"; done

# 2. Rebuild + sync into the Xcode project (prebuild re-syncs 3D_)
npm run ios:sync

# 3. Verify both old + new symbols are present in the bundle
#    (V1 speech logic + the kept-from-previous-rounds upgrades)
grep -c 'continuous *= *true\|sessionCount\|recommendBookFromSpeech\|recommendFilmFromSensors\|wakeLock' \
       ios/App/App/public/assets/*.js
# Expect >= 5

# 4. Open Xcode to deploy
npm run ios:open
```

In Xcode:

5. iPad target → ▶ Build & Run (~30 s).

---

## Verify on the iPad

1. Open the app. Allow Camera + Microphone (Speech Recognition prompt may
   already be remembered).
2. Tap **Both** in the top capsule.
3. Watch the dashboard's right column:
   - **Sound** row should pulse a value (≥ 30 dB ambient).
   - **Last heard** should start showing italic green interim text within
     a few seconds of you speaking.
   - The diagnostic line `sessions N · results M · last Xs ago` — both
     `N` and `M` should be advancing.
4. Say *"physics and the universe"* → 📖 *A Brief History of Time*
   appears under "Suggested book".
5. Leave the iPad alone for ~15 seconds — the 🎬 "Suggested film" row
   should swap to a new film whose mood matches the mock sensor state.

---

## Things NOT to do

- Don't re-rewrite `speech.js` to `continuous=false` again. The V1 shape
  works on this device.
- Don't disable `audio.js` again. It was a red herring.
- Don't touch `src/pyramid.js`.
