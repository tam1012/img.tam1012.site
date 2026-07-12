#!/usr/bin/env bash
# Open 3 independent Chromium instances (separate user-data-dir) for true multi-account rotation.
set -euo pipefail

DISPLAY_NUM="${DISPLAY_NUM:-:1}"
BASE="/var/lib/chatgpt-web-bridge/profiles"
SRC_CHROMIUM="${SRC_CHROMIUM:-/home/ubuntu/.config/chromium}"
BROWSER="${BROWSER:-$(command -v chromium || command -v chromium-browser || true)}"

if [ -z "$BROWSER" ]; then
  echo "Chromium not found"
  exit 1
fi

export DISPLAY="$DISPLAY_NUM"
mkdir -p "$BASE"

copy_one() {
  local name="$1"
  local src_profile="$2"
  local dest="$BASE/$name"
  local src_path="$SRC_CHROMIUM/$src_profile"
  if [ ! -d "$src_path" ]; then
    echo "MISSING source: $src_path"
    exit 1
  fi
  echo "Sync $name from [$src_profile]"
  mkdir -p "$dest/Default"
  rsync -a \
    --exclude="Singleton*" \
    --exclude="lockfile" \
    --exclude="LOCK" \
    --exclude="Cache" \
    --exclude="Code Cache" \
    --exclude="GPUCache" \
    --exclude="ShaderCache" \
    --exclude="GrShaderCache" \
    --exclude="GraphiteDawnCache" \
    --exclude="Service Worker/CacheStorage" \
    --exclude="Service Worker/ScriptCache" \
    --exclude="Crashpad" \
    --exclude="Crash Reports" \
    --exclude="BrowserMetrics" \
    "$src_path/" "$dest/Default/"

  python3 - "$dest" <<'PY'
import json, sys
from pathlib import Path
dest = Path(sys.argv[1])
(dest / "Local State").write_text(json.dumps({
  "profile": {
    "info_cache": {"Default": {"active_time": 0.0, "is_using_default_name": True, "name": "Person"}},
    "last_used": "Default",
    "last_active_profiles": ["Default"],
  }
}))
prefs = dest / "Default" / "Preferences"
if prefs.exists():
    try:
        data = json.loads(prefs.read_text())
        data.setdefault("profile", {})["exit_type"] = "Normal"
        data["profile"]["exited_cleanly"] = True
        prefs.write_text(json.dumps(data))
    except Exception as e:
        print("prefs skip", e)
PY

  mkdir -p "$dest/NativeMessagingHosts"
  if [ -d "$SRC_CHROMIUM/NativeMessagingHosts" ]; then
    cp -f "$SRC_CHROMIUM"/NativeMessagingHosts/*.json "$dest/NativeMessagingHosts/" 2>/dev/null || true
  fi
  chmod -R u+rwX,go-rwx "$dest"
}

if [ "${SKIP_SYNC:-0}" != "1" ]; then
  copy_one account_01 "Default"
  copy_one account_02 "Profile 1"
  # Person 1 lives in directory literally named: Profile\ 1
  copy_one account_03 'Profile\ 1'
fi

launch_one() {
  local name="$1"
  local dest="$BASE/$name"
  pkill -f "user-data-dir=$dest" 2>/dev/null || true
  sleep 0.3
  echo "Launch $name -> $dest"
  nohup "$BROWSER" \
    --user-data-dir="$dest" \
    --profile-directory=Default \
    --no-first-run \
    --no-default-browser-check \
    --disable-dev-shm-usage \
    --no-sandbox \
    --enable-remote-extensions \
    "https://chatgpt.com/" \
    >"/tmp/chromium-$name.log" 2>&1 &
  echo "  pid $!"
}

for name in account_01 account_02 account_03; do
  launch_one "$name"
  sleep 1
done

sleep 2
echo "=== running ==="
pgrep -af "user-data-dir=$BASE/account_" || true
echo "Done. Keep all 3 Chromium windows open."
