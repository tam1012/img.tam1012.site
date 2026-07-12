#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${1:-}"
if [ -z "$PROFILE_NAME" ]; then
  echo "Usage: $0 account_01"
  exit 1
fi

BASE_DIR="/var/lib/chatgpt-web-bridge/profiles"
PROFILE_DIR="$BASE_DIR/$PROFILE_NAME"
mkdir -p "$PROFILE_DIR"
chmod 700 "$PROFILE_DIR"

BROWSER="${BROWSER:-}"
if [ -z "$BROWSER" ]; then
  BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
fi
if [ -z "$BROWSER" ]; then
  echo "Không tìm thấy Chromium/Chrome. Cài browser trước."
  exit 1
fi

echo "Browser: $BROWSER"
echo "Profile: $PROFILE_DIR"
echo "Mở browser để Anh login ChatGPT. Sau khi login xong, đóng browser."

exec "$BROWSER" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  https://chatgpt.com/
