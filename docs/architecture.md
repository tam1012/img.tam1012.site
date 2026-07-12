# Kiến trúc hệ thống — IMG Studio

## Tổng quan

IMG Studio hiện là app tạo/chỉnh ảnh và video AI có tài khoản riêng, ví tiền VND và ledger giao dịch.

```text
Browser
  │ HTTPS
  ▼
nginx / Certbot
  │ HTTP :3456
  ▼
Next.js 15 App Router
  ├── Pages React: login, generate, edit, video, gallery, billing, admin, settings
  ├── API routes
  ├── Prisma Client
  │     ▼
  │   PostgreSQL 16 (img-studio-db)
  ├── Filesystem /data (ảnh, video, thumbnail)
  └── AI providers
        ├── OpenAI-compatible
        ├── Google Gemini
        ├── Google Vertex AI
        ├── ChatGPT Web Bridge (host systemd :8456, admin-only experimental)
        └── xAI direct (Grok Image/Video) qua OAuth pool read-only
```

## Auth và user

- Session dùng `iron-session`, cookie `img-session`, httpOnly.
- Session chứa `userId` và `role` (`admin` hoặc `user`).
- User đăng nhập bằng email hoặc số điện thoại + mật khẩu hash bằng `bcryptjs`.
- User bị `blocked` không được coi là đăng nhập hợp lệ.

Các route chính:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/me
```

`/api/me` trả user public info và wallet summary: số dư, giá mỗi ảnh, số ảnh còn tạo được.

## Database

Runtime metadata dùng PostgreSQL qua Prisma. `db.json` legacy chỉ dùng để import dữ liệu cũ.

Các model chính:

- `User` — email/phone/passwordHash/role/status.
- `Wallet` — số dư VND theo user.
- `WalletLedger` — ledger audit mọi topup/charge/refund/adjust.
- `Provider` — cấu hình AI provider, API key server-side.
- `Image` — metadata ảnh, owner `userId`, status, cost, provider, filename.

## Luồng tạo ảnh

```text
Client → POST /api/generate
  1. API requireUser()
  2. Validate prompt/provider/aspect/resolution/quality
  3. Load provider enabled từ DB
  4. Create Image status=processing, gắn userId
  5. Nếu role=user: debit wallet trong transaction, ghi ledger charge_image
     - API yêu cầu `Idempotency-Key` để retry không bị double-charge
  6. Gọi AI provider
  7. Lưu file webp + thumbnail vào /data/images
  8. Update Image status=completed + filename/mime/model
  9. Trả image URL

Nếu lỗi sau khi đã debit:
  - Update Image status=failed
  - Refund wallet trong transaction, ghi ledger refund_image
```

Admin mặc định không bị trừ tiền để test vận hành dễ hơn.

## Luồng chỉnh sửa ảnh

`POST /api/edit` tương tự generate, nhưng input là `FormData` gồm nhiều ảnh, prompt và provider. API vẫn giữ các guard hiện có:

- Tổng upload tối đa 9.5MB.
- Wan2.7 edit không cho chọn 4K.
- Provider fail thì refund nếu user đã bị charge.

## Prompt Refine

`POST /api/prompt-refine` là preflight độc lập, không nằm trong generate/edit/video transaction:

- Mọi user đã đăng nhập được dùng; rate limit 10 lần/phút/user.
- `gemini-3-flash-agent` rewrite theo mode `generate|edit|video` và giữ nguyên ngôn ngữ gốc.
- Component chung cho phép sửa/hoàn tác trước khi user gửi prompt cuối vào API tạo nội dung.
- Refine fail không charge, không ghi ledger và không thay đổi prompt hiện tại.

## Gallery và quyền ảnh

- User thường chỉ thấy ảnh `userId` của chính mình, `status=completed`, chưa soft delete.
- Admin thấy toàn bộ ảnh và thấy owner label.
- `GET /api/images/[id]` luôn require session:
  - admin xem được mọi ảnh;
  - user chỉ xem được ảnh của chính mình.
- `DELETE /api/images/[id]` soft delete, không xóa file vật lý.

## Provider runtime

Provider runtime vẫn tập trung ở `src/lib/providers/custom.ts` và re-export qua `src/lib/providers/index.ts`.

`api_type` hỗ trợ:

- `openai` — OpenAI-compatible, có custom base URL; Gemini/Imagen qua proxy tự route sang chat completions khi cần.
- `gemini` — Google Gemini API key trực tiếp.
- `vertex` — Google Vertex AI dùng service account JSON mount server-side.
- `chatgpt_bridge` — bridge nội bộ gọi ChatGPT web (experimental, **admin-only**). Không hỗ trợ edit. Không coi là provider production ổn định.

Ngoại lệ xAI:

- `grok-imagine-image*` không dùng `config.base_url` CPA; backend gọi thẳng `api.x.ai` qua `xai-auth-pool.ts`.
- Grok Video dùng cùng pool và cố định account trong cả vòng đời job.
- CPA chỉ quản lý/refresh OAuth gốc. Timer host sync riêng file xAI sang thư mục app; request direct không hiện trong CPA Manager Plus.

Provider config lưu trong DB (server-side). `GET /api/providers`:

- **User:** chỉ `id`, `name`, `is_default`, `max_edit_images`, `max_resolution` — không trả `api_key`/`base_url`/`api_type`/`model`.
- **Admin:** field quản trị Settings + `api_key` mask (`****xxxx`), không full key.

Generate/edit client chỉ gửi `provider_id`; backend tự load full config và gọi provider.

Bridge (khi bật): app Docker → `CHATGPT_BRIDGE_BASE_URL` (thường `http://host.docker.internal:8456`) → FastAPI host → `chatgpt-imagegen --backend web` + Chrome profile ngoài repo.

## Storage ảnh

- Ảnh output encode về WebP chất lượng cao.
- File chính: `/data/images/{imageId}.webp`.
- Thumbnail: `/data/images/{imageId}.thumb.webp`.
- Thumbnail lỗi thì fallback ảnh gốc, không làm hỏng luồng chính.

## Middleware

Middleware chỉ kiểm tra cookie tồn tại để redirect sớm:

Public route:

```text
/login
/api/auth
/api/auth/login
/api/auth/register
/api/auth/logout
/favicon.ico
```

Không public `/api/images/`. Mọi quyền thật vẫn phải check trong API route.

## Admin và billing

- `/admin` chỉ admin truy cập: xem users, balance, số ảnh, ledger, cộng/điều chỉnh tiền.
- `/billing` cho user xem số dư, quota, ledger và nội dung chuyển khoản thủ công.

---

*Cập nhật lần cuối: 2026-07-09*
