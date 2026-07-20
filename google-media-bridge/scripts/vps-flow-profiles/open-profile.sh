#!/usr/bin/env bash
# Mở Chromium với user-data-dir riêng trên desktop VPS (Guacamole / DISPLAY=:0)
# để Anh login Google + Flow một lần.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
MAP="$ROOT/flow-profiles.json"

if [[ ! -f "$MAP" ]]; then
  echo "Thieu $MAP"
  exit 1
fi

PROFILES_ROOT="$(python3 -c "import json; print(json.load(open('$MAP'))['profilesRoot'])")"
CHROME="$(python3 -c "import json; print(json.load(open('$MAP'))['chromiumPath'])")"

usage() {
  echo "Usage: $0 <flow-01|flow-02|...|1-5|email>"
  echo "Accounts:"
  python3 -c "
import json
m=json.load(open('$MAP'))
for i,a in enumerate(m['accounts'],1):
  print(f\"  {i}) {a['alias']:8} {a['email']}\")
"
  exit 1
}

[[ $# -lt 1 ]] && usage
KEY="$1"

RESOLVED="$(python3 -c "
import json, sys
key = sys.argv[1].strip().lower()
m = json.load(open(sys.argv[2]))
accs = m['accounts']
chosen = None
if key.isdigit():
    i = int(key)
    if 1 <= i <= len(accs):
        chosen = accs[i-1]
else:
    for a in accs:
        if a['alias'].lower()==key or a['email'].lower()==key or a['folder'].lower()==key:
            chosen = a
            break
if not chosen:
    sys.exit(2)
print(chosen['alias'])
print(chosen['email'])
print(chosen['folder'])
" "$KEY" "$MAP")" || {
  echo "Khong tim thay account: $KEY"
  usage
}

ALIAS="$(echo "$RESOLVED" | sed -n '1p')"
EMAIL="$(echo "$RESOLVED" | sed -n '2p')"
FOLDER="$(echo "$RESOLVED" | sed -n '3p')"
UD="$PROFILES_ROOT/$FOLDER"
mkdir -p "$UD"

export DISPLAY="${DISPLAY:-:0}"
if [[ -z "${XAUTHORITY:-}" ]]; then
  if [[ -f /home/ubuntu/.Xauthority ]]; then
    export XAUTHORITY=/home/ubuntu/.Xauthority
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
echo "  1. Vao Guacamole desktop VPS"
echo "  2. Cua so Chromium se mo Flow"
echo "  3. Dang nhap Google dung email tren + vao duoc Flow"
echo "  4. Dong Chromium"
echo "  5. Bao em (hoac chay reauth.sh $ALIAS)"
echo

xhost +SI:localuser:ubuntu >/dev/null 2>&1 || true
xhost +local: >/dev/null 2>&1 || true

# Neu DISPLAY khong dung, van mo headless=false co the fail — thu :0
if ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
  echo "Canh bao: khong ket noi duoc DISPLAY=$DISPLAY"
  echo "Thu mo bang nohup van the; neu khong thay cua so, bao em."
fi

nohup "$CHROME" \
  --user-data-dir="$UD" \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --password-store=basic \
  --no-sandbox \
  --disable-dev-shm-usage \
  "https://labs.google/fx/tools/flow" \
  >"/tmp/flow-open-$ALIAS.log" 2>&1 &

PID=$!
sleep 2
if kill -0 "$PID" 2>/dev/null; then
  echo "Da mo Chromium (pid $PID). Log: /tmp/flow-open-$ALIAS.log"
else
  echo "Chromium co the da thoat. Xem log:"
  tail -n 30 "/tmp/flow-open-$ALIAS.log" 2>/dev/null || true
  exit 1
fi
echo "Xong login thi bao em chay reauth, hoac: $ROOT/reauth.sh $ALIAS"
