// 4-viewport Pepper's-Ghost renderer.
//
// Layout (on a face-up iPad, viewed from above):
//
//             +---+
//             | N |          N = +Z camera. Avatar's head appears at the BOTTOM
//             +---+              of this viewport (the edge nearest canvas centre),
//    +---+    +---+    +---+    so after the 45° reflection off the N pyramid
//    | W | -- | C | -- | E |    panel it floats upright to a viewer on the north
//    +---+    +---+    +---+    side. Same logic for S/E/W (head always at the
//             +---+              viewport edge that touches canvas centre).
//             | S |
//             +---+
//
// Why head-at-INNER-edge (not outer):
//   Reflecting a pixel (x,y,0) on the iPad through a 45° panel whose bottom
//   edge sits at the iPad's outer edge maps it to (R, y, R-x). Pixels close
//   to the iPad centre (small x) map to high apparent points — which is where
//   the head should be. Pixels close to the outer edge map to z≈0, the feet.
//
// Background is pure BLACK so the acrylic reflects almost nothing of the
// dark areas — the avatar appears to float in space.
//
// Implementation notes:
//   * Render each sub-view DIRECTLY to its rectangle on the canvas using
//     setViewport + setScissor, instead of render-to-target + composite.
//     This avoids autoClear-between-passes bugs and aspect-ratio distortion.
//   * The 90°/180° viewport rotations are achieved purely by setting the
//     camera's `up` vector — no texture rotations needed.

import * as THREE from 'three';

export class PyramidRenderer {
  constructor(canvas, avatarScene) {
    this.canvas = canvas;
    this.avatarScene = avatarScene;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0x000000, 1.0);
    // 1x (not 2x) on the Retina iPad: the hologram is reflected through a small
    // pyramid, so full-res is wasted — and at 2x the WebGL framebuffers are 4x
    // the memory, which pushes the 2 GB iPad 6 into OOM-reload during the long run.
    this.renderer.setPixelRatio(1);
    // We manage clears explicitly per sub-viewport — disable auto-clear so
    // each render() call doesn't wipe the previously-drawn quads.
    this.renderer.autoClear = false;

    // Cameras: perspective at four cardinal directions around the avatar.
    // FOV/dist chosen so a ~1.8 m diameter head fills ~80% of the viewport.
    const fov = 30, aspect = 1, near = 0.05, far = 50;
    const dist = 4.0;

    const make = (pos, up) => {
      const c = new THREE.PerspectiveCamera(fov, aspect, near, far);
      c.position.set(pos[0], pos[1], pos[2]);
      c.up.set(up[0], up[1], up[2]);
      c.lookAt(avatarScene.headTarget);
      return c;
    };

    // up vectors are chosen so the avatar's head (world +Y) projects to the
    // viewport edge that faces canvas centre. See header comment for the
    // reflection derivation.
    this.cams = {
      N: make([0, 0, +dist], [0, -1,  0]),  // top viewport,    head → bottom of view
      S: make([0, 0, -dist], [0, +1,  0]),  // bottom viewport, head → top of view
      E: make([+dist, 0, 0], [0,  0, -1]),  // right viewport,  head → left of view
      W: make([-dist, 0, 0], [0,  0, -1]),  // left viewport,   head → right of view
    };

    // Dedicated camera for the single-center layout.
    // Face-focused portrait (mirrors old project: FOV 26, dist ~1.1 m).
    // At dist 1.1 m, half-height ≈ 0.26 m → face fills most of the frame.
    this.centerCam = new THREE.PerspectiveCamera(26, 1, 0.05, 50);

    this.layout = 'single'; // default: single centred model
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  setLayout(layout) { this.layout = layout; }

  _onResize() {
    const w = this.canvas.clientWidth | 0;
    const h = this.canvas.clientHeight | 0;
    if (w > 0 && h > 0) this.renderer.setSize(w, h, false);
  }

  render() {
    // Keep cameras tracking the avatar's head target in case the avatar
    // changed (placeholder vs. VRM with different head heights).
    const target = this.avatarScene.headTarget;
    for (const c of Object.values(this.cams)) c.lookAt(target);

    const w = this.canvas.clientWidth | 0;
    const h = this.canvas.clientHeight | 0;

    // Full-canvas clear to black.
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setClearColor(0x000000, 1.0);
    this.renderer.clear(true, true, true);

    if (this.layout === 'single') {
      // Single centred view: head + upper body, proper front-facing framing.
      // Camera sits at +Z (sees the avatar's face), aimed slightly below
      // the head pivot so chest fills the lower half of the viewport.
      this.centerCam.aspect = w / h;
      // dist 1.1 m: face fills the frame. Slight Y up matches eye-level framing.
      this.centerCam.position.set(0, 0.06, 1.1);
      this.centerCam.up.set(0, 1, 0);
      // Aim slightly above head pivot (headTarget is at the head bone, face is
      // a bit higher). +0.08 m lifts the gaze to eye/nose level.
      const aimPt = new THREE.Vector3(target.x, target.y + 0.08, target.z);
      this.centerCam.lookAt(aimPt);
      this.centerCam.updateProjectionMatrix();
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.render(this.avatarScene.scene, this.centerCam);
      return;
    }

    // Pyramid layout — square sub-views in a "+" cross centred on the canvas.
    const side = Math.floor(Math.min(w, h) / 3);
    const cx = w / 2;
    const cy = h / 2;

    // WebGL viewport coordinates have origin at BOTTOM-left.
    const vps = [
      { cam: this.cams.N, x: cx - side / 2, y: h - side,     s: side }, // top
      { cam: this.cams.S, x: cx - side / 2, y: 0,            s: side }, // bottom
      { cam: this.cams.E, x: w - side,      y: cy - side / 2, s: side }, // right
      { cam: this.cams.W, x: 0,             y: cy - side / 2, s: side }, // left
    ];

    this.renderer.setScissorTest(true);
    for (const v of vps) {
      const x = Math.floor(v.x);
      const y = Math.floor(v.y);
      const s = Math.floor(v.s);
      this.renderer.setViewport(x, y, s, s);
      this.renderer.setScissor(x, y, s, s);
      this.renderer.render(this.avatarScene.scene, v.cam);
    }
    this.renderer.setScissorTest(false);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
