// Dashboard panel — Canvas 2D rendered alongside the Pepper's-Ghost area.
//
// Sources of truth:
//   * getSensorState()   — Arduino MQTT values  (temp / humidity / lux / motion)
//   * audio.db           — iPad mic level       (sound dB-ish, smoothed)
//   * speech state       — last transcript, mood, recommended book
//
// Drawn with a soft semi-transparent background and accent-green strokes so
// it stays visually consistent with the HUD + the Pepper's-Ghost theme.

import { getSensorState } from './sensors.js';
import { bookByUid } from './bookDb.js';

// Current Arduino build (v3): VL53L0X (distance) + BME/BMP280 (temp/hum)
// + RC522 (book RFID). Rows whose value is null render as "—", so this
// list is safe even when a sensor is missing (e.g. humidity on BMP280).
const ROWS_ARDUINO = [
  { key: 'distanceCm', label: 'Distance', unit: 'cm', decimals: 0 },
  { key: 'tempC',      label: 'Temp',     unit: '°C', decimals: 1 },
  { key: 'humidity',   label: 'Humidity', unit: '%',  decimals: 0 },
];

export class Dashboard {
  /**
   * @param {HTMLCanvasElement} canvasEl
   * @param {{ audio?: import('./audio.js').AudioCapture, getSpeechState?: () => any }} ctx
   */
  constructor(canvasEl, ctx = {}) {
    this.canvas = canvasEl;
    this.ctx2   = canvasEl.getContext('2d');
    this.audio  = ctx.audio || null;
    this.getSpeechState = ctx.getSpeechState || (() => null);
    // Exhibition layout: recommendations render in their own right-side HTML
    // panel (never over the avatar), so the dashboard can omit its copy.
    this.hideSuggestions = !!ctx.hideSuggestions;
    this._fit   = this._fit.bind(this);
    window.addEventListener('resize', this._fit);
    this._fit();
  }

  _fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.canvas.width  = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw() {
    const s   = getSensorState();
    const ctx = this.ctx2;
    const w   = this.canvas.clientWidth;
    const h   = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    ctx.clearRect(0, 0, w, h);

    let y = 22;

    // ---- Header ----
    ctx.font      = '600 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#e8e8e8';
    ctx.fillText('Library Sensors', 14, y);
    y += 18;
    ctx.font      = '11px ui-monospace, Menlo, monospace';
    ctx.fillStyle = s.connected ? '#7be0c9' : '#f5b169';
    ctx.fillText(
      s.connected ? `Arduino · ${s.source}` : `Arduino · waiting (${s.source})`,
      14, y,
    );
    y += 18;

    // ---- Arduino rows (temp / humidity / light) ----
    const rowH = 52;
    ROWS_ARDUINO.forEach((row) => {
      const val = s[row.key];
      ctx.font      = '11px -apple-system, sans-serif';
      ctx.fillStyle = '#888';
      ctx.fillText(row.label, 14, y);
      ctx.font      = '600 20px -apple-system, sans-serif';
      ctx.fillStyle = val == null ? '#444' : '#e8e8e8';
      const valStr  = val == null ? '—' : val.toFixed(row.decimals);
      ctx.fillText(valStr, 14, y + 22);
      ctx.font      = '11px -apple-system, sans-serif';
      ctx.fillStyle = '#666';
      const vw = ctx.measureText(valStr).width;
      ctx.fillText(' ' + row.unit, 14 + vw + 4, y + 22);
      // sparkline (right-aligned)
      const sx = 110, sy = y + 4, sw = w - 14 - sx, sh = 22;
      this._spark(s.history[row.key], sx, sy, sw, sh);
      y += rowH;
    });

    // Presence pill (VL53L0X-driven; falls back to legacy PIR `motion`)
    const present = s.presence != null ? s.presence === 1 : s.motion === 1;
    ctx.fillStyle = present ? '#7be0c9' : '#333';
    ctx.beginPath(); ctx.arc(20, y + 4, 5, 0, Math.PI * 2); ctx.fill();
    ctx.font      = '11px -apple-system, sans-serif';
    ctx.fillStyle = present ? '#e8e8e8' : '#666';
    ctx.fillText(present ? 'Reader present' : 'No reader', 32, y + 8);
    y += 22;

    // Book-on-desk pill (RC522 RFID)
    const hasBook = s.bookPresent === 1 && s.bookUid;
    ctx.fillStyle = hasBook ? '#f5b169' : '#333';
    ctx.beginPath(); ctx.arc(20, y + 4, 5, 0, Math.PI * 2); ctx.fill();
    ctx.font      = '11px -apple-system, sans-serif';
    ctx.fillStyle = hasBook ? '#e8e8e8' : '#666';
    if (hasBook) {
      const b = bookByUid(s.bookUid);
      this._wrap('Reading: ' + (b && !b.unknown ? b.title : 'tag ' + s.bookUid), 32, y + 8, w - 46, 14, 1);
    } else {
      ctx.fillText('No book on desk', 32, y + 8);
    }
    y += 22;

    // ---- Divider ----
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(w - 14, y); ctx.stroke();
    y += 16;

    // ---- iPad audio (sound level from mic) ----
    ctx.font      = '600 13px -apple-system, sans-serif';
    ctx.fillStyle = '#e8e8e8';
    ctx.fillText('Heard on iPad', 14, y);
    y += 18;

    // ---- Sound dB bar (restored — audio.js is back on) ----
    const db = this.audio ? this.audio.db : null;
    ctx.font      = '11px -apple-system, sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('Sound', 14, y);
    ctx.font      = '600 20px -apple-system, sans-serif';
    ctx.fillStyle = db == null ? '#444' : '#e8e8e8';
    const dbStr   = db == null ? '—' : db.toFixed(0);
    ctx.fillText(dbStr, 14, y + 22);
    ctx.font      = '11px -apple-system, sans-serif';
    ctx.fillStyle = '#666';
    const dvw = ctx.measureText(dbStr).width;
    ctx.fillText(' dB', 14 + dvw + 4, y + 22);
    if (db != null) {
      const barX = 110, barY = y + 12, barW = w - 14 - barX, barH = 8;
      const fill = Math.max(0, Math.min(1, (db - 20) / 60));
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = fill < 0.5 ? '#7be0c9' : fill < 0.8 ? '#f5b169' : '#ff6b6b';
      ctx.fillRect(barX, barY, barW * fill, barH);
    }
    y += rowH;

    // ---- Last transcribed sentence ----
    const sp = this.getSpeechState() || {};
    ctx.font      = '11px -apple-system, sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('Last heard', 14, y);
    y += 14;
    if (sp.text) {
      // Final results = solid white, interim = italic dim-green so you can
      // see the recogniser is mid-sentence in real time.
      const isFinal = !!sp.textFinal;
      ctx.font      = (isFinal ? '13px' : 'italic 13px') + ' -apple-system, sans-serif';
      ctx.fillStyle = isFinal ? '#e8e8e8' : '#7be0c9';
      this._wrap(sp.text, 14, y, w - 28, 16, 2);
    } else {
      ctx.font      = 'italic 13px -apple-system, sans-serif';
      // Smarter fallback:
      //   - not active        → user hasn't picked Listen/Both
      //   - sessions but no results in ≥ 5 attempts → likely no network
      //     for cloud STT, or wrong language pack not installed
      //   - listening right now → mid-utterance
      //   - between sessions   → recogniser is restarting
      // Offline Vosk recogniser — never "needs Wi-Fi".
      let msg;
      if (sp.listening)    { msg = 'listening — say a topic'; ctx.fillStyle = '#7be0c9'; }
      else if (!sp.active) { msg = 'starting speech…';        ctx.fillStyle = '#888'; }
      else                 { msg = 'ready — say a topic';     ctx.fillStyle = '#888'; }
      ctx.fillText(msg, 14, y);
    }
    y += 32;

    // Tiny diagnostics line — sessions started + results received + age of
    // the last result. This makes invisible failures visible immediately.
    ctx.font      = '10px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#555';
    const age = sp.lastResultMs ? Math.max(0, Math.round((performance.now() - 0) - (sp.lastResultMs - 0))) : 0;
    const ageSec = sp.lastResultMs
      ? Math.round((Date.now() - sp.lastResultMs) / 1000) + 's ago'
      : '—';
    ctx.fillText(
      `sessions ${sp.sessionCount || 0} · results ${sp.resultCount || 0} · last ${ageSec}`,
      14, y);
    y += 14;

    // ---- Divider ----
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(w - 14, y); ctx.stroke();
    y += 16;

    // ---- Two-track recommendations: BOOK from speech, FILM from sensors ----
    const drawRec = (header, item, glyph, creditPrefix, fallbackHint, matchLabel) => {
      ctx.font      = '600 13px -apple-system, sans-serif';
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(header, 14, y);
      y += 18;
      if (item) {
        ctx.font      = '14px -apple-system, sans-serif';
        ctx.fillStyle = '#7be0c9';
        ctx.fillText(glyph, 14, y);
        ctx.font      = '600 14px -apple-system, sans-serif';
        ctx.fillStyle = '#7be0c9';
        this._wrap(item.title, 36, y, w - 50, 17, 2);
        y += 36;
        ctx.font      = '12px -apple-system, sans-serif';
        ctx.fillStyle = '#888';
        ctx.fillText(creditPrefix + (item.creator || item.author || ''), 14, y);
        y += 18;
        if (item.matchedTopics?.length) {
          ctx.font      = '10px ui-monospace, Menlo, monospace';
          ctx.fillStyle = '#555';
          ctx.fillText(matchLabel + ' ' + item.matchedTopics.join(', '), 14, y);
          y += 16;
        }
      } else {
        ctx.font      = 'italic 12px -apple-system, sans-serif';
        ctx.fillStyle = '#555';
        ctx.fillText(fallbackHint, 14, y);
        y += 18;
      }
    };

    if (!this.hideSuggestions) {
      drawRec(
        'Suggested book (from speech)',
        sp.book,
        '📖', 'by ',
        'Speak a topic to get a book suggestion.',
        'match:',
      );

      // small divider
      y += 8;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(w - 14, y); ctx.stroke();
      y += 12;

      drawRec(
        'Suggested film (from environment)',
        sp.film,
        '🎬', 'dir. ',
        'Waiting for sensors…',
        'ambient mood:',
      );
    }

    // ---- Mood pill (bottom) ----
    const mood = sp.mood || 'neutral';
    const moodColor = mood === 'happy'   ? '#7be0c9'
                    : mood === 'sad'     ? '#7aa8ff'
                    : mood === 'thinking'? '#f5b169'
                                         : '#666';
    ctx.fillStyle = moodColor;
    ctx.beginPath(); ctx.arc(20, h - 22, 5, 0, Math.PI * 2); ctx.fill();
    ctx.font      = '11px -apple-system, sans-serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText('Mood: ' + mood, 32, h - 18);
  }

  _spark(arr, x, y, w, h) {
    if (!arr || arr.length < 2 || w < 10 || h < 4) return;
    const ctx = this.ctx2;
    let min = Infinity, max = -Infinity;
    for (const v of arr) { if (v < min) min = v; if (v > max) max = v; }
    if (!isFinite(min) || !isFinite(max)) return;
    const range = (max - min) || 1;
    ctx.beginPath();
    arr.forEach((v, i) => {
      const px = x + (i / (arr.length - 1)) * w;
      const py = y + h - ((v - min) / range) * h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = '#7be0c9';
    ctx.lineWidth   = 1.2;
    ctx.stroke();
  }

  _wrap(text, x, y, maxW, lineH, maxLines) {
    if (!text) return;
    const ctx   = this.ctx2;
    const words = String(text).split(/\s+/);
    let line = '', lines = 0;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW) {
        ctx.fillText(line, x, y);
        y += lineH; lines++;
        line = w;
        if (lines >= maxLines - 1) {
          while (ctx.measureText(line + '…').width > maxW && line.length > 0) line = line.slice(0, -1);
          ctx.fillText(line + '…', x, y); return;
        }
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }
}
