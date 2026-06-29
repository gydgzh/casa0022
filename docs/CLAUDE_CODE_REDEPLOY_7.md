# CLAUDE_CODE_REDEPLOY_7.md  —  Plan B: native SFSpeechRecognizer

> `sessions` was incrementing, `results` was stuck at 0 even after the V1
> revert. That confirms Web Speech API in WKWebView is fundamentally
> broken on this iPad — no amount of JS-level tweaking will fix it.
>
> Plan B: ship the **Capacitor community speech-recognition plugin**, which
> calls iOS's native `SFSpeechRecognizer` directly (same engine Siri uses)
> and bypasses Web Speech entirely. The JS-side API is wrapped in
> `src/speechNative.js` with the exact same shape as the Web Speech
> wrapper, so the rest of the app keeps working unchanged.
>
> Browser builds (Mac Safari / Chrome) still use Web Speech via the old
> wrapper; only Capacitor builds switch to native.

---

## Files changed this round

| File | Change |
|---|---|
| `package.json` | Added `@capacitor-community/speech-recognition` dependency |
| `src/speechNative.js` | **NEW** — wraps the plugin, exposes same API as `SpeechRecognizer` (start/stop/setLang/onText/onStateChange + sessionCount/resultCount) |
| `src/main.js` | At startup: `_isCapacitorRuntime` → picks `NativeSpeechRecognizer`; else `WebSpeechRecognizer`. Awaits `speech.start()` (now returns a Promise) |
| `src/speech.js` | Untouched — still works as the browser-only fallback |

---

## Claude Code: run these in order — this round is heavier (one-time)

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# 1. Install the new dep (~10 s)
npm install

# 2. Sync into iOS — this runs `pod install` in ios/App/ to bring in the
#    Swift side of the plugin. Takes ~30-60 s the first time.
npx cap sync ios

# 3. Rebuild + sync (prebuild copies 3D_/ into public/3D_/)
npm run ios:sync

# 4. Sanity-check the bundle contains the native wrapper
grep -c '_isCapacitorRuntime\|NativeSpeechRecognizer\|SFSpeechRecognizer\|speech-recognition' \
       ios/App/App/public/assets/*.js
# Expect >= 3 (the SFSpeechRecognizer string itself only lives in the
# iOS Swift code, not the JS bundle)

# 5. Open Xcode to deploy
npm run ios:open
```

In Xcode:

6. iPad target → ▶ Build & Run.
   * First build is slow (~2 min) because CocoaPods is wiring up the
     native plugin. Subsequent builds are fast again.
7. If Xcode complains about a missing pod, run `cd ios/App && pod install`
   manually and re-build.

---

## Verify on the iPad

1. App launches. **You'll see a fresh Speech Recognition permission
   prompt** — even though you allowed mic before, this is a different
   permission (Speech Recognition vs. Microphone). Tap **Allow**.
2. Watch the dashboard's right column. The Sound dB bar should still be
   live (audio.js is back on too). Below it:
   - **Last heard** should populate within 2-3 seconds of you speaking.
   - **`sessions N · results M · last Xs ago`** — `results` should
     finally start incrementing.
3. Say *"physics and the universe"* → 📖 *A Brief History of Time*.
4. Switch language in Settings to **中文**, save → say
   *"我想找一本关于哲学的书"* → 📖 *The Republic*.

If `results` is STILL 0 after this round, the only remaining causes are
device-side:
* iOS Settings → Virtual Librarian → Speech Recognition is OFF
* iOS Settings → General → Keyboard → Dictation language pack missing
  for the chosen language
* No network (Apple cloud STT path for non-English needs Wi-Fi)

---

## What the user has to do in Xcode (manual steps the CLI can't replace)

1. After `npx cap sync ios`, Xcode may pop a banner saying "the project
   needs to be re-loaded" — click **Revert** if asked, then re-open.
2. Build target picker (top bar): still your iPad.
3. App ▸ Signing & Capabilities → confirm Team is still your Apple ID.
4. Press ▶ Run.
5. On first launch, accept the new Speech Recognition permission prompt.

---

## Things NOT to do

- Don't remove `@capacitor-community/speech-recognition` from
  package.json — that breaks the iPad build.
- Don't delete `ios/App/Podfile.lock` — CocoaPods uses it to lock the
  plugin's Swift version. If a pod install fails, `cd ios/App && pod install`
  to refresh.
- Don't replace the WebSpeechRecognizer entirely — it's still the
  fallback for browser-mode dev/testing on the Mac.
- Don't touch `src/pyramid.js`.

---

## If the native plugin also can't fire `results`

Then we have three options left:
1. **Whisper.cpp in the WebView** — bundle the 75 MB whisper-tiny model
   and run STT 100 % on-device, no network. Heavy but guaranteed.
2. **Apple's Dictation via the keyboard** — replace the speech-driven
   recommender with a text input box that uses iPad's built-in dictation
   button (it inserts text via the keyboard). Less elegant but works.
3. **Drop voice from the iPad path** — keep face tracking and sensors,
   move the "tell me a topic" flow to a touch-driven category picker.

Tell me the symptom and I'll do whichever fits the dissertation timeline.
