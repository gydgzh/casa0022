#!/usr/bin/env bash
# scripts/verify-arduino.sh <ip>
# ===============================
# Sanity-check that the Arduino's HTTP endpoint is alive and that the
# JSON shape is what the iPad app expects. Runs 5 polls a second apart so
# you can wave a hand in front of the PIR / cover the TEMT6000 mid-test
# and see the values move.

set -euo pipefail
IP="${1:-}"
if [ -z "$IP" ]; then
  echo "usage: $0 <arduino-ip>"
  echo "       $0 192.168.4.1     # AP mode"
  echo "       $0 192.168.1.42    # station mode (IP from flash log)"
  exit 1
fi

URL="http://${IP}/sensors"

echo "Probing $URL …"
echo

for i in 1 2 3 4 5; do
  printf "[%d/5] " "$i"
  if RESP=$(curl -fsS --max-time 2 "$URL" 2>&1); then
    echo "$RESP"
  else
    echo "❌ $RESP"
  fi
  sleep 1
done

echo
echo "All polls successful?  Then it's working."
echo "On the iPad: ⚙︎ Settings → Arduino IP → ${IP} → Save & reload"
