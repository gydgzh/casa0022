/*
 * library_sensors.ino  —  HTTP-JSON sensor server
 * ================================================
 * UCL CASA dissertation — Holographic Virtual Librarian
 *
 * FINAL DEPLOYMENT TOPOLOGY: no Mac in the loop.
 *
 *   [TEMT6000 + PIR] → MKR WiFi 1010 (HTTP :80) ←─ Wi-Fi ─→ iPad app
 *
 * The iPad's app polls `GET http://<arduino>:80/sensors` once a second.
 * The Arduino answers a small JSON blob and immediately closes the
 * connection. No MQTT, no broker, no laptop, no certificates.
 *
 * Wi-Fi modes (controlled by USE_AP):
 *   USE_AP = 0  → STATION mode: joins your home/lab Wi-Fi network. Print
 *                 the IP that DHCP gives you on Serial Monitor; type that
 *                 IP into the iPad app's Settings ▸ Arduino IP field.
 *   USE_AP = 1  → ACCESS POINT mode: the Arduino *creates* a Wi-Fi
 *                 network called "VirtualLibrarian". iPad joins that
 *                 network and reaches the Arduino at 192.168.4.1.
 *                 Use this at exhibitions / wherever you can't predict
 *                 the venue network. iPad has no internet in this mode.
 *
 * Hardware (current build):
 *   Arduino MKR WiFi 1010
 *   TEMT6000 ambient light  →  3V3 + A0
 *   HC-SR501 PIR            →  5V  + D2
 *
 * Required Arduino libraries (Library Manager):
 *   - WiFiNINA            by Arduino  (only library needed)
 *
 * Wi-Fi credentials in arduino_secrets.h.
 */

#include <WiFiNINA.h>
#include "arduino_secrets.h"
//   #define WIFI_SSID    "your-wifi"
//   #define WIFI_PASS    "your-password"
//   #define AP_SSID      "VirtualLibrarian"
//   #define AP_PASS      "casa2026"        // ≥ 8 chars

// ── Build switches ─────────────────────────────────────────────────────
#define USE_AP 0                 // 0 = join Wi-Fi, 1 = create Wi-Fi
const int  HTTP_PORT  = 80;

// ── Pins ───────────────────────────────────────────────────────────────
const int  PIN_LIGHT  = A0;
const int  PIN_PIR    = 2;

// ── Calibration (see wiring.txt for the maths) ─────────────────────────
const float ADC_VREF  = 3.3f;
const float ADC_FS    = 1023.0f;
const float LUX_COEFF = 2000.0f;

// ── Globals ────────────────────────────────────────────────────────────
WiFiServer server(HTTP_PORT);
unsigned long lastMotion  = 0;
bool          motionLatched = false;

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
  int status = WiFi.beginAP(AP_SSID, AP_PASS);
  if (status != WL_AP_LISTENING) {
    Serial.println("[ap] failed; halting"); while (1) blink(3, 200);
  }
  Serial.print("[ap] OK; iPad should connect to '"); Serial.print(AP_SSID); Serial.println("'");
  Serial.print("[ap] gateway IP = "); Serial.println(WiFi.localIP());  // typically 192.168.4.1
}

float sampleLux() {
  int s[5];
  for (int i = 0; i < 5; i++) { s[i] = analogRead(PIN_LIGHT); delay(2); }
  for (int i = 1; i < 5; i++) {
    int x = s[i], j = i - 1;
    while (j >= 0 && s[j] > x) { s[j + 1] = s[j]; j--; }
    s[j + 1] = x;
  }
  float voltage = s[2] * ADC_VREF / ADC_FS;
  return voltage * LUX_COEFF;
}

void updateMotion() {
  if (digitalRead(PIN_PIR) == HIGH) { lastMotion = millis(); motionLatched = true; }
  if (motionLatched && millis() - lastMotion > 3000) motionLatched = false;
}

void writeJSON(WiFiClient& client) {
  float lux  = sampleLux();
  int   raw  = analogRead(PIN_LIGHT);
  int   mot  = motionLatched ? 1 : 0;
  unsigned long up = millis();

  client.println(F("HTTP/1.1 200 OK"));
  client.println(F("Content-Type: application/json"));
  client.println(F("Access-Control-Allow-Origin: *"));   // CORS — iPad app needs this
  client.println(F("Access-Control-Allow-Methods: GET, OPTIONS"));
  client.println(F("Access-Control-Allow-Headers: *"));
  client.println(F("Cache-Control: no-store"));
  client.println(F("Connection: close"));
  client.println();
  client.print(F("{\"lux\":"));      client.print(lux, 1);
  client.print(F(",\"lux_raw\":"));  client.print(raw);
  client.print(F(",\"motion\":"));   client.print(mot);
  client.print(F(",\"uptime_ms\":")); client.print(up);
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
  pinMode(PIN_PIR, INPUT);
  analogReadResolution(10);

  Serial.begin(115200);
  unsigned long s0 = millis();
  while (!Serial && millis() - s0 < 2000) {}
  Serial.println("\n[boot] library_sensors.ino  (HTTP server build)");

#if USE_AP
  startWiFiAP();
#else
  startWiFiStation();
#endif

  server.begin();
  Serial.print("[http] listening on http://");
  Serial.print(WiFi.localIP());
  Serial.print(":");
  Serial.print(HTTP_PORT);
  Serial.println("/sensors");
  blink(3);
}

void loop() {
  updateMotion();

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

  client.flush();
  delay(5);
  client.stop();
  digitalWrite(LED_BUILTIN, LOW);
}
