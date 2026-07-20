#!/usr/bin/env bash
# Reauth account Flow từ profile Chromium trên VPS → đẩy storageState vào bridge.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <flow-01|flow-02|...|1-5|email>"
  echo "Vi du: $0 flow-02"
  exit 1
fi

# Dam bao dependency
if [[ ! -d node_modules/playwright-core ]]; then
  echo "Cai playwright-core..."
  npm install --omit=dev --no-fund --no-audit
fi

exec node reauth-from-profile.mjs "$1"
