# CLAUDE_CODE_REDEPLOY.md

> After the UI polish + 3D model fix, the existing iPad install needs to
> be re-built and re-installed. Mac is wired to iPad over USB; Arduino is
> not on hand. This is purely a rebuild + reinstall.
>
> Outcome: launching the app on the iPad shows the ryu2.vrm character,
> proper app chrome (title + status pill), no debug panels visible.

---

## What changed since the last install

1. `scripts/sync-public-assets.sh` — copies `3D_/*.vrm` into `public/3D_/`
   so Vite includes them in the bundle. Wired up as a `prebuild` hook in
   `package.json`, so every `npm run build` triggers it automatically.
2. `src/main.js` — when running inside Capacitor with no explicit avatar
   choice, defaults to `/3D_/ryu2.vrm` (instead of the primitive placeholder).
3. `index.html` — debug HUD and dev controls hidden behind `?debug=1`;
   added app-style title bar (top-left "VL · Virtual Librarian") and a
   compact status pill (bottom-left, replaces the debug HUD in normal use).
4. `index.html` — Settings modal restyled: card now has a subtitle, focused
   inputs glow accent green, gear button rotates on hover.

---

## Claude Code: copy-paste these steps in order

```bash
DLL=/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D
cd "$DLL"

# 1. Sanity: confirm the VRM exists where the build expects it.
bash scripts/sync-public-assets.sh
ls -lh public/3D_/

# 2. Rebuild web bundle + sync into iOS Xcode project.
npm run ios:sync

# 3. Verify the .vrm actually made it into the iOS app's web bundle.
ls -lh ios/App/App/public/3D_/

# 4. Open Xcode for the re-install.
npm run ios:open
```

In Xcode:

5. Make sure the **iPad** is still selected in the top-bar device picker.
6. Press **▶ Build & Run** (⌘R). First re-install takes ~30 s.

On the iPad:

7. The app re-launches automatically.
8. You should immediately see:
   - "VL · Virtual Librarian" brand mark, top-left.
   - The mode capsule `👤 Mirror · 🎤 Listen · ✨ Both` (Both highlighted).
   - The ryu2.vrm character centred, following your head.
   - The status pill at bottom-left should read "tracking" with a green dot.
   - No FPS/Mode/Latency debug box (good — that means the new chrome is on).
9. Tap **⚙︎** at top-right → Settings panel now looks polished.
10. (Optional) If you want the debug HUD back for a single launch, you
    can't add `?debug=1` from inside the bundled app — instead append it
    in the Settings panel by editing the "Default avatar URL" field
    temporarily, or rebuild with `localStorage.debugOn = '1'`. The
    cleanest path is to launch Safari with the dev URL during development.

---

## If the avatar still doesn't appear

Likely causes, in order of probability:

| Symptom | Check |
|---|---|
| Status pill says `loading avatar 12% …` and stalls | The .vrm file may be corrupted in the bundle — `shasum` it in `public/3D_/` vs `3D_/` |
| Status pill says `avatar load failed: …` | The path isn't `/3D_/ryu2.vrm`. In Xcode console, check the JS error |
| Status pill says `avatar ready (vrm)` but you only see the primitive head | Head is off-camera — try ⚙︎ and pick a different avatar in the dropdown to verify the VRM scene loaded |
| Black canvas, status pill says `tracking` | WebGL is up but VRM URL never resolved — confirm `ios/App/App/public/3D_/ryu2.vrm` exists and is non-zero |
| `ios/App/App/public/3D_/` is empty after `cap sync` | `prebuild` didn't run — invoke directly: `bash scripts/sync-public-assets.sh && npm run build && npx cap copy ios` |

---

## Things NOT to do this round

- Don't touch `src/pyramid.js` — the user has been iterating on the
  framing themselves.
- Don't try to add new Xcode capabilities or change the bundle ID — the
  current signing setup is working.
- Don't reintroduce the floating HUD/controls panels — they were
  deliberately moved behind `?debug=1`.
- Don't bump the `webDir` in `capacitor.config.json` — it's correctly
  pointing at `dist/`.
