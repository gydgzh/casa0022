# CLAUDE_CODE_REDEPLOY_3.md  —  Split recommenders + robust speech

> Two functional changes this round:
>   1. Listen (speech) → recommends **books only** now.
>   2. The environmental sensors (light + motion, mock for now) →
>      recommend **films only**, rotating every ~8 s through a
>      mood-matched bucket.
> Plus one reliability fix:
>   3. The Web Speech recogniser was wedging on iPad after a few
>      seconds. It now self-restarts on every utterance, has a
>      10 s watchdog, retries soft errors with linear backoff, and
>      pulses a dot in the UI whenever the mic is actively listening.

Pure rebuild + re-install. No Arduino flash needed; mock sensors drive
the film panel.

---

## Files changed

| File | Change |
|---|---|
| `src/speech.js` | Rewritten — per-utterance sessions, watchdog timer, error retry, `setLang()` hot-swap, `onStateChange` callback for live UI pulse |
| `src/bookDb.js` | Added `mood` tag to every film; added `recommendBookFromSpeech(text)` and `recommendFilmFromSensors(state, seed)` plus `pickMoodFromSensors` |
| `src/main.js` | Calls `recommendBookFromSpeech` for the speech path; spins a `setInterval` to re-pick a film from sensor mood every 8 s |
| `src/dashboard.js` | Now renders **two** recommendation sections — 📖 "Suggested book (from speech)" and 🎬 "Suggested film (from environment)" |
| `index.html` | Pulse animation for the mood-badge dot when the recogniser is mid-session |

---

## Claude Code: copy-paste these steps

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# 1. Self-check the new recommenders before rebuilding
node -e "
import('./src/bookDb.js').then(m => {
  console.log('— Speech → BOOK —');
  for (const t of ['quantum physics','history of china','philosophy of justice','我想找一本关于心理学的书']) {
    const r = m.recommendBookFromSpeech(t);
    console.log(' • '+t+'  →  '+(r ? r.title : 'no match'));
  }
  console.log('— Sensors → FILM (mood bucket rotates) —');
  let seed = 0;
  for (const s of [{lux:50,motion:0},{lux:50,motion:1},{lux:200,motion:0},{lux:600,motion:1}]) {
    const f = m.recommendFilmFromSensors(s, seed++);
    console.log(' lux='+s.lux+' motion='+s.motion+'  →  '+m.pickMoodFromSensors(s)+'  ·  '+(f?f.title:'none'));
  }
});
"

# 2. Rebuild + sync into the iOS Xcode project (prebuild also re-syncs 3D_/)
npm run ios:sync

# 3. Confirm the rebuilt bundle has the new recommender functions
grep -c 'recommendBookFromSpeech\|recommendFilmFromSensors\|pickMoodFromSensors' \
       ios/App/App/public/assets/*.js
# Expect >= 3

# 4. Open Xcode for the re-install
npm run ios:open
```

In Xcode:

5. Confirm the iPad is the build target. Press **▶ Build & Run** (⌘R).

On the iPad:

6. App relaunches. Switch the top capsule to **Both** or **Listen**.
7. The mood-badge dot **pulses green** whenever the mic is mid-session
   — that's your "the recogniser is actually listening right now" signal.
8. Speak a topic, e.g. *"I love poetry and meaning"* → 📖 appears in
   "Suggested book (from speech)".
9. The 🎬 "Suggested film (from environment)" section updates every 8 s
   based on the current `lux` + `motion` mock readings. With `sensors=mock`,
   lux gently swings around 320 and motion flicks on a low-frequency cycle,
   so you should see the film rotate through Hidden Figures / Theory of
   Everything / Interstellar / etc.

---

## How to debug the speech recogniser

* In Xcode's console (with the iPad attached), search for `[speech]` —
  you should see:
  ```
  [speech] session start, lang= en-US
  [speech] session start, lang= en-US        (every couple of seconds)
  ```
* Each `session start` is a fresh recogniser. Aggressive restarts are
  intentional — iOS Safari doesn't keep one session alive for long.
* If you see only one `session start` and never another, the watchdog
  isn't firing — check that **Microphone** permission is still granted
  in *iPad Settings → Virtual Librarian*.
* `[speech] watchdog: no result in 10 s — respawning` means the wrapper
  noticed the recogniser had wedged and forced a fresh session. Good.
* `[speech] error: not-allowed` is fatal — the user denied mic; reset
  permission in *iPad Settings*.

---

## Test phrases

### Books (speech path)

| Say | Expected book |
|---|---|
| "physics and the universe"           | A Brief History of Time |
| "I want to read about psychology"    | Thinking, Fast and Slow |
| "urban planning and the city"        | The Death and Life of Great American Cities |
| "Turing and computer history"        | Code: The Hidden Language |
| 中文: "推荐一本关于哲学的书"           | The Republic |

### Films (environment path)

| Mock lux | Mock motion | Mood bucket | Sample title |
|---|---|---|---|
| 50  | off | atmospheric  | Wings of Desire / Blade Runner 2049 |
| 50  | on  | contemplative| Arrival / Interstellar |
| 200 | off | contemplative| Spirited Away |
| 200 | on  | classic      | The Theory of Everything |
| 600 | off | classic      | A Beautiful Mind / Dead Poets Society |
| 600 | on  | energetic    | Hidden Figures / Good Will Hunting |

To force a particular mood, open *iPad Settings → Virtual Librarian*…
actually easier: in the mock data, lux already swings between ~250 and
~460 so you'll naturally cycle through `contemplative → classic`. When
the Arduino is plugged back in, you'll get the full range.

---

## If the recogniser still feels insensitive

Tier-2 escalation, in order:

1. **Speak louder + closer to iPad mic.** iPad mics are highly directional;
   ~30 cm at conversational volume is the sweet spot. iPad seems to mute
   the front mic if a Bluetooth headset is paired — check Settings.
2. **Background noise.** Apple's cloud STT rejects low-SNR audio silently
   (no error, no result). Move to a quieter spot for the test.
3. **Stop the AudioContext while testing speech.** Currently `audio.js`
   keeps an `AnalyserNode` open at all times for the dB bar. On some iOS
   versions this competes with Web Speech for the mic. Telltale sign:
   speech works for the first session, then never again. If this happens,
   I'll add an `audio.pause()` call wrapped around active recognition
   sessions. Tell me and I'll patch.
4. **Fall back to a native plugin.** `@capacitor-community/speech-recognition`
   uses native SFSpeechRecognizer instead of Web Speech. Bigger lift
   (CocoaPods install, new plugin) but rock-solid. Reserved for plan-C.

---

## Things NOT to do

- Don't reintroduce `continuous = true` in `speech.js` — iOS Safari
  ignores it after the first utterance and the recogniser dies silently.
- Don't merge the book + film panels back into one. Andy will read the
  split as "what you said" vs. "what the room is like" — that's the
  Sense-Deploy-Communicate story.
- Don't touch `src/pyramid.js`.
