# Changelog — IMG Studio

## 2026-07-11 — Public Prompt Refine + direct xAI OAuth pool

- Mở `Gợi ý cải thiện` cho mọi user đã đăng nhập trên Generate, Edit và Video.
- Dùng `gemini-3-flash-agent`, giữ nguyên ngôn ngữ gốc, preview/sửa/hoàn tác; rate limit 10 lần/phút/user.
- Grok Image và Grok Video chuyển sang gọi trực tiếp `api.x.ai`, bỏ CPA request router bị regression ở v7.2.65/v7.2.66.
- Thêm pool OAuth xAI round-robin, cooldown 429/quota, reload 401; video giữ cùng account trong toàn bộ job.
- Thêm systemd timer đồng bộ account xAI từ CPA mỗi phút; add/remove/refresh tự phản ánh, file không đổi không bị ghi lại.
- Production smoke test xác nhận Grok Image Quality và Video thành công, rotation qua nhiều account ID vô danh.

## 2026-07-09 — ChatGPT Web Bridge (admin-only) + siết /api/providers

- Thêm provider `chatgpt_bridge` gọi service bridge nội bộ (ChatGPT web qua `chatgpt-imagegen`), experimental.
- Bridge chỉ admin: ẩn khỏi `GET /api/providers` với user thường; `/api/generate` và `/api/edit` chặn non-admin (403).
- `GET /api/providers` tách payload:
  - User: `id`, `name`, `is_default`, `max_edit_images`, `max_resolution` (không lộ key/base_url/api_type/model).
  - Admin Settings: config quản trị + `api_key` mask.
- UI Generate/Edit dùng `max_resolution` thay vì đọc tên model phía client.
- Deploy: container gọi bridge qua `CHATGPT_BRIDGE_BASE_URL` / `host.docker.internal`; worker host systemd port 8456.

---

## 2026-07-08 — Video performance: streaming + thumbnail + click-to-play

- Video serve endpoint chuyển từ `readFileSync` (đọc toàn bộ file vào RAM) sang `createReadStream` + `Readable.toWeb()` — chỉ đọc đúng byte range browser yêu cầu.
- Thêm endpoint `/api/video/[id]/thumb` — trích frame đầu bằng ffmpeg, cache tại `/data/videos/thumbs/{id}.jpg`.
- Gallery chuyển sang click-to-play: hiện thumbnail + play icon, chỉ tải `<video>` khi bấm vào.
- Thêm nút tải về cho mỗi video trong gallery.
- Dockerfile thêm `ffmpeg` (alpine).

---

## 2026-07-03 — Signup credit 1.000đ

- User mới đăng ký được tạo ví với số dư ban đầu 1.000đ.
- Ledger ghi `topup_manual` với ghi chú `Tặng 10 ảnh khi tạo tài khoản` để audit được khoản tặng này.

---

## 2026-07-03 — Paid v1 nội bộ

### Tính năng mới

- Chuyển từ mật khẩu chung sang user account riêng:
  - Đăng ký bằng email hoặc số điện thoại.
  - Đăng nhập bằng email/số điện thoại + mật khẩu.
  - Session chứa user thật (`userId`, `role`).
- Thêm PostgreSQL + Prisma cho runtime data.
- Thêm ví tiền VND cho user:
  - Giá mặc định `IMAGE_PRICE_VND=100`/ảnh.
  - Số ảnh còn tạo được = `floor(balance / IMAGE_PRICE_VND)`.
  - Generate/edit thành công trừ tiền user thường.
  - Provider fail thì refund và ghi ledger.
- Thêm ledger giao dịch:
  - `topup_manual`
  - `adjust_manual`
  - `charge_image`
  - `refund_image`
- Thêm `/admin`:
  - Danh sách user.
  - Balance/quota/số ảnh.
  - Xem ledger.
  - Cộng tiền/điều chỉnh thủ công.
- Thêm `/billing`:
  - User xem số dư/quota.
  - Hướng dẫn chuyển khoản thủ công.
  - Xem ledger cá nhân.
- Gallery và image access theo owner:
  - User chỉ thấy/xem ảnh của chính mình.
  - Admin xem toàn bộ ảnh.
  - `/api/images/[id]` không còn public.
- Thêm script seed admin và import legacy `db.json` sang PostgreSQL.

### Thay đổi kiến trúc

- `db.json` không còn là runtime database cho provider/image/wallet; chỉ dùng legacy migration.
- Docker Compose thêm service `img-studio-db` và volume `img-postgres`.
- Startup production chạy Prisma migrate + seed admin + import legacy một lần.
- Provider config chuyển sang DB, API key vẫn mask khi trả về client.
- Header hiển thị user, số dư và số ảnh còn lại.

### Env mới

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `IMAGE_PRICE_VND`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

---

## 2026-06-22 — Guest quota đổi sang 50 ảnh/ngày

- Quota khách đổi từ giới hạn tổng → **50 ảnh/ngày** (tạo + chỉnh sửa tính chung, reset theo ngày UTC).
- Mục này là lịch sử prototype; paid v1 đã thay quota guest bằng ví tiền theo user.

---

## 2026-06-22 — Tài khoản khách

- Thêm role **guest** với mật khẩu riêng (`GUEST_PASSWORD`).
- Guest không truy cập được trang Settings.
- Hiện badge "Khách" trên header.
- Mục này là lịch sử prototype; paid v1 không còn dùng guest chung.

---

## 2026-06-22 — Dynamic Provider Management

### Tính năng mới

- Trang Cài đặt (Settings) quản lý AI provider trên giao diện web:
  - Thêm/sửa/xoá provider.
  - Mỗi provider: tên, loại API, base URL, API key, model.
  - Hỗ trợ custom base URL cho proxy/relay services.
  - Đặt provider mặc định.
  - API key hiển thị đã mask.
- Lịch sử prompt — panel trên trang Tạo ảnh, click để tái sử dụng prompt cũ.
- Bỏ hardcoded providers — không cần set API key trong `.env` nữa.

### Thay đổi kiến trúc

- Ban đầu provider config lưu trong `db.json`; paid v1 đã chuyển sang PostgreSQL.
- API routes: `/api/providers`, `/api/providers/[id]`, `/api/prompts`.
- Nav bar thêm link "Cài đặt".

---

## 2026-06-22 — Initial Release

### Tính năng

- Trang tạo ảnh AI với Google Gemini và OpenAI.
- Trang chỉnh sửa ảnh (upload + prompt).
- Thư viện ảnh với modal xem chi tiết.
- Đăng nhập bằng mật khẩu chung.
- Tải ảnh về máy.
- Giao diện dark theme, responsive.
- Phím tắt Ctrl+Enter để tạo/sửa ảnh nhanh.

### Hạ tầng

- Deploy Docker trên VPS Oracle Singapore.
- nginx reverse proxy + SSL (Certbot).
- GitHub Actions CI/CD (push main → auto deploy).
- JSON file-based storage cho metadata ở prototype.
- Filesystem storage cho ảnh.

---

*Mỗi thay đổi đáng kể sẽ được ghi lại ở đây.*
