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

// ?debug=1 unhides the developer panels (FPS, tracker/layout dropdowns).
// In a normal app launch they stay hidden so the UI feels finished.
if (q.get('debug') === '1') document.body.classList.add('debug-on');
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
  dashboard = new Dashboard(document.getElementById('dashboard-canvas'), { audio, getSpeechState });
} else if (SENSORS_MODE === '1' || SENSORS_MODE === 'live') {
  initSensorsLive();
  dashboard = new Dashboard(document.getElementById('dashboard-canvas'), { audio, getSpeechState });
}

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
  if (uid && uid !== _bp.lastUid) { _bp.lastUid = uid; showBookPopup(uid); }
  else if (!uid && _bp.lastUid)   { _bp.lastUid = ''; hideBookPopup(); }
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

/* Offline text-to-speech: the librarian speaks its recommendation aloud.
   iOS speechSynthesis is on-device, so this works with no Wi-Fi. While it
   talks we mute the recogniser so it doesn't transcribe its own voice. */
let _ttsLast = 0;
let _lastPartialReco = 0;
function librarianSay(text) {
  try {
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

/* Speech callback: gets fired by SpeechRecognizer on every interim or
   final result. We update the dashboard state immediately, then on final
   results we re-run sentiment classification + book recommendation. */
function onSpeech(text, isFinal) {
  speechState.text      = text;
  speechState.textFinal = !!isFinal;
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
    { onState: (st) => {
        speechState.active    = st.listening;
        speechState.listening = st.listening;
        if (pttBtn) {
          pttBtn.classList.toggle('live',    st.status === 'listening');
          pttBtn.classList.toggle('loading', st.status === 'loading');
        }
        if (pttLabel) {
          pttLabel.textContent =
            st.status === 'loading'   ? 'Loading speech…'  :
            st.status === 'listening' ? 'Listening'        :
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
  const ensureOn = () => {
    if (voskRec.supported && voskRec.externalStream && !voskRec.listening && !voskRec.starting) voskRec.start();
  };
  // iOS often needs ONE user gesture to unlock audio; any tap during setup both
  // resumes a suspended AudioContext and (re)starts the recogniser.
  const kick = () => {
    if (voskRec.audioContext && voskRec.audioContext.state === 'suspended') voskRec.audioContext.resume().catch(() => {});
    ensureOn();
  };
  document.addEventListener('touchend', kick, { passive: true });
  document.addEventListener('click', kick);
  setInterval(ensureOn, 8000);   // watchdog
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
  const feat   = document.getElementById('set-features');
  const lang   = document.getElementById('set-lang');
  const av     = document.getElementById('set-avatar-url');
  const cancel = document.getElementById('set-cancel');
  const save   = document.getElementById('set-save');
  if (!btn || !modal) return;

  const fillCurrent = () => {
    host.value = localStorage.getItem('arduinoHost') || '192.168.4.1';
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
  setStatus('requesting camera…', 'warn');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      // Grab mic + camera in ONE call: video drives face-tracking, the audio
      // track is handed to Vosk. Two separate getUserMedia calls fight on iOS
      // and the camera goes black.
      audio: _isCapacitorRuntime ? { echoCancellation: true, noiseSuppression: true, channelCount: 1 } : false,
      video: {
        width:  { ideal: _isCapacitorRuntime ? 320 : (LOWEND ? 480 : 640) },
        height: { ideal: _isCapacitorRuntime ? 240 : (LOWEND ? 360 : 480) },
        facingMode: 'user'
      }
    });
    ui.video.srcObject = stream;
    await ui.video.play();
    // Share this stream's mic with the offline recogniser (continuous, hands-free).
    if (voskRec) { voskRec.useStream(stream); voskRec.start(); }
  } catch (e) {
    setStatus('camera blocked: ' + e.message, 'err');
    return false;
  }
  setStatus('loading MediaPipe…', 'warn');
  faceCap = await new FaceCapture().init();
  if (ui.tracker.value !== 'face') poseCap = await new PoseCapture().init();
  setStatus('tracking', 'ok');
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

/* ---------- Relay client ---------- */
const relay = new RelayClient(MODE, {
  onFrame: (frame) => {
    if (MODE !== 'display') return;
    const tNow = performance.now();
    ui.latency.textContent = Math.round(tNow - frame.t);
    if (frame.b) avatarScene.applyBlendshapes(frame.b);
    if (frame.m) avatarScene.applyHeadTransform(new Float32Array(frame.m));
    if (frame.p) avatarScene.applyPose(frame.p);
  },
  onStatus: (s) => { /* console.log(s); */ }
});
relay.connect();

/* ---------- Capture mode boot ---------- */
if (MODE === 'capture') {
  const ok = await startCapture();
  if (!ok) console.warn('Capture not started; renderer still alive for testing.');
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
  //   * Mirror mode  → camera blendshapes only
  //   * Listen mode  → idle procedural breathing/blink only (camera ignored)
  //   * Both         → camera blendshapes + idle as backup if camera not ready
  const useCamera = isMirror() && MODE === 'capture' && faceCap && ui.video.readyState >= 2;
  const useIdle   = !useCamera && (MODE === 'demo' || isListen() || (MODE === 'capture' && !useCamera));

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
    relay.sendFrame(smoothed, transform, null);
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
