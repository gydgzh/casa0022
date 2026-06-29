// arduino_secrets.h
// =================
// Fill these in before flashing. Do NOT commit real credentials.

#pragma once

// === STATION mode (USE_AP = 0 in library_sensors.ino) ===
// Wi-Fi network the Arduino joins. MKR WiFi 1010 can only see 2.4 GHz.
#define WIFI_SSID    "REPLACE_WITH_YOUR_SSID"
#define WIFI_PASS    "REPLACE_WITH_YOUR_PASSWORD"

// === ACCESS POINT mode (USE_AP = 1) ===
// The Arduino creates this Wi-Fi network; the iPad joins it.
// AP_PASS must be at least 8 characters.
#define AP_SSID      "VirtualLibrarian"
#define AP_PASS      "casa2026"
