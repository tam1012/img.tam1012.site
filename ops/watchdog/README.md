# Watchdog IMG Studio — cảnh báo Telegram khi lỗi bất thường
#
# Cài trên VPS:
#   1. ops/watchdog/.env  (token + chat id, chmod 600)
#   2. cron mỗi 5 phút gọi scripts/img-studio-watchdog.py
#
# Không gọi getUpdates. Chỉ sendMessage.
# State dedup: ops/watchdog/state.json
# Log: ops/watchdog/watchdog.log
#
# Các loại cảnh báo:
# - Lỗi lặp / tỷ lệ fail cao (RequestLog)
# - Tự dừng + hoàn tiền job ảnh/video treo
# - Provider model lệch CPA
# - Account Google Flow `reauth_required` (đọc Admin API trong container
#   google-media-bridge; tin nhắn kèm sẵn lệnh reauth.sh / open-profile.sh)
#
# Test:
#   IMG_WATCHDOG_TEST=1 python3 scripts/img-studio-watchdog.py
#   # hoặc: python3 scripts/img-studio-watchdog.py --test
#
# Tắt riêng báo Flow reauth: IMG_WATCHDOG_FLOW_REAUTH=0 trong .env

Xem script: `scripts/img-studio-watchdog.py`
