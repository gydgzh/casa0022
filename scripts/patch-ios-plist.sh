#!/usr/bin/env bash
# scripts/patch-ios-plist.sh
# ==========================
# After `npx cap add ios` has generated ios/App/App/Info.plist, run this
# to inject the four iOS permission descriptions the dissertation needs
# (camera, microphone, speech, local network), allow plain HTTP to the
# Arduino on the LAN, and lock the iPad to landscape.
#
# Uses /usr/libexec/PlistBuddy which ships with macOS — no extra install.
#
# Safe to re-run: every :Add is preceded by :Delete, so values are reset
# to the wording defined here each time.

set -euo pipefail

PLIST="${PLIST:-$(cd "$(dirname "$0")/.." && pwd)/ios/App/App/Info.plist}"

if [ ! -f "$PLIST" ]; then
  echo "❌  $PLIST does not exist."
  echo "    Run \`npx cap add ios\` first."
  exit 1
fi

PB=/usr/libexec/PlistBuddy

set_string () {
  local key="$1" val="$2"
  $PB -c "Delete :$key" "$PLIST" 2>/dev/null || true
  $PB -c "Add :$key string $val" "$PLIST"
  echo "  ✓ $key"
}

echo "Patching $PLIST"

set_string "NSCameraUsageDescription"            "Used to mirror your facial expressions onto the virtual librarian."
set_string "NSMicrophoneUsageDescription"        "Used to detect ambient noise and recognise spoken topics for book recommendations."
set_string "NSSpeechRecognitionUsageDescription" "Used to transcribe what you say so the librarian can suggest a relevant book."
set_string "NSLocalNetworkUsageDescription"      "Used to read environment sensors (light, motion) published by the Arduino on the same Wi-Fi."

# App Transport Security: allow plain HTTP to the Arduino's HTTP server.
# NSAllowsLocalNetworking is the least-permissive setting that works for
# LAN IPs from WKWebView. If WKWebView still blocks the fetch, fall back
# to NSAllowsArbitraryLoads = true (less secure; not needed in most cases).
$PB -c "Delete :NSAppTransportSecurity" "$PLIST" 2>/dev/null || true
$PB -c "Add :NSAppTransportSecurity dict" "$PLIST"
$PB -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$PLIST"
$PB -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true" "$PLIST"
echo "  ✓ NSAppTransportSecurity (local + arbitrary loads enabled)"

# Lock the iPad to landscape (Pepper's Ghost pyramid sits flat on screen).
$PB -c "Delete :UISupportedInterfaceOrientations~ipad" "$PLIST" 2>/dev/null || true
$PB -c "Add :UISupportedInterfaceOrientations~ipad array" "$PLIST"
$PB -c "Add :UISupportedInterfaceOrientations~ipad: string UIInterfaceOrientationLandscapeLeft"  "$PLIST"
$PB -c "Add :UISupportedInterfaceOrientations~ipad: string UIInterfaceOrientationLandscapeRight" "$PLIST"
echo "  ✓ UISupportedInterfaceOrientations~ipad = [Landscape Left, Landscape Right]"

echo
echo "✅  Info.plist patched. Re-run \`npx cap sync ios\` if Capacitor needs to copy"
echo "    the patched file into ios/App/App/public/."
