#!/bin/sh
set -e
mkdir -p /data/videos
# Named volumes start as root; ensure bridge user can write SQLite/media.
chown -R flowbridge:flowbridge /data 2>/dev/null || true
if [ "$(id -u)" = "0" ]; then
  exec runuser -u flowbridge -- "$@"
fi
exec "$@"
