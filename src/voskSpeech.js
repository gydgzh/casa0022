// Offline speech → topic keywords via vosk-browser (WASM Kaldi, NO internet).
//
// Why this exists: on the iPad (Capacitor WKWebView) iOS cloud STT needs the
// network, and the iPad 6 (A10, no Neural Engine) has no on-device
// SFSpeechRecognizer. vosk-browser is a self-contained WASM recogniser that
// runs fully offline in a Web Worker. We constrain it to a closed GRAMMAR of
// film topics — that both boosts accuracy and cuts CPU on the weak A10.
//
// Stack-specific choices (from research, see docs):
//   * ScriptProcessorNode, NOT AudioWorklet (AudioWorklet corrupts mic audio
//     in WKWebView).
//   * NEVER hardcode 16000 — iOS returns a 48000 AudioContext; pass the ACTUAL
//     sampleRate and let Vosk resample.
//   * AudioContext must be resumed inside the user gesture, before getUserMedia.
//   * Push-to-talk only (recogniser runs solely while the button is held), so
//     the three.js + face-tracking loop keeps the A10's two cores.
//   * vosk-browser (~6 MB WASM) is dynamically imported on the first
//     push-to-talk, so it never bloats app startup.

// Spoken word forms (word-based lexicon → no 'sci-fi'/'scifi'). '[unk]' lets
// off-list speech map to "unknown" instead of being force-fit to a keyword.
const TOPIC_GRAMMAR = JSON.stringify([
  'science fiction', 'space', 'physics', 'mathematics', 'computer', 'code',
  'history', 'war', 'romance', 'love', 'mystery', 'philosophy', 'poetry',
  'library', 'reading', 'city', 'urban', 'dystopia', 'future', 'biology',
  'evolution', 'art', 'music', 'animation', 'comedy', 'science', 'time',
  'turing', 'space odyssey', 'hawking', '[unk]',
]);

const MODEL_URL = 'models/vosk-model-small-en-us-0.15.tar.gz';

export class VoskTopicRecognizer {
  constructor(onText, { onState = null, grammar = null } = {}) {
    this.onText  = onText;     // (text, isFinal) => void
    this.onState = onState;    // ({status, supported, listening, error}) => void
    this.grammar = grammar;    // JSON-string word list → tiny closed-grammar decode
                               // (wake-word spotting); null → full open vocabulary.
                               // Survives watchdog restarts (start() re-reads it).
    this.supported = true;
    this.model = null;
    this.recognizer = null;
    this.audioContext = null;
    this.stream = null; this.source = null; this.node = null;
    this.listening = false;
    this.starting  = false;   // guards against overlapping start() calls (watchdog)
    this.externalStream = null;  // shared camera+mic stream (avoids 2nd getUserMedia on iOS)
    this._ownStream = false;
    this.muted = false;          // true while the librarian's own TTS is speaking
    this.lastAudioMs = 0;        // last time onaudioprocess fired (watchdog liveness)
    this.trackDead = false;      // mic track ended/muted (iOS route change) — needs re-acquire
    this._onVis = null;
  }

  /** Use an already-open MediaStream's audio (from the camera getUserMedia),
   *  instead of opening a second mic stream — iOS kills the camera otherwise. */
  useStream(stream) { this.externalStream = stream; }

  _state(status, error) {
    if (this.onState) this.onState({
      status, supported: this.supported, listening: this.listening, error: error || null,
    });
  }

  /** Lazily load the (heavy) model on the first push-to-talk. */
  async init() {
    if (this.model || !this.supported) return this.supported;
    this._state('loading');
    try {
      const { createModel } = await import('vosk-browser');   // lazy: only on first talk
      this.model = await createModel(MODEL_URL);               // same-origin file under public/
      this._state('ready');
      return true;
    } catch (e) {
      this.supported = false;
      console.warn('[vosk] model load failed:', e?.message || e);
      this._state('error', e?.message || String(e));
      return false;
    }
  }

  /** (Re)build the Kaldi recogniser against the live AudioContext.
   *  With a grammar: a tiny closed-word-list decode — near-zero CPU/RAM on the
   *  A10 while idle, only able to hear the wake word. Without: full open
   *  vocabulary (pass the ACTUAL rate; iOS gives 48000, Vosk resamples). */
  _makeRecognizer() {
    if (this.recognizer) { try { this.recognizer.remove?.(); } catch (_) {} }
    this.recognizer = this.grammar
      ? new this.model.KaldiRecognizer(this.audioContext.sampleRate, this.grammar)
      : new this.model.KaldiRecognizer(this.audioContext.sampleRate);
    this.recognizer.on('result',        (m) => { const t = (m.result?.text    || '').trim(); if (t) this.onText(t, true);  });
    this.recognizer.on('partialresult', (m) => { const t = (m.result?.partial || '').trim(); if (t) this.onText(t, false); });
  }

  /** Hot-swap between wake-word grammar and open vocabulary WITHOUT touching
   *  the mic/audio pipeline (onaudioprocess reads this.recognizer per event,
   *  so swapping the instance between events is safe). */
  setGrammar(grammar) {
    if (this.grammar === grammar) return;
    this.grammar = grammar;
    if (this.listening && this.model && this.audioContext) {
      this._makeRecognizer();
      console.log('[vosk] recogniser →', grammar ? 'wake-word grammar (idle)' : 'open vocabulary (awake)');
    }
  }

  /** Start continuous listening. First call may be slow (loads the model). */
  async start() {
    if (this.listening || this.starting) return;
    this.starting = true;
    try {
      const ok = await this.init();
      if (!ok) { this.starting = false; return; }
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();

      if (this.externalStream) {
        this.stream = this.externalStream;   // share the camera's mic — no 2nd getUserMedia
        this._ownStream = false;
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
          video: false,
        });
        this._ownStream = true;
      }

      // Mic-track liveness: on iOS an audio-route change (Bluetooth/HDMI/dock
      // connect-disconnect) or memory pressure can silently 'ended' or 'mute'
      // the track. onaudioprocess then keeps firing on a DEAD track, so the
      // lastAudioMs liveness check never trips and the recogniser hears nothing
      // forever. Flag trackDead → the watchdog (healSpeech) re-acquires the mic
      // with a fresh getUserMedia. A transient mute that self-recovers fires
      // 'unmute' and clears the flag, so we don't restart needlessly.
      this.trackDead = false;
      const micTrack = this.stream.getAudioTracks()[0];
      if (micTrack) {
        micTrack.onended  = () => { console.warn('[vosk] mic track ended');  this.trackDead = true;  };
        micTrack.onmute   = () => { console.warn('[vosk] mic track muted');  this.trackDead = true;  };
        micTrack.onunmute = () => { console.log ('[vosk] mic track unmuted'); this.trackDead = false; };
      }

      this._makeRecognizer();

      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.node   = this.audioContext.createScriptProcessor(2048, 1, 1);  // not AudioWorklet (WKWebView bug); smaller = lower latency
      // Lightweight VAD: only run the (expensive) decoder while there's actual
      // voice, plus a short tail so Vosk can finalise. During the mostly-silent
      // week-long run this keeps the A10 cool and the render loop smooth.
      // Sensitivity: 0.006 lets far/quiet exhibition speech through (0.012
      // gated it out — wake word felt deaf); 1000 ms tail gives Vosk enough
      // context to finalise short phrases like "hello librarian".
      const VAD_RMS = 0.006, VAD_TAIL_MS = 1000;
      let lastVoice = 0;
      this.node.onaudioprocess = (e) => {
        this.lastAudioMs = (performance && performance.now) ? performance.now() : Date.now();
        if (this.muted) return;   // ignore mic while the librarian is talking (no self-hearing)
        const buf = e.inputBuffer.getChannelData(0);
        let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        const rms = Math.sqrt(s / buf.length);
        const now = (performance && performance.now) ? performance.now() : Date.now();
        if (rms > VAD_RMS) lastVoice = now;
        if (now - lastVoice < VAD_TAIL_MS) {
          try { this.recognizer.acceptWaveform(e.inputBuffer); } catch (_) {}
        }
      };
      this.source.connect(this.node);
      this.node.connect(this.audioContext.destination);

      this._onVis = () => {
        if (document.visibilityState === 'visible' && this.audioContext?.state === 'suspended') {
          this.audioContext.resume();
        }
      };
      document.addEventListener('visibilitychange', this._onVis);

      this.lastAudioMs = (performance && performance.now) ? performance.now() : Date.now();
      this.listening = true;
      this._state('listening');
    } catch (e) {
      console.warn('[vosk] start failed:', e?.message || e);
      this._state('error', e?.message || String(e));
      this.stop();
    } finally {
      this.starting = false;
    }
  }

  /** Stop listening — frees the mic + CPU so the render loop gets the cores. */
  stop() {
    this.listening = false;
    if (this._onVis) { document.removeEventListener('visibilitychange', this._onVis); this._onVis = null; }
    if (this.node)   { try { this.node.disconnect(); } catch (_) {} this.node.onaudioprocess = null; this.node = null; }
    if (this.source) { try { this.source.disconnect(); } catch (_) {} this.source = null; }
    if (this.stream) { if (this._ownStream) this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.recognizer) { try { this.recognizer.remove?.(); } catch (_) {} this.recognizer = null; }
    if (this.audioContext) { try { this.audioContext.close(); } catch (_) {} this.audioContext = null; }
    this._state(this.supported ? 'ready' : 'error');
  }
}
