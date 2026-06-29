# CLAUDE_CODE_REDEPLOY_5.md  —  Fix "warming up forever" mic conflict

> Symptom on the live iPad: the **Last heard** line was stuck on
> "warming up…", with a brief flash of "listening" maybe once every
> few seconds. Cause confirmed by the diagnostic line — `sessions` was
> incrementing, `results` was always 0.
>
> Root cause: on iPad WKWebView only **one** mic consumer is permitted
> at a time. The dashboard's dB analyser (`audio.js`) was holding the
> mic, so each Web Speech session started with no signal, hit Apple's
> "no-speech" detector almost immediately, and ended. The recogniser
> restarted, got nothing again, ended, restarted… an infinite warm-up.
>
> Fix in this round: on iPad (any browser where Web Speech is supported)
> the audio analyser is **never opened**. Speech owns the mic exclusively.
> The dB row in the dashboard is replaced by a clearer "Microphone" row
> that shows mic state directly (idle / listening / between sessions).

---

## Files changed

| File | Change |
|---|---|
| `src/main.js`     | `audio = null` whenever `webkitSpeechRecognition` is available; removed the now-obsolete pause/resume coordination in the speech `onStateChange` callback; cleaned up the `startCapture` mic-acquire path |
| `src/dashboard.js` | Replaced "Sound" dB row with a "Microphone" row whose colour + label reflect speech state (grey idle, green listening, amber between sessions). "Last heard" fallback text is smarter: shows "offline — STT needs Wi-Fi" if no network, "no audio detected — speak closer" if ≥5 sessions but 0 results, "listening…" / "warming up…" otherwise |
| `src/audio.js`    | Untouched in this round (kept as fallback for browsers without Web Speech) |
| `src/speech.js`   | Untouched in this round (the previous diagnostic surface is reused) |

---

## Claude Code: run these

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# 1. Syntax sanity
for f in src/*.js; do node --check "$f" || echo "FAIL $f"; done

# 2. Rebuild + push into the Xcode project (prebuild also re-syncs 3D_)
npm run ios:sync

# 3. Confirm the new logic is in the bundle
grep -c '_speechSupported\|Microphone\|no audio detected\|offline' \
       ios/App/App/public/assets/*.js
# Expect >= 3

# 4. Open Xcode to deploy
npm run ios:open
```

In Xcode:

5. iPad target → ▶ Build & Run (~30 s).

---

## What to verify on the iPad

### Test 1 — Listen mode actually transcribes

1. Tap **Listen** in the top capsule.
2. Watch the dashboard's **Microphone** row.
3. Within 2 seconds you should see:
   - Glyph 🎤 stays the same
   - Label changes from "idle" → green **"listening"** when the recogniser
     is mid-session, → amber "between sessions" briefly during restart
4. Say *"recommend a book about physics"* slowly + close to the mic.
5. **Last heard** should show:
   - Interim transcript in **italic green** during the sentence
   - Final transcript in **solid white** when you stop
6. Below it, `sessions N · results M · last Xs ago` — `results` should
   advance to ≥ 1 within a few seconds of speaking.
7. 📖 *A Brief History of Time* should appear in "Suggested book".

### Test 2 — If "Last heard" still says "warming up" forever

The new dashboard tells you why:

| Text shown | Meaning | Fix |
|---|---|---|
| `offline — STT needs Wi-Fi` | iPad has no internet | rejoin Wi-Fi, or use Arduino's AP and accept STT won't work |
| `no audio detected — speak closer` | 5+ sessions ran, none picked up speech | move 20-30 cm from the iPad, speak at normal conversational volume; check the iPad isn't routed to a Bluetooth headset |
| `warming up…` (steady, no flash) | sessions are failing before onstart | mic permission was revoked — iPad Settings → Virtual Librarian → Microphone toggle |
| `listening…` (steady green) | recogniser is working but no result yet | speak; should resolve in a second |

### Test 3 — long-run still good

Wake Lock + visibilitychange recovery (added last round) are unchanged.
Leave the iPad on the desk for 10 minutes, screen should stay on.

---

## If this still doesn't fix it — Plan B

If after this round the recogniser is **still** failing (`results: 0`
even close to the mic, online, with permission granted), the Web Speech
API in WKWebView is too brittle for the demo. Plan B is the native
Capacitor plugin:

```bash
npm install @capacitor-community/speech-recognition
npx cap sync ios
```

Then swap `src/speech.js` to call `SpeechRecognition.start(...)` from
that plugin. It uses native `SFSpeechRecognizer` directly — same Apple
on-device engine, but without the WKWebView/Web Speech middleware.

Tell me if we need to go there; I'll do the plugin swap in a 30-min
follow-up.

---

## Things NOT to do

- Don't re-enable `audio.start()` for the dB bar on iPad. That's the
  exact mic conflict this round fixes.
- Don't remove the diagnostic line under "Last heard" — it's the only
  way to tell apart "mic-not-working" / "no-internet" / "result-blocked"
  failure modes from the outside.
- Don't touch `src/pyramid.js`.
