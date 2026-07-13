// Entry point: wires camera, MediaPipe, avatar, pyramid renderer and the
// optional WebSocket relay. URL flags:
//   ?mode=capture (default)  – Mac with webcam
//   ?mode=display            – iPad receiver (no camera)
//   ?lowend=1                – downscale capture for iPad standalone

import { FaceCapture } from './faceCapture.js';
import { PoseCapture } from './poseCapture.js';
import { AvatarScene } from './avatarScene.js';
import { PyramidRenderer } from './pyramid.js';
import { RelayClient } from './streaming.js';
import { OneEuroDict } from './oneEuro.js';
import { DemoDriver } from './demoMode.js';
import { initSensorsLive, initSensorsMock, getSensorState } from './sensors.js';
import { Dashboard } from './dashboard.js';
import { AudioCapture } from './audio.js';
import { SpeechRecognizer as WebSpeechRecognizer } from './speech.js';
import { NativeSpeechRecognizer } from './speechNative.js';
import { VoskTopicRecognizer } from './voskSpeech.js';

// On iPad (Capacitor) use the native SFSpeechRecognizer plugin — that's
// the only way to escape the WKWebView "sessions fire, 0 results" bug
// you hit with Web Speech. In a plain browser fall back to Web Speech.
const _isCapacitorRuntime = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const SpeechRecognizer = _isCapacitorRuntime ? NativeSpeechRecognizer : WebSpeechRecognizer;
console.log('[speech] using', _isCapacitorRuntime ? 'NATIVE (SFSpeechRecognizer)' : 'WEB (Web Speech API)');
import { classifySentiment, recommendBookFromSpeech, recommendFilmFromSensors, bookByUid } from './bookDb.js';

const q = new URLSearchParams(location.search);
// capture = Mac + webcam (default), display = iPad receiver, demo = no webcam (procedural)
const MODE = q.get('mode') || 'capture';
const LOWEND = q.get('lowend') === '1';
// Face-tracking (camera + MediaPipe): ON by default — mirroring the visitor's
// face IS the project's theme. On the 2 GB A10 iPad it is the biggest
// memory/GPU consumer and was implicated in the ~30-min throttling; the Web
// Worker watchdog now self-heals the audio side, but for the week-long
// unattended run it can be disabled in Settings (or ?face=0). Priority:
// ?face= URL param → Settings toggle (localStorage faceTracking) → ON.
const _isCapacitorRT = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const _faceLS = localStorage.getItem('faceTracking');
const FACE_TRACKING =
  q.get('face') !== null ? q.get('face') === '1' :
  _faceLS      !== null  ? _faceLS === '1'       : true;
const TRACKER_DEFAULT = q.get('tracker') || 'face';
// Avatar selection priority:
//   1. ?avatar=… URL parameter (explicit override)
//   2. saved `avatarUrl` in Settings localStorage
//   3. /3D_/ryu2.vrm default in Capacitor builds (bundled into the IPA
//      via scripts/sync-public-assets.sh)
//   4. nothing → placeholder primitive head
const _qAvatar = q.get('avatar');
const _isCapacitorAvatar = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const AVATAR_URL =
  _qAvatar !== null ? _qAvatar :
  (localStorage.getItem('avatarUrl') || (_isCapacitorAvatar ? '/3D_/ryu2.vrm' : null));
// Which camera drives face capture (Mac may have several: built-in FaceTime,
// an external UVC webcam, iPhone Continuity). Match by label substring,
// e.g. ?cam=web%20camera or Settings → Camera. Empty → browser default.
const CAM_FILTER = (q.get('cam') || localStorage.getItem('camDevice') || '').trim();
// Where the WebSocket relay lives (the capture Mac's IP). On the iPad the page
// host is capacitor://localhost, so it MUST be set explicitly (Settings → Mac
// relay IP) for the mirror link; empty falls back to the page's own hostname.
const RELAY_HOST = (q.get('relay') || localStorage.getItem('relayHost') || '').trim();
// Wake word ("Hello, librarian"): in the exhibition the librarian stays idle
// until greeted, so it doesn't blurt recommendations at passers-by. Default ON
// in the Capacitor app, OFF in browser dev; override with ?wake=1 / ?wake=0.
const WAKE_GATE = q.get('wake') !== null ? q.get('wake') === '1' : _isCapacitorRT;
// Spoken replies (offline TTS). LISTEN-ONLY by default: the librarian shows
// its recommendations on screen but stays silent. Re-enable with ?tts=1.
const TTS_ON = q.get('tts') === '1';

// ?debug=1 unhides the developer panels (FPS, tracker/layout dropdowns).
// In a normal app launch they stay hidden so the UI feels finished.
if (q.get('debug') === '1') document.body.classList.add('debug-on');
// Mirror pre-flip (Pepper's ghost): the avatar canvas renders upside down so
// the mirror reflection reads upright. On by default; ?flip=0 disables (e.g.
// when viewing the screen directly without the prism).
if (q.get('flip') !== '0') document.body.classList.add('mirror-flip');
// Sensor data source:
//   * ?sensors=1     — live MQTT (needs Mosquitto + Arduino reachable)
//   * ?sensors=mock  — synthetic in-browser data (good for UI testing)
//   * (nothing)      — implicit default:
//                       - web build: no dashboard (legacy behaviour)
//                       - Capacitor native app + no saved Mac IP → 'mock'
//                       - Capacitor native app + saved Mac IP    → '1'
const _isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const _explicitSensors = q.get('sensors'); // '1' | 'mock' | null
const _savedHost  = localStorage.getItem('arduinoHost');
const SENSORS_MODE =
  _explicitSensors !== null ? _explicitSensors :
  _isCapacitor               ? '1' :   // native app: ALWAYS poll the real Arduino
                               null;    // (defaultArduinoHost() = saved IP or 192.168.4.1).
                                        // Use ?sensors=mock explicitly for UI-only testing.
// Which input drives the avatar: 'mirror' (face only), 'listen' (audio only),
// 'both' (default). Overridable by URL ?features=… and live by UI capsule.
const FEATURES_DEFAULT = (q.get('features') || 'both').toLowerCase();

const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $('pyramid-canvas'),
  video: $('preview'),
  modeLabel: $('mode-label'),
  fps: $('fps'),
  latency: $('latency'),
  status: $('status'),
  tracker: $('tracker'),
  layout: $('layout'),
  avatar: $('avatar'),
  avatarFile: $('avatar-file'),
  fullscreen: $('fullscreen-btn'),
  reload: $('reload-btn')
};

// Two status surfaces in parallel:
//   * ui.status      — the debug HUD line (only visible with ?debug=1)
//   * #app-status    — the small app-style pill at bottom-left, always visible
const _appStatusEl   = document.getElementById('app-status');
const _appStatusText = document.getElementById('app-status-text');
function setStatus(text, cls = '') {
  if (ui.status) {
    ui.status.textContent = text;
    ui.status.className = cls;
  }
  if (_appStatusText) _appStatusText.textContent = text;
  if (_appStatusEl) {
    _appStatusEl.classList.remove('warn', 'err');
    if (cls === 'warn' || cls === 'err') _appStatusEl.classList.add(cls);
  }
}

document.body.classList.toggle('display-mode', MODE === 'display');
document.body.classList.toggle('sensors-on', !!SENSORS_MODE);
ui.modeLabel.textContent = MODE;
ui.tracker.value = TRACKER_DEFAULT;

/* ---------- Feature state (Mirror / Listen / Both) ---------- */
// Pre-create a fallback procedural driver so the avatar can still breathe
// and look around in Listen mode (no face tracking). Demo mode also uses it.
const idleDriver = new DemoDriver();
const featureState = { current: FEATURES_DEFAULT };
function isMirror() { return featureState.current !== 'listen'; }
function isListen() { return featureState.current !== 'mirror'; }
function applyFeatureClasses() {
  document.body.classList.remove('feature-mirror', 'feature-listen', 'feature-both');
  document.body.classList.add('feature-' + featureState.current);
}
applyFeatureClasses();
function setFeature(mode) {
  if (mode === featureState.current) return;
  featureState.current = mode;
  applyFeatureClasses();
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  // Audio + speech start/stop on transitions.
  // With _speechSupported the `audio` ref is null, so we go straight to
  // speech.start() — that's the desired "speech owns the mic" path.
  // Native recogniser is async; await it so we set active correctly.
  if (isListen()) {
    if (audio && !audio.stream) {
      audio.start().then(async (ok) => {
        if (ok && speech) {
          const started = await Promise.resolve(speech.start());
          speechState.active = !!started;
        }
      });
    } else if (speech && !speech.active) {
      Promise.resolve(speech.start()).then((started) => {
        speechState.active = !!started;
      });
    }
  } else {
    speech?.stop();
    speechState.active = false;
  }
  console.log('[feature] set →', mode);
}

const avatarScene = new AvatarScene();
const pyramid = new PyramidRenderer(ui.canvas, avatarScene);

// Sensors + dashboard — only enabled when ?sensors=… is in the URL.
// Default for capture mode: audio capture (mic + speech) is on so the
// dashboard's "Heard on iPad" section animates. Pass ?audio=0 to skip.
const AUDIO_ON = q.get('audio') !== '0' && (MODE === 'capture' || MODE === 'demo');

// Audio analyser: on iPad (Capacitor) the native SFSpeechRecognizer needs
// exclusive AVAudioEngine access — opening a parallel getUserMedia stream
// for the dB bar starves it and recognition silently never produces
// results. So on Capacitor we leave the dB bar dark and let speech own
// the mic. In a normal browser both can coexist, so we keep audio on.
const audio  = (AUDIO_ON && !_isCapacitorRuntime) ? new AudioCapture() : null;
if (AUDIO_ON && _isCapacitorRuntime) {
  console.log('[audio] suppressed on Capacitor — SFSpeechRecognizer needs the mic');
}
// Language for Web Speech API. Default English (US). Override via Settings;
// localStorage key `speechLang`. The recogniser's output is fed into the
// recommender, which translates Chinese keywords to English topics so the
// suggestion shown to the user is always English.
const _speechLang = (localStorage.getItem('speechLang') || q.get('lang') || 'en-US').trim();
// On the iPad we use the OFFLINE Vosk push-to-talk recogniser instead of the
// network-dependent native one (set up further below). So only build the
// auto-listening native/web recogniser off-Capacitor.
const speech = (AUDIO_ON && !_isCapacitorRuntime) ? new SpeechRecognizer(
  (text, isFinal) => onSpeech(text, isFinal),
  {
    lang: _speechLang,
    onStateChange: (st) => {
      speechState.active       = !!st.active;
      speechState.listening    = !!st.listening;
      speechState.sessionCount = st.sessionCount || 0;
      speechState.resultCount  = st.resultCount  || 0;
      speechState.lastResultMs = st.lastResultMs || 0;
      // Note: audio analyser is now disabled entirely on iPad (see
      // _speechSupported gate above) so there is no mic-contention to pause.
      updateMoodBadge();
    },
  }
) : null;

const speechState = {
  active:    false,
  listening: false,   // pulses true when the recogniser is mid-session
  text:      '',      // most recent (interim or final) sentence
  textFinal: false,   // was the latest text a finalised utterance?
  mood:      'neutral',
  book:      null,    // last book recommendation (from speech)
  film:      null,    // last film recommendation (from sensors)
  sessionCount: 0,
  resultCount:  0,
  lastResultMs: 0,
};
function getSpeechState() { return speechState; }

// Sensor-driven film recommendation (v3). Picks a film from presence /
// distance / temp / humidity, with an RFID-book override (a recognised
// book on the desk recommends the closest-matching film). Re-evaluates
// every 8 s; the seed rotates titles within a mood bucket.
let _filmSeed = Math.floor(Math.random() * 1000);
function updateFilmFromSensors() {
  const s = getSensorState();
  const f = recommendFilmFromSensors({
    presence:   s.presence,
    distanceCm: s.distanceCm,
    tempC:      s.tempC,
    humidity:   s.humidity,
    bookUid:    s.bookUid,
    lux:        s.lux,        // legacy fallback (old firmware / mock)
    motion:     s.motion,
    speechText: speechState.text,   // spoken topic (offline Vosk) blends into the pick
  }, _filmSeed);
  if (f) speechState.film = f;
  _filmSeed++;
}
setInterval(updateFilmFromSensors, 8000);
setTimeout(updateFilmFromSensors, 1500);    // first pick once mock/live data shows up

/* ---------- Avatar presence gate (Andy's feedback #4) ----------
 * The librarian should only appear when a reader is actually in front
 * of the installation. The Arduino's VL53L0X gives `presence` (1 when
 * someone is < 1 m, with a 3 s latch). If nobody is there for > 5 s we
 * fade the pyramid canvas out; the moment presence returns, fade in.
 * Only active when live sensors report a presence field — in browser
 * dev / mock / old-firmware setups the avatar stays visible. Speech and
 * tracking keep running (cheap, and avoids touching the working audio
 * pipeline); this is purely a visual gate. */
const PRESENCE_GRACE_MS = 5000;
const PRESENCE_GATE = false;   // demo: keep the librarian ALWAYS visible (don't fade out
                               // when the ToF reports no reader within 1 m). Set true to
                               // restore the "appears only when someone approaches" effect.
let _lastPresentMs = performance.now();
let _avatarHidden  = false;
ui.canvas.style.transition = 'opacity 1.2s ease';
setInterval(() => {
  const s = getSensorState();
  if (!PRESENCE_GATE || !s.connected || s.presence == null || s.source === 'mock') {
    if (_avatarHidden) { ui.canvas.style.opacity = '1'; _avatarHidden = false; }
    return;
  }
  const now = performance.now();
  if (s.presence === 1) _lastPresentMs = now;
  const shouldHide = now - _lastPresentMs > PRESENCE_GRACE_MS;
  if (shouldHide !== _avatarHidden) {
    _avatarHidden = shouldHide;
    ui.canvas.style.opacity = shouldHide ? '0' : '1';
    console.log('[presence] avatar', shouldHide ? 'hidden (no reader)' : 'shown');
  }
}, 1000);

let dashboard = null;
if (SENSORS_MODE === 'mock') {
  initSensorsMock();
  dashboard = new Dashboard(document.getElementById('dashboard-canvas'), { audio, getSpeechState, hideSuggestions: true });
} else if (SENSORS_MODE === '1' || SENSORS_MODE === 'live') {
  initSensorsLive();
  dashboard = new Dashboard(document.getElementById('dashboard-canvas'), { audio, getSpeechState, hideSuggestions: true });
}

/* ---------- Right-side recommendations panel (exhibition layout) ----------
 * Book + film suggestions live in their own HTML card at the top-right so
 * they never cover the avatar's face; the left-side dashboard shows only
 * sensor data (hideSuggestions above). */
(() => {
  const bt = document.getElementById('sp-book-title'),  bc = document.getElementById('sp-book-credit');
  const ft = document.getElementById('sp-film-title'),  fc = document.getElementById('sp-film-credit');
  if (!bt || !ft) return;
  setInterval(() => {
    const b = speechState.book, f = speechState.film;
    bt.textContent = b ? '📖 ' + b.title : 'Say “Hello”, then a topic…';
    bc.textContent = b ? 'by ' + (b.creator || '') : '';
    ft.textContent = f ? '🎬 ' + f.title : '—';
    fc.textContent = f ? 'dir. ' + (f.creator || '') : '';
  }, 1000);
})();

/* ---------- "Book scanned" popup ----------
 * Prominent overlay that fires the moment the RC522 (field-loading detection)
 * reports a new book on the desk, shows the title/author + the matching film,
 * auto-hides after a few seconds, and clears when the book is removed. */
const _bp = {
  el:     document.getElementById('book-popup'),
  title:  document.getElementById('bp-title'),
  author: document.getElementById('bp-author'),
  film:   document.getElementById('bp-film'),
  lastUid: '',
  timer:   null,
};
function showBookPopup(uid) {
  if (!_bp.el) return;
  const b = bookByUid(uid);
  playScanChime();                               // audible "book found" cue
  console.log('[book] scanned uid=' + uid + ' → ' + ((b && !b.unknown) ? b.title : 'UNKNOWN tag'));
  _bp.title.textContent  = (b && !b.unknown) ? b.title : ('Tag ' + uid);
  _bp.author.textContent = (b && b.creator) ? b.creator : '';
  updateFilmFromSensors();                       // refresh the matching film
  const f = speechState.film;
  _bp.film.textContent = f ? ('🎬  ' + f.title) : '';
  _bp.el.classList.remove('show', 'hiding');
  void _bp.el.offsetWidth;                        // restart the entrance animation
  _bp.el.classList.add('show');
  if (_bp.timer) clearTimeout(_bp.timer);
  _bp.timer = setTimeout(hideBookPopup, 5000);
}
function hideBookPopup() {
  if (!_bp.el || !_bp.el.classList.contains('show')) return;
  _bp.el.classList.add('hiding');
  setTimeout(() => _bp.el.classList.remove('show', 'hiding'), 340);
}
setInterval(() => {
  const s = getSensorState();
  const uid = (s.bookPresent === 1 && s.bookUid) ? s.bookUid : '';
  // Debounce on the RESOLVED title, not the raw UID: each exhibition book
  // carries two tags (Feiju sticker + Mifare card) and the PN532 alternates
  // between their UIDs every poll — comparing UIDs re-fired the popup+chime
  // in a loop. Same book = same title = one popup; unknown tags fall back to
  // the UID so two different unknown tags still both announce themselves.
  const key = uid ? ((bookByUid(uid) && !bookByUid(uid).unknown) ? bookByUid(uid).title : uid) : '';
  if (key && key !== _bp.lastUid) { _bp.lastUid = key; showBookPopup(uid); }
  else if (!key && _bp.lastUid)   { _bp.lastUid = ''; hideBookPopup(); }
}, 300);

/* Sentiment overlay — boosts smile/frown/brow on the avatar for ~4 s
   after a recognised utterance, on top of whatever MediaPipe is driving. */
const emotion = { mood: 'neutral', until: 0 };
function setMood(m) {
  emotion.mood  = m;
  emotion.until = performance.now() + 4000;
}
function overlayMood(bs) {
  const now = performance.now();
  if (now >= emotion.until) return bs;
  const w = Math.max(0, (emotion.until - now) / 4000);
  const out = { ...bs };
  const max = (a, b) => Math.max(a || 0, b);
  if (emotion.mood === 'happy') {
    out.mouthSmileLeft   = max(out.mouthSmileLeft,   0.7 * w);
    out.mouthSmileRight  = max(out.mouthSmileRight,  0.7 * w);
    out.cheekSquintLeft  = max(out.cheekSquintLeft,  0.3 * w);
    out.cheekSquintRight = max(out.cheekSquintRight, 0.3 * w);
  } else if (emotion.mood === 'sad') {
    out.mouthFrownLeft   = max(out.mouthFrownLeft,   0.5 * w);
    out.mouthFrownRight  = max(out.mouthFrownRight,  0.5 * w);
    out.browInnerUp      = max(out.browInnerUp,      0.5 * w);
  } else if (emotion.mood === 'thinking') {
    out.browDownLeft     = max(out.browDownLeft,     0.4 * w);
    out.browDownRight    = max(out.browDownRight,    0.4 * w);
    out.eyeLookUpLeft    = max(out.eyeLookUpLeft,    0.3 * w);
    out.eyeLookUpRight   = max(out.eyeLookUpRight,   0.3 * w);
  }
  return out;
}

/* ---------- Wake chime ----------
 * TTS is off (listen-only), so this loud two-note "ding-ding" is the ONLY
 * audible cue that "Hello" was heard and the librarian is ready for a topic.
 * Synthesised with Web Audio — no asset, works offline. The context is
 * created/resumed inside the setup tap (same gesture that unlocks the mic). */
let _chimeCtx = null;
function ensureChimeCtx() {
  try {
    if (!_chimeCtx) _chimeCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_chimeCtx.state === 'suspended') _chimeCtx.resume().catch(() => {});
  } catch (_) {}
  return _chimeCtx;
}
function playWakeChime() {
  const ctx = ensureChimeCtx();
  if (!ctx) return;
  if (voskRec) {           // don't let the recogniser transcribe the chime
    voskRec.muted = true;
    setTimeout(() => { if (voskRec) voskRec.muted = false; }, 700);
  }
  const t = ctx.currentTime + 0.02;
  // E6 → A6, short attack, ~loud (0.85 peak) — cuts through exhibition noise
  [[1318.5, 0, 0.22], [1760, 0.18, 0.38]].forEach(([f, dt, dur]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + dt);
    g.gain.exponentialRampToValueAtTime(0.85, t + dt + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t + dt); o.stop(t + dt + dur + 0.05);
  });
}

/* Book-scan chime — a falling "ding-dong" (distinct from the RISING wake
   chime) that confirms the PN532 read a book, synced with the popup. Same
   Web Audio context as the wake chime (unlocked by the same setup tap). */
function playScanChime() {
  const ctx = ensureChimeCtx();
  if (!ctx) return;
  if (voskRec) {           // don't let the recogniser transcribe the chime
    voskRec.muted = true;
    setTimeout(() => { if (voskRec) voskRec.muted = false; }, 700);
  }
  const t = ctx.currentTime + 0.02;
  // G6 → C6, falling fourth — reads as "found it!" against the wake chime's rise
  [[1568, 0, 0.22], [1046.5, 0.18, 0.42]].forEach(([f, dt, dur]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + dt);
    g.gain.exponentialRampToValueAtTime(0.85, t + dt + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t + dt); o.stop(t + dt + dur + 0.05);
  });
}

/* Offline text-to-speech: the librarian speaks its recommendation aloud.
   iOS speechSynthesis is on-device, so this works with no Wi-Fi. While it
   talks we mute the recogniser so it doesn't transcribe its own voice. */
let _ttsLast = 0;
let _lastPartialReco = 0;
function librarianSay(text) {
  try {
    if (!TTS_ON) return;   // listen-only mode: recommendations appear on screen, no voice
    if (!('speechSynthesis' in window) || !text) return;
    const now = Date.now();
    if (now - _ttsLast < 4000) return;        // don't talk over itself
    _ttsLast = now;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 1.0; u.pitch = 1.05;
    if (voskRec) {
      voskRec.muted = true;
      const unmute = () => { if (voskRec) voskRec.muted = false; };
      u.onend = unmute; u.onerror = unmute;
      setTimeout(unmute, 6000);               // safety net if onend never fires
    }
    window.speechSynthesis.speak(u);
  } catch (_) {}
}

/* ---------- Wake word: "Hello, librarian" ----------
 * In the exhibition the librarian stays idle until greeted, so it doesn't
 * blurt recommendations at every passer-by (tutor feedback). The recogniser
 * keeps transcribing while idle (it must HEAR the greeting) but nothing is
 * recommended or spoken until someone says the wake phrase. Once woken it
 * stays awake for WAKE_WINDOW_MS, extended by each further utterance.
 * Matching is deliberately loose ('librar' catches librarian/library) since
 * the small offline Vosk model sometimes mangles "librarian". */
const WAKE_WINDOW_MS = 45000;
let _awakeUntil = 0;
const isIdleGated = () => WAKE_GATE && Date.now() >= _awakeUntil;
// Two-tier mic for the week-long run: while idle the Vosk recogniser is
// hot-swapped onto this tiny closed grammar — the decoder can ONLY hear the
// wake word (and its near-homophones from matchesWake), so ambient exhibition
// chatter costs near-zero A10 CPU/RAM instead of a full open-vocab decode.
// '[unk]' is load-bearing: without it EVERY utterance would be force-fitted
// to "hello" and false-wake the librarian. On wake we swap to open vocabulary
// (see onSpeech); healSpeech lapses us back once the awake window expires.
const WAKE_GRAMMAR = JSON.stringify(['hello', 'hollow', 'halo', 'hulu', '[unk]']);
function matchesWake(text) {
  // Wake word: "hello" — simple on purpose (the exhibitor's accent), and
  // FORGIVING about near-homophones the small Vosk model hears instead
  // (hallo/hollow/halo/hulu are how a non-native "hello" often transcribes).
  // Whole words only, so ambient chatter doesn't fire it.
  return /\b(hello|hallo|hullo|allo|hollow|halo|hulu)\b/.test(text.toLowerCase());
}
// True when the utterance is JUST the greeting ("hello librarian") with no
// topic words worth recommending from.
function isBareGreeting(text) {
  const rest = text.toLowerCase().replace(/\b(hello|hallo|hullo|hey|hi|librarian|librarians|liberian|library|libraries|and|in|the|a|an)\b/g, ' ');
  return rest.split(/[^a-z']+/).filter(Boolean).length < 2;
}

/* Speech callback: gets fired by SpeechRecognizer on every interim or
   final result. We update the dashboard state immediately, then on final
   results we re-run sentiment classification + book recommendation. */
function onSpeech(text, isFinal) {
  // Idle (wake-gated): only listen for the greeting. Nothing else may leak —
  // not into the pill, and (crucially) not into speechState.text, which the
  // 8 s film-recommendation interval reads.
  if (isIdleGated()) {
    speechState.text = ''; speechState.textFinal = false;
    if (matchesWake(text)) {
      _awakeUntil = Date.now() + WAKE_WINDOW_MS;
      setMood('happy');
      playWakeChime();     // audible "I heard you" (TTS stays off)
      voskRec?.setGrammar(null);   // open vocabulary NOW — the topic comes next
      const _lbl = document.getElementById('ptt-label');
      if (_lbl && voskRec?.listening) _lbl.textContent = 'Listening';
      librarianSay('Hello! What kind of books do you enjoy?');   // no-op unless ?tts=1
      console.log('[wake] woken by:', text);
    }
    updateMoodBadge();
    return;
  }
  // The greeting itself isn't a topic: a partial wakes us, then the SAME
  // utterance's final arrives here. Swallow pure greetings (repeats too);
  // "hello librarian I like space" still flows through for its topic words.
  if (WAKE_GATE && matchesWake(text) && isBareGreeting(text)) {
    if (isFinal) _awakeUntil = Date.now() + WAKE_WINDOW_MS;
    speechState.text = ''; speechState.textFinal = false;
    updateMoodBadge();
    return;
  }
  speechState.text      = text;
  speechState.textFinal = !!isFinal;
  if (WAKE_GATE && isFinal) _awakeUntil = Date.now() + WAKE_WINDOW_MS;  // stay awake while they talk

  updateMoodBadge();
  if (!isFinal) {
    // React live on interim text so the recommendation appears AS you speak,
    // instead of waiting for the (slower) final result — feels much snappier.
    const now = Date.now();
    if (now - _lastPartialReco > 400) {
      _lastPartialReco = now;
      const b = recommendBookFromSpeech(text);
      if (b) { speechState.book = b; speechState.lastResultMs = now; updateFilmFromSensors(); }
    }
    return;
  }
  const mood = classifySentiment(text);
  const book = recommendBookFromSpeech(text);   // speech → book suggestion
  speechState.mood = mood;
  speechState.lastResultMs = Date.now();
  if (book) {
    speechState.book = book;
    librarianSay('You might enjoy ' + book.title + (book.creator ? ' by ' + book.creator : ''));
  }
  setMood(mood);
  updateFilmFromSensors();   // speech ALSO biases the film (spoken topic + environment)
  updateMoodBadge();
  console.log('[speech] final:', text, '| mood=', mood, '| book=', book?.title, '| film=', speechState.film?.title);
}

/* Mood badge — small floating pill below the mode selector that shows
   the live transcript or a one-word mood after each utterance. */
const moodDot  = document.getElementById('mood-dot');
const moodText = document.getElementById('mood-text');
function updateMoodBadge() {
  if (!moodText || !moodDot) return;
  const m = speechState.mood;
  const colors = { happy: '#7be0c9', sad: '#7aa8ff', thinking: '#f5b169', neutral: '#888' };
  moodDot.style.background = colors[m] || '#888';
  // Pulse the dot whenever the recogniser is mid-session, so the user can
  // see at a glance that the mic is hot.
  moodDot.classList.toggle('pulse', !!speechState.listening);
  if (!speechState.active) {
    moodText.textContent = 'Tap a mode to start';
  } else if (isIdleGated()) {
    moodText.textContent = 'Say “Hello”';
  } else if (speechState.text) {
    const t = speechState.text;
    moodText.textContent = (t.length > 60 ? t.slice(0, 57) + '…' : t) + '  ·  ' + m;
  } else {
    moodText.textContent = speechState.listening ? 'Listening…' : 'Warming up…';
  }
}

/* Wire mode selector buttons */
document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.classList.toggle('active', btn.dataset.mode === featureState.current);
  btn.addEventListener('click', () => setFeature(btn.dataset.mode));
});
updateMoodBadge();

/* ---------- Offline push-to-talk speech (iPad / Capacitor, Vosk) ----------
 * The iPad 6 (A10) has no on-device SFSpeechRecognizer and iOS cloud STT needs
 * the network. Vosk (WASM) runs the recogniser fully offline. Push-to-talk
 * keeps the WASM off the A10's cores except while the button is held. A spoken
 * topic flows through onSpeech() → biases both the book and the film. */
let voskRec = null;
if (_isCapacitorRuntime) {
  document.body.classList.add('ptt-on');
  const pttBtn   = document.getElementById('ptt-btn');
  const pttLabel = document.getElementById('ptt-label');
  voskRec = new VoskTopicRecognizer(
    (text, isFinal) => onSpeech(text, isFinal),
    { // Boot straight into the cheap wake-word tier when the gate is on.
      grammar: WAKE_GATE ? WAKE_GRAMMAR : null,
      onState: (st) => {
        speechState.active    = st.listening;
        speechState.listening = st.listening;
        if (pttBtn) {
          pttBtn.classList.toggle('live',    st.status === 'listening');
          pttBtn.classList.toggle('loading', st.status === 'loading');
        }
        if (pttLabel) {
          pttLabel.textContent =
            st.status === 'loading'   ? 'Loading speech…'  :
            st.status === 'listening' ? (isIdleGated() ? 'Say “Hello”' : 'Listening') :
            st.status === 'error'     ? 'Speech offline'   :
                                        'Starting…';
        }
        updateMoodBadge();
      } }
  );
  // CONTINUOUS + HANDS-FREE: the finished hologram can't be touched, so we
  // auto-start the recogniser and keep it running. A watchdog restarts it if it
  // ever drops — critical for the week-long unattended installation.
  // Don't start yet — startCapture() shares ONE camera+mic stream into the
  // recogniser (avoids the iOS double-getUserMedia conflict that blanked the
  // camera). The watchdog (and a setup tap) keep it alive once the stream is in.
  const canStart = () => voskRec.supported && (voskRec.externalStream || !FACE_TRACKING) && !voskRec.listening && !voskRec.starting;
  const ensureOn = () => { if (canStart()) voskRec.start(); };
  ensureOn();   // FACE_TRACKING off → start now (own mic); on → startCapture() shares the stream
  // iOS often needs ONE user gesture to unlock audio; any tap during setup both
  // resumes a suspended AudioContext and (re)starts the recogniser.
  const kick = () => {
    if (voskRec.audioContext && voskRec.audioContext.state === 'suspended') voskRec.audioContext.resume().catch(() => {});
    ensureChimeCtx();   // unlock the wake chime on the same setup tap
    ensureOn();
  };
  document.addEventListener('touchend', kick, { passive: true });
  document.addEventListener('click', kick);

  // Self-healing: on the 2 GB A10 iPad, WKWebView discards JIT-compiled JS at
  // ~65% memory pressure — main-thread setInterval AND the audio ScriptProcessor
  // stop together (the rAF render loop survives on the GPU process, which is why
  // the avatar keeps moving while speech/popups freeze). healSpeech() detects the
  // three ways the pipeline dies and restarts IN PLACE (never a page reload —
  // reload resets the audio gesture-unlock and kills speech with nobody to tap):
  //   1. mic track ended/muted (iOS audio-route change)  → voskRec.trackDead
  //   2. ScriptProcessor stalled (no onaudioprocess > 7 s, memory throttle)
  //   3. AudioContext suspended (iOS pauses it on visibility/route change)
  function healSpeech() {
    if (!voskRec || !voskRec.supported) return;
    ensureOn();                              // (re)start if it isn't listening at all
    if (!voskRec.listening || voskRec.starting) return;
    // Two-tier mic: lapse back to the tiny wake-word grammar once the awake
    // window expires. Riding the worker ping means the downgrade still happens
    // when main-thread intervals are being throttled under memory pressure.
    if (WAKE_GATE) {
      const wantGrammar = isIdleGated() ? WAKE_GRAMMAR : null;
      if (voskRec.grammar !== wantGrammar) {
        voskRec.setGrammar(wantGrammar);
        const lbl = document.getElementById('ptt-label');
        if (lbl) lbl.textContent = wantGrammar ? 'Say “Hello”' : 'Listening';
        updateMoodBadge();
      }
    }
    if (voskRec.audioContext && voskRec.audioContext.state === 'suspended') {
      voskRec.audioContext.resume().catch(() => {});
    }
    const stalled = performance.now() - (voskRec.lastAudioMs || 0) > 7000;
    if (voskRec.trackDead || stalled) {
      console.warn('[vosk] heal: restarting —', voskRec.trackDead ? 'mic track dead' : 'audio pipeline stalled');
      if (!FACE_TRACKING) voskRec.externalStream = null;   // force a fresh getUserMedia
      voskRec.stop();
      setTimeout(() => voskRec.start(), 500);
    }
  }

  // Main-thread watchdog — works while the main thread is alive, but is the FIRST
  // thing throttled/killed under memory pressure (exactly when we need it). So it's
  // only the backup.
  setInterval(healSpeech, 5000);

  // Web Worker watchdog (the real fix): a Worker runs on its own thread with its
  // own timer that WKWebView does NOT throttle under memory pressure. It pings the
  // main thread every 2.5 s; the message wakes the main thread (re-JITs the handler
  // if it was dropped) and runs healSpeech — so even when the main-thread interval
  // is dead, the pipeline still gets nudged back to life. Built from a Blob so it
  // needs no separate bundled file / path (robust inside the Capacitor WKWebView).
  try {
    const workerSrc = 'var n=0;setInterval(function(){postMessage(++n);},2500);';
    const blobUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'application/javascript' }));
    const watchdog = new Worker(blobUrl);
    watchdog.onmessage = () => { try { healSpeech(); } catch (_) {} };
    console.log('[vosk] worker watchdog armed (2.5s ping)');
  } catch (e) {
    console.warn('[vosk] worker watchdog unavailable, relying on main-thread interval:', e?.message || e);
  }
}

/* ============================================================
 * Long-running stability: keep the iPad alive and recover from
 * background / context loss.
 * ============================================================ */

// 1. Wake Lock — prevent the iPad from auto-locking (iOS 16.4+).
//    Falls back silently on older versions.
let _wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    console.log('[wake] screen wake lock acquired');
  } catch (e) {
    console.warn('[wake] lock request failed:', e.message);
  }
}
requestWakeLock();

// 2. visibilitychange — when the iPad comes back from the home-screen
//    swipe or lock-screen unlock, refresh everything that suspends:
//      - AudioContext (iOS pauses it)
//      - SpeechRecognition (lost session)
//      - WakeLock (released on hide)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  console.log('[visibility] back to foreground — restoring');
  await requestWakeLock();
  if (audio) await audio.resume();
  if (speech && speech.active && !speech.isListening) {
    // Force a fresh session
    try { speech.stop(); } catch {}
    setTimeout(() => { try { speech.start(); } catch {} }, 200);
  }
});

// 3. WebGL context loss — if the GPU resets while we're backgrounded,
//    Three.js's renderer dies. Prevent default to allow recovery, then
//    soft-reload the page so all the pipelines re-init cleanly.
ui.canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.warn('[webgl] context lost — reloading in 1 s');
  setTimeout(() => location.reload(), 1000);
});

/* ---------- Settings panel (gear icon) ---------- */
(() => {
  const btn    = document.getElementById('settings-btn');
  const modal  = document.getElementById('settings-modal');
  const host   = document.getElementById('set-arduino-host');
  const rly    = document.getElementById('set-relay-host');
  const cam    = document.getElementById('set-camera');
  const face   = document.getElementById('set-face');
  const feat   = document.getElementById('set-features');
  const lang   = document.getElementById('set-lang');
  const av     = document.getElementById('set-avatar-url');
  const cancel = document.getElementById('set-cancel');
  const save   = document.getElementById('set-save');
  if (!btn || !modal) return;

  const fillCurrent = () => {
    host.value = localStorage.getItem('arduinoHost') || '192.168.4.1';
    rly.value  = localStorage.getItem('relayHost')   || '';
    cam.value  = localStorage.getItem('camDevice')   || '';
    face.value = localStorage.getItem('faceTracking') || '1';
    feat.value = localStorage.getItem('featuresDef') || 'both';
    lang.value = localStorage.getItem('speechLang')  || 'en-US';
    av.value   = localStorage.getItem('avatarUrl')   || '/3D_/ryu2.vrm';
  };

  btn.addEventListener('click', () => { fillCurrent(); modal.classList.add('open'); });
  cancel.addEventListener('click', () => modal.classList.remove('open'));

  // "Test Arduino" — one-shot GET /sensors against the IP in the field,
  // result shown inline so wiring problems surface before Save & reload.
  const testBtn = document.getElementById('set-test-arduino');
  const testOut = document.getElementById('set-test-result');
  testBtn?.addEventListener('click', async () => {
    const ip = (host.value.trim() || '192.168.4.1');
    testOut.textContent = 'testing http://' + ip + '/sensors …';
    testOut.style.color = '#777';
    try {
      const ctl = new AbortController();
      const tm  = setTimeout(() => ctl.abort(), 3000);
      const res = await fetch(`http://${ip}/sensors`, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(tm);
      const j   = await res.json();
      const ok  = j.sensors || {};
      const d   = (j.distance_mm != null) ? (j.distance_mm / 10).toFixed(0) + 'cm' : '—';
      const t   = (j.temp_c != null) ? j.temp_c + '°C' : '—';
      testOut.textContent =
        `✓ tof:${ok.tof ?? '?'} env:${ok.env ?? '?'}(${ok.env_chip || '?'}) rfid:${ok.rfid ?? '?'} · ${d} ${t}` +
        (j.book_present ? ` · book ${j.book_uid}` : '');
      testOut.style.color = '#7be0c9';
    } catch (e) {
      testOut.textContent = '✗ no reply from ' + ip + ' — check Wi-Fi + IP';
      testOut.style.color = '#ff6b6b';
    }
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
  save.addEventListener('click', () => {
    const ip = host.value.trim();
    if (ip) localStorage.setItem('arduinoHost', ip);
    else    localStorage.removeItem('arduinoHost');
    const rip = rly.value.trim();
    if (rip) localStorage.setItem('relayHost', rip);
    else     localStorage.removeItem('relayHost');
    const cv = cam.value.trim();
    if (cv) localStorage.setItem('camDevice', cv);
    else    localStorage.removeItem('camDevice');
    localStorage.setItem('faceTracking', face.value);
    localStorage.setItem('featuresDef', feat.value);
    localStorage.setItem('speechLang',  lang.value);
    if (av.value.trim()) localStorage.setItem('avatarUrl', av.value.trim());
    else localStorage.removeItem('avatarUrl');
    // Hot-swap the speech recogniser's language so the user doesn't always
    // need a page reload to test the other locale.
    try { speech?.setLang(lang.value); } catch {}
    // Rebuild URL with saved defaults so they survive a reload (especially
    // useful in the Capacitor bundle where there's no address bar).
    //   - ip empty       → sensors=mock (UI test)
    //   - ip configured  → sensors=1    (live HTTP poll of Arduino)
    const u = new URL(location.href);
    u.searchParams.set('mode',     u.searchParams.get('mode') || 'capture');
    u.searchParams.set('sensors',  '1');   // native deployment always polls the real Arduino
    u.searchParams.set('features', feat.value);
    if (av.value.trim()) u.searchParams.set('avatar', av.value.trim());
    location.href = u.toString();
  });
})();

// Load placeholder avatar immediately so something renders, then optionally
// swap in a URL-provided model in the background (large GLBs can take 10–30 s).
await avatarScene.setAvatar('placeholder');

if (AVATAR_URL) {
  (async () => {
    setStatus('loading avatar (0%)…', 'warn');
    try {
      await avatarScene.setAvatar('custom-url', AVATAR_URL, (loaded, total) => {
        const pct = Math.round((loaded / total) * 100);
        const mb  = (loaded / 1048576).toFixed(1);
        const tot = (total  / 1048576).toFixed(1);
        setStatus(`loading avatar ${pct}% (${mb}/${tot} MB)…`, 'warn');
      });
      const kind = avatarScene.avatar?.userData?.detectedKind || 'avatar';
      setStatus(`avatar ready (${kind})`, 'ok');
    } catch (e) {
      console.error('Avatar load failed:', e);
      setStatus('avatar load failed: ' + e.message, 'err');
    }
  })();
}

// 1-Euro filter for blendshapes.
// minCutoff 2.5: gentle smoothing that removes camera noise without lagging.
// beta 0.15: speed-adaptive — fast expressions (blink, jaw) pass through
//            with minimal delay; slow drifts get smoothed more.
const filter = new OneEuroDict({ minCutoff: 2.5, beta: 0.15, dCutoff: 1.0 });

let faceCap = null, poseCap = null;
let demo = null;
let frames = 0, lastFpsT = performance.now();

async function startCapture() {
  // Lightweight path (iPad default): NO camera, NO MediaPipe. The avatar
  // idle-animates and Vosk opens its own mic — far lighter for the week-long run.
  if (!FACE_TRACKING) {
    ui.video.style.display = 'none';
    if (voskRec) voskRec.start();           // own audio getUserMedia
    setStatus('ready', 'ok');
    return true;
  }
  setStatus('requesting camera…', 'warn');
  let stream;
  try {
    // Pick the camera: the Mac may have several (built-in FaceTime, external
    // UVC webcam, iPhone Continuity). Settings → Camera / ?cam= matches a
    // device-label substring; empty keeps the browser default.
    const videoConstraints = {
      width:  { ideal: _isCapacitorRuntime ? 320 : (LOWEND ? 480 : 640) },
      height: { ideal: _isCapacitorRuntime ? 240 : (LOWEND ? 360 : 480) },
      facingMode: 'user'
    };
    // Camera picking needs a throwaway permission-priming stream. On iOS a
    // second getUserMedia is exactly the double-open that used to black the
    // camera, so on Capacitor we only probe when a filter is explicitly set
    // (e.g. a future USB-C iPad with an external UVC camera).
    if (navigator.mediaDevices.enumerateDevices && (CAM_FILTER || !_isCapacitorRuntime)) {
      try {
        // Device labels are only exposed after a grant — prime with a throwaway stream.
        const probe = await navigator.mediaDevices.getUserMedia({ video: true });
        probe.getTracks().forEach((t) => t.stop());
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        console.log('[cam] available:', cams.map((c) => c.label || '(unnamed)').join(' | '));
        // Priority: explicit filter (Settings/?cam=) → any EXTERNAL camera
        // (auto: plugged-in USB/UVC wins over built-ins the moment it's
        // present, no config needed — works on the Mac today and on USB-C
        // iPads with iPadOS 17+ external-camera support) → system default.
        // iPhone Continuity / Desk View are never auto-picked (they come and
        // go with the phone); select them explicitly via the filter if wanted.
        let hit = null;
        if (CAM_FILTER) {
          hit = cams.find((c) => c.label.toLowerCase().includes(CAM_FILTER.toLowerCase()));
          if (!hit) console.warn(`[cam] no camera label matches "${CAM_FILTER}" — trying auto/external`);
        }
        if (!hit && cams.length > 1) {
          hit = cams.find((c) => c.label && !/facetime|built-in|integrated|front|back|iphone|continuity|desk view/i.test(c.label));
          if (hit) console.log('[cam] external camera detected — auto-selected');
        }
        if (hit) {
          delete videoConstraints.facingMode;          // deviceId is authoritative
          videoConstraints.deviceId = { exact: hit.deviceId };
          console.log('[cam] using:', hit.label);
        }
      } catch (e) {
        console.warn('[cam] device probe failed, using default:', e?.message || e);
      }
    }
    // Mic + camera in ONE call (two getUserMedia calls fight on iOS → black cam).
    const audioConstraints = _isCapacitorRuntime ? { echoCancellation: true, noiseSuppression: true, channelCount: 1 } : false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: videoConstraints });
    } catch (e) {
      if (!videoConstraints.deviceId) throw e;
      // The chosen camera enumerates but won't open (unplugged UVC ghost,
      // Continuity iPhone that walked away, device busy) — don't let a stale
      // Settings value brick face tracking AND the shared-mic speech path.
      console.warn('[cam] selected camera failed to open — falling back to default:', e?.message || e);
      delete videoConstraints.deviceId;
      videoConstraints.facingMode = 'user';
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: videoConstraints });
    }
  } catch (e) {
    setStatus('camera blocked: ' + e.message, 'err');
    return false;
  }
  ui.video.srcObject = stream;
  try { await ui.video.play(); } catch (e) { console.warn('[cam] preview play blocked:', e?.message || e); }
  if (voskRec) { voskRec.useStream(stream); voskRec.start(); }   // share the mic
  setStatus('loading MediaPipe…', 'warn');
  try {
    faceCap = await new FaceCapture().init();
    if (ui.tracker.value !== 'face') poseCap = await new PoseCapture().init();
    setStatus('tracking', 'ok');
  } catch (e) {
    // MediaPipe failing (GPU pressure, missing asset) must not kill the app —
    // speech is already wired to the shared stream; the avatar just idles.
    faceCap = null;
    console.warn('[face] MediaPipe init failed — idle avatar continues:', e?.message || e);
    setStatus('face tracking unavailable — idle mode', 'warn');
  }
  // Piggy-back the mic permission on the camera-allow gesture (iOS Safari
  // grants both prompts in sequence; user only sees a single flow). On
  // iPad `audio` is null because Web Speech takes the mic exclusively, so
  // we go straight to speech.start().
  if (isListen()) {
    if (audio) {
      const ok = await audio.start();
      if (ok && speech) {
        speechState.active = !!(await Promise.resolve(speech.start()));
        updateMoodBadge();
      }
    } else if (speech) {
      speechState.active = !!(await Promise.resolve(speech.start()));
      updateMoodBadge();
    }
  }
  return true;
}

ui.tracker.addEventListener('change', async () => {
  if (MODE !== 'capture') return;
  if (ui.tracker.value === 'face') { poseCap?.dispose(); poseCap = null; }
  else if (!poseCap) { setStatus('loading pose…', 'warn'); poseCap = await new PoseCapture().init(); setStatus('tracking', 'ok'); }
});

ui.layout.addEventListener('change', () => pyramid.setLayout(ui.layout.value));

ui.avatar.addEventListener('change', async () => {
  const v = ui.avatar.value;
  if (v === 'placeholder') await avatarScene.setAvatar('placeholder');
  else if (v === 'vrm-sample') {
    setStatus('loading sample VRM…', 'warn');
    try { await avatarScene.setAvatar('vrm-sample'); setStatus('avatar ready', 'ok'); }
    catch (e) { setStatus('VRM load failed: ' + e.message, 'err'); }
  } else if (v === 'custom') {
    ui.avatarFile.click();
  }
});

ui.avatarFile.addEventListener('change', async () => {
  const f = ui.avatarFile.files?.[0];
  if (!f) return;
  setStatus('loading custom VRM…', 'warn');
  try { await avatarScene.setAvatar('custom-file', f); setStatus('avatar ready', 'ok'); }
  catch (e) { setStatus('load failed: ' + e.message, 'err'); }
});

ui.fullscreen.addEventListener('click', () => {
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen();
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
});
ui.reload.addEventListener('click', () => location.reload());

/* ---------- Relay client ----------
 * Mac (external webcam + MediaPipe) → ws://<Mac>:8787 → iPad avatar mirrors
 * the visitor. The iPad's page host is capacitor://localhost, so the Mac's IP
 * must come from Settings → "Mac relay IP" (or ?relay=). Frames are accepted
 * in ANY mode as long as this device isn't face-tracking locally; when no
 * frames arrive for 1.5 s the avatar falls back to its idle animation, so the
 * installation keeps breathing even with the Mac switched off. */
let _lastRelayFrameMs = -Infinity;
// Plain ws:// to localhost even from https pages (mixed-content exempt);
// the relay server has no TLS, so wss only makes sense for a remote host.
const _relayProto = (location.protocol === 'https:' && !/^(localhost|127\.)/.test(RELAY_HOST)) ? 'wss' : 'ws';
const relay = new RelayClient(MODE, {
  url: RELAY_HOST ? `${_relayProto}://${RELAY_HOST}:8787` : undefined,
  onFrame: (frame) => {
    if (MODE === 'capture' && faceCap && ui.video.readyState >= 2) return;  // local camera wins
    _lastRelayFrameMs = performance.now();
    ui.latency.textContent = Math.round(performance.now() - frame.t);
    if (frame.b) avatarScene.applyBlendshapes(overlayMood(frame.b));
    if (frame.m) avatarScene.applyHeadTransform(new Float32Array(frame.m));
    if (frame.p) avatarScene.applyPose(frame.p);
  },
  onStatus: (s) => { console.log('[relay]', s); }
});
// On the iPad, "localhost" is the WKWebView itself — without a configured Mac
// relay IP there is nothing to connect to, and the 1.5 s reconnect loop would
// spin (and spam the console) for the whole week-long run. Browser dev keeps
// the default same-host relay for the Mac-capture mirror workflow.
if (!_isCapacitorRuntime || RELAY_HOST) relay.connect();
else console.log('[relay] skipped — no Mac relay IP configured (Settings → Mac relay IP)');

/* ---------- Capture mode boot ----------
 * NON-BLOCKING: boot must never gate the render loop. A pending iOS camera
 * permission dialog (or a slow MediaPipe init) used to stall this top-level
 * await — loop() never ran and the whole screen stayed black. The avatar now
 * idle-animates immediately; face tracking takes over whenever it's ready. */
if (MODE === 'capture') {
  startCapture()
    .then((ok) => { if (!ok) console.warn('Capture not started; idle avatar continues.'); })
    .catch((e) => {
      console.warn('[capture] failed — idle avatar continues:', e?.message || e);
      setStatus('camera unavailable — idle mode', 'warn');
    });
}

/* ---------- Demo mode boot (no webcam, procedural animation) ---------- */
if (MODE === 'demo') {
  demo = new DemoDriver();
  ui.video.style.display = 'none';
  setStatus('demo (procedural)', 'ok');
}

/* ---------- Main loop ---------- */
let lastLoopT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  if (now - lastLoopT < 30) return;   // ~33 fps cap — lighter GPU/CPU/heat for the week-long run
  const delta = Math.min((now - lastLoopT) / 1000, 0.1); // seconds, capped at 100 ms
  lastLoopT = now;

  // Decide which input source drives the avatar this frame.
  //   * local camera tracking a face     → its blendshapes win
  //   * fresh frames from the relay      → the remote Mac's camera drives us
  //     (applied in relay.onFrame; we just stay out of the way here)
  //   * neither                          → procedural idle breathing/blink
  const useCamera = isMirror() && MODE === 'capture' && faceCap && ui.video.readyState >= 2;
  const relayLive = !useCamera && (now - _lastRelayFrameMs < 1500);
  const useIdle   = !useCamera && !relayLive;

  if (useCamera) {
    const { blendshapes, transform } = faceCap.detect(ui.video, now);
    const tracker = ui.tracker.value;
    let pose = null, poseLm = null;
    if (poseCap && (tracker === 'pose' || tracker === 'holistic')) {
      const r = poseCap.detect(ui.video, now);
      if (r.landmarks) {
        pose   = { landmarks: r.landmarks, world: r.world || null };
        poseLm = r.landmarks;
      }
    }
    const smoothed = filter.apply(blendshapes, now / 1000);
    const overlaid = overlayMood(smoothed || {});
    if (smoothed && (tracker === 'face' || tracker === 'holistic')) avatarScene.applyBlendshapes(overlaid);
    if (transform) avatarScene.applyHeadTransform(transform);
    if (pose)   avatarScene.applyPose(pose);
    relay.sendFrame(smoothed, transform, poseLm);
  } else if (useIdle) {
    const src = (MODE === 'demo' && demo) ? demo : idleDriver;
    const { blendshapes, transform } = src.step();
    const smoothed = filter.apply(blendshapes, now / 1000);
    const overlaid = overlayMood(smoothed);
    avatarScene.applyBlendshapes(overlaid);
    avatarScene.applyHeadTransform(transform);
    // NOTE: idle frames are NOT sent to the relay — every device can generate
    // its own idle locally, and broadcasting them would fight the Mac's real
    // camera frames on the receiving iPad.
  }

  // Pull one mic sample per frame so the dashboard's dB bar updates smoothly.
  if (audio && isListen()) audio.sample();

  // Propagate normalized-bone rotations (head, neck, arms) to the actual VRM
  // skeleton and tick spring-bone physics. Must run after all apply* calls,
  // before pyramid.render(). Without this, head rotation has zero visual effect
  // because three-vrm's normalized bone nodes are virtual — changes only appear
  // after vrm.humanoid.update() is called.
  avatarScene.update(delta);

  pyramid.render();

  if (dashboard) dashboard.draw();

  // FPS counter
  frames++;
  if (now - lastFpsT >= 500) {
    ui.fps.textContent = Math.round((frames * 1000) / (now - lastFpsT));
    frames = 0;
    lastFpsT = now;
  }
}
loop();
