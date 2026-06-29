/*
 * library_sensors.ino  —  HTTP-JSON sensor server  (v3, 3-sensor build)
 * =====================================================================
 * UCL CASA dissertation — Holographic Virtual Librarian
 *
 * FINAL DEPLOYMENT TOPOLOGY: no Mac in the loop.
 *
 *   [VL53L0X + BME/BMP280 + RC522] → MKR WiFi 1010 (HTTP :80) ←─ Wi-Fi ─→ iPad
 *
 * The iPad polls `GET http://<arduino>:80/sensors` once a second and gets
 * a small JSON blob. No MQTT, no broker, no laptop, no certificates.
 *
 * Wi-Fi modes (controlled by USE_AP):
 *   USE_AP = 0  → STATION mode: joins your home/lab Wi-Fi.
 *   USE_AP = 1  → ACCESS POINT mode: creates "VirtualLibrarian"; the iPad
 *                 joins it and reaches the Arduino at 192.168.4.1.
 *
 * Hardware (v3 — current build):
 *   Arduino MKR WiFi 1010
 *   HW-843 / VL53L0X ToF distance → I²C (SDA=11, SCL=12), addr 0x29
 *   BME280 or BMP280 temp(+hum)   → I²C, addr 0x76 or 0x77 (auto-detected;
 *                                   chip-ID 0x60 = BME280, 0x58 = BMP280)
 *   RC522 RFID reader             → SPI (MOSI=8, SCK=9, MISO=10),
 *                                   SS = D5, RST = D4   ⚠ 3.3 V only
 *   (TEMT6000 / PIR / OLED / WS2812B not connected in this build; the
 *    firmware degrades gracefully — missing sensors report null.)
 *
 * Required Arduino libraries (Library Manager):
 *   - WiFiNINA            by Arduino
 *   - VL53L0X             by Pololu          (NOT the VL53L1X one!)
 *   - Adafruit BME280 Library                (pulls in Adafruit Unified Sensor)
 *   - Adafruit BMP280 Library
 *   - MFRC522             by GithubCommunity (miguelbalboa)
 *
 * JSON shape (GET /sensors):
 *   {
 *     "distance_mm": 642,          // null if ToF missing / out of range
 *     "presence": 1,               // 1 = someone < PRESENCE_MM, 3 s latch
 *     "temp_c": 22.5,              // null if env sensor missing
 *     "humidity_pct": 41.2,        // null on BMP280 (no humidity)
 *     "pressure_hpa": 1012.3,
 *     "book_uid": "04A1B2C3",      // "" when no book on the reader
 *     "book_present": 0,
 *     "motion": 1,                 // compat alias of presence (old dashboard)
 *     "sensors": {"tof":1,"env":1,"rfid":1,"env_chip":"BME280"},
 *     "uptime_ms": 123456
 *   }
 *
 * Wi-Fi credentials in arduino_secrets.h.
 */

#include <WiFiNINA.h>
#include <Wire.h>
#include <SPI.h>
#include <VL53L0X.h>             // Pololu
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <Adafruit_BMP280.h>
#include <MFRC522.h>
#include "arduino_secrets.h"
//   #define WIFI_SSID    "your-wifi"
//   #define WIFI_PASS    "your-password"
//   #define AP_SSID      "VirtualLibrarian"
//   #define AP_PASS      "casa2026"        // ≥ 8 chars

// ── Build switches ─────────────────────────────────────────────────────
#define USE_AP 1                 // 0 = join Wi-Fi, 1 = create Wi-Fi
#define RFID_DEBUG 0             // 1 = print RC522 antenna/detection diagnostics every second
// ── Demo fallback ──────────────────────────────────────────────────────
// The HW-126 RC522 clone on this build has a weak/detuned antenna and cannot
// wake the Feiju ISO 14443-4 (IsoDep CPU) tag, so a book "present" is inferred
// from the working VL53L0X ToF instead: an object closer than TOF_BOOK_NEAR_MM
// reports TOF_BOOK_UID as book_uid, lighting up the iPad app's book pipeline.
#define TOF_BOOK_FALLBACK 1
#define TOF_BOOK_NEAR_MM  80     // tune to platform geometry (mm) — see [hb] dist=
static const char* TOF_BOOK_UID = "5357E918950001";  // demo sticker UID (phone NFC Tools)
// ── Field-loading book detection (no UID read) ─────────────────────────
// The RC522 can't decode this card, but a tag entering the coil still loads
// the RF field, so REQA stops timing out. We don't read the UID — we just
// sense "a tag is in the field" (REQA != TIMEOUT), debounce over 16 probes,
// and light up book_uid for the demo. Overrides the RFID/ToF paths.
#define FIELD_BOOK     1         // 1 = detect a book by RF field loading
#define FIELD_DEBUG    1         // 1 = print rolling hit count (tuning)
#define FIELD_PERIOD   100       // ms between field probes
#define FIELD_ON_HITS  12        // >= this many of last 16 probes saw a tag -> book ON
                                 // (card -> 16, a passing hand -> ~8, so 12 = clean margin)
#define FIELD_OFF_HITS 3         // <= this -> book OFF
const int HTTP_PORT = 80;

// ── Pins (MKR WiFi 1010) ───────────────────────────────────────────────
// I²C is fixed: SDA = 11, SCL = 12.  SPI is fixed: MOSI=8, SCK=9, MISO=10.
const int PIN_RFID_SS  = 5;      // RC522 SDA(SS)
const int PIN_RFID_RST = 4;      // RC522 RST  (D6 avoided: LED_BUILTIN)

// ── Behaviour constants ────────────────────────────────────────────────
const uint16_t      PRESENCE_MM     = 1000;  // closer than this = reader present
const unsigned long PRESENCE_HOLD   = 3000;  // ms latch after last close reading
const unsigned long BOOK_HOLD       = 3000;  // ms grace before "book removed"
const unsigned long TOF_PERIOD      = 200;   // ms between ToF reads
const unsigned long ENV_PERIOD      = 1000;  // ms between BME/BMP reads
const unsigned long RFID_PERIOD     = 300;   // ms between RFID polls

// ── Sensor objects + state ─────────────────────────────────────────────
WiFiServer server(HTTP_PORT);
unsigned long       lastHttpServed = 0;       // millis() of the last response sent (seeded at boot)
const unsigned long HTTP_WEDGE_MS  = 60000;   // no serve this long while polled => NINA wedge

VL53L0X         tof;
Adafruit_BME280 bme;
Adafruit_BMP280 bmp;
MFRC522         rfid(PIN_RFID_SS, PIN_RFID_RST);

bool   okTof  = false;
bool   okEnv  = false;            // BME280 or BMP280 found
bool   okRfid = false;
bool   envIsBme = false;          // true = BME280 (has humidity)

int           distanceMm   = -1;  // -1 = no valid reading
bool          presence     = false;
unsigned long lastClose    = 0;

float  tempC = NAN, humPct = NAN, presHpa = NAN;

String        bookUid      = "";
bool          bookPresent  = false;
unsigned long bookLastSeen = 0;

unsigned long tTof = 0, tEnv = 0, tRfid = 0;

// ── Helpers ────────────────────────────────────────────────────────────
void blink(int n, int ms = 80) {
  for (int i = 0; i < n; i++) {
    digitalWrite(LED_BUILTIN, HIGH); delay(ms);
    digitalWrite(LED_BUILTIN, LOW);  delay(ms);
  }
}

void startWiFiStation() {
  Serial.print("[wifi] joining "); Serial.println(WIFI_SSID);
  int tries = 0;
  while (WiFi.begin(WIFI_SSID, WIFI_PASS) != WL_CONNECTED) {
    Serial.print('.'); blink(1); delay(2000);
    if (++tries > 20) { Serial.println("\n[wifi] gave up; halting"); while (1) blink(3, 200); }
  }
  Serial.println();
  Serial.print("[wifi] OK ip=");   Serial.print(WiFi.localIP());
  Serial.print(" rssi=");          Serial.println(WiFi.RSSI());
}

void startWiFiAP() {
  Serial.print("[ap] creating SSID "); Serial.println(AP_SSID);
  // Bounded retry (NO WiFi.end — that call wedges the NINA). If beginAP keeps
  // failing, reboot clean rather than halt or hang. NINA is fresh after a
  // power-up, so the first try almost always succeeds.
  for (int tries = 0; tries < 8; tries++) {
    if (WiFi.beginAP(AP_SSID, AP_PASS) == WL_AP_LISTENING) {
      Serial.print("[ap] OK; iPad joins '"); Serial.print(AP_SSID);
      Serial.print("', gateway "); Serial.println(WiFi.localIP());
      return;
    }
    Serial.print("[ap] beginAP not ready, retry "); Serial.println(tries);
    blink(2, 150);
    delay(1500);
  }
  Serial.println("[ap] beginAP failed repeatedly — rebooting clean");
  delay(300);
  NVIC_SystemReset();
}

// ── Sensor init (each one optional — missing sensors just report null) ─
void initTof() {
  tof.setTimeout(100);
  if (tof.init()) {
    tof.startContinuous(TOF_PERIOD);     // background ranging
    okTof = true;
    Serial.println("[tof]  VL53L0X OK (0x29)");
  } else {
    Serial.println("[tof]  VL53L0X NOT FOUND — distance will be null");
  }
}

uint8_t readChipId(uint8_t addr) {
  Wire.beginTransmission(addr);
  Wire.write(0xD0);                      // chip-ID register (BMx280)
  if (Wire.endTransmission() != 0) return 0;
  Wire.requestFrom(addr, (uint8_t)1);
  return Wire.available() ? Wire.read() : 0;
}

void initEnv() {
  const uint8_t addrs[2] = { 0x76, 0x77 };
  for (uint8_t addr : addrs) {
    uint8_t id = readChipId(addr);
    if (id == 0x60) {                    // BME280 — temp + humidity + pressure
      if (bme.begin(addr)) {
        okEnv = true; envIsBme = true;
        Serial.print("[env]  BME280 OK at 0x"); Serial.println(addr, HEX);
        return;
      }
    } else if (id == 0x58) {             // BMP280 — temp + pressure, NO humidity
      if (bmp.begin(addr)) {
        okEnv = true; envIsBme = false;
        Serial.print("[env]  BMP280 OK at 0x"); Serial.print(addr, HEX);
        Serial.println("  (no humidity — board is BMP, not BME)");
        return;
      }
    }
  }
  Serial.println("[env]  BME/BMP280 NOT FOUND — temp/humidity will be null");
}

void initRfid() {
  SPI.begin();
  rfid.PCD_Init();
  rfid.PCD_SetAntennaGain(MFRC522::RxGain_max);  // some RC522 ship with low RX gain; max it out for reliable reads
  rfid.PCD_AntennaOn();
  // Self-test: version register reads 0x91/0x92 on a live RC522.
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (v == 0x91 || v == 0x92 || v == 0x88 || v == 0x90 || v == 0x82) {  // 0x82 = a clone chip seen on this build
    okRfid = true;
    Serial.print("[rfid] RC522 OK (version 0x"); Serial.print(v, HEX); Serial.println(")");
  } else {
    Serial.print("[rfid] RC522 NOT FOUND (version reg 0x"); Serial.print(v, HEX);
    Serial.println(") — book detection disabled");
  }
}

// ── Sensor polling (non-blocking, called from loop) ────────────────────
void pollTof() {
  if (!okTof || millis() - tTof < TOF_PERIOD) return;
  tTof = millis();
  uint16_t mm = tof.readRangeContinuousMillimeters();
  if (tof.timeoutOccurred() || mm > 4000) {
    distanceMm = -1;                     // out of range / nothing in front
  } else {
    distanceMm = mm;
    if (mm < PRESENCE_MM) lastClose = millis();
  }
  presence = (millis() - lastClose < PRESENCE_HOLD) && lastClose != 0;
}

void pollEnv() {
  if (!okEnv || millis() - tEnv < ENV_PERIOD) return;
  tEnv = millis();
  if (envIsBme) {
    tempC   = bme.readTemperature();
    humPct  = bme.readHumidity();
    presHpa = bme.readPressure() / 100.0f;
  } else {
    tempC   = bmp.readTemperature();
    humPct  = NAN;                       // BMP280 has no humidity sensor
    presHpa = bmp.readPressure() / 100.0f;
  }
}

String uidToHex(MFRC522::Uid* uid) {
  String s = "";
  for (byte i = 0; i < uid->size; i++) {
    if (uid->uidByte[i] < 0x10) s += "0";
    s += String(uid->uidByte[i], HEX);
  }
  s.toUpperCase();
  return s;
}

// A tag left sitting on the antenna goes to HALT state and stops answering
// REQA, so PICC_IsNewCardPresent() alone would report "book removed" while
// the book is still there. We wake halted tags with WUPA each poll.
bool cardStillThere() {
  byte atqa[2]; byte size = sizeof(atqa);
  MFRC522::StatusCode st = rfid.PICC_WakeupA(atqa, &size);
  if (st == MFRC522::STATUS_OK || st == MFRC522::STATUS_COLLISION) {
    rfid.PICC_HaltA();
    return true;
  }
  return false;
}

void pollRfid() {
  if (!okRfid || millis() - tRfid < RFID_PERIOD) return;
  tRfid = millis();

  if (!bookPresent) {
    // Looking for a new book.
    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      bookUid      = uidToHex(&rfid.uid);
      bookPresent  = true;
      bookLastSeen = millis();
      rfid.PICC_HaltA();
      Serial.print("[rfid] book ON  uid="); Serial.println(bookUid);
    }
  } else {
    // A book is on the desk — confirm it's still there.
    if (cardStillThere()) {
      bookLastSeen = millis();
    } else if (millis() - bookLastSeen > BOOK_HOLD) {
      Serial.print("[rfid] book OFF uid="); Serial.println(bookUid);
      bookPresent = false;
      bookUid     = "";
    }
  }
}

// Demo fallback: infer "a book is on the platform" from the ToF distance when the
// RC522 cannot read the tag. An object closer than TOF_BOOK_NEAR_MM latches the
// demo UID into book_uid (held BOOK_HOLD ms after it leaves), so the iPad app's
// existing book pipeline lights up exactly as if the tag had been read.
void pollBookFallback() {
  if (millis() - tRfid < RFID_PERIOD) return;
  tRfid = millis();
  static unsigned long tofSeen = 0;
  bool nearObj = (okTof && distanceMm >= 0 && distanceMm < TOF_BOOK_NEAR_MM);
  if (nearObj) tofSeen = millis();
  bool on = (tofSeen != 0) && (millis() - tofSeen < BOOK_HOLD);
  if (on && !bookPresent) {
    bookUid = TOF_BOOK_UID; bookPresent = true;
    Serial.print("[book] ON via ToF, uid="); Serial.println(bookUid);
  } else if (!on && bookPresent) {
    bookPresent = false; bookUid = "";
    Serial.println("[book] OFF via ToF");
  }
}

// Detect a book by RF FIELD LOADING (no UID read). Each probe forces a strong
// field and sends REQA; a tag in the coil perturbs the field so REQA returns
// something other than a clean TIMEOUT. We track the last 16 probes and latch
// book_uid on/off with hysteresis. This is what fires the demo on this build.
void pollBookByField() {
  static unsigned long tF = 0;
  static uint16_t hist = 0;
  if (!okRfid || millis() - tF < FIELD_PERIOD) return;
  tF = millis();
  rfid.PCD_WriteRegister(MFRC522::TxControlReg, 0x83);  // antenna on
  rfid.PCD_WriteRegister(MFRC522::GsNReg,   0xFF);       // strongest drive -> biggest
  rfid.PCD_WriteRegister(MFRC522::CWGsPReg, 0x3F);       // field perturbation to sense
  byte atqa[2]; byte sz = sizeof(atqa);
  MFRC522::StatusCode st = rfid.PICC_RequestA(atqa, &sz);
  bool saw = (st != MFRC522::STATUS_TIMEOUT);            // tag loaded the field
  hist = (uint16_t)((hist << 1) | (saw ? 1 : 0));
  int hits = __builtin_popcount((unsigned)hist);        // 0..16
  if (!bookPresent && hits >= FIELD_ON_HITS) {
    bookPresent = true; bookUid = TOF_BOOK_UID;
    Serial.println("[book] ON via field");
  } else if (bookPresent && hits <= FIELD_OFF_HITS) {
    bookPresent = false; bookUid = "";
    Serial.println("[book] OFF via field");
  }
#if FIELD_DEBUG
  static unsigned long tP = 0;
  if (millis() - tP > 250) {
    tP = millis();
    Serial.print("[field] hits16="); Serial.print(hits);
    Serial.print(" book=");          Serial.println(bookPresent);
  }
#endif
}

// ── HTTP ───────────────────────────────────────────────────────────────
void printNumOrNull(WiFiClient& c, float v, int decimals) {
  if (isnan(v)) c.print(F("null"));
  else          c.print(v, decimals);
}

void writeJSON(WiFiClient& client) {
  client.println(F("HTTP/1.1 200 OK"));
  client.println(F("Content-Type: application/json"));
  client.println(F("Access-Control-Allow-Origin: *"));   // CORS — iPad app needs this
  client.println(F("Access-Control-Allow-Methods: GET, OPTIONS"));
  client.println(F("Access-Control-Allow-Headers: *"));
  client.println(F("Cache-Control: no-store"));
  client.println(F("Connection: close"));
  client.println();

  client.print(F("{\"distance_mm\":"));
  if (distanceMm < 0) client.print(F("null")); else client.print(distanceMm);
  client.print(F(",\"presence\":"));      client.print(presence ? 1 : 0);
  client.print(F(",\"temp_c\":"));        printNumOrNull(client, tempC, 1);
  client.print(F(",\"humidity_pct\":"));  printNumOrNull(client, humPct, 1);
  client.print(F(",\"pressure_hpa\":"));  printNumOrNull(client, presHpa, 1);
  client.print(F(",\"book_uid\":\""));    client.print(bookUid); client.print(F("\""));
  client.print(F(",\"book_present\":"));  client.print(bookPresent ? 1 : 0);
  client.print(F(",\"motion\":"));        client.print(presence ? 1 : 0); // compat
  client.print(F(",\"sensors\":{\"tof\":")); client.print(okTof ? 1 : 0);
  client.print(F(",\"env\":"));           client.print(okEnv ? 1 : 0);
  client.print(F(",\"rfid\":"));          client.print(okRfid ? 1 : 0);
  client.print(F(",\"env_chip\":\""));
  client.print(okEnv ? (envIsBme ? F("BME280") : F("BMP280")) : F("none"));
  client.print(F("\"}"));
  client.print(F(",\"uptime_ms\":"));     client.print(millis());
  client.println(F("}"));
}

void writeNotFound(WiFiClient& client) {
  client.println(F("HTTP/1.1 404 Not Found"));
  client.println(F("Content-Type: text/plain"));
  client.println(F("Connection: close"));
  client.println();
  client.println(F("Try GET /sensors"));
}

// ── Arduino lifecycle ──────────────────────────────────────────────────
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);

  Serial.begin(115200);
  unsigned long s0 = millis();
  while (!Serial && millis() - s0 < 2000) {}
  Serial.println("\n[boot] library_sensors.ino v3 (VL53L0X + BME/BMP280 + RC522)");

  Wire.begin();
  initTof();
  initEnv();
  initRfid();
  Serial.print("[boot] sensors: tof=");  Serial.print(okTof);
  Serial.print(" env=");                 Serial.print(okEnv);
  Serial.print(" rfid=");                Serial.println(okRfid);

#if USE_AP
  startWiFiAP();
#else
  startWiFiStation();
#endif

  server.begin();
  lastHttpServed = millis();   // seed the wedge timer from boot
  Serial.print("[http] listening on http://");
  Serial.print(WiFi.localIP());
  Serial.print(":");
  Serial.print(HTTP_PORT);
  Serial.println("/sensors");
  blink(3);
}

void loop() {
  static unsigned long tHb = 0;
  bool hb = (millis() - tHb > 1000);
  if (hb) tHb = millis();
  pollTof();
  pollEnv();
#if FIELD_BOOK
  pollBookByField();
#elif TOF_BOOK_FALLBACK
  pollBookFallback();
#else
  pollRfid();
#endif
  if (hb) {
    Serial.print("[hb] dist="); Serial.print(distanceMm);
    Serial.print("mm book=");   Serial.print(bookPresent);
    Serial.print(" ip=");       Serial.println(WiFi.localIP());
  }

#if RFID_DEBUG
  static unsigned long tDbg = 0;
  if (millis() - tDbg > 200) {
    tDbg = millis();
    rfid.PCD_WriteRegister(MFRC522::TxControlReg, 0x83);   // clone won't hold AntennaOn -> force it
    rfid.PCD_WriteRegister(MFRC522::GsNReg,   0xFF);       // max n-driver conductance (carrier+mod)
    rfid.PCD_WriteRegister(MFRC522::CWGsPReg, 0x3F);       // max carrier p-driver -> strongest field
    bool got = false;
    // Try REQA path first, then WUPA (wakes a HALT-state card the phone poll may have left behind).
    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      got = true;
    } else {
      byte atqa[2]; byte s = sizeof(atqa);
      if (rfid.PICC_WakeupA(atqa, &s) == MFRC522::STATUS_OK && rfid.PICC_ReadCardSerial()) got = true;
    }
    if (got) {
      Serial.print("[READ] uid=");
      for (byte i = 0; i < rfid.uid.size; i++) {
        if (rfid.uid.uidByte[i] < 0x10) Serial.print('0');
        Serial.print(rfid.uid.uidByte[i], HEX);
      }
      Serial.print(" sak=0x"); Serial.println(rfid.uid.sak, HEX);
      rfid.PICC_HaltA();
    } else {
      static unsigned int misses = 0;
      if ((++misses & 0x0F) == 0) Serial.println("[try] still no read (move card to dead-centre, 0-5mm)");
    }
  }
#endif

  WiFiClient client = server.available();
  if (!client) return;

  digitalWrite(LED_BUILTIN, HIGH);

  // Read first line (e.g. "GET /sensors HTTP/1.1")
  String reqLine;
  unsigned long t0 = millis();
  while (client.connected() && millis() - t0 < 2000) {
    if (client.available()) {
      char c = client.read();
      if (c == '\n') break;
      if (c != '\r' && reqLine.length() < 200) reqLine += c;
    }
  }

  // Drain rest of headers (we don't need them)
  while (client.connected() && client.available()) {
    String line = client.readStringUntil('\n');
    if (line.length() <= 1) break;       // blank line ends headers
  }

  // Route
  if (reqLine.startsWith("GET /sensors") || reqLine.startsWith("GET / ")) {
    writeJSON(client);
  } else if (reqLine.startsWith("OPTIONS")) {
    // CORS pre-flight
    client.println(F("HTTP/1.1 204 No Content"));
    client.println(F("Access-Control-Allow-Origin: *"));
    client.println(F("Access-Control-Allow-Methods: GET, OPTIONS"));
    client.println(F("Access-Control-Allow-Headers: *"));
    client.println(F("Connection: close"));
    client.println();
  } else {
    writeNotFound(client);
  }

  lastHttpServed = millis();   // a client was served — server is healthy
  client.flush();
  delay(5);
  client.stop();
  digitalWrite(LED_BUILTIN, LOW);
}
