// Native iOS speech recognition via @capacitor-community/speech-recognition v6.
//
// Important plugin behaviour (this caused the round-7 bug):
//   * `SpeechRecognition.start({...})` resolves IMMEDIATELY after starting
//     a session. It does NOT wait for a final transcript. The console log
//     shows `TO JS undefined` right after the call — that's the no-op
//     resolve.
//   * Transcripts are delivered EXCLUSIVELY through the `partialResults`
//     listener — the "partial" name is misleading, it carries both
//     interim and final candidates.
//   * Session start/stop are reported through the `listeningState`
//     listener (`{status: 'started' | 'stopped'}`). The SDK auto-stops
//     after a short silence; we restart it inside the `stopped` callback
//     to keep recognition live.
//
// Same JS-side API as the Web Speech wrapper in `./speech.js`:
//   new NativeSpeechRecognizer(onText, { lang, onStateChange })
//     .start()  /  .stop()  /  .setLang(lang)
//   Public state: active, isListening, sessionCount, resultCount, lastResultMs

import { SpeechRecognition } from '@capacitor-community/speech-recognition';

export class NativeSpeechRecognizer {
  constructor(onText, { lang = 'en-US', onStateChange = null } = {}) {
    this.onText        = onText;
    this.onStateChange = onStateChange;
    this.lang          = lang;
    this.active        = false;
    this.isListening   = false;
    this.supported     = true;
    this.sessionCount  = 0;
    this.resultCount   = 0;
    this.lastResultMs  = 0;
    this._partialSub   = null;
    this._stateSub     = null;
    this._restartTimer = null;
    this._lastText     = '';   // the most recent partial transcript
  }

  _emit() {
    if (this.onStateChange) this.onStateChange({
      active:        this.active,
      listening:     this.isListening,
      lang:          this.lang,
      sessionCount:  this.sessionCount,
      resultCount:   this.resultCount,
      lastResultMs:  this.lastResultMs,
    });
  }

  async _ensurePermission() {
    try {
      const a = await SpeechRecognition.available();
      if (a && a.available === false) { this.supported = false; return false; }
    } catch (_) {}
    try {
      const p = await SpeechRecognition.checkPermissions();
      if (p && p.speechRecognition === 'granted') return true;
      const r = await SpeechRecognition.requestPermissions();
      return r && r.speechRecognition === 'granted';
    } catch (e) {
      console.warn('[speech-native] permission flow failed:', e?.message || e);
      return false;
    }
  }

  async start() {
    if (this.active) return true;
    const ok = await this._ensurePermission();
    if (!ok) return false;

    // -- The actual transcript stream --
    try {
      this._partialSub = await SpeechRecognition.addListener(
        'partialResults',
        (data) => {
          const matches = data && data.matches;
          if (!matches || !matches.length) return;
          const text = matches[0].trim();
          if (!text) return;
          this.resultCount++;
          this.lastResultMs = Date.now();
          this._lastText    = text;
          // Plugin doesn't distinguish interim vs final — emit each as
          // "interim" here; we re-emit as final when the session stops.
          this.onText(text, false);
          this._emit();
        },
      );
    } catch (e) {
      console.warn('[speech-native] addListener(partialResults) failed:', e?.message || e);
    }

    // -- Lifecycle event used to drive auto-restart --
    try {
      this._stateSub = await SpeechRecognition.addListener(
        'listeningState',
        (data) => {
          const wasListening = this.isListening;
          this.isListening = !!(data && data.status === 'started');
          this._emit();
          // SDK auto-stops on silence; if we still want to be active,
          // immediately spin up another session.
          if (wasListening && !this.isListening && this.active) {
            // Flush the accumulated "interim" transcript as a finalised
            // utterance so downstream (book recommender, sentiment) fires.
            this._flushFinalIfAny();
            this._restartTimer = setTimeout(() => {
              if (this.active) this._beginSession();
            }, 250);
          }
        },
      );
    } catch (_) {}

    this.active = true;
    this._emit();
    this._beginSession();
    return true;
  }

  /** Called from listeningState 'stopped' to mark whatever's currently
   *  shown as a finalised utterance — so the rest of the app's pipeline
   *  (sentiment, book recommender, avatar mood overlay) actually runs. */
  _flushFinalIfAny() {
    if (this.lastResultMs && (Date.now() - this.lastResultMs) < 8000) {
      // We have a recent transcript — re-emit it as final.
      // The callback already received the latest text; emit "" with
      // isFinal=true wouldn't help, so re-emit the existing payload by
      // calling the user callback with the SAME text but isFinal=true.
      // (main.js's onSpeech treats this exactly like a Web Speech final.)
      this.onText(this._lastText || '', true);
    }
  }

  async _beginSession() {
    if (!this.active) return;
    this.sessionCount++;
    this._emit();
    try {
      await SpeechRecognition.start({
        language:        this.lang,
        maxResults:      1,
        partialResults:  true,
        popup:           false,
      });
      // start() resolves immediately; recognition keeps running in the
      // background and emits via partialResults + listeningState.
    } catch (e) {
      console.warn('[speech-native] start failed:', e?.message || e);
      if (this.active) {
        this._restartTimer = setTimeout(() => {
          if (this.active) this._beginSession();
        }, 500);
      }
    }
  }

  async stop() {
    this.active = false;
    this.isListening = false;
    if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null; }
    try { await SpeechRecognition.stop(); } catch {}
    try { await this._partialSub?.remove(); } catch {}
    try { await this._stateSub?.remove();   } catch {}
    this._partialSub = null;
    this._stateSub   = null;
    this._emit();
  }

  setLang(lang) {
    if (lang === this.lang) return;
    console.log('[speech-native] lang →', lang);
    this.lang = lang;
    // End current session; the listeningState 'stopped' handler will
    // restart it with the new language.
    SpeechRecognition.stop().catch(() => {});
  }
}
