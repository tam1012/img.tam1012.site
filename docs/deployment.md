# Hướng dẫn triển khai — IMG Studio

## Thông tin VPS

| Mục | Giá trị |
|---|---|
| IP / Host | `<VPS_HOST>` |
| User | ubuntu |
| OS | Ubuntu ARM64 |
| SSH Key | đường dẫn key local (không commit private key) |
| Project dir | `/home/ubuntu/img-studio` |
| App container | `img-studio` |
| DB container | `img-studio-db` |
| Port | 3456 |
| Domain chính | `imgstudio.site` |
| Domain cũ | `img.tam1012.site` → redirect 308, giữ path/query |
| SSL | Certbot auto-renew cho cả domain chính và domain cũ |

## SSH vào VPS

```bash
ssh -i "/path/to/your-private-key" ubuntu@<VPS_HOST>
```

## Environment Variables

File `.env` tại `/home/ubuntu/img-studio/.env` cần có:

```env
SESSION_SECRET=random_string_at_least_32_chars
POSTGRES_PASSWORD=strong_password
DATABASE_URL=postgresql://imgstudio:${POSTGRES_PASSWORD}@db:5432/imgstudio?schema=public
IMAGE_PRICE_VND=100
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=strong_admin_password
DATA_DIR=/data
  APP_BASE_URL=https://imgstudio.site
  PROMPT_REFINE_BASE_URL=https://your-cpa.example/v1
  PROMPT_REFINE_API_KEY=server-only
  PROMPT_REFINE_MODEL=gemini-3-flash-agent
  PROMPT_REFINE_TIMEOUT_MS=25000
```

Ghi chú:

- `AUTH_PASSWORD` và `GUEST_PASSWORD` của prototype cũ không còn là luồng auth chính.
- `APP_BASE_URL=https://imgstudio.site` được dùng để tạo PayOS return/cancel URL; webhook hiện hành là `https://imgstudio.site/api/payos/webhook`.
- Không đổi `SESSION_SECRET` khi chuyển domain; cookie là host-only nên người dùng cần đăng nhập lại một lần trên domain mới.
- `ADMIN_EMAIL`/`ADMIN_PASSWORD` dùng bởi `scripts/seed-admin.js` khi container start.
- Provider API key cấu hình trong trang Settings, không để trong `.env`.
- Nếu dùng ChatGPT Web Bridge: app cần `CHATGPT_BRIDGE_BASE_URL` (compose mặc định `http://host.docker.internal:8456`). Token bridge và Chrome profile **không** để trong repo; nằm env/systemd + `/var/lib/chatgpt-web-bridge/`.
- `XAI_AUTH_DIR=/run/secrets/xai-auths` được compose set sẵn. Không đặt OAuth token trực tiếp trong `.env`.

## Docker Compose

Stack hiện có 2 service:

- `img-studio-db` — PostgreSQL 16, volume `img-studio_img-postgres`.
- `img-studio` — Next.js app, volume `img-studio_img-data` mount `/data`.

xAI OAuth pool:

- Host source CPA: `/home/ubuntu/cliproxyapi/auths/xai-*.json`.
- Host target app: `/home/ubuntu/img-studio/secrets/xai-auths/`.
- Container: `/run/secrets/xai-auths` read-only.
- `img-studio-xai-auth-sync.timer` chạy mỗi phút; kiểm tra bằng:

```bash
systemctl status img-studio-xai-auth-sync.timer
journalctl -u img-studio-xai-auth-sync.service -n 20 --no-pager
```

Các lệnh thường dùng:

```bash
cd ~/img-studio

docker compose ps
docker logs img-studio --tail 100 -f
docker logs img-studio-db --tail 50

docker compose restart app
docker compose build --no-cache app
docker compose up -d
```

## Deploy tự động (CI/CD)

Push code lên `main` → GitHub Actions SSH vào VPS và chạy:

```bash
cd ~/img-studio
git fetch origin main
git reset --hard origin/main
# cài/enable xAI auth sync systemd, chạy sync một lần trước compose up
# nếu có chatgpt-web-bridge/ và /opt/chatgpt-web-bridge: copy file + restart service
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
# Backup volume /data (file ảnh…) nếu container app đang chạy
if docker container inspect img-studio >/dev/null 2>&1; then
  MEDIA_BACKUP="./backups/img-data-before-deploy-$STAMP"
  docker cp img-studio:/data "$MEDIA_BACKUP"
  test -d "$MEDIA_BACKUP"
  find "$MEDIA_BACKUP" -mindepth 1 -print -quit | grep -q .
fi
# Giữ đúng 3 snapshot /data mới nhất theo timestamp trong tên
find ./backups -maxdepth 1 -mindepth 1 -type d \
  -name 'img-data-before-deploy-*' -printf '%f\n' \
  | grep -E '^img-data-before-deploy-[0-9]{8}-[0-9]{6}$' \
  | sort -r \
  | tail -n +4 \
  | while IFS= read -r snapshot; do
      rm -rf -- "./backups/$snapshot"
    done
# Dump PostgreSQL custom-format (-Fc) trước build; dump fail → abort deploy (set -e)
# (skip nếu chưa có container img-studio-db; khi đã có DB thì dump bắt buộc thành công)
if docker container inspect img-studio-db >/dev/null 2>&1; then
  docker exec img-studio-db pg_dump -U imgstudio -d imgstudio -Fc -f /tmp/img-postgres-$STAMP.dump
  docker cp img-studio-db:/tmp/img-postgres-$STAMP.dump ./backups/img-postgres-$STAMP.dump
  docker exec img-studio-db rm -f /tmp/img-postgres-$STAMP.dump
fi
# Giữ 3 dump DB mới nhất (độc lập retention backup /data)
ls -1dt ./backups/img-postgres-*.dump 2>/dev/null | tail -n +4 | xargs -r rm -f
docker compose build --no-cache app
docker compose up -d --remove-orphans
```

**Backup trước deploy:** CI backup `/data` **và** `pg_dump -Fc` DB vào `./backups/img-postgres-*.dump` trước `docker compose build`. Dump fail = abort deploy. Retention: 3 dump DB mới nhất + 3 bản `img-data-before-deploy-*` (hai luồng độc lập).

- Backup `/data` dùng tên `img-data-before-deploy-YYYYMMDD-HHMMSS` và giữ ba bản mới nhất theo timestamp trong tên, không theo filesystem mtime.
- Deploy dừng trước build nếu `docker cp` thất bại, snapshot không tồn tại hoặc không có entry nào bên trong.
- App publish `127.0.0.1:3456:3456`; chỉ nginx trên VPS truy cập trực tiếp cổng Next.js.

**Lưu ý:** workflow **không** có concurrency lock. Push 2 commit sát nhau có thể chạy 2 deploy song song trên cùng VPS (build/up đè nhau). Nên gom commit hoặc đợi deploy trước xong rồi push tiếp. Code cuối vẫn lấy `origin/main` mới nhất; rủi ro chính là job fail/timeout hoặc app restart 2 lần.

**GitHub Secrets cần thiết (không commit giá trị thật):** `SSH_PRIVATE_KEY`, `VPS_HOST`, `VPS_USER`.

### Kiểm tra production sau deploy (Phase 1)

```bash
sudo ss -lntp | grep ':3456'
curl -I --max-time 10 http://127.0.0.1:3456/
curl -I --max-time 15 https://img.tam1012.site/
find ~/img-studio/backups -maxdepth 1 -type d -name 'img-data-before-deploy-*' -printf '%f\n' | sort -r
du -sh ~/img-studio/backups/img-data-before-deploy-*
```

## Deploy thủ công

```bash
cd ~/img-studio
git fetch origin main
git reset --hard origin/main
docker compose build --no-cache app
docker compose up -d
```

Khi app container start, command production chạy lần lượt:

```bash
node scripts/check-env.js
npx prisma migrate deploy
node scripts/seed-admin.js
node scripts/migrate-db-json-to-postgres.js /data/db.json  # chỉ khi còn db.json và chưa có /data/.db-json-imported
node server.js
```

## Backup trước migration paid v1

Không xóa dữ liệu cũ. Trước lần deploy paid v1 đầu tiên cần backup `/data`:

```bash
cd /home/ubuntu/img-studio
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
docker cp img-studio:/data ./backups/img-data-before-paid-v1-$STAMP
```

PostgreSQL lần đầu chưa có dữ liệu. Sau khi đã chạy paid v1, backup DB bằng `pg_dump` custom-format trong container DB:

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
docker exec img-studio-db pg_dump -U imgstudio -d imgstudio -Fc -f /tmp/img-postgres-$STAMP.dump
docker cp img-studio-db:/tmp/img-postgres-$STAMP.dump ./backups/img-postgres-$STAMP.dump
docker exec img-studio-db rm -f /tmp/img-postgres-$STAMP.dump
# Giữ 3 dump mới nhất (tuỳ chọn khi backup tay)
ls -1dt ./backups/img-postgres-*.dump 2>/dev/null | tail -n +4 | xargs -r rm -f
```

## Migration dữ liệu cũ

Legacy `/data/db.json` được import vào PostgreSQL bởi `scripts/migrate-db-json-to-postgres.js`:

- Import providers.
- Tạo admin theo `ADMIN_EMAIL`.
- Tạo user `Legacy Guest` trạng thái blocked để giữ ảnh guest cũ nhưng không cho login.
- Import ảnh cũ, giữ filename trong `/data/images`.
- Không tạo charge ledger cho ảnh cũ (`costVnd = 0`).
- Sau khi chạy thành công, Docker CMD tạo marker `/data/.db-json-imported` để không import lại mỗi restart.

## ChatGPT Web Bridge (experimental, host systemd)

Bridge **không** chạy trong Docker app. Trên VPS host:

| Mục | Giá trị |
|---|---|
| Service | `chatgpt-web-bridge.service` |
| Display | `xvfb-chatgpt.service` (`:99`) |
| Code | `/opt/chatgpt-web-bridge/` |
| Config | `/etc/chatgpt-web-bridge/config.yaml` |
| Token | env `BRIDGE_ADMIN_TOKEN` (file env systemd, chmod 600) |
| Profiles | `/var/lib/chatgpt-web-bridge/profiles/` (ngoài repo) |
| Listen | thường `172.17.0.1:8456` (Docker bridge) hoặc `127.0.0.1:8456` |

Kiểm tra nhanh:

```bash
sudo systemctl status xvfb-chatgpt chatgpt-web-bridge --no-pager
curl -sS http://172.17.0.1:8456/healthz
# status cần Bearer token — không in token ra log/chat
journalctl -u chatgpt-web-bridge -n 50 --no-pager
```

Provider Settings (admin): type `ChatGPT Web Bridge`, Base URL `http://127.0.0.1:8456` (app rewrite sang `CHATGPT_BRIDGE_BASE_URL`), token = `BRIDGE_ADMIN_TOKEN`.

---

## Kiểm tra sau deploy

```bash
cd ~/img-studio
docker compose ps
docker logs img-studio --tail 100
curl -I https://imgstudio.site/
curl -I "https://img.tam1012.site/gallery?model=test"  # phải trả 308 và giữ path/query
```

Manual check:

1. Mở `/login`.
2. Login admin bằng `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
3. Mở `/settings`, kiểm tra provider cũ còn đủ.
4. Mở `/admin`, kiểm tra danh sách user và legacy images.
5. Tạo user test hoặc đăng ký user mới.
6. Admin nạp 1.000đ cho user test.
7. User test thấy còn 10 ảnh.
8. User test tạo/chỉnh 1 ảnh → số dư giảm 100đ.
9. User test không thấy ảnh user khác.
10. Admin thấy toàn bộ ảnh.
11. Provider lỗi thì user được hoàn tiền và ledger có `refund_image`.
12. User thường: `/api/providers` không có `api_key`/`base_url`/`api_type`/`model`; không thấy ChatGPT Web Bridge.
13. Admin: Settings vẫn thấy/sửa provider; bridge chỉ admin dùng được.

## Nginx

Cấu hình production:

- Domain chính: `/etc/nginx/sites-available/imgstudio.site`, enable qua `/etc/nginx/sites-enabled/imgstudio.site`.
- Domain cũ: `/etc/nginx/sites-enabled/img.tam1012.site` trả 308 về `imgstudio.site`, giữ nguyên `$request_uri`; riêng `/api/payos/webhook` vẫn proxy trực tiếp làm fallback.
- Phải giữ DNS và SSL hợp lệ cho domain cũ để trình duyệt hoàn tất TLS trước khi nhận redirect.

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Upload ảnh nên có `client_max_body_size` đủ lớn cho edit nhiều ảnh.

## SSL Certificate

```bash
sudo certbot certificates
sudo certbot renew --dry-run
```

## Rollback

- Không xóa volume `img-studio_img-data` hoặc `img-studio_img-postgres` khi rollback.
- Nếu deploy mới lỗi trước khi có giao dịch thật, revert commit trên GitHub để Actions deploy lại app cũ.
- Nếu đã phát sinh giao dịch paid v1 trong PostgreSQL, rollback về app JSON cũ sẽ không thấy giao dịch/ảnh mới trong DB, nên chỉ rollback sau khi đã đánh giá dữ liệu cần giữ.

---

*Cập nhật lần cuối: 2026-07-11*
