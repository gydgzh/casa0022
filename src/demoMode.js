// Procedural "fake face" driver for supervisor demos and any time the webcam
// isn't available. Emits a plausible stream of ARKit blendshape coefficients
// so the avatar performs: gentle breathing, periodic blinks, occasional
// smiles, talking jaw bursts, and lazy head-look sweeps.
//
// No camera, no MediaPipe, no participant data — pure synth.

const TAU = Math.PI * 2;

function rand(min, max) { return min + Math.random() * (max - min); }

export class DemoDriver {
  constructor() {
    this.t0 = performance.now() / 1000;
    this.nextBlink = 2 + Math.random() * 2;
    this.nextSmile = 5 + Math.random() * 4;
    this.smileUntil = 0;
    this.nextTalk = 4 + Math.random() * 3;
    this.talkUntil = 0;
    this.talkPhase = 0;
    this.yaw = 0;
    this.pitch = 0;
  }

  /** @returns {Record<string, number>} 52-channel-ish ARKit blendshape dict */
  step() {
    const t = performance.now() / 1000 - this.t0;
    const out = {};

    // --- Breathing micro-motion: cheeks + jaw + brows slightly ride sine.
    const breath = 0.04 + 0.02 * Math.sin((t / 4.0) * TAU);
    out.cheekPuff = breath * 0.4;

    // --- Blink schedule: every 2–5s a quick 100ms close.
    if (t > this.nextBlink) {
      const elapsed = t - this.nextBlink;
      const dur = 0.18;
      if (elapsed < dur) {
        const phase = elapsed / dur;
        const v = Math.sin(phase * Math.PI); // 0→1→0 over the blink
        out.eyeBlinkLeft = v;
        out.eyeBlinkRight = v;
      } else {
        this.nextBlink = t + 2 + Math.random() * 3;
      }
    }

    // --- Smile schedule: every 5–10s, hold a soft smile for ~2s.
    if (t > this.nextSmile && t > this.smileUntil) {
      this.smileUntil = t + rand(1.5, 2.5);
      this.nextSmile = this.smileUntil + rand(4, 8);
    }
    if (t < this.smileUntil) {
      const remaining = this.smileUntil - t;
      const total = 2.0;
      const ease = Math.min(1, Math.min(remaining, total - remaining) / 0.3);
      out.mouthSmileLeft = 0.7 * ease;
      out.mouthSmileRight = 0.7 * ease;
      out.cheekSquintLeft = 0.3 * ease;
      out.cheekSquintRight = 0.3 * ease;
      out.eyeSquintLeft = 0.25 * ease;
      out.eyeSquintRight = 0.25 * ease;
    }

    // --- Talking burst: every 4–8s, open/close jaw at ~4 Hz for ~3s.
    if (t > this.nextTalk && t > this.talkUntil) {
      this.talkUntil = t + rand(2.5, 4.0);
      this.nextTalk = this.talkUntil + rand(3, 6);
      this.talkPhase = 0;
    }
    if (t < this.talkUntil) {
      this.talkPhase += 0.16;
      const jaw = Math.max(0, Math.sin(this.talkPhase * TAU * 0.8));
      out.jawOpen = 0.05 + 0.35 * jaw;
      out.mouthFunnel = 0.1 * jaw;
    } else {
      out.jawOpen = 0.02 + 0.02 * Math.sin(t * 0.6);
    }

    // --- Lazy head sweeps (yaw/pitch). Returned as a 4×4 matrix so the same
    // applyHeadTransform path used by MediaPipe works unchanged.
    this.yaw   = 0.25 * Math.sin(t * 0.35);
    this.pitch = 0.12 * Math.sin(t * 0.5 + 1.2);
    const m = this._yawPitchMatrix(this.yaw, this.pitch);

    // --- Eye-look correlated with yaw so the gaze leads the head.
    const look = this.yaw * 1.4;
    if (look > 0) {
      out.eyeLookOutLeft = Math.min(1, look);
      out.eyeLookInRight = Math.min(1, look);
    } else {
      out.eyeLookInLeft  = Math.min(1, -look);
      out.eyeLookOutRight= Math.min(1, -look);
    }

    // Occasional brow flash.
    out.browInnerUp = 0.1 + 0.05 * Math.sin(t * 0.7);

    return { blendshapes: out, transform: m };
  }

  _yawPitchMatrix(yaw, pitch) {
    const cy = Math.cos(yaw),  sy = Math.sin(yaw);
    const cx = Math.cos(pitch), sx = Math.sin(pitch);
    // Column-major 4×4, like MediaPipe's facialTransformationMatrixes.
    return new Float32Array([
      cy,        0,    -sy,       0,
      sy * sx,   cx,    cy * sx,  0,
      sy * cx,  -sx,    cy * cx,  0,
      0,         0,     0,        1
    ]);
  }
}
