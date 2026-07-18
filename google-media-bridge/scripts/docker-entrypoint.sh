#!/bin/sh
set -e
mkdir -p /data/videos
# Named volumes start as root; ensure bridge user can write SQLite/media.
chown -R flowbridge:flowbridge /data 2>/dev/null || true

# Start virtual X server for Chromium non-headless (better reCAPTCHA score).
# DISPLAY=:99 is the conventional default; bridge connects via the env var.
XVFB_PID=""
if [ -x /usr/bin/Xvfb ]; then
  Xvfb :99 -screen 0 1366x768x24 -ac +extension RANDR &
  XVFB_PID=$!
  # Give Xvfb a moment to start.
  sleep 1
fi

cleanup() {
  if [ -n "$XVFB_PID" ] && kill -0 "$XVFB_PID" 2>/dev/null; then
    kill "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

export DISPLAY=:99

if [ "$(id -u)" = "0" ]; then
  exec runuser -u flowbridge -- env DISPLAY=:99 "$@"
fi
exec "$@"
