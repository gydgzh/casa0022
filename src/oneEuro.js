// One-Euro low-pass filter for noisy real-time signals.
// Reference: Casiez et al., "1€ Filter", CHI 2012.

class LowPass {
  constructor(alpha, initVal = 0) { this.a = alpha; this.y = initVal; this.s = initVal; this.hasLast = false; }
  filter(v, alpha = this.a) {
    if (!this.hasLast) { this.y = v; this.s = v; this.hasLast = true; return v; }
    this.s = alpha * v + (1 - alpha) * this.s;
    return this.s;
  }
}

export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass(0);
    this.dx = new LowPass(0);
    this.lastT = null;
  }
  _alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }
  filter(v, tSec) {
    if (this.lastT == null) { this.lastT = tSec; return this.x.filter(v, 1.0); }
    const dt = Math.max(1e-6, tSec - this.lastT);
    this.lastT = tSec;
    const dv = this.x.hasLast ? (v - this.x.s) / dt : 0;
    const edv = this.dx.filter(dv, this._alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edv);
    return this.x.filter(v, this._alpha(cutoff, dt));
  }
}

// Apply a single OneEuro to a dictionary of named scalars, lazily creating filters.
export class OneEuroDict {
  constructor(opts) { this.opts = opts; this.filters = new Map(); }
  apply(dict, tSec) {
    if (!dict) return null;
    const out = {};
    for (const k in dict) {
      let f = this.filters.get(k);
      if (!f) { f = new OneEuro(this.opts); this.filters.set(k, f); }
      out[k] = f.filter(dict[k], tSec);
    }
    return out;
  }
}
