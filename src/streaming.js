// WebSocket "relay" client — sends/receives blendshape frames between
// the Mac (capture) and the iPad (display). Falls back silently if no
// relay server is reachable, so the app still works as a single-device demo.

const FRAME_TYPE = 'frame';

export class RelayClient {
  /**
   * @param {('capture'|'display')} role
   * @param {{ url?: string, onFrame?: (frame: any)=>void, onStatus?: (s:string)=>void }} opts
   */
  constructor(role, opts = {}) {
    this.role = role;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // Default: same host as the page, port 8787 (see server/relay.js).
    this.url = opts.url || `${proto}://${location.hostname}:8787`;
    this.onFrame = opts.onFrame ?? (() => {});
    this.onStatus = opts.onStatus ?? (() => {});
    this.ws = null;
    this.connected = false;
    this.reconnectMs = 1500;
    this._lastSent = 0;
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this.onStatus('relay disabled (' + e.message + ')');
      return;
    }
    this.ws.addEventListener('open', () => {
      this.connected = true;
      this.onStatus('relay connected (' + this.role + ')');
      this.ws.send(JSON.stringify({ type: 'hello', role: this.role }));
    });
    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.onStatus('relay disconnected');
      setTimeout(() => this.connect(), this.reconnectMs);
    });
    this.ws.addEventListener('error', () => { /* swallow */ });
    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === FRAME_TYPE) this.onFrame(msg.payload);
      } catch {}
    });
  }

  // Throttled to ~60 Hz max.
  sendFrame(blendshapes, transform, pose) {
    if (!this.connected) return;
    const now = performance.now();
    if (now - this._lastSent < 12) return;
    this._lastSent = now;
    this.ws.send(JSON.stringify({
      type: FRAME_TYPE,
      payload: {
        t: now,
        b: blendshapes,
        m: transform ? Array.from(transform) : null,
        p: pose || null
      }
    }));
  }
}
