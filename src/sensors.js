// MQTT sensor subscription for the library dashboard.
//
// Mac runs Mosquitto on :1883 (TCP, for Arduino) + :9001 (WS, for browser).
// Vite proxies wss://<mac>:5173/mqtt → ws://127.0.0.1:9001 so the iPad,
// loaded over HTTPS, can subscribe without mixed-content errors.
//
// Enable in the URL: ?sensors=1   (live MQTT)
//                    ?sensors=mock (synthetic data, no broker needed)
//
// mqtt.js is loaded via <script> in index.html as global `mqtt`.

// Topics the Arduino MKR publishes. Current hardware build: TEMT6000
// (light) + HC-SR501 (motion). Sound is captured on the iPad directly.
const TOPICS = {
  'ucl/library/dissertation/lux':       'lux',
  'ucl/library/dissertation/lux_raw':   'luxRaw',
  'ucl/library/dissertation/motion':    'motion',
};

const MAX_HISTORY = 120; // 2 minutes of 1 Hz samples

const state = {
  connected: false,
  source:    'none',           // 'arduino-http' | 'mock' | 'none'
  lastUpdate: 0,
  // legacy fields (TEMT6000/PIR build) — kept for back-compat, null in v3
  lux: null, luxRaw: null, motion: null,
  // v3 fields (VL53L0X + BME/BMP280 + RC522)
  distanceCm: null,            // VL53L0X, converted mm → cm
  presence:   null,            // 1 = reader within 1 m (3 s latch on Arduino)
  tempC:      null,            // BME/BMP280
  humidity:   null,            // null on BMP280 boards (no humidity sensor)
  pressure:   null,            // hPa
  bookUid:    '',              // RC522 — NTAG213 sticker UID, '' = no book
  bookPresent: null,
  sensorsOk:  null,            // {tof, env, rfid, env_chip} self-test from Arduino
  history: { lux: [], distanceCm: [], tempC: [] },
};

export function getSensorState() { return state; }

function pushHistory(key, v) {
  const h = state.history[key];
  if (!h) return;
  h.push(v);
  if (h.length > MAX_HISTORY) h.shift();
}

/**
 * Connect directly to the Arduino MKR WiFi 1010's HTTP server.
 *
 *   GET http://<arduino-ip>:80/sensors  →  { lux, lux_raw, motion, uptime_ms }
 *
 * We poll once per second. Three consecutive failures flip the dashboard
 * indicator to "waiting" so users notice the Arduino has dropped off.
 *
 * Defaults:
 *   * If the user has saved an "arduinoHost" in the in-app Settings, use it.
 *   * Otherwise fall back to 192.168.4.1 (the gateway IP when the Arduino
 *     runs in Access-Point mode and the iPad joins its "VirtualLibrarian"
 *     network — see USE_AP in library_sensors.ino).
 */
function defaultArduinoHost() {
  const saved = (localStorage.getItem('arduinoHost') || '').trim();
  return saved || '192.168.4.1';
}

export function initSensorsLive({ host, period = 1000 } = {}) {
  const target = `http://${host || defaultArduinoHost()}/sensors`;
  state.source = 'arduino-http';
  console.log('[sensors] arduino http poll →', target);

  let consecutiveFailures = 0;
  const tick = async () => {
    try {
      const ctl = ('AbortController' in window) ? new AbortController() : null;
      const tm  = ctl && setTimeout(() => ctl.abort(), 1500);
      const res = await fetch(target, { cache: 'no-store', signal: ctl?.signal });
      if (tm) clearTimeout(tm);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      // legacy fields (null on the v3 firmware — no TEMT6000/PIR wired)
      state.lux    = (typeof j.lux === 'number') ? j.lux : null;
      state.luxRaw = (typeof j.lux_raw === 'number') ? j.lux_raw : null;
      state.motion = (typeof j.motion === 'number') ? j.motion : null;
      // v3 fields
      state.distanceCm  = (typeof j.distance_mm === 'number') ? j.distance_mm / 10 : null;
      state.presence    = (typeof j.presence === 'number') ? j.presence : null;
      state.tempC       = (typeof j.temp_c === 'number') ? j.temp_c : null;
      state.humidity    = (typeof j.humidity_pct === 'number') ? j.humidity_pct : null;
      state.pressure    = (typeof j.pressure_hpa === 'number') ? j.pressure_hpa : null;
      state.bookUid     = (typeof j.book_uid === 'string') ? j.book_uid : '';
      state.bookPresent = (typeof j.book_present === 'number') ? j.book_present : null;
      state.sensorsOk   = j.sensors || null;
      state.connected  = true;
      state.lastUpdate = performance.now();
      if (state.lux != null)        pushHistory('lux', state.lux);
      if (state.distanceCm != null) pushHistory('distanceCm', state.distanceCm);
      if (state.tempC != null)      pushHistory('tempC', state.tempC);
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) state.connected = false;
    }
  };
  tick();                              // first poll immediately
  const id = setInterval(tick, period);
  return { stop() { clearInterval(id); } };
}

/* Mock driver: smoothly varying values so the dashboard is animated even
   before the Arduino is wired. Useful for demoing the dashboard to the
   supervisor early. */
export function initSensorsMock() {
  state.source    = 'mock';
  state.connected = true;
  const t0 = performance.now();
  const MOCK_UIDS = ['', '', '04A1B2C3', ''];   // mostly empty, sometimes a book
  setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    // v3 mock: a "reader" walks up, sits ~45 cm away, leaves again.
    const near = Math.sin(t / 23) > -0.2;
    state.distanceCm  = near ? 45 + Math.sin(t / 3) * 8 : 180 + Math.sin(t / 5) * 15;
    state.presence    = near ? 1 : 0;
    state.tempC       = 21.5 + Math.sin(t / 47) * 1.5;
    state.humidity    = 42 + Math.sin(t / 31) * 6;
    state.pressure    = 1012 + Math.sin(t / 90) * 3;
    const uid = MOCK_UIDS[Math.floor(t / 25) % MOCK_UIDS.length];
    state.bookUid     = uid;
    state.bookPresent = uid ? 1 : 0;
    state.motion      = state.presence;   // legacy alias
    state.sensorsOk   = { tof: 1, env: 1, rfid: 1, env_chip: 'BME280' };
    state.lastUpdate = performance.now();
    pushHistory('distanceCm', state.distanceCm);
    pushHistory('tempC', state.tempC);
  }, 1000);
}
