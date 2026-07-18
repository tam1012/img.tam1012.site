# Watchdog IMG Studio — cảnh báo Telegram khi lỗi bất thường
#
# Cài trên VPS:
#   1. ops/watchdog/.env  (token + chat id, chmod 600)
#   2. cron mỗi 5 phút gọi scripts/img-studio-watchdog.py
#
# Không gọi getUpdates. Chỉ sendMessage.
# State dedup: ops/watchdog/state.json
# Log: ops/watchdog/watchdog.log

Xem script: `scripts/img-studio-watchdog.py`
