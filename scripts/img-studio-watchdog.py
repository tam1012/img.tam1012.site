#!/usr/bin/env python3
"""IMG Studio anomaly watchdog — gửi Telegram khi có lỗi bất thường.

Chạy bằng cron mỗi 5–10 phút trên VPS. Chỉ dùng sendMessage (không getUpdates).
Secret nằm ở ops/watchdog/.env (không commit).

Cũng tự dừng + hoàn tiền job treo:
- ảnh/edit processing > STUCK_IMAGE_MIN (mặc định 10 phút)
- video processing > STUCK_VIDEO_MIN (mặc định 20 phút)
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

# scripts/img-studio-watchdog.py → repo root = parents[1]
ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = Path(os.environ.get("IMG_WATCHDOG_ENV", ROOT / "ops" / "watchdog" / ".env"))
STATE_FILE = Path(os.environ.get("IMG_WATCHDOG_STATE", ROOT / "ops" / "watchdog" / "state.json"))
LOG_FILE = Path(os.environ.get("IMG_WATCHDOG_LOG", ROOT / "ops" / "watchdog" / "watchdog.log"))

# Cửa sổ quét fail cluster
WINDOW_MINUTES = int(os.environ.get("IMG_WATCHDOG_WINDOW_MIN", "15"))
# Ngưỡng: tối thiểu N fail cùng pattern trong cửa sổ
MIN_CLUSTER = int(os.environ.get("IMG_WATCHDOG_MIN_CLUSTER", "3"))
# Ảnh/edit treo quá lâu (phút)
STUCK_IMAGE_MIN = int(os.environ.get("IMG_WATCHDOG_STUCK_IMAGE_MIN", "10"))
# Video treo quá lâu (phút)
STUCK_VIDEO_MIN = int(os.environ.get("IMG_WATCHDOG_STUCK_VIDEO_MIN", "20"))
# Không spam cùng alert key trong N phút
DEDUP_MINUTES = int(os.environ.get("IMG_WATCHDOG_DEDUP_MIN", "45"))
# Tỷ lệ fail (và tối thiểu request) trong cửa sổ
FAIL_RATE_THRESHOLD = float(os.environ.get("IMG_WATCHDOG_FAIL_RATE", "0.4"))
FAIL_RATE_MIN_TOTAL = int(os.environ.get("IMG_WATCHDOG_FAIL_RATE_MIN", "8"))
# Tự hoàn tiền job treo (1 = bật)
AUTO_REFUND_STUCK = os.environ.get("IMG_WATCHDOG_AUTO_REFUND", "1").strip() not in ("0", "false", "no")

ADMIN_URL = os.environ.get("IMG_STUDIO_ADMIN_URL", "https://imgstudio.site/admin/logs")
VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def now_vn_str() -> str:
    return datetime.now(VN_TZ).strftime("%Y-%m-%d %H:%M giờ VN")


def log(msg: str) -> None:
    line = f"{datetime.now(VN_TZ).isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def psql(sql: str) -> str:
    """Chạy SQL qua docker exec img-studio-db; trả stdout text."""
    cmd = [
        "docker",
        "exec",
        "-i",
        "img-studio-db",
        "psql",
        "-U",
        "imgstudio",
        "-d",
        "imgstudio",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
        "-F",
        "\t",
        "-c",
        sql,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"psql failed: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout


def sql_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {"alerts": {}}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"alerts": {}}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)


def should_send(state: dict, key: str, now: float) -> bool:
    alerts = state.setdefault("alerts", {})
    prev = alerts.get(key)
    if prev and now - float(prev) < DEDUP_MINUTES * 60:
        return False
    return True


def mark_sent(state: dict, key: str, now: float) -> None:
    state.setdefault("alerts", {})[key] = now
    cutoff = now - 7 * 24 * 3600
    state["alerts"] = {k: v for k, v in state["alerts"].items() if float(v) >= cutoff}


def send_telegram(token: str, chat_id: str, text: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = urllib.parse.urlencode(
        {
            "chat_id": chat_id,
            "text": text[:4000],
            "disable_web_page_preview": "true",
        }
    ).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        data = json.loads(raw)
        if not data.get("ok"):
            raise RuntimeError(f"telegram not ok: {raw[:200]}")
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"telegram HTTP {e.code}: {err[:200]}") from e


def normalize_error(msg: str | None) -> str:
    if not msg:
        return "(không có message)"
    s = re.sub(r"\s+", " ", msg.strip())
    s = re.sub(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        "<id>",
        s,
        flags=re.I,
    )
    return s[:180]


def collect_fail_clusters() -> list[tuple[str, str, int, str]]:
    sql = f"""
SELECT COALESCE(model,'(none)'), COALESCE("errorMessage",''), COALESCE(u.email,'(no-email)')
FROM "RequestLog" r
LEFT JOIN "User" u ON u.id = r."userId"
WHERE r.status = 'failed'
  AND r."createdAt" >= now() - interval '{WINDOW_MINUTES} minutes'
ORDER BY r."createdAt" DESC;
"""
    out = psql(sql)
    buckets: dict[tuple[str, str], list[str]] = defaultdict(list)
    for line in out.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        model, err, email = parts[0], parts[1], parts[2]
        key = (model, normalize_error(err))
        buckets[key].append(email)

    result = []
    for (model, err), emails in buckets.items():
        if len(emails) >= MIN_CLUSTER:
            result.append((model, err, len(emails), emails[0]))
    result.sort(key=lambda x: -x[2])
    return result


def collect_fail_rate() -> tuple[int, int] | None:
    sql = f"""
SELECT
  COUNT(*) FILTER (WHERE status = 'failed')::text,
  COUNT(*)::text
FROM "RequestLog"
WHERE "createdAt" >= now() - interval '{WINDOW_MINUTES} minutes';
"""
    out = psql(sql).strip()
    if not out or "\t" not in out:
        return None
    failed_s, total_s = out.split("\t", 1)
    return int(failed_s), int(total_s)


def collect_stuck_images() -> list[tuple[str, str, str, str, str, str]]:
    """log_id, model, email, created_vn, userId, relatedImageId"""
    sql = f"""
SELECT r.id,
       COALESCE(r.model,'(none)'),
       COALESCE(u.email,'(no-email)'),
       to_char(r."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS'),
       r."userId",
       COALESCE(r."relatedImageId",'')
FROM "RequestLog" r
LEFT JOIN "User" u ON u.id = r."userId"
WHERE r.status = 'processing'
  AND r.kind IS DISTINCT FROM 'video'
  AND r."createdAt" < now() - interval '{STUCK_IMAGE_MIN} minutes'
ORDER BY r."createdAt" ASC
LIMIT 30;
"""
    rows = []
    for line in psql(sql).splitlines():
        if not line.strip():
            continue
        p = line.split("\t")
        if len(p) >= 6:
            rows.append((p[0], p[1], p[2], p[3], p[4], p[5]))
    return rows


def collect_stuck_videos() -> list[tuple[str, str, str, str, str, str]]:
    """log_id, model, email, created_vn, userId, relatedVideoId"""
    sql = f"""
SELECT r.id,
       COALESCE(r.model,'(none)'),
       COALESCE(u.email,'(no-email)'),
       to_char(r."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS'),
       r."userId",
       COALESCE(r."relatedVideoId",'')
FROM "RequestLog" r
LEFT JOIN "User" u ON u.id = r."userId"
WHERE r.status = 'processing'
  AND (r.kind = 'video' OR r."relatedVideoId" IS NOT NULL)
  AND r."createdAt" < now() - interval '{STUCK_VIDEO_MIN} minutes'
ORDER BY r."createdAt" ASC
LIMIT 30;
"""
    rows = []
    for line in psql(sql).splitlines():
        if not line.strip():
            continue
        p = line.split("\t")
        if len(p) >= 6:
            rows.append((p[0], p[1], p[2], p[3], p[4], p[5]))
    return rows


def refund_stuck_image(log_id: str, user_id: str, image_id: str) -> tuple[bool, str]:
    """Dừng + hoàn tiền 1 job ảnh/edit. Trả (ok, detail)."""
    note = "Hoan tien tu dong: job treo processing (watchdog)"
    img_q = sql_quote(image_id) if image_id else "NULL"
    # amount từ charge ledger nếu có
    amt_sql = "100"
    if image_id:
        got = psql(
            f"""
SELECT (-"amountVnd")::text FROM "WalletLedger"
WHERE "idempotencyKey" = {sql_quote("charge:" + image_id)}
  AND type = 'charge_image'
LIMIT 1;
"""
        ).strip()
        if got.isdigit():
            amt_sql = got

    if not image_id:
        # chỉ fail log, không hoàn (không có related image)
        psql(
            f"""
UPDATE "RequestLog"
SET status = 'failed',
    "errorMessage" = 'Request treo processing, watchdog tu dong dung',
    "updatedAt" = now()
WHERE id = {sql_quote(log_id)} AND status = 'processing';
"""
        )
        return True, f"log {log_id[:8]}… failed (no image id, no refund)"

    sql = f"""
BEGIN;

WITH charged AS (
  SELECT 1 FROM "WalletLedger"
  WHERE "idempotencyKey" = {sql_quote("charge:" + image_id)}
    AND type = 'charge_image'
),
already AS (
  SELECT 1 FROM "WalletLedger"
  WHERE "idempotencyKey" = {sql_quote("refund:" + image_id)}
),
upd AS (
  UPDATE "Wallet"
  SET "balanceVnd" = "balanceVnd" + {amt_sql}
  WHERE "userId" = {sql_quote(user_id)}
    AND EXISTS (SELECT 1 FROM charged)
    AND NOT EXISTS (SELECT 1 FROM already)
  RETURNING "balanceVnd"
)
INSERT INTO "WalletLedger"
  (id, "userId", type, "amountVnd", "balanceAfterVnd", "relatedImageId", note, "idempotencyKey", "createdAt")
SELECT
  gen_random_uuid()::text,
  {sql_quote(user_id)},
  'refund_image',
  {amt_sql},
  upd."balanceVnd",
  {sql_quote(image_id)},
  {sql_quote(note)},
  {sql_quote("refund:" + image_id)},
  now()
FROM upd;

UPDATE "Image"
SET status = 'failed',
    "errorMessage" = 'Request treo processing, watchdog tu dong dung',
    "updatedAt" = now()
WHERE id = {sql_quote(image_id)}
  AND status = 'processing';

UPDATE "RequestLog"
SET status = 'failed',
    "errorMessage" = 'Request treo processing, watchdog tu dong dung',
    "updatedAt" = now()
WHERE id = {sql_quote(log_id)}
  AND status = 'processing';

COMMIT;
"""
    try:
        psql(sql)
        return True, f"+{amt_sql}đ image {image_id[:8]}…"
    except Exception as e:
        return False, str(e)[:200]


def refund_stuck_video(log_id: str, user_id: str, video_id: str) -> tuple[bool, str]:
    note = "Hoan tien tu dong: video treo processing (watchdog)"
    if not video_id:
        psql(
            f"""
UPDATE "RequestLog"
SET status = 'failed',
    "errorMessage" = 'Request treo processing, watchdog tu dong dung',
    "updatedAt" = now()
WHERE id = {sql_quote(log_id)} AND status = 'processing';
"""
        )
        return True, f"log {log_id[:8]}… failed (no video id)"

    got = psql(
        f"""
SELECT (-"amountVnd")::text FROM "WalletLedger"
WHERE "idempotencyKey" = {sql_quote("charge:video:" + video_id)}
  AND type = 'charge_video'
LIMIT 1;
"""
    ).strip()
    amt_sql = got if got.isdigit() else "1500"

    sql = f"""
BEGIN;

WITH charged AS (
  SELECT 1 FROM "WalletLedger"
  WHERE "idempotencyKey" = {sql_quote("charge:video:" + video_id)}
    AND type = 'charge_video'
),
already AS (
  SELECT 1 FROM "WalletLedger"
  WHERE "idempotencyKey" = {sql_quote("refund:video:" + video_id)}
),
upd AS (
  UPDATE "Wallet"
  SET "balanceVnd" = "balanceVnd" + {amt_sql}
  WHERE "userId" = {sql_quote(user_id)}
    AND EXISTS (SELECT 1 FROM charged)
    AND NOT EXISTS (SELECT 1 FROM already)
  RETURNING "balanceVnd"
)
INSERT INTO "WalletLedger"
  (id, "userId", type, "amountVnd", "balanceAfterVnd", "relatedVideoId", note, "idempotencyKey", "createdAt")
SELECT
  gen_random_uuid()::text,
  {sql_quote(user_id)},
  'refund_video',
  {amt_sql},
  upd."balanceVnd",
  {sql_quote(video_id)},
  {sql_quote(note)},
  {sql_quote("refund:video:" + video_id)},
  now()
FROM upd;

UPDATE "Video"
SET status = 'failed',
    "errorMessage" = 'Request treo processing, watchdog tu dong dung',
    "updatedAt" = now()
WHERE id = {sql_quote(video_id)}
  AND status = 'processing';

UPDATE "RequestLog"
SET status = 'failed',
    "errorMessage" = 'Request treo processing, watchdog tu dong dung',
    "updatedAt" = now()
WHERE id = {sql_quote(log_id)}
  AND status = 'processing';

COMMIT;
"""
    try:
        psql(sql)
        return True, f"+{amt_sql}đ video {video_id[:8]}…"
    except Exception as e:
        return False, str(e)[:200]


def auto_refund_stuck() -> list[str]:
    """Tự fail + hoàn job treo. Trả list dòng mô tả kết quả."""
    results: list[str] = []
    for log_id, model, email, created_vn, user_id, image_id in collect_stuck_images():
        ok, detail = refund_stuck_image(log_id, user_id, image_id)
        tag = "OK" if ok else "LOI"
        results.append(f"[{tag}] ảnh/edit {created_vn} | {model} | {email} | {detail}")
        log(f"auto-refund image {log_id}: {detail}")

    for log_id, model, email, created_vn, user_id, video_id in collect_stuck_videos():
        ok, detail = refund_stuck_video(log_id, user_id, video_id)
        tag = "OK" if ok else "LOI"
        results.append(f"[{tag}] video {created_vn} | {model} | {email} | {detail}")
        log(f"auto-refund video {log_id}: {detail}")
    return results


def collect_missing_cpa_models() -> list[str]:
    sql = """
SELECT model, "baseUrl", "apiKey"
FROM "Provider"
WHERE enabled = true
  AND "apiType" = 'openai'
  AND model IS NOT NULL
  AND model <> ''
  AND "baseUrl" ILIKE '%cli.tam1012.site%';
"""
    lines = [ln for ln in psql(sql).splitlines() if ln.strip()]
    if not lines:
        return []

    first = lines[0].split("\t")
    if len(first) < 3:
        return []
    base = (first[1] or "").rstrip("/")
    api_key = first[2] or ""
    if not base or not api_key:
        return []

    models_url = base if base.endswith("/v1") else base + "/v1"
    models_url = models_url + "/models"
    req = urllib.request.Request(
        models_url,
        headers={"Authorization": f"Bearer {api_key}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception as e:
        log(f"CPA models check skip: {e}")
        return []

    available = {item.get("id") for item in payload.get("data", []) if item.get("id")}
    missing = []
    for line in lines:
        parts = line.split("\t")
        model = parts[0]
        if model not in available:
            missing.append(model)
    return sorted(set(missing))


def build_alerts(refund_lines: list[str] | None = None) -> list[tuple[str, str]]:
    alerts: list[tuple[str, str]] = []
    ts = now_vn_str()

    # 0) Kết quả auto-refund (nếu có)
    if refund_lines:
        key = f"auto-refund:{datetime.now(VN_TZ).strftime('%Y%m%d%H%M')}"
        # dedup theo phút — dùng fixed key theo giờ
        key = "auto-refund"
        body = "\n".join(f"• {x}" for x in refund_lines[:15])
        msg = (
            f"✅ IMG Studio — đã tự dừng + hoàn job treo\n"
            f"{body}\n"
            f"• {ts}\n"
            f"• {ADMIN_URL}"
        )
        alerts.append((key, msg))

    # 1) Cluster fail
    for model, err, count, email in collect_fail_clusters():
        key = f"cluster:{model}:{err}"
        msg = (
            f"⚠️ IMG Studio — lỗi lặp\n"
            f"• {count} request fail / {WINDOW_MINUTES} phút\n"
            f"• Model: {model}\n"
            f"• Lỗi: {err}\n"
            f"• User gần nhất: {email}\n"
            f"• {ts}\n"
            f"• {ADMIN_URL}"
        )
        alerts.append((key, msg))

    # 2) Tỷ lệ fail cao
    rate = collect_fail_rate()
    if rate:
        failed, total = rate
        if total >= FAIL_RATE_MIN_TOTAL and failed / total >= FAIL_RATE_THRESHOLD:
            key = f"failrate:{WINDOW_MINUTES}"
            pct = int(round(100 * failed / total))
            msg = (
                f"⚠️ IMG Studio — tỷ lệ fail cao\n"
                f"• {failed}/{total} fail ({pct}%) trong {WINDOW_MINUTES} phút\n"
                f"• Ngưỡng: ≥{int(FAIL_RATE_THRESHOLD*100)}% và ≥{FAIL_RATE_MIN_TOTAL} request\n"
                f"• {ts}\n"
                f"• {ADMIN_URL}"
            )
            alerts.append((key, msg))

    # 3) Job treo còn lại (sau auto-refund, nếu còn thì báo)
    stuck_img = collect_stuck_images()
    if stuck_img and not AUTO_REFUND_STUCK:
        lines = [f"  - {m} | {e} | {t}" for _, m, e, t, _, _ in stuck_img[:8]]
        key = "stuck:image"
        msg = (
            f"⚠️ IMG Studio — ảnh/edit treo\n"
            f"• {len(stuck_img)} job processing > {STUCK_IMAGE_MIN} phút\n"
            + "\n".join(lines)
            + f"\n• {ts}\n• {ADMIN_URL}"
        )
        alerts.append((key, msg))

    stuck_vid = collect_stuck_videos()
    if stuck_vid and not AUTO_REFUND_STUCK:
        lines = [f"  - {m} | {e} | {t}" for _, m, e, t, _, _ in stuck_vid[:8]]
        key = "stuck:video"
        msg = (
            f"⚠️ IMG Studio — video treo\n"
            f"• {len(stuck_vid)} job processing > {STUCK_VIDEO_MIN} phút\n"
            + "\n".join(lines)
            + f"\n• {ts}\n• {ADMIN_URL}"
        )
        alerts.append((key, msg))

    # 4) Model lệch CPA
    missing = collect_missing_cpa_models()
    if missing:
        key = "cpa:missing"
        msg = (
            f"⚠️ IMG Studio — model provider lệch CPA\n"
            f"• Provider enabled nhưng model không có trên cli.tam1012.site:\n"
            f"  {', '.join(missing)}\n"
            f"• Có thể Google/Vertex đổi tên model (vd preview → GA)\n"
            f"• {ts}"
        )
        alerts.append((key, msg))

    return alerts


def main() -> int:
    env = load_env(ENV_FILE)
    for k in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "IMG_WATCHDOG_TEST"):
        if k in os.environ and os.environ[k]:
            env[k] = os.environ[k]

    token = env.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = env.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        log("ERROR: thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong ops/watchdog/.env")
        return 2

    if env.get("IMG_WATCHDOG_TEST") == "1" or "--test" in sys.argv:
        send_telegram(
            token,
            chat_id,
            f"✅ IMG Studio watchdog online\n"
            f"• Giờ VN: {now_vn_str()}\n"
            f"• Auto hoàn job treo: {'BẬT' if AUTO_REFUND_STUCK else 'TẮT'}\n"
            f"• Ảnh/edit >{STUCK_IMAGE_MIN}p, video >{STUCK_VIDEO_MIN}p",
        )
        log("test message sent")
        return 0

    refund_lines: list[str] = []
    try:
        if AUTO_REFUND_STUCK:
            refund_lines = auto_refund_stuck()
        alerts = build_alerts(refund_lines if refund_lines else None)
    except Exception as e:
        state = load_state()
        now = time.time()
        key = "watchdog:error"
        if should_send(state, key, now):
            try:
                send_telegram(
                    token,
                    chat_id,
                    f"🚨 IMG Studio watchdog lỗi khi quét\n"
                    f"• {type(e).__name__}: {str(e)[:300]}\n"
                    f"• {now_vn_str()}",
                )
                mark_sent(state, key, now)
                save_state(state)
            except Exception as te:
                log(f"failed to alert about error: {te}")
        log(f"ERROR build_alerts: {e}")
        return 1

    if not alerts:
        log("ok — no anomalies")
        return 0

    state = load_state()
    now = time.time()
    sent = 0
    for key, msg in alerts:
        # auto-refund luôn gửi (dedup 45p vẫn áp dụng để tránh spam)
        if not should_send(state, key, now):
            log(f"skip dedup {key}")
            continue
        try:
            send_telegram(token, chat_id, msg)
            mark_sent(state, key, now)
            sent += 1
            log(f"sent {key}")
        except Exception as e:
            log(f"send fail {key}: {e}")

    save_state(state)
    log(f"done sent={sent} candidates={len(alerts)} refunds={len(refund_lines)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
