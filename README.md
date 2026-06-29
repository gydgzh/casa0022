# Holographic Virtual Librarian — prototype

Browser-based facial (and optional full-body) motion capture driving a 3D
avatar rendered in a 4-viewport "Pepper's-Ghost" layout, designed to be
shown on an iPad placed face-up underneath an acrylic hologram pyramid.

The whole stack is open-source and permissively licensed (see "Licences"
at the bottom).

## Quick start (Mac)

```bash
cd 1111D
npm install
npm run start          # boots WS relay (8787) + Vite HTTPS dev server (5173)
```

Then on the **Mac**, open:

```
https://localhost:5173/?mode=capture
```

Accept the self-signed-cert warning, allow camera access. You should see
the four-view pyramid layout with the placeholder head mirroring your face.

## iPad display

1. Make sure the iPad is on the **same WiFi** as the Mac.
2. On the Mac: `ifconfig | grep "inet "` and find the LAN address, e.g. `192.168.1.42`.
3. On the iPad Safari, open:

   ```
   https://192.168.1.42:5173/?mode=display
   ```

4. Tap **Continue** on the self-signed cert warning.
5. Tap the **Fullscreen** button (or use AA → Hide Toolbar in Safari).
6. Set the iPad face-up on the table; place the acrylic pyramid on top.

The iPad does **no tracking** — it just receives 52 blendshape floats per
frame from the Mac over WebSocket. CPU/GPU load on iPad 7/8 stays low.

## URL flags

| Flag | Effect |
|---|---|
| `?mode=capture` | Mac/host: enables webcam + MediaPipe (default) |
| `?mode=display` | iPad: hides UI, no camera, receives frames over WS |
| `?lowend=1` | Lower capture resolution (480×360) |
| `?tracker=face\|pose\|holistic` | Pick tracker on load |

## Architecture

```
        Mac (capture mode)                                 iPad (display)
 ┌────────────────────────────────┐                ┌──────────────────────────┐
 │ getUserMedia → <video>         │                │                          │
 │   ↓                            │                │                          │
 │ MediaPipe FaceLandmarker  ─┐   │   WebSocket    │   <canvas>               │
 │ MediaPipe PoseLandmarker  ─┤   │  (port 8787)   │     ↑                    │
 │   ↓                       └───►│───frames──────►│  AvatarScene + Pyramid   │
 │ OneEuro filter                 │                │   renderer (Three.js)    │
 │   ↓                            │                │                          │
 │ AvatarScene + Pyramid render   │                │                          │
 └────────────────────────────────┘                └──────────────────────────┘
```

- `src/faceCapture.js` – MediaPipe FaceLandmarker, returns 52 ARKit
  blendshapes + a facial-transform matrix.
- `src/poseCapture.js` – MediaPipe PoseLandmarker (lite), optional full-body.
- `src/oneEuro.js` – One-Euro filter for jitter reduction.
- `src/avatarScene.js` – Three.js scene. Includes a placeholder primitive
  head and a VRM loader path. Exposes a unified `expressions.set(name, v)` API.
- `src/pyramid.js` – Four perspective cameras (N/E/S/W), renders each into an
  off-screen target, then composites them onto the main canvas with correct
  rotations so the bottom edge of every viewport points toward the centre.
- `src/streaming.js` – WebSocket relay client.
- `src/main.js` – Wires everything together, runs the main loop.
- `server/relay.js` – Tiny Node WebSocket relay between Mac and iPad.

## Importing a real avatar

The pipeline accepts **VRM 1.0** and **GLB** files with ARKit-style morph
targets. To drop in a production avatar:

1. Click the **Avatar** dropdown → **Custom (drop GLB/VRM)**, pick a file.
2. The avatar is loaded with `@pixiv/three-vrm` (MIT) and expression names
   on the VRM expression manager are driven directly from the blendshape
   dictionary returned by MediaPipe.
3. Expected morph target / expression names: the 52 ARKit names listed in
   `ARKIT_BLENDSHAPES` (`src/avatarScene.js`).

For VRM models without ARKit morph targets, common preset names work
(`happy`, `angry`, `sad`, `aa`, `ih`, `ou`, `ee`, `oh`, `blink`, etc.) –
you'll see them animate but with reduced fidelity. We can extend the
mapping table once you provide the real character file.

## Pepper's-Ghost geometry — practical notes

- Pyramid side length should be **roughly equal to the side of one
  sub-view in the cross layout**. For a 10.2" iPad in portrait, that's
  about 7.5–8 cm.
- The canvas background is **pure black (#000000)** so that the acrylic
  reflects nothing outside the avatar silhouette → the avatar looks like
  it's floating.
- Use a **matte-black hood** or fabric around the pyramid in bright rooms.
- Set iPad brightness to **max**; auto-brightness off; Night Shift off.

## Performance targets

| Target | iPad 7 (A10) | iPad 8 (A12) | Mac (Apple Silicon) |
|---|---|---|---|
| Capture+render local | not recommended | ~20 FPS | 60 FPS |
| Display-only (frames over WS) | 30–60 FPS | 60 FPS | n/a |

So the recommended config for your installation is **Mac captures + renders, iPad receives**.

## Licences

| Component | Licence | Notes |
|---|---|---|
| `@mediapipe/tasks-vision` | Apache-2.0 (Google) | Free academic + commercial |
| `three` | MIT | |
| `@pixiv/three-vrm` | MIT | |
| `ws` (Node) | MIT | |
| Pixiv sample VRM in code | CC0 | Prototyping only — replace with your model |
| Ready Player Me avatars (optional) | CC-BY-NC-SA 4.0 | Fine for academic dissertation with attribution |

No facial-identity dataset is collected or trained. Landmarks are
computed live and discarded each frame; no images, video or biometric
identifiers leave the device.

## TODO once the production model is available

- Replace `vrm-sample` URL with your supplied model.
- Build a one-time blendshape calibration UI (per-user neutral pose).
- Tune `cameraDist` / FOV in `pyramid.js` to match the physical pyramid.
- Add WebRTC-DataChannel transport as a lower-latency alternative to
  the JSON-over-WS relay (worth it for ≤30 ms latency).
- Add a "scripted librarian" mode that plays back a pre-recorded blendshape
  timeline for the Librarian condition of the user study.
