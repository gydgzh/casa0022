#!/usr/bin/env bash
# scripts/sync-public-assets.sh
# =============================
# Vite only bundles files under public/ into dist/. Our 3D models live at
# project-root/3D_/ for convenience during dev (they show up at /3D_/...
# in both dev server and built bundle).
#
# Before every build we mirror 3D_/ → public/3D_/ so Capacitor includes
# the .vrm files in the iOS app bundle.
#
# Idempotent and fast: cp -u only copies changed files.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -d "3D_" ]; then
  echo "[sync] no 3D_/ folder; nothing to copy"
  exit 0
fi

mkdir -p public/3D_
# -u = only copy if source is newer than destination
cp -u 3D_/*.vrm public/3D_/ 2>/dev/null || true
cp -u 3D_/*.glb public/3D_/ 2>/dev/null || true

echo "[sync] public/3D_/ now contains:"
ls -lh public/3D_/ 2>/dev/null | awk 'NR>1 {printf "         %-32s %s\n", $NF, $5}'
