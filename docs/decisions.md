# Quyết định thiết kế — IMG Studio

## 2026-07-11: Grok Image/Video gọi direct xAI qua OAuth pool

**Quyết định:** Bỏ CPA request router cho Grok Image/Video; app gọi thẳng `api.x.ai`, còn CPA chỉ quản lý/refresh OAuth gốc.

**Lý do:** CPA v7.2.65/v7.2.66 trả 503 ngay trên đúng `/v1/images/generations`; direct xAI production test thành công và nhanh hơn rõ rệt.

**Hệ quả:** Request Grok không hiện trong CPA Manager Plus. App tự round-robin, cooldown quota và log account bằng ID vô danh.

---

## 2026-07-11: Tự đồng bộ pool OAuth xAI

**Quyết định:** systemd timer mỗi phút copy atomically riêng `xai-*.json` từ CPA sang thư mục read-only của app.

**Lý do:** Thêm/xóa/refresh account phải tự phản ánh mà không restart container, nhưng không được mount toàn bộ auth directory chứa token provider khác.

**Hệ quả:** File không đổi không bị replace; account thay đổi được nhận trong khoảng một phút.

---

## 2026-07-11: Prompt Refine public nhưng là preflight độc lập

**Quyết định:** Mọi user đăng nhập dùng refine trên Generate/Edit/Video; không tự refine trong pipeline và chưa tính phí.

**Lý do:** Giữ quyền kiểm soát cho user, dễ hoàn tác, không làm phức tạp charge/idempotency/provider flow.

**Hệ quả:** API có rate limit riêng; model/context refine có thể đổi mà không chạm API tạo nội dung.

---

## 2026-07-08: PayOS cho nạp tiền tự động

**Quyết định:** Billing hỗ trợ các gói PayOS cố định; webhook verify checksum rồi cộng ví idempotent. Admin vẫn có thể điều chỉnh thủ công.

**Hệ quả:** Quyết định “chỉ thanh toán thủ công” ngày 2026-07-03 đã bị thay thế.

---

## 2026-07-03: Chuyển sang paid v1 nội bộ bằng PostgreSQL + Prisma

**Quyết định:** IMG Studio chuyển từ prototype mật khẩu chung sang bản nội bộ có user riêng, ví tiền VND, ledger và admin nạp tiền thủ công. Runtime data dùng PostgreSQL qua Prisma.

**Lý do:**
- Tiền/quota cần transaction chắc chắn; JSON file không đủ an toàn khi có request song song.
- Cần phân quyền ảnh theo từng user, không dùng `created_by = guest/admin` chung nữa.
- Cần ledger để audit mọi topup/charge/refund.
- PostgreSQL phù hợp nếu sau này mở rộng public/payment tự động.

**Hệ quả:**
- Docker Compose có thêm service `img-studio-db` và volume Postgres.
- `db.json` chỉ còn là legacy import source, không dùng runtime.
- Deploy cần migration Prisma và backup `/data` trước lần chuyển đổi đầu.

---

## 2026-07-03: Admin free trong v1

**Quyết định:** Admin không bị trừ tiền khi tạo/chỉnh ảnh; ảnh admin vẫn gắn `userId` thật.

**Lý do:** Admin cần test provider/vận hành mà không làm nhiễu số dư.

**Hệ quả:** Ledger charge/refund chỉ phát sinh cho user thường. Báo cáo chi phí nội bộ nếu cần sau này phải tính riêng ảnh admin.

---

## 2026-07-09: ChatGPT Web Bridge chỉ admin, experimental

**Quyết định:** Thêm `api_type = chatgpt_bridge` gọi worker FastAPI + `chatgpt-imagegen` (ChatGPT web). Chỉ admin thấy/dùng. Không hỗ trợ edit. Không coi là provider production.

**Lý do:** Tận dụng subscription ChatGPT web khi cần; web automation vốn CAPTCHA/login/rate-limit/UI đổi → không ổn định như API.

**Hệ quả:** Cần systemd + Xvfb + Chrome profile ngoài repo; container gọi qua `CHATGPT_BRIDGE_BASE_URL`. User thường bị ẩn/chặn. Ổn định lâu dài vẫn ưu tiên provider API chính thức.

---

## 2026-07-09: Siết payload GET /api/providers theo role

**Quyết định:** User chỉ nhận field công khai (`id`, `name`, `is_default`, `max_edit_images`, `max_resolution`). Admin Settings nhận config quản trị + key mask. Client generate/edit chỉ gửi `provider_id`.

**Lý do:** Không phơi base_url/api_type/model/key (kể cả mask) ra browser user; backend tự resolve config.

**Hệ quả:** UI phụ thuộc hint an toàn (`max_resolution`) thay vì tên model phía client. Settings admin vẫn đủ để CRUD provider.

---

## 2026-07-03: Thanh toán thủ công, chưa tích hợp payment gateway (đã thay thế bởi PayOS)

**Quyết định:** V1 chưa tích hợp VietQR/PayOS/SePay. User xem hướng dẫn chuyển khoản ở `/billing`; admin cộng tiền ở `/admin`.

**Lý do:** Nhóm dùng nhỏ/nội bộ, ưu tiên core wallet/ledger/permission chạy chắc trước.

**Hệ quả:** Admin cần đối soát và nạp tiền thủ công; ledger vẫn ghi note để audit.

---

## 2026-07-03: Ảnh private theo owner

**Quyết định:** `/api/images/[id]` không còn public. Route phải require session; admin xem mọi ảnh, user chỉ xem ảnh của mình.

**Lý do:** Paid v1 có user riêng, ảnh của từng user phải riêng tư.

**Hệ quả:** Link ảnh chỉ hoạt động khi người xem đã đăng nhập đúng tài khoản. Chưa có share token/public gallery trong v1.

---

## 2026-06-22: Chọn Next.js 15 thay vì Express + static files

**Quyết định:** Dùng Next.js 15 (App Router) làm framework chính.

**Lý do:**
- Xử lý cả frontend (React) lẫn backend (API routes) trong 1 project.
- Hệ sinh thái React quen thuộc.
- Build `standalone` output cho Docker image nhẹ.
- Turbopack dev server nhanh.

**Hệ quả:** Cần Node.js runtime; không phải static hosting.

---

## 2026-06-22: Lưu ảnh trên filesystem thay vì database/cloud storage

**Quyết định:** Ảnh tạo xong được encode WebP và lưu trong `/data/images/`.

**Lý do:**
- URL ảnh từ AI API là tạm thời.
- Filesystem đơn giản, không cần S3/GCS cho v1.
- Dễ backup cùng Docker volume.

**Hệ quả:** Dung lượng disk phụ thuộc số ảnh tạo; cần monitor và backup `/data`.

---

## 2026-06-22: Docker thay vì PM2

**Quyết định:** Deploy bằng Docker Compose thay vì PM2 trực tiếp.

**Lý do:**
- Nhất quán với các project khác trên VPS.
- Isolate dependencies.
- Volume giữ data persist qua rebuild.
- Dễ rollback theo image/commit.

**Hệ quả:** Build time chậm hơn PM2; cần Docker daemon chạy.

---

## 2026-06-22: Dynamic provider management

**Quyết định:** Provider do admin cấu hình trên Settings, không hardcode API key trong env/source.

**Lý do:** Dễ thêm proxy/model mới mà không sửa code.

**Hệ quả:** API key lưu server-side trong DB. User-facing list không trả config nhạy cảm; admin Settings mask key. Runtime hỗ trợ OpenAI-compatible, Gemini, Vertex, và ChatGPT web bridge (admin-only experimental).

---

## Quyết định đã thay thế

### 2026-06-22: JSON file thay vì SQLite

**Trạng thái:** Đã thay thế ngày 2026-07-03.

JSON file từng phù hợp prototype nhỏ vì tránh native build trên Windows. Với paid v1 có tiền/quota, JSON không còn phù hợp vì thiếu transaction và dễ lỗi khi request song song.

### 2026-06-22: Auth bằng 2 mật khẩu `AUTH_PASSWORD`/`GUEST_PASSWORD`

**Trạng thái:** Đã thay thế ngày 2026-07-03.

Luồng mới dùng user thật, password hash, session `userId` + `role`. Biến cũ không còn là auth chính.

---

*Cập nhật lần cuối: 2026-07-09*
