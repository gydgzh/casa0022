// Three.js scene with avatar + face/body driving.
// - Placeholder head built from primitives so the app runs with zero assets.
// - VRM loader path for production avatars (three-vrm, MIT).
// - Public-domain sample VRM URL is provided for quick testing.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// MediaPipe FaceLandmarker → ARKit blendshape names (52). Same names as VRM 1.0
// expression mappings, so they generally map 1:1 onto VRM expressions.
export const ARKIT_BLENDSHAPES = [
  'browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight',
  'cheekPuff','cheekSquintLeft','cheekSquintRight',
  'eyeBlinkLeft','eyeBlinkRight','eyeLookDownLeft','eyeLookDownRight','eyeLookInLeft','eyeLookInRight',
  'eyeLookOutLeft','eyeLookOutRight','eyeLookUpLeft','eyeLookUpRight','eyeSquintLeft','eyeSquintRight',
  'eyeWideLeft','eyeWideRight',
  'jawForward','jawLeft','jawOpen','jawRight',
  'mouthClose','mouthDimpleLeft','mouthDimpleRight','mouthFrownLeft','mouthFrownRight',
  'mouthFunnel','mouthLeft','mouthLowerDownLeft','mouthLowerDownRight','mouthPressLeft','mouthPressRight',
  'mouthPucker','mouthRight','mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper',
  'mouthSmileLeft','mouthSmileRight','mouthStretchLeft','mouthStretchRight','mouthUpperUpLeft','mouthUpperUpRight',
  'noseSneerLeft','noseSneerRight','tongueOut'
];

/* ---------- Placeholder head ---------- */
// A stylised, very low-poly head built from primitives so the pipeline can
// be tested before any model is supplied. Exposes a `.expressions` map that
// the blendshape driver can write into.
function buildPlaceholderHead() {
  const group = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: 0xe8c9a8, roughness: 0.6, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xc56b6b, roughness: 0.5 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 48, 48), skin);
  head.scale.set(0.95, 1.05, 0.95);
  group.add(head);

  // Hair cap
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.93, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
  hair.scale.set(0.97, 1.07, 0.97);
  group.add(hair);

  // Eyes
  const eyeGeom = new THREE.SphereGeometry(0.13, 24, 24);
  const eyeL = new THREE.Mesh(eyeGeom, white); eyeL.position.set(-0.28, 0.1, 0.78);
  const eyeR = new THREE.Mesh(eyeGeom, white); eyeR.position.set(0.28, 0.1, 0.78);
  group.add(eyeL, eyeR);

  const pupilGeom = new THREE.SphereGeometry(0.055, 16, 16);
  const pupilL = new THREE.Mesh(pupilGeom, dark); pupilL.position.set(-0.28, 0.1, 0.89);
  const pupilR = new THREE.Mesh(pupilGeom, dark); pupilR.position.set(0.28, 0.1, 0.89);
  group.add(pupilL, pupilR);

  // Eyelids (used for blinking)
  const lidGeom = new THREE.SphereGeometry(0.135, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const lidL = new THREE.Mesh(lidGeom, skin); lidL.position.copy(eyeL.position); lidL.rotation.x = Math.PI;
  const lidR = new THREE.Mesh(lidGeom, skin); lidR.position.copy(eyeR.position); lidR.rotation.x = Math.PI;
  lidL.scale.y = 0.01; lidR.scale.y = 0.01;
  group.add(lidL, lidR);

  // Brows
  const browGeom = new THREE.BoxGeometry(0.28, 0.04, 0.04);
  const browL = new THREE.Mesh(browGeom, dark); browL.position.set(-0.28, 0.34, 0.82);
  const browR = new THREE.Mesh(browGeom, dark); browR.position.set(0.28, 0.34, 0.82);
  group.add(browL, browR);

  // Mouth (jaw pivot + lips)
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.45, 0.78);
  const upperLip = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.04), lipMat);
  upperLip.position.y = 0.02;
  const lowerLip = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.04), lipMat);
  lowerLip.position.y = -0.02;
  jaw.add(upperLip, lowerLip);
  group.add(jaw);

  // Nose
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 16), skin);
  nose.position.set(0, -0.1, 0.92);
  nose.rotation.x = Math.PI;
  group.add(nose);

  // Convenience handles so the driver can manipulate expressions.
  group.userData.handles = {
    eyeL, eyeR, pupilL, pupilR, lidL, lidR, browL, browR, jaw, upperLip, lowerLip, head
  };
  group.userData.kind = 'placeholder';

  // Expression slots – simple proxies that act on the handles above.
  group.userData.expressions = {
    set(name, value) {
      const h = group.userData.handles;
      const v = THREE.MathUtils.clamp(value, 0, 1);
      switch (name) {
        case 'eyeBlinkLeft':       h.lidL.scale.y = THREE.MathUtils.lerp(0.01, 0.95, v); break;
        case 'eyeBlinkRight':      h.lidR.scale.y = THREE.MathUtils.lerp(0.01, 0.95, v); break;
        case 'browInnerUp':        h.browL.position.y = 0.34 + v * 0.06; h.browR.position.y = 0.34 + v * 0.06; break;
        case 'browDownLeft':       h.browL.position.y = 0.34 - v * 0.06; break;
        case 'browDownRight':      h.browR.position.y = 0.34 - v * 0.06; break;
        case 'browOuterUpLeft':    h.browL.rotation.z = -v * 0.4; break;
        case 'browOuterUpRight':   h.browR.rotation.z = v * 0.4; break;
        case 'jawOpen':            h.jaw.rotation.x = -v * 0.55; break;
        case 'mouthSmileLeft':     h.lowerLip.position.x = -v * 0.06; h.upperLip.position.x = -v * 0.04; break;
        case 'mouthSmileRight':    h.lowerLip.position.x =  v * 0.06; h.upperLip.position.x =  v * 0.04; break;
        case 'mouthPucker':        h.upperLip.scale.x = h.lowerLip.scale.x = THREE.MathUtils.lerp(1, 0.5, v); break;
        case 'mouthFunnel':        h.upperLip.scale.x = h.lowerLip.scale.x = THREE.MathUtils.lerp(1, 0.4, v); break;
        case 'cheekPuff':          h.head.scale.x = 0.95 + v * 0.08; break;
        case 'eyeLookUpLeft':      h.pupilL.position.y = 0.1 + v * 0.06; break;
        case 'eyeLookUpRight':     h.pupilR.position.y = 0.1 + v * 0.06; break;
        case 'eyeLookDownLeft':    h.pupilL.position.y = 0.1 - v * 0.06; break;
        case 'eyeLookDownRight':   h.pupilR.position.y = 0.1 - v * 0.06; break;
        case 'eyeLookInLeft':      h.pupilL.position.x = -0.28 + v * 0.06; break;
        case 'eyeLookInRight':     h.pupilR.position.x =  0.28 - v * 0.06; break;
        case 'eyeLookOutLeft':     h.pupilL.position.x = -0.28 - v * 0.06; break;
        case 'eyeLookOutRight':    h.pupilR.position.x =  0.28 + v * 0.06; break;
      }
    }
  };
  return group;
}

/* ---------- glTF / GLB / VRM loader ---------- */
// Returns { group, kind, headLocalY }. Caller positions the group so that
// `headLocalY` ends up at world Y=0 (so the head sits on the camera rig's
// rotation pivot — otherwise head rotation swings the whole body).
async function loadAvatar(url, onProgress) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url, (ev) => {
    if (onProgress && ev.total) onProgress(ev.loaded, ev.total);
  });

  const vrm = gltf.userData.vrm;
  const group = new THREE.Group();

  if (vrm) {
    /* ---- VRM path: has standard humanoid bones + expressions ---- */
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // face +Z

    // Index every morph target by name across all meshes so we can drive
    // ARKit-named morph targets (e.g. "eyeBlinkLeft") even when the model
    // doesn't expose them as VRM expressions. This is the common case for
    // VRM 0.x models that were authored with ARKit blendshape names at the
    // primitive level but only registered VRM-classic presets (a/i/u/e/o,
    // blink, joy, …) in blendShapeMaster.
    //
    // morphIndex maps lowercased name → array of { mesh, index }.
    const morphIndex = new Map();
    gltf.scene.traverse((obj) => {
      if (!obj.morphTargetDictionary || !obj.morphTargetInfluences) return;
      for (const name of Object.keys(obj.morphTargetDictionary)) {
        const key = name.toLowerCase();
        if (!morphIndex.has(key)) morphIndex.set(key, []);
        morphIndex.get(key).push({ mesh: obj, index: obj.morphTargetDictionary[name] });
      }
    });

    // ARKit-name → VRM-classic preset (only used when the model has no
    // direct morph target by the ARKit name). Pairwise-asymmetric channels
    // (eyeBlinkLeft vs Right) intentionally map to *_l / *_r so we don't
    // accidentally close both eyes via the shared "blink" preset.
    const ALIASES_TO_VRM = {
      eyeblinkleft:  'blink_l',
      eyeblinkright: 'blink_r',
      jawopen:       'a',
      mouthfunnel:   'o',
      mouthpucker:   'u',
      mouthsmileleft:  'joy',
      mouthsmileright: 'joy',
    };
    const vrmHas = (n) => {
      try { return !!vrm.expressionManager?.getExpression?.(n); }
      catch { return false; }
    };

    group.add(vrm.scene);
    group.userData.vrm = vrm;
    group.userData.kind = 'vrm';
    group.userData.morphIndex = morphIndex;

    // Direct morph values to overlay AFTER vrm.expressionManager.update(),
    // because that update zeroes any morph influence not driven by a VRM
    // expression. We collect per-frame and flush in apply().
    const pendingDirect = new Map();

    group.userData.expressions = {
      set(name, value) {
        const v = THREE.MathUtils.clamp(value, 0, 1);
        const key = name.toLowerCase();
        // Priority 1: direct morph target match (overlaid post-update).
        if (morphIndex.has(key)) { pendingDirect.set(key, v); return; }
        // Priority 2: VRM expression by literal name (VRM 1.0 style).
        if (vrmHas(name)) { vrm.expressionManager.setValue(name, v); return; }
        // Priority 3: VRM-classic alias (VRM 0.x "blink"/"joy"/"a"…).
        const alias = ALIASES_TO_VRM[key];
        if (alias && vrmHas(alias)) vrm.expressionManager.setValue(alias, v);
      },
      apply() {
        // Update VRM expressions first (writes morph influences for any
        // VRM-managed expression). Then overlay our direct values so they
        // survive the update.
        vrm.expressionManager?.update();
        for (const [key, v] of pendingDirect) {
          const hits = morphIndex.get(key);
          if (hits) for (const h of hits) h.mesh.morphTargetInfluences[h.index] = v;
        }
        pendingDirect.clear();
      }
    };

    // Find the head bone's world Y so the loader can centre the model on
    // the camera rig's pivot (so head rotation rotates around the HEAD,
    // not the FEET). Falls back to 1.35 m if the rig is missing/odd.
    let headLocalY = 1.35;
    try {
      const headBone =
        vrm.humanoid?.getNormalizedBoneNode?.('head') ||
        vrm.humanoid?.getBoneNode?.('head');
      if (headBone) {
        vrm.scene.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        headBone.getWorldPosition(v);
        headLocalY = v.y;
      }
    } catch (_) { /* keep default */ }

    return { group, kind: 'vrm', headLocalY };
  }

  /* ---- Plain GLB path (no VRM, no morph targets, no rig) ---- */
  // Bake position and scale: bbox-fit so the model is ~1.8 m tall, then
  // recentre so the estimated head position is at local (0, 0, 0).
  const inner = gltf.scene;
  // Make sure world matrices are up to date for bbox computation.
  inner.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(inner);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);

  // Auto-scale: target overall height ≈ 1.8 m if the model is tall (humanoid),
  // otherwise use the largest dimension. Avoid divide-by-zero on degenerate
  // models (single-point meshes).
  const targetH = 1.8;
  const dom = Math.max(size.x, size.y, size.z, 1e-6);
  const scale = targetH / dom;
  inner.scale.setScalar(scale);

  // Re-evaluate bbox after scaling and find a sensible head Y.
  inner.updateMatrixWorld(true);
  const bbox2 = new THREE.Box3().setFromObject(inner);
  const size2 = new THREE.Vector3(); bbox2.getSize(size2);
  const center2 = new THREE.Vector3(); bbox2.getCenter(center2);

  // Heuristic: humanoid head sits ~12 % below the top of the bbox.
  // For non-humanoid (object/architecture), this still yields a pleasant
  // framing — just slightly above centre.
  const headY = bbox2.max.y - 0.12 * size2.y;

  // Recentre X/Z on origin, and shift Y so headY → 0.
  inner.position.x -= center2.x;
  inner.position.z -= center2.z;
  inner.position.y -= headY;

  group.add(inner);
  group.userData.kind = 'glb';
  // No expression channels — provide a silent no-op so the blendshape
  // stream from MediaPipe / DemoDriver doesn't error.
  group.userData.expressions = {
    set(_name, _value) { /* static model, no morph targets */ },
    apply() {}
  };
  return { group, kind: 'glb', headLocalY: 0 };
}

/* ---------- Avatar scene wrapper ---------- */
export class AvatarScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = null; // transparent — black canvas behind for Pepper's Ghost
    this.avatar = null;
    this.headPivot = new THREE.Group();
    this.scene.add(this.headPivot);

    // Lights: dramatic key + rim for high contrast on black.
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.5, 1.0, 1.5); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xa6d5ff, 0.4); fill.position.set(-1.0, 0.4, 0.6); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xc6ffe0, 1.0); rim.position.set(0.0, 0.5, -1.5); this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // Camera target – the avatar's "head" position. Updated per avatar.
    this.headTarget = new THREE.Vector3(0, 0, 0);
    this.bodyMode = false;
  }

  async setAvatar(kind, fileOrUrl, onProgress) {
    if (this.avatar) {
      this.headPivot.remove(this.avatar);
      this.avatar = null;
    }
    if (kind === 'placeholder') {
      this.avatar = buildPlaceholderHead();
      this.headTarget.set(0, 0, 0);
      this.headPivot.add(this.avatar);
      return this.avatar;
    }

    let url;
    if (kind === 'vrm-sample') {
      url = 'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@release/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';
    } else if (kind === 'custom-url') {
      url = fileOrUrl;
    } else if (kind === 'custom-file') {
      url = URL.createObjectURL(fileOrUrl);
    } else {
      throw new Error('Unknown avatar kind: ' + kind);
    }

    const { group, kind: detected, headLocalY } = await loadAvatar(url, onProgress);
    this.avatar = group;
    // For VRM the inner scene still has its rig in place (head ~1.4 m up);
    // shift the whole group down by headLocalY so the head sits at world
    // (0, 0, 0). For plain GLB this is already done inside loadAvatar.
    if (detected === 'vrm' && headLocalY) {
      group.position.y = -headLocalY;
    }
    // Apply a natural rest pose so the avatar doesn't stay in T-pose.
    if (detected === 'vrm' && group.userData.vrm) {
      this._setVRMRestPose(group.userData.vrm);
    }
    this.headTarget.set(0, 0, 0);
    this.headPivot.add(this.avatar);
    this.avatar.userData.detectedKind = detected; // 'vrm' or 'glb'
    this.avatar.userData.headLocalY = headLocalY;
    return this.avatar;
  }

  applyBlendshapes(dict) {
    if (!dict || !this.avatar?.userData?.expressions?.set) return;
    const exp = this.avatar.userData.expressions;

    // ── Step 1: build the per-channel "final" values with muscle coupling ────
    //
    // Design goals:
    //   • Single data-path: each channel is set exactly once, avoiding the
    //     double-drive bug where VRM expressionManager AND direct morphs both
    //     write the same morph target (causing over-activation artefacts).
    //   • Soft co-activation: mirror how real facial muscles work — smiling
    //     lifts cheeks, blinking slightly squints the outer eye, brow raises
    //     widen the eyes a little, etc.
    //   • Per-group gain: cameras under-detect brow and nose movement; those
    //     channels get extra boost so the avatar reads naturally on screen.
    //
    // FACE_GAIN / FACE_POW: power curve lifts small signals (POW < 1), linear
    // gain amplifies overall.  At 1.5 / 0.78 the feel is "enhanced but not
    // cartoon" — tweak here to taste.
    const FACE_GAIN = 1.5;
    const FACE_POW  = 0.78;
    const amp = (v) => Math.min(1.0, Math.pow(Math.max(0, v), FACE_POW) * FACE_GAIN);
    const g   = (k) => Math.max(0, dict[k] ?? 0);

    // Start from raw MediaPipe values.
    const final = {};
    for (const k in dict) final[k] = g(k);

    // ── Brows: camera sees them poorly — extra ×1.5 so avatar reads clearly ─
    final.browInnerUp      = g('browInnerUp')      * 1.5;
    final.browDownLeft     = g('browDownLeft')     * 1.5;
    final.browDownRight    = g('browDownRight')    * 1.5;
    final.browOuterUpLeft  = g('browOuterUpLeft')  * 1.5;
    final.browOuterUpRight = g('browOuterUpRight') * 1.5;

    // ── Jaw: ×1.2 so speech is legible on avatar ─────────────────────────────
    final.jawOpen = g('jawOpen') * 1.2;

    // ── Nose sneer: subtle channel, ×1.4 for visibility ─────────────────────
    final.noseSneerLeft  = g('noseSneerLeft')  * 1.4;
    final.noseSneerRight = g('noseSneerRight') * 1.4;

    // ── Soft muscle coupling (co-activation) ─────────────────────────────────
    // Rule: take the MAX of the detected value vs the coupled contribution, so
    // coupling never REDUCES an expression that was directly detected.

    // Smile → cheeks rise (zygomaticus major pulls cheek up when smiling).
    final.cheekSquintLeft  = Math.max(g('cheekSquintLeft'),  g('mouthSmileLeft')  * 0.45);
    final.cheekSquintRight = Math.max(g('cheekSquintRight'), g('mouthSmileRight') * 0.45);

    // Hard blink → outer-eye squint (orbicularis oculi, peripheral fibres).
    final.eyeSquintLeft  = Math.max(g('eyeSquintLeft'),  g('eyeBlinkLeft')  * 0.30);
    final.eyeSquintRight = Math.max(g('eyeSquintRight'), g('eyeBlinkRight') * 0.30);

    // Brow raise → eyes open slightly wider (frontalis lifts the upper lid).
    final.eyeWideLeft  = Math.max(g('eyeWideLeft'),  g('browInnerUp') * 0.25);
    final.eyeWideRight = Math.max(g('eyeWideRight'), g('browInnerUp') * 0.25);

    // Frown corners → pull lower lip down slightly (depressor anguli oris).
    final.mouthLowerDownLeft  = Math.max(g('mouthLowerDownLeft'),  g('mouthFrownLeft')  * 0.35);
    final.mouthLowerDownRight = Math.max(g('mouthLowerDownRight'), g('mouthFrownRight') * 0.35);

    // ── Step 2: apply amplification and send to expression driver ────────────
    for (const k in final) exp.set(k, amp(final[k]));

    exp.apply?.();
  }

  applyHeadTransform(mat4Float32) {
    if (!this.avatar || !mat4Float32) return;

    // ── Parse the MediaPipe facial-transform matrix ────────────────────────
    // MediaPipe stores this as a row-major Float32Array (each row = one row of
    // the 4×4 matrix). THREE.Matrix4.fromArray() expects COLUMN-major order, so
    // we load then transpose to get the correct rotation matrix.
    const m = new THREE.Matrix4().fromArray(mat4Float32).transpose();

    // ── Coordinate-space correction ───────────────────────────────────────
    // MediaPipe face-transform is in camera space:
    //   +X right (camera's right), +Y DOWN (image y-down), +Z INTO the screen.
    // Three.js / VRM world space:
    //   +X right (avatar's right),  +Y UP,                 +Z OUT of the screen.
    //
    // Practical effect on the rotation angles (YXZ decomposition):
    //   Pitch  (X): nod up/down.     Camera +X ≡ Three.js +X, BUT Y is flipped,
    //               so the sign of pitch must be negated.
    //   Yaw    (Y): turn left/right. Camera +Y ≡ Three.js −Y  → negate.
    //   Roll   (Z): tilt left/right. Camera +Z ≡ Three.js −Z  → negate.
    const euler = new THREE.Euler().setFromRotationMatrix(m, 'YXZ');
    // Pitch (X) keeps its sign — nod up in real life = head up on avatar.
    // Yaw (Y) and Roll (Z) are negated to correct the front-facing camera mirror.
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(euler.x, -euler.y, -euler.z, 'YXZ')
    );

    // SLERP 0.25: smooth but responsive. Raise toward 0.4 if tracking feels
    // sluggish; lower toward 0.15 if the head jitters.
    const SLERP = 0.25;

    const vrm = this.avatar?.userData?.vrm;
    if (vrm?.humanoid) {
      // Drive head + neck bones directly — never the scene-level pivot — so the
      // body stays perfectly still while the head turns.
      const headBone = vrm.humanoid.getNormalizedBoneNode?.('head') ?? null;
      const neckBone = vrm.humanoid.getNormalizedBoneNode?.('neck') ?? null;
      if (headBone) headBone.quaternion.slerp(q, SLERP);
      if (neckBone) {
        // Neck takes 35 % of the same rotation → gentle secondary motion.
        const neckQ = new THREE.Quaternion().slerp(q, 0.35);
        neckBone.quaternion.slerp(neckQ, SLERP);
      }
      // NOTE: vrm.humanoid.update() is called once per frame inside
      // AvatarScene.update(delta) — do NOT call it here to avoid double updates.
      this.headPivot.quaternion.set(0, 0, 0, 1); // body stays still
    } else {
      this.headPivot.quaternion.slerp(q, SLERP);
    }
  }

  /**
   * Call this ONCE per frame (after all applyBlendshapes / applyHeadTransform /
   * applyPose calls, before rendering). Propagates normalized-bone rotations to
   * the actual mesh skeleton and ticks spring-bone physics.
   *
   * This is the missing step that was preventing head rotation from visually
   * appearing: three-vrm v3 uses virtual "normalized" bone nodes — writing to
   * them has NO visual effect until vrm.humanoid.update() is called.
   */
  update(deltaSeconds) {
    const vrm = this.avatar?.userData?.vrm;
    if (!vrm) return;
    // Propagate normalized-bone rotations (head, neck, arms…) → raw mesh bones.
    vrm.humanoid?.update?.();
    // Tick spring-bone physics (hair, clothing). Pass clamped delta so a tab
    // that was hidden for a while doesn't cause an explosion on resume.
    const safeDelta = Math.min(deltaSeconds, 0.1);
    vrm.springBoneManager?.update?.(safeDelta);
  }

  // Set a natural resting pose after VRM is loaded so the character doesn't
  // stand in T-pose. Arms angle ~50° below horizontal — relaxed, not stiff.
  //
  // VRM normalised bone conventions (T-pose rest = rotation 0,0,0):
  //   leftUpperArm  → bone points −X  (char's left arm goes left)
  //   rightUpperArm → bone points +X  (char's right arm goes right)
  // Right-hand rule around Z: +X rotates toward +Y (up), −X toward −Y (down).
  // → leftUpperArm.z  positive → arm DOWN  ✓
  // → rightUpperArm.z negative → arm DOWN  ✓
  _setVRMRestPose(vrm) {
    if (!vrm?.humanoid) return;
    const H = vrm.humanoid;
    const getB = (n) => { try { return H.getNormalizedBoneNode?.(n) ?? null; } catch { return null; } };
    // Upper arms: ~50° below horizontal (0.87 rad).  Feels natural on screen.
    const lUA = getB('leftUpperArm');  if (lUA) lUA.rotation.z =  0.87;
    const rUA = getB('rightUpperArm'); if (rUA) rUA.rotation.z = -0.87;
    // Lower arms: very slight natural bend so elbows don't lock straight.
    const lLA = getB('leftLowerArm');  if (lLA) lLA.rotation.z =  0.12;
    const rLA = getB('rightLowerArm'); if (rLA) rLA.rotation.z = -0.12;
    // Shoulders: tiny downward shrug to avoid that "hanger" look.
    const lSh = getB('leftShoulder');  if (lSh) lSh.rotation.z =  0.06;
    const rSh = getB('rightShoulder'); if (rSh) rSh.rotation.z = -0.06;
  }

  applyPose(poseData) {
    // Accept { landmarks, world } (capture mode) or plain landmark array (relay).
    const lm  = Array.isArray(poseData) ? poseData : poseData?.landmarks;
    const wld = Array.isArray(poseData) ? null      : poseData?.world;
    if (!lm || lm.length < 25) return;

    const ls = lm[11], rs = lm[12]; // left/right shoulder  (image space, y-down)
    const le = lm[13], re = lm[14]; // left/right elbow
    const lw = lm[15], rw = lm[16]; // left/right wrist
    if (!ls || !rs) return;

    // Shoulder roll from image-space 2-D positions.
    // shoulderRoll > 0 when right side of image is lower than left.
    const shoulderRoll = Math.atan2(rs.y - ls.y, rs.x - ls.x);

    const LERP = 0.12; // per-frame smoothing (lower = smoother / more lag)

    const vrm = this.avatar?.userData?.vrm;
    if (vrm?.humanoid) {
      const H = vrm.humanoid;
      const getB = (n) => {
        try { return H.getNormalizedBoneNode?.(n) ?? null; } catch { return null; }
      };
      const lrp = (bone, axis, target) => {
        if (!bone) return;
        bone.rotation[axis] = THREE.MathUtils.lerp(bone.rotation[axis], target, LERP);
      };

      // ── Spine + chest: split shoulder roll across two bones ──────────────
      lrp(getB('spine'), 'z', -shoulderRoll * 0.25);
      lrp(getB('chest'), 'z', -shoulderRoll * 0.25);

      // ── Upper arms: elevation angle from world landmarks (metric, y-up) ──
      // World landmarks come from PoseLandmarker in metric space (hip origin).
      // elevAngle = atan2(elbow_y - shoulder_y, horizontal_dist) — positive
      // means elbow is ABOVE the shoulder, i.e. arm is raised.
      //
      // VRM normalized bone directions (T-pose, character facing +Z):
      //   leftUpperArm  → points −X  (character's left arm extends left)
      //   rightUpperArm → points +X  (character's right arm extends right)
      //
      // Right-hand rule around +Z: a point at +X rotates toward +Y (upward).
      // A point at −X rotates toward −Y (downward), so leftUpperArm needs
      // rotation.z = −elevAngle to go UP, rightUpperArm = +elevAngle.
      if (wld && wld.length >= 17) {
        const wls = wld[11], wrs = wld[12];
        const wle = wld[13], wre = wld[14];
        const wlw = wld[15], wrw = wld[16];

        // Left upper arm
        if (wls && wle) {
          const hdL = Math.sqrt((wle.x-wls.x)**2 + (wle.z-wls.z)**2);
          const elevL = Math.atan2(wle.y - wls.y, hdL + 0.001);
          lrp(getB('leftUpperArm'), 'z', -elevL);
        }
        // Right upper arm
        if (wrs && wre) {
          const hdR = Math.sqrt((wre.x-wrs.x)**2 + (wre.z-wrs.z)**2);
          const elevR = Math.atan2(wre.y - wrs.y, hdR + 0.001);
          lrp(getB('rightUpperArm'), 'z', elevR);
        }

        // ── Forearm bend: angle between upper-arm and forearm vectors ──────
        // bend = 0 → arm straight; bend = π → fully curled.
        // leftLowerArm (points −X in elbow's local frame):  rotation.z = +bend
        // rightLowerArm (points +X):                        rotation.z = −bend
        if (wls && wle && wlw) {
          const uL = { x: wle.x-wls.x, y: wle.y-wls.y, z: wle.z-wls.z };
          const fL = { x: wlw.x-wle.x, y: wlw.y-wle.y, z: wlw.z-wle.z };
          const cosL = (uL.x*fL.x + uL.y*fL.y + uL.z*fL.z) /
            (Math.sqrt(uL.x**2+uL.y**2+uL.z**2) * Math.sqrt(fL.x**2+fL.y**2+fL.z**2) + 1e-6);
          const bendL = Math.acos(THREE.MathUtils.clamp(cosL, -1, 1)); // 0=straight, π=curled
          lrp(getB('leftLowerArm'), 'z', THREE.MathUtils.clamp(bendL, 0, Math.PI * 0.85));
        }
        if (wrs && wre && wrw) {
          const uR = { x: wre.x-wrs.x, y: wre.y-wrs.y, z: wre.z-wrs.z };
          const fR = { x: wrw.x-wre.x, y: wrw.y-wre.y, z: wrw.z-wre.z };
          const cosR = (uR.x*fR.x + uR.y*fR.y + uR.z*fR.z) /
            (Math.sqrt(uR.x**2+uR.y**2+uR.z**2) * Math.sqrt(fR.x**2+fR.y**2+fR.z**2) + 1e-6);
          const bendR = Math.acos(THREE.MathUtils.clamp(cosR, -1, 1));
          lrp(getB('rightLowerArm'), 'z', -THREE.MathUtils.clamp(bendR, 0, Math.PI * 0.85));
        }
      } else {
        // Fallback when world landmarks are unavailable: image-space elevation.
        // In image y-down: elbow above shoulder → ls.y − le.y > 0 → arm raised.
        // Allow full symmetric range so hanging arms (elbow well below shoulder)
        // map to a proper downward rotation instead of clamping near T-pose.
        if (le && ls) {
          const elevL = THREE.MathUtils.clamp((ls.y - le.y) * 4.5, -Math.PI * 0.85, Math.PI * 0.85);
          lrp(getB('leftUpperArm'), 'z', -elevL);
        }
        if (re && rs) {
          const elevR = THREE.MathUtils.clamp((rs.y - re.y) * 4.5, -Math.PI * 0.85, Math.PI * 0.85);
          lrp(getB('rightUpperArm'), 'z', elevR);
        }
      }
    } else {
      // Placeholder / plain-GLB fallback: tilt head pivot with shoulder roll.
      this.headPivot.rotation.z = THREE.MathUtils.lerp(
        this.headPivot.rotation.z, -shoulderRoll * 0.4, LERP);
    }
  }
}
