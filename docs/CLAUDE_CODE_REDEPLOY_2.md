# CLAUDE_CODE_REDEPLOY_2.md  —  Books + Films + bilingual speech

> Adds film recommendations alongside books, supports Chinese speech
> input (testing only, output stays English), and adds a language picker
> in Settings. Pure rebuild + re-install — no Arduino, no Mac broker.

---

## What changed since the last install

1. `src/bookDb.js` — completely reworked:
   * `MEDIA` array now holds 26 books **and** 15 films.
   * `recommend(text)` returns the best book or film with a `type` field
     so the dashboard can render it correctly.
   * Chinese → English alias map (`物理 → physics`, `电影 → film`, etc.)
     so a Mandarin transcript can still match the English topic vocabulary.
   * `classifySentiment` also reads a small Chinese mood lexicon.
2. `src/main.js` — Speech recogniser language now comes from
   `localStorage.speechLang` (default `en-US`).
3. `index.html` — Settings modal now includes a language dropdown
   *English (US) / English (UK) / 中文 (普通话, testing only)* and a note
   explaining that the recommendations always render in English.
4. `src/dashboard.js` — recommendation section now shows 📖 + "by …" for
   books and 🎬 + "dir. …" for films; the section header changes between
   "Suggested reading" and "Suggested watching".

---

## Claude Code: copy-paste these steps in order

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# 1. Quick sanity tests — Chinese + English → book or film
node -e "
import('./src/bookDb.js').then(m => {
  for (const t of [
    'show me a film about the universe',
    'recommend a book about psychology',
    '我想看一部关于宇宙的电影',
    '推荐一本心理学的书',
    'tell me about library and reading',
  ]) {
    const r = m.recommend(t);
    console.log(' • '+t+'  →  '+(r ? r.type+': '+r.title : 'no match'));
  }
});
"

# 2. Rebuild and copy into the Xcode project (prebuild also re-syncs 3D_/)
npm run ios:sync

# 3. Confirm the new bundle.js contains the films
grep -c 'Wings of Desire\|The Imitation Game\|2001: A Space Odyssey' \
       ios/App/App/public/assets/*.js
# Expect > 0

# 4. Re-open Xcode for the re-install
npm run ios:open
```

In Xcode:

5. Confirm iPad is still selected. Press **▶ Build & Run** (⌘R).
6. ~30 s later the iPad relaunches with the new bundle.

On the iPad:

7. Tap **⚙︎ Settings** → the new **Speech recognition language** dropdown
   appears. Leave it on **English (US)** for normal use; switch to
   **中文 (普通话)** when you want to test Mandarin input.
8. Tap **Save & reload** — the speech recogniser restarts with the chosen
   language.
9. Switch the top capsule to **🎤 Listen** or **✨ Both**.
10. Say one of these test sentences and watch the dashboard:

| Speech | Expected suggestion |
|---|---|
| "I want a film about Turing"     | 🎬 The Imitation Game, dir. Morten Tyldum |
| "Recommend a book about psychology" | 📖 Thinking, Fast and Slow, by Daniel Kahneman |
| "Show me a film about the universe" | 🎬 2001: A Space Odyssey, dir. Stanley Kubrick |
| "Tell me about library and reading" | 📖 The Library at Night, by Alberto Manguel |
| (中文) "我想看一部关于宇宙的电影" | 🎬 2001: A Space Odyssey, dir. Stanley Kubrick |
| (中文) "推荐一本关于哲学的书"    | 📖 The Republic, by Plato |
| (中文) "推荐一部关于数学的电影"  | 🎬 Hidden Figures, dir. Theodore Melfi |

Mood overlay on the avatar still fires from the sentiment side
(happy / sad / thinking / neutral) for either language.

---

## If a Chinese sentence isn't recognised on the iPad

* Apple's on-device speech recognition needs the Chinese language pack
  installed: *iPad Settings → General → Keyboard → Dictation* should
  show "Simplified Chinese (China mainland)" enabled.
* Cellular / Wi-Fi must be on the first time — iOS downloads the model.
* The Web Speech API in WKWebView occasionally fails the very first call
  after a language switch; tap **Mirror → Both** once to re-kick it.

## If a film recommendation never appears

* Open the gear ⚙︎ → make sure the language is set correctly (Chinese
  topic words won't match if the recogniser is listening in English and
  thinks you said gibberish).
* Easiest verification: speak slowly with one keyword, e.g. *"Turing"*,
  *"hawking"*, *"poetry"*, *"silk road"*, *"interstellar"*.

---

## Things NOT to do this round

- Don't roll back the dashboard's recommendation section to the old
  book-only renderer — film vs book distinction is part of the feature.
- Don't add Chinese into `MEDIA` titles — every title/author/director
  stays English as the user requested.
- Don't switch to a Capacitor speech-recognition plugin — Web Speech in
  WKWebView already covers en-US, en-GB, zh-CN with zero extra deps.
- Don't touch `src/pyramid.js`.
