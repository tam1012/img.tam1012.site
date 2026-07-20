#!/usr/bin/env bash
# Mở Chromium với user-data-dir riêng trên desktop VPS (Guacamole / DISPLAY=:0)
# để Anh login Google + Flow một lần.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
MAP="$ROOT/flow-profiles.json"
PROFILES_ROOT="$(python3 -c "import json;print(json.load(open('$MAP'))['profilesRoot'])")"
CHROME="$(python3 -c "import json;print(json.load(open('$MAP'))['chromiumPath'])")"

usage() {
  echo "Usage: $0 <flow-01|flow-02|...|1-5|email>"
  echo "Accounts:"
  python3 - <<'PY'
import json
from pathlib import Path
m=json.loads(Path("'"$MAP"'").read_text())
for i,a in enumerate(m["accounts"],1):
  print(f"  {i}) {a['alias']:8} {a['email']}")
PY
  exit 1
}

[[ $# -lt 1 ]] && usage
KEY="$1"

ALIAS_FOLDER="$(python3 - <<PY
import json,sys
from pathlib import Path
key=sys.argv[1].strip().lower()
m=json.loads(Path("$MAP").read_text())
accs=m["accounts"]
chosen=None
if key.isdigit():
  i=int(key)
  if 1<=i<=len(accs): chosen=accs[i-1]
else:
  for a in accs:
    if a["alias"].lower()==key or a["email"].lower()==key or a["folder"].lower()==key:
      chosen=a; break
if not chosen:
  print("", end=""); sys.exit(2)
print(chosen["alias"]+"|"+chosen["email"]+"|"+chosen["folder"])
PY
"$KEY")" || { echo "Khong tim thay account: $KEY"; usage; }

ALIAS="${ALIAS_FOLDER%%|*}"
REST="${ALIAS_FOLDER#*|}"
EMAIL="${REST%%|*}"
FOLDER="${REST##*|}"
UD="$PROFILES_ROOT/$FOLDER"
mkdir -p "$UD"

# Desktop VPS qua Guacamole / LightDM :0
export DISPLAY="${DISPLAY:-:0}"
if [[ -z "${XAUTHORITY:-}" ]]; then
  if [[ -f /home/ubuntu/.Xauthority ]]; then
    export XAUTHORITY=/home/ubuntu/.Xauthority
  elif [[ -f /var/run/lightdm/root/:0 ]]; then
    # fallback — có thể cần sudo xhost +SI:localuser:ubuntu
    export XAUTHORITY=/var/run/lightdm/root/:0
  fi
fi

echo "================================================"
echo "  MO PROFILE FLOW TREN VPS (login lan dau)"
echo "================================================"
echo "  Alias:  $ALIAS"
echo "  Email:  $EMAIL  <-- login DUNG email nay"
echo "  Dir:    $UD"
echo "  DISPLAY $DISPLAY"
echo
echo "Huong dan:"
echo "  1. Vao Guacamole desktop VPS (neu chua)"
echo "  2. Cua so Chromium se mo Flow"
echo "  3. Dang nhap Google dung email tren + vao duoc Flow"
echo "  4. Dong Chromium"
echo "  5. Chay: $ROOT/reauth.sh $ALIAS"
echo

# Cho phep user ubuntu ve :0 neu can (khong fail script neu khong duoc)
xhost +SI:localuser:ubuntu >/dev/null 2>&1 || true

nohup "$CHROME" \
  --user-data-dir="$UD" \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --password-store=basic \
  --no-sandbox \
  "https://labs.google/fx/tools/flow" \
  >/tmp/flow-open-$ALIAS.log 2>&1 &

echo "Da mo Chromium (pid $!). Log: /tmp/flow-open-$ALIAS.log"
echo "Xong login thi chay: $ROOT/reauth.sh $ALIAS"
