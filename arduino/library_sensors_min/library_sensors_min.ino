/*
 * library_sensors_min.ino — MINIMAL fallback build (ToF + RFID only)
 * ==================================================================
 * UCL CASA dissertation — Holographic Virtual Librarian
 *
 * Stripped to the smallest possible surface so we can isolate whether the
 * build failure is in the CODE or in the macOS SAMD TOOLCHAIN.
 *
 *   [VL53L0X + RC522] → MKR WiFi 1010 (HTTP :80) ←─ Wi-Fi ─→ iPad
 *
 * Removed vs v3: BME280, BMP280, Adafruit_Sensor (the heaviest deps).
 * Env fields (temp/humidity/pressure) are emitted as null so the iPad
 * app keeps working unchanged.
 *
 * Required libraries (Library Manager):
 *   - WiFiNINA   by Arduino
 *   - VL53L0X    by Pololu              (NOT the VL53L1X one)
 *   - MFRC522    by GithubCommunity     (miguelbalboa, v1.4.x — NOT MFRC522v2)
 *
 * Wi-Fi credentials in arduino_secrets.h (same file as the v3 build).
 */

#include <WiFiNINA.h>
#include <Wire.h>
#include <SPI.h>
#include <VL53L0X.h>
#include <MFRC522.h>
#include "arduino_secrets.h"

// ── Build switches ─────────────────────────────────────────────────────
#define USE_AP 1                 // 0 = join Wi-Fi, 1 = create Wi-Fi
const int HTTP_PORT = 80;

// ── Pins ───────────────────────────────────────────────────────────────
const int PIN_RFID_SS  = 5;
const int PIN_RFID_RST = 4;

// ── Behaviour ──────────────────────────────────────────────────────────
const uint16_t      PRESENCE_MM   = 1000;
const unsigned long PRESENCE_HOLD = 3000;
const unsigned long BOOK_HOLD     = 3000;
const unsigned long TOF_PERIOD    = 200;
const unsigned long RFID_PERIOD   = 300;

// ── State ──────────────────────────────────────────────────────────────
WiFiServer server(HTTP_PORT);
VL53L0X    tof;
MFRC522    rfid(PIN_RFID_SS, PIN_RFID_RST);

bool okTof = false, okRfid = false;
int  distanceMm = -1;
bool presence = false;
unsigned long lastClose = 0;

String        bookUid = "";
bool          bookPresent = false;
unsigned long bookLastSeen = 0;
unsigned long tTof = 0, tRfid = 0;

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
    if (++tries > 20) { Serial.println("\n[wifi] gave up"); while (1) blink(3, 200); }
  }
  Serial.println();
  Serial.print("[wifi] OK ip="); Serial.println(WiFi.localIP());
}

void startWiFiAP() {
  Serial.print("[ap] creating SSID "); Serial.println(AP_SSID);
  if (WiFi.beginAP(AP_SSID, AP_PASS) != WL_AP_LISTENING) {
    Serial.println("[ap] failed"); while (1) blink(3, 200);
  }
  Serial.print("[ap] OK gateway = "); Serial.println(WiFi.localIP()); // 192.168.4.1
}

void initTof() {
  tof.setTimeout(100);
  if (tof.init()) { tof.startContinuous(TOF_PERIOD); okTof = true;
    Serial.println("[tof]  VL53L0X OK"); }
  else Serial.println("[tof]  VL53L0X NOT FOUND");
}

void initRfid() {
  SPI.begin();
  rfid.PCD_Init();
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (v == 0x91 || v == 0x92 || v == 0x88 || v == 0x90) { okRfid = true;
    Serial.print("[rfid] RC522 OK 0x"); Serial.println(v, HEX); }
  else { Serial.print("[rfid] RC522 NOT FOUND 0x"); Serial.println(v, HEX); }
}

void pollTof() {
  if (!okTof || millis() - tTof < TOF_PERIOD) return;
  tTof = millis();
  uint16_t mm = tof.readRangeContinuousMillimeters();
  if (tof.timeoutOccurred() || mm > 4000) distanceMm = -1;
  else { distanceMm = mm; if (mm < PRESENCE_MM) lastClose = millis(); }
  presence = (millis() - lastClose < PRESENCE_HOLD) && lastClose != 0;
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

bool cardStillThere() {
  byte atqa[2]; byte size = sizeof(atqa);
  MFRC522::StatusCode st = rfid.PICC_WakeupA(atqa, &size);
  if (st == MFRC522::STATUS_OK || st == MFRC522::STATUS_COLLISION) {
    rfid.PICC_HaltA(); return true;
  }
  return false;
}

void pollRfid() {
  if (!okRfid || millis() - tRfid < RFID_PERIOD) return;
  tRfid = millis();
  if (!bookPresent) {
    if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
      bookUid = uidToHex(&rfid.uid); bookPresent = true; bookLastSeen = millis();
      rfid.PICC_HaltA();
      Serial.print("[rfid] book ON uid="); Serial.println(bookUid);
    }
  } else {
    if (cardStillThere()) bookLastSeen = millis();
    else if (millis() - bookLastSeen > BOOK_HOLD) {
      Serial.print("[rfid] book OFF uid="); Serial.println(bookUid);
      bookPresent = false; bookUid = "";
    }
  }
}

void writeJSON(WiFiClient& client) {
  client.println(F("HTTP/1.1 200 OK"));
  client.println(F("Content-Type: application/json"));
  client.println(F("Access-Control-Allow-Origin: *"));
  client.println(F("Access-Control-Allow-Methods: GET, OPTIONS"));
  client.println(F("Access-Control-Allow-Headers: *"));
  client.println(F("Cache-Control: no-store"));
  client.println(F("Connection: close"));
  client.println();
  client.print(F("{\"distance_mm\":"));
  if (distanceMm < 0) client.print(F("null")); else client.print(distanceMm);
  client.print(F(",\"presence\":"));      client.print(presence ? 1 : 0);
  client.print(F(",\"temp_c\":null"));
  client.print(F(",\"humidity_pct\":null"));
  client.print(F(",\"pressure_hpa\":null"));
  client.print(F(",\"book_uid\":\""));    client.print(bookUid); client.print(F("\""));
  client.print(F(",\"book_present\":"));  client.print(bookPresent ? 1 : 0);
  client.print(F(",\"motion\":"));        client.print(presence ? 1 : 0);
  client.print(F(",\"sensors\":{\"tof\":")); client.print(okTof ? 1 : 0);
  client.print(F(",\"env\":0,\"rfid\":"));   client.print(okRfid ? 1 : 0);
  client.print(F(",\"env_chip\":\"none\"}"));
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

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  unsigned long s0 = millis();
  while (!Serial && millis() - s0 < 2000) {}
  Serial.println("\n[boot] library_sensors_min (VL53L0X + RC522)");

  Wire.begin();
  initTof();
  initRfid();

#if USE_AP
  startWiFiAP();
#else
  startWiFiStation();
#endif

  server.begin();
  Serial.print("[http] http://"); Serial.print(WiFi.localIP());
  Serial.println(":80/sensors");
  blink(3);
}

void loop() {
  pollTof();
  pollRfid();

  WiFiClient client = server.available();
  if (!client) return;
  digitalWrite(LED_BUILTIN, HIGH);

  String reqLine;
  unsigned long t0 = millis();
  while (client.connected() && millis() - t0 < 2000) {
    if (client.available()) {
      char c = client.read();
      if (c == '\n') break;
      if (c != '\r' && reqLine.length() < 200) reqLine += c;
    }
  }
  while (client.connected() && client.available()) {
    String line = client.readStringUntil('\n');
    if (line.length() <= 1) break;
  }

  if (reqLine.startsWith("GET /sensors") || reqLine.startsWith("GET / ")) writeJSON(client);
  else if (reqLine.startsWith("OPTIONS")) {
    client.println(F("HTTP/1.1 204 No Content"));
    client.println(F("Access-Control-Allow-Origin: *"));
    client.println(F("Access-Control-Allow-Methods: GET, OPTIONS"));
    client.println(F("Access-Control-Allow-Headers: *"));
    client.println(F("Connection: close"));
    client.println();
  } else writeNotFound(client);

  client.flush();
  delay(5);
  client.stop();
  digitalWrite(LED_BUILTIN, LOW);
}
