// Web Speech API wrapper for iPad Safari — back to the simple version
// that actually worked.
//
// Lessons learned:
//   - Per-utterance sessions (continuous=false) sounded safer in theory
//     but on this specific iPad they silently failed (sessions firing,
//     0 results). Going back to `continuous = true` + restart-on-end is
//     what the device wants.
//   - Restart on onend is a single line; no watchdog needed.
//   - We still expose `sessionCount` / `resultCount` / `onStateChange`
//     so the dashboard's diagnostic line and the mood-badge pulse keep
//     working without rewriting their callers.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export class SpeechRecognizer {
  /**
   * @param {(text:string, isFinal:boolean) => void} onText
   * @param {{ lang?: string, onStateChange?: (state) => void }} opts
   */
  constructor(onText, { lang = 'en-US', onStateChange = null } = {}) {
    this.onText        = onText;
    this.onStateChange = onStateChange;
    this.lang          = lang;
    this.recog         = null;
    this.active        = false;
    this.isListening   = false;
    this.supported     = !!SR;
    this.sessionCount  = 0;
    this.resultCount   = 0;
    this.lastResultMs  = 0;
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

  start() {
    if (!this.supported) {
      console.warn('[speech] Web Speech API not available');
      return false;
    }
    if (this.active) return true;
    this.active = true;
    this._spawn();
    return true;
  }

  stop() {
    this.active = false;
    this.isListening = false;
    try { this.recog?.stop(); } catch {}
    this.recog = null;
    this._emit();
  }

  setLang(lang) {
    if (lang === this.lang) return;
    console.log('[speech] lang →', lang);
    this.lang = lang;
    if (this.active) this._spawn();
  }

  _spawn() {
    if (this.recog) try { this.recog.abort(); } catch {}
    const r = new SR();
    r.continuous      = true;
    r.interimResults  = true;
    r.lang            = this.lang;
    r.maxAlternatives = 1;

    r.onstart = () => {
      this.isListening = true;
      this.sessionCount++;
      console.log('[speech] session #' + this.sessionCount + ' start, lang=', this.lang);
      this._emit();
    };

    r.onresult = (ev) => {
      this.resultCount++;
      this.lastResultMs = Date.now();
      let interim = '', finalText = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const t = result[0].transcript;
        if (result.isFinal) finalText += t;
        else interim += t;
      }
      if (finalText) this.onText(finalText.trim(), true);
      else if (interim) this.onText(interim.trim(), false);
    };

    r.onend = () => {
      this.isListening = false;
      this._emit();
      // Simple V1 pattern: just restart if we're still meant to be active.
      if (this.active) {
        try { r.start(); }
        catch {
          // Restarting too quickly throws InvalidStateError; back off.
          setTimeout(() => { if (this.active) this._spawn(); }, 250);
        }
      }
    };

    r.onerror = (e) => {
      console.warn('[speech] error:', e.error);
      this.isListening = false;
      this._emit();
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.active = false;
      }
    };

    try {
      r.start();
      this.recog = r;
    } catch (e) {
      console.warn('[speech] start() threw:', e.message);
      setTimeout(() => { if (this.active) this._spawn(); }, 250);
    }
  }
}
