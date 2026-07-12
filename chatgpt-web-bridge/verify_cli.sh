#!/usr/bin/env bash
# verify_cli.sh — Kiểm tra CLI chatgpt-imagegen hoạt động với profile
set -euo pipefail

PROFILE_NAME="${1:-account_01}"
DISPLAY="${DISPLAY:-:99}"
BINARY="${BINARY:-chatgpt-imagegen}"

BASE_DIR="/var/lib/chatgpt-web-bridge/profiles"
PROFILE_DIR="$BASE_DIR/$PROFILE_NAME"
OUTPUT_DIR="/var/lib/chatgpt-web-bridge/output"

mkdir -p "$OUTPUT_DIR"

echo "=== Doctor ==="
"$BINARY" doctor

echo ""
echo "=== Test generate ==="
echo "Profile: $PROFILE_DIR"
echo "Display: $DISPLAY"

CHROME_USER_DATA_DIR="$PROFILE_DIR" DISPLAY="$DISPLAY" "$BINARY" \
  --backend web \
  "a cute orange cat sleeping on a cloud" \
  -o "$OUTPUT_DIR/test.png"

echo ""
echo "=== Verify output ==="
file "$OUTPUT_DIR/test.png"
ls -lh "$OUTPUT_DIR/test.png"
echo "Test OK!"
