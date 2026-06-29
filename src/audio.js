// iPad-side microphone capture.
//
// Two responsibilities:
//   1. Compute a continuous "dB-ish" sound level for the dashboard so the
//      reading area's ambient noise is visible alongside the Arduino's
//      environmental data.
//   2. Expose the underlying MediaStream so SpeechRecognition can attach
//      to the same input (iOS shares the system mic across both).
//
// Notes:
//   * Web Audio API works in iPad Safari over HTTPS once the user has
//     granted mic permission. The first call to start() must happen in
//     a user-gesture handler (we trigger it from the camera-allow flow).
//   * The "dB" value is RMS-derived and only relative — calibrate the
//     offset constant against a phone SPL meter for absolute readings.

export class AudioCapture {
  constructor() {
    this.stream    = null;
    this.ctx       = null;
    this.analyser  = null;
    this.buf       = null;
    this.db        = 0;     // smoothed dB-ish level
    this._dbSmooth = 0;
  }

  async start() {
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        video: false,
      });
    } catch (e) {
      console.warn('[audio] mic denied:', e.message);
      return false;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.3;
    src.connect(this.analyser);
    this.buf = new Uint8Array(this.analyser.fftSize);
    console.log('[audio] mic OK, sampleRate=', this.ctx.sampleRate);
    return true;
  }

  /** Pull one RMS sample (call once per frame). Updates this.db. */
  sample() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    let rms = Math.sqrt(sum / this.buf.length);
    if (rms < 1e-5) rms = 1e-5;
    // Empirical mapping: ambient quiet room → ~30 dB, normal conversation → ~55 dB.
    const dbInstant = 20 * Math.log10(rms) + 90;
    this._dbSmooth = this._dbSmooth * 0.85 + dbInstant * 0.15;
    this.db = this._dbSmooth;
    return this.db;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.stream = null;
    this.ctx    = null;
    this.analyser = null;
  }

  /** iOS suspends the AudioContext when the app goes to background. Call
   *  this when the page becomes visible again to bring it back online. */
  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); console.log('[audio] resumed'); }
      catch (e) { console.warn('[audio] resume failed:', e.message); }
    }
  }
  /** iOS Safari sometimes refuses to grant SpeechRecognition the mic while
   *  the AudioContext also holds it. Pause the analyser briefly while a
   *  speech session is active. */
  pause() {
    if (this.ctx && this.ctx.state === 'running') {
      try { this.ctx.suspend(); } catch {}
    }
  }
}
