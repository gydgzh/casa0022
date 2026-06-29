# CLAUDE_CODE_REDEPLOY_8.md  —  Native plugin: event-driven model + mic exclusivity

> Xcode log from previous round read like:
> ```
> [speech] using NATIVE (SFSpeechRecognizer)
> [audio] mic OK, sampleRate= 44100
> To Native ->  SpeechRecognition start
> TO JS {"status":"started"}
> TO JS undefined        ← this told us everything
> ```
>
> Two bugs found, both fixed in this round:
>
> 1. **Plugin API mismatch.** `@capacitor-community/speech-recognition` v6's
>    `start()` resolves **immediately with `undefined`** — recognition
>    keeps running in the background and reports via `partialResults` +
>    `listeningState` event listeners. My v7 wrapper was awaiting the
>    `start()` Promise as if it carried the final transcript, so the loop
>    spun without ever wiring up results. Rewritten to be event-driven.
>
> 2. **Mic contention back, in native land.** Native SFSpeechRecognizer
>    grabs `AVAudioEngine`. So does WKWebView when `getUserMedia` opens
>    a stream for `audio.js`. They fight, and recognition gets no audio.
>    On Capacitor we now don't open `audio.js` at all (browser dev path
>    still does, since Web Speech tolerates the dB analyser).

---

## Files changed this round

| File | What |
|---|---|
| `src/speechNative.js` | Rewritten for event-driven model: `start()` is fire-and-forget; transcripts come through `partialResults` listener; auto-restart on `listeningState 'stopped'`; final-flush when the session naturally ends |
| `src/main.js` | `audio = null` when running on Capacitor (lets native SFSpeechRecognizer have exclusive `AVAudioEngine`); browser-mode dev path still creates `audio` for the dB bar |

`src/speech.js` (Web wrapper) and the rest of the app are untouched.

---

## Claude Code: run these in order

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# 1. Syntax check
for f in src/*.js; do node --check "$f" || echo "FAIL $f"; done

# 2. Rebuild + sync into Xcode project (no `npm install` needed this round)
npm run ios:sync

# 3. Confirm the new wrapper logic is in the bundle
grep -c "partialResults\|listeningState\|_lastText\|suppressed on Capacitor" \
       ios/App/App/public/assets/*.js
# Expect >= 3

# 4. Open Xcode
npm run ios:open
```

In Xcode:

5. ▶ Build & Run on the iPad.

---

## What to look for in the Xcode console this time

After Speech Recognition permission is allowed, you should see something
like this on the very first sentence you speak:

```
[speech] using NATIVE (SFSpeechRecognizer)
To Native ->  SpeechRecognition available
TO JS {"available":true}
To Native ->  SpeechRecognition checkPermissions
TO JS {"speechRecognition":"granted"}
To Native ->  SpeechRecognition addListener
To Native ->  SpeechRecognition addListener
To Native ->  SpeechRecognition start
TO JS {"status":"started"}
TO JS undefined                                                ← still undefined; that's normal
                                                              ← (start() resolves immediately, by design)
TO JS {"matches":["physics and the universe"]}                ← THIS is the new line you want to see
TO JS {"matches":["physics and the universe"]}
...
TO JS {"status":"stopped"}                                     ← natural end of utterance
To Native ->  SpeechRecognition start                          ← auto-restart for next sentence
TO JS {"status":"started"}
```

And on the iPad dashboard:

- `sessions` advances each time you start speaking.
- `results` **finally** advances with every partialResults event.
- `Last heard` shows the transcript.
- 📖 *A Brief History of Time* shows under Suggested book after the
  session ends (we re-emit the last partial as a finalised utterance
  in the `listeningState 'stopped'` handler).

---

## If `results` is STILL stuck at 0

Then SFSpeechRecognizer itself is failing on this iPad. Check in order:

1. **iPad Settings → Virtual Librarian → Speech Recognition** is ON.
2. **iPad Settings → General → Keyboard → Dictation** is ON. The
   on-device speech-recognition model lives behind that switch.
3. **For Chinese**: the same Dictation pane must have the Mandarin
   language pack downloaded (it'll show a download progress on first
   selection).
4. **For old iPadOS** (< 16): SFSpeechRecognizer required network for
   most languages. Plug in to a network and try again.

If after all that `results` is still 0, the device-side STT is unusable
and we go to Plan C (Whisper.cpp on-device, ~75 MB) or Plan D (touch UI).

---

## Things NOT to do

- Don't add `audio.start()` to the Capacitor code path — it was the cause
  of the silent stall.
- Don't try to `await SpeechRecognition.start()` as if it returns a
  transcript. It doesn't. Use the listener.
- Don't `npm install` again; nothing in `package.json` changed this round.
- Don't touch `src/pyramid.js`.
