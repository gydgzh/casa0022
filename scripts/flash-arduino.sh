#!/usr/bin/env bash
# scripts/flash-arduino.sh
# ========================
# One-shot Arduino MKR WiFi 1010 flash. Uses arduino-cli (the official CLI),
# so the local AI agent can complete it end-to-end without anyone opening
# Arduino IDE.
#
# What it does:
#   1. Verifies arduino-cli + board core + library are installed.
#   2. Auto-detects the MKR WiFi 1010 USB port.
#   3. Sanity-checks that arduino_secrets.h has been filled in.
#   4. Compiles the sketch.
#   5. Uploads the binary to the board.
#   6. Streams the Serial Monitor for 15 s so you (and Claude Code) can see
#      the boot log: SSID joined, IP address, "[http] listening on …".
#   7. Extracts the IP from the Serial log and prints the URL the iPad app
#      should poll.
#
# Re-run any time after editing the sketch — idempotent.

set -euo pipefail
DLL="${DLL:-/Users/yimisheng/Desktop/AAAucl-2025/0022Dissertation/1111D}"
SKETCH="$DLL/arduino/library_sensors"
FQBN="arduino:samd:mkrwifi1010"
SECRETS="$SKETCH/arduino_secrets.h"

echo "── 1/7  arduino-cli sanity ─────────────────────────────"
if ! command -v arduino-cli >/dev/null; then
  echo "  ❌ arduino-cli not installed."
  echo "     Run: brew install arduino-cli"
  exit 1
fi
arduino-cli version | head -1

echo
echo "── 2/7  board core + library ──────────────────────────"
arduino-cli core update-index >/dev/null
arduino-cli core install arduino:samd >/dev/null 2>&1 || true
arduino-cli lib install WiFiNINA                    >/dev/null 2>&1 || true
arduino-cli lib install "VL53L0X"                   >/dev/null 2>&1 || true   # Pololu (NOT VL53L1X)
arduino-cli lib install "Adafruit BME280 Library"   >/dev/null 2>&1 || true
arduino-cli lib install "Adafruit BMP280 Library"   >/dev/null 2>&1 || true
arduino-cli lib install "Adafruit Unified Sensor"   >/dev/null 2>&1 || true
arduino-cli lib install "MFRC522"                   >/dev/null 2>&1 || true   # miguelbalboa
echo "  ✓ arduino:samd + WiFiNINA + VL53L0X + BME/BMP280 + MFRC522 installed (or already present)"

echo
echo "── 3/7  detect MKR WiFi 1010 ──────────────────────────"
# arduino-cli board list returns a table. Look for "mkrwifi1010" in the FQBN column.
PORT=$(arduino-cli board list | awk '/mkrwifi1010/{print $1; exit}')
if [ -z "$PORT" ]; then
  # Fall back to first /dev/cu.usbmodem* (typical for SAMD)
  PORT=$(ls /dev/cu.usbmodem* 2>/dev/null | head -n1 || true)
fi
if [ -z "$PORT" ]; then
  echo "  ❌ MKR WiFi 1010 not detected."
  echo "     - Double-tap the reset button to enter bootloader and try again."
  echo "     - Confirm you're using a DATA cable, not a power-only cable."
  exit 1
fi
echo "  ✓ Found at $PORT"

echo
echo "── 4/7  secrets check ─────────────────────────────────"
if ! [ -f "$SECRETS" ]; then
  echo "  ❌ $SECRETS missing."
  exit 1
fi
if grep -q "REPLACE_WITH_YOUR_SSID" "$SECRETS"; then
  echo "  ❌ arduino_secrets.h still has placeholder credentials."
  echo "     Open $SECRETS"
  echo "     and fill in WIFI_SSID + WIFI_PASS for the Wi-Fi"
  echo "     network the iPad is on (or leave alone and flip USE_AP=1)."
  exit 1
fi
echo "  ✓ secrets look filled"

echo
echo "── 5/7  compile ───────────────────────────────────────"
arduino-cli compile --fqbn "$FQBN" "$SKETCH"
echo "  ✓ compile OK"

echo
echo "── 6/7  upload to $PORT ───────────────────────────────"
arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$SKETCH"
echo "  ✓ upload OK"

echo
echo "── 7/7  serial monitor (15 s) ─────────────────────────"
LOG=$(mktemp)
( arduino-cli monitor -p "$PORT" -c baudrate=115200 > "$LOG" 2>&1 &
  MON_PID=$!
  sleep 15
  kill "$MON_PID" 2>/dev/null || true
  wait "$MON_PID" 2>/dev/null || true ) || true

echo
echo "── Serial log (first 40 lines) ────────────────────────"
head -40 "$LOG"
echo

# Extract Arduino's reported IP
IP=$(grep -Eo 'ip=([0-9]+\.){3}[0-9]+' "$LOG" | head -1 | sed 's/^ip=//')
if [ -z "$IP" ]; then
  IP=$(grep -Eo 'gateway IP = ([0-9]+\.){3}[0-9]+' "$LOG" | head -1 | awk '{print $4}')
fi

if [ -n "$IP" ]; then
  echo "════════════════════════════════════════════════════════════════"
  echo "  ✅ Arduino reachable at  http://${IP}/sensors"
  echo
  echo "  Test from this Mac:"
  echo "    curl http://${IP}/sensors"
  echo
  echo "  On the iPad: ⚙︎ Settings → Arduino IP → ${IP} → Save & reload"
  echo "════════════════════════════════════════════════════════════════"
else
  echo "⚠️  IP not found in 15 s of log."
  echo "    - If USE_AP=1 in the sketch, the iPad must join the 'VirtualLibrarian'"
  echo "      Wi-Fi; default gateway IP is 192.168.4.1."
  echo "    - If USE_AP=0 (station), check Wi-Fi credentials in arduino_secrets.h."
  echo "    Full log: $LOG"
fi
