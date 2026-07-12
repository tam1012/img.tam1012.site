# IMG Studio

Ứng dụng web nội bộ / semi-public để **tạo ảnh**, **chỉnh sửa ảnh** và **tạo video** bằng AI.

Người dùng có tài khoản riêng, ví tiền VND, lịch sử giao dịch (ledger), nạp tiền tự động (PayOS) hoặc nạp thủ công qua admin. Ảnh/video gắn theo chủ sở hữu — user chỉ xem được nội dung của mình, admin xem được toàn bộ.

> Repo này được chuẩn bị để public. README **không** chứa secret, IP server, private key hay credential thật. Các giá trị nhạy cảm chỉ nằm ở `.env` trên máy/VPS và GitHub Secrets.

---

## Mục lục

- [Tính năng chính](#tính-năng-chính)
- [Tech stack](#tech-stack)
- [Kiến trúc tổng quan](#kiến-trúc-tổng-quan)
- [Vai trò người dùng](#vai-trò-người-dùng)
- [Ví tiền & billing](#ví-tiền--billing)
- [AI providers](#ai-providers)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Chạy local](#chạy-local)
- [Biến môi trường](#biến-môi-trường)
- [Database & migration](#database--migration)
- [Docker](#docker)
- [Deploy](#deploy)
- [Bảo mật (mức cao)](#bảo-mật-mức-cao)
- [Tài liệu thêm](#tài-liệu-thêm)
- [Ghi chú phát triển](#ghi-chú-phát-triển)

---

## Tính năng chính

### Tài khoản & phiên đăng nhập

- Đăng ký / đăng nhập bằng **email** hoặc **số điện thoại** + mật khẩu
- Mật khẩu hash bằng `bcryptjs`
- Session cookie `httpOnly` qua `iron-session`
- Role: `admin` | `user`
- User mới được tặng sẵn **1.000đ** (tương đương 10 ảnh ở giá mặc định 100đ/ảnh), ghi ledger
- Chặn email disposable; rate-limit đăng ký / đăng nhập sai theo IP
- User `blocked` không đăng nhập được

### Tạo & chỉnh ảnh

- Trang **Tạo ảnh** (`/generate`): prompt, chọn provider, tỷ lệ, độ phân giải, chất lượng
- **Batch generation**: tạo **1–10 ảnh** cùng lúc; trừ ví một lần cho cả batch; hoàn tiền phần fail (nếu có)
- Trang **Chỉnh sửa ảnh** (`/edit`): upload ảnh + prompt chỉnh sửa
- Hỗ trợ tỷ lệ: `1:1`, `3:2`, `4:3`, `16:9`, `2:3`, `3:4`, `9:16`
- Độ phân giải: `1K` / `1.5K` / `2K` / `4K` (giới hạn theo provider/model)
- Ảnh output lưu WebP + thumbnail trên filesystem
- Polling trạng thái khi request còn `processing`
- Lịch sử prompt để tái sử dụng nhanh
- `Gợi ý cải thiện` cho mọi user đăng nhập: giữ nguyên ngôn ngữ, sửa/hoàn tác trước khi Generate/Edit
- Header `Idempotency-Key` chống trừ/cộng tiền hai lần khi retry

### Video

- Trang **Video** (`/video`) cho user đã đăng nhập
- Model **Google Veo** (Vertex) và **xAI Grok Imagine Video**
- Text-to-video / image-to-video (tuỳ model)
- Stream serve video (không đọc cả file vào RAM)
- Thumbnail bằng `ffmpeg`, gallery click-to-play, nút tải về
- Giá mặc định: `VIDEO_PRICE_VND=5000` / video; admin free khi test
- Prompt Refine dùng chung trên Video với context chuyển động/camera/continuity
- Grok Image/Video gọi direct xAI qua OAuth pool round-robin; Gemini/GPT Image vẫn theo provider runtime hiện tại

### Thư viện

- Gallery ảnh + video theo owner
- User chỉ thấy nội dung của mình
- Admin: tab **Của tôi / Tất cả** (mặc định “Của tôi”)
- Soft-delete ảnh (không xoá file vật lý ngay)
- Endpoint ảnh **không public** — luôn cần session + quyền owner/admin

### Ví & nạp tiền

- Ví VND + ledger đầy đủ (topup / charge / refund / adjust)
- Nạp **PayOS** với gói cố định: 10k / 20k / 50k / 100k (QR nhúng)
- Admin cộng / điều chỉnh tiền thủ công
- Số ảnh còn tạo ≈ `floor(balance / IMAGE_PRICE_VND)`

### Quản trị

- `/admin`: danh sách user, số dư, số ảnh, ledger, nạp/điều chỉnh
- `/settings`: CRUD AI provider (chỉ admin)
- API key provider luôn **mask** khi trả về client; user thường chỉ nhận field công khai

---

## Tech stack

| Thành phần | Công nghệ |
|---|---|
| Framework | Next.js 15 (App Router), React 19 |
| Ngôn ngữ | TypeScript |
| UI | Tailwind CSS v4 |
| Database | PostgreSQL 16 |
| ORM | Prisma |
| Auth / session | iron-session + bcryptjs |
| Ảnh | Filesystem (`/data/images`), sharp |
| Video | Filesystem (`/data/videos`), ffmpeg |
| Thanh toán | PayOS (`@payos/node`) |
| AI SDK | OpenAI-compatible, `@google/genai`, `@google/generative-ai` |
| Deploy | Docker Compose + nginx + Certbot |
| CI/CD | GitHub Actions (push `main` → deploy) |

---

## Kiến trúc tổng quan

```text
Browser
  │ HTTPS
  ▼
nginx (+ SSL)
  │ proxy → :3456
  ▼
Next.js app (standalone)
  ├── Pages: login, generate, edit, gallery, video, billing, admin, settings
  ├── API routes
  ├── Prisma → PostgreSQL
  ├── Filesystem /data (images, videos, thumbs)
  └── AI providers
        ├── OpenAI-compatible (kể cả proxy/relay)
        ├── Google Gemini (API key)
        ├── Google Vertex AI (service account mount)
        ├── ChatGPT Web Bridge (optional, experimental, admin-only)
        └── xAI direct OAuth pool (Grok Image/Video)
```

Luồng tạo ảnh (rút gọn):

```text
POST /api/generate
  → requireUser
  → validate options + Idempotency-Key
  → load provider từ DB
  → tạo Image(status=processing)
  → user: debit ví + ledger charge (admin free)
  → gọi AI provider
  → lưu WebP/thumbnail → status=completed
  → nếu lỗi sau debit: fail image + refund + ledger refund
```

---

## Vai trò người dùng

| | User | Admin |
|---|---|---|
| Tạo / sửa ảnh, tạo video | Có (trừ tiền) | Có (mặc định free) |
| Xem gallery | Chỉ của mình | Của mình + tất cả |
| Settings (provider) | Không | Có |
| Admin panel | Không | Có |
| Provider experimental (ChatGPT bridge) | Không | Có (nếu bật) |

---

## Ví tiền & billing

### Giá mặc định (có thể đổi bằng env)

- Ảnh: `IMAGE_PRICE_VND=100`
- Video: `VIDEO_PRICE_VND=5000`
- Đăng ký mới: tặng **1.000đ**

### Loại ledger

| Type | Ý nghĩa |
|---|---|
| `topup_manual` | Nạp/tặng thủ công (kể cả credit đăng ký) |
| `topup_payos` | Nạp qua PayOS |
| `charge_image` / `refund_image` | Trừ / hoàn khi tạo-sửa ảnh |
| `charge_video` / `refund_video` | Trừ / hoàn khi tạo video |
| `adjust_manual` | Điều chỉnh bởi admin |

### Nguyên tắc tiền

- Không cho số dư âm
- Charge/refund chạy trong transaction + ledger
- Dùng `Idempotency-Key` cho generate/edit/admin wallet adjust
- Provider fail sau khi đã trừ → refund

### PayOS

- User chọn gói trên `/billing`
- App tạo order → webhook xác nhận → cộng ví + ledger `topup_payos`
- Cần cấu hình `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` và base URL app
- **Không** commit credential PayOS vào repo

---

## AI providers

Provider cấu hình trên UI **Cài đặt** (admin), lưu server-side trong PostgreSQL.  
User-facing `GET /api/providers` chỉ trả field an toàn:

- `id`, `name`, `is_default`, `max_edit_images`, `max_resolution`

Admin Settings mới thấy config quản trị + API key đã mask.

### `api_type` hỗ trợ

| api_type | Mô tả |
|---|---|
| `openai` | OpenAI-compatible; hỗ trợ custom base URL (proxy/relay) |
| `gemini` | Google Gemini bằng API key |
| `vertex` | Google Vertex AI bằng service account JSON (mount runtime) |
| `chatgpt_bridge` | Bridge nội bộ gọi ChatGPT web — **experimental, chỉ admin**, không hỗ trợ edit |

Runtime provider hiện tập trung ở `src/lib/providers/custom.ts` (re-export qua `index.ts`).

Grok là ngoại lệ có chủ đích: `grok-imagine-image*` và Grok Video gọi thẳng `api.x.ai`. CPA chỉ quản lý/refresh OAuth; app dùng pool copy read-only tự đồng bộ mỗi phút. Request direct không xuất hiện trong CPA Manager Plus.

### ChatGPT Web Bridge (optional)

- Service Python/FastAPI chạy **trên host** (không nằm trong container app)
- App Docker gọi qua `CHATGPT_BRIDGE_BASE_URL` (compose mẫu: `host.docker.internal:8456`)
- Code mẫu: thư mục `chatgpt-web-bridge/`
- Không ổn định như API chính thức (login web, CAPTCHA, UI đổi, rate-limit…)
- Token bridge, Chrome profile, path host **không** commit vào repo

---

## Cấu trúc thư mục

```text
.
├── chatgpt-web-bridge/     # Optional bridge experimental (host service)
├── docs/                   # Kiến trúc, deploy, changelog, decisions
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   ├── check-env.js
│   ├── seed-admin.js
│   └── migrate-db-json-to-postgres.js
├── src/
│   ├── app/                # App Router pages + API routes
│   ├── components/
│   └── lib/                # auth, wallet, providers, video, payos, storage...
├── public/
├── Dockerfile
├── docker-compose.yml
├── nginx.conf              # Mẫu reverse proxy (domain placeholder)
├── .env.example
└── package.json
```

### Trang chính

| Path | Mục đích |
|---|---|
| `/login` | Đăng nhập / đăng ký |
| `/generate` | Tạo ảnh |
| `/edit` | Chỉnh sửa ảnh |
| `/gallery` | Thư viện |
| `/video` | Tạo video |
| `/billing` | Số dư, nạp PayOS, ledger |
| `/admin` | Quản trị user & ví |
| `/settings` | Quản lý AI provider |

### API (nhóm chính)

```text
POST /api/auth/register | login | logout
GET  /api/me
GET  /api/wallet | /api/wallet/ledger
POST /api/generate | /api/edit
GET  /api/gallery | /api/images/[id]
GET|POST /api/providers | /api/providers/[id]
POST /api/video/generate
GET  /api/video/list | /api/video/[id] | /api/video/[id]/thumb
POST /api/payos/create
POST /api/payos/webhook
GET|POST /api/admin/users...
```

---

## Chạy local

### Yêu cầu

- Node.js 22+ (khuyến nghị, khớp Docker base)
- PostgreSQL 16 (local hoặc Docker)
- npm

### Các bước

```bash
# 1. Clone
git clone https://github.com/tam1012/img.tam1012.site.git
cd img.tam1012.site

# 2. Cài dependency
npm install

# 3. Env
cp .env.example .env
# Sửa SESSION_SECRET, DATABASE_URL, POSTGRES_PASSWORD,
# ADMIN_EMAIL, ADMIN_PASSWORD, giá ảnh/video nếu cần

# 4. DB
npx prisma generate
npx prisma migrate deploy
# hoặc: npm run prisma:migrate  (dev)

# 5. (Tuỳ chọn) seed admin
npm run seed:admin

# 6. Dev server
npm run dev
```

Mở dev URL Next.js (mặc định `http://localhost:3000` với `next dev`).  
Production start script lắng nghe port **3456**:

```bash
npm run build
npm start   # next start -p 3456
```

### Scripts npm

| Script | Việc |
|---|---|
| `dev` | Next dev + Turbopack |
| `build` | Production build |
| `start` | Chạy production port 3456 |
| `prisma:generate` | Generate Prisma client |
| `prisma:migrate` | Migrate dev |
| `seed:admin` | Tạo/cập nhật admin từ env |
| `check:env` | Kiểm tra env bắt buộc |
| `migrate:legacy` | Import `db.json` cũ → Postgres (một lần) |

---

## Biến môi trường

Chỉ liệt kê **tên** biến. Giá trị thật đặt trong `.env` local/VPS, không commit.

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `SESSION_SECRET` | Có | Secret session (≥ 32 ký tự ngẫu nhiên) |
| `POSTGRES_PASSWORD` | Có (Docker) | Password user Postgres compose |
| `DATABASE_URL` | Có | Connection string Prisma |
| `IMAGE_PRICE_VND` | Không (mặc định 100) | Giá mỗi ảnh |
| `VIDEO_PRICE_VND` | Không (mặc định 5000) | Giá mỗi video |
| `ADMIN_EMAIL` | Có (seed) | Email admin seed |
| `ADMIN_PASSWORD` | Có (seed) | Password admin seed |
| `DATA_DIR` | Không (mặc định `./data` hoặc `/data`) | Thư mục lưu ảnh/video |
| `PAYOS_CLIENT_ID` | Nếu dùng PayOS | Client ID |
| `PAYOS_API_KEY` | Nếu dùng PayOS | API key |
| `PAYOS_CHECKSUM_KEY` | Nếu dùng PayOS | Checksum key |
| `APP_BASE_URL` | Khuyến nghị khi PayOS | Base URL return/cancel |
| `XAI_AUTH_DIR` | Compose set | Pool OAuth xAI read-only cho Grok Image/Video |
| `PROMPT_REFINE_BASE_URL` | Nếu bật refine | CPA/OpenAI-compatible endpoint |
| `PROMPT_REFINE_API_KEY` | Nếu bật refine | Key server-side, không trả client |
| `PROMPT_REFINE_MODEL` | Không | Mặc định `gemini-3-flash-agent` |
| `CHATGPT_BRIDGE_BASE_URL` | Tuỳ bridge | URL bridge host |
| `GOOGLE_APPLICATION_CREDENTIALS` | Nếu Vertex | Path service account (runtime) |

**Lưu ý:** API key của hầu hết image provider cấu hình trên web Settings, **không** nhét vào `.env` (trừ credential mount kiểu Vertex / xAI OAuth file).

Xem mẫu đầy đủ: [`.env.example`](.env.example).

---

## Database & migration

Schema Prisma gồm các model chính:

- `User`, `Wallet`, `WalletLedger`
- `Provider`, `Image`, `Video`
- `PayosOrder`

Mọi thay đổi schema **phải** có file migration trong `prisma/migrations/` và được commit cùng code.

Migrations hiện có (tóm tắt):

1. `paid_v1` — user/wallet/ledger/provider/image
2. `add_payos` — order PayOS + ledger `topup_payos`
3. `add_video_table` — video + charge/refund video
4. `add_batch_id` — batch generation

Production container start:

```text
check-env → prisma migrate deploy → seed-admin
  → (optional) import legacy db.json một lần
  → node server.js
```

Legacy `db.json` **không** còn là runtime DB; chỉ dùng import dữ liệu cũ.

---

## Docker

```bash
# Cần file .env hợp lệ + (nếu Vertex/xAI) secrets mount
docker compose up -d --build
```

Services:

| Service | Container | Vai trò |
|---|---|---|
| `db` | `img-studio-db` | PostgreSQL 16 |
| `app` | `img-studio` | Next.js app, port **3456** |

Volumes:

- `img-postgres` — data Postgres
- `img-data` — `/data` (ảnh, video, marker import…)
- `./secrets/xai-auths` → `/run/secrets/xai-auths:ro` — pool OAuth xAI đã anonymize

Dockerfile:

- Multi-stage Node 22 Alpine
- `output: "standalone"`
- Cài `ffmpeg` cho thumbnail video
- User non-root `nextjs`

Mẫu nginx reverse proxy: [`nginx.conf`](nginx.conf) (domain là placeholder `YOUR_DOMAIN_HERE`).

---

## Deploy

Luồng chuẩn của project:

1. Sửa & kiểm tra **local**
2. Commit + push nhánh **`main`**
3. GitHub Actions SSH lên VPS:
   - `git fetch` + `reset --hard origin/main`
   - cài/enable timer sync OAuth xAI và sync một lần trước deploy
   - (nếu có) sync `chatgpt-web-bridge` lên host service
   - backup `/data` trước build (giữ vài bản gần nhất)
   - `docker compose build --no-cache app && up -d`
   - dọn build cache / image cũ

GitHub Secrets cần (tên, không commit giá trị):

- `SSH_PRIVATE_KEY`
- `VPS_HOST`
- `VPS_USER`

**Lưu ý vận hành:**

- Workflow hiện **không** có concurrency lock — tránh push 2 deploy sát nhau
- Trước migration lớn: backup volume `/data` và `pg_dump` DB
- Không commit `.env`, `secrets/`, private key, service account JSON

Chi tiết hơn: [`docs/deployment.md`](docs/deployment.md) (một số placeholder đã được làm sạch cho public).

---

## Bảo mật (mức cao)

- Session cookie httpOnly; secret dài ngẫu nhiên
- Password bcrypt cost 12
- Middleware chỉ là lớp chặn nhẹ; **quyền thật check trong API**
- Ảnh/video private theo owner
- Provider config/API key không lộ full ra client user
- ChatGPT bridge ẩn với non-admin
- Rate-limit đăng ký / login fail theo IP
- Chặn email disposable
- Security headers (HSTS, nosniff, frame options…) ở Next config + nginx mẫu
- `.gitignore` loại trừ `.env`, `data/`, `secrets/`, credential patterns, một số docs local-only

**Không đưa vào public repo:** token, password, service account, OAuth file, webhook secret, IP/private SSH key, nội dung `docs/payos.txt` và các dump local-only.

---

## Tài liệu thêm

Trong `docs/` (public-safe / đã sanitize một phần):

| File | Nội dung |
|---|---|
| [`architecture.md`](docs/architecture.md) | Kiến trúc hệ thống |
| [`deployment.md`](docs/deployment.md) | Triển khai & vận hành |
| [`decisions.md`](docs/decisions.md) | Quyết định thiết kế |
| [`changelog.md`](docs/changelog.md) | Lịch sử thay đổi đáng kể |

Một số file docs local-only (có thể chứa secret/dump lớn) bị ignore — xem `.gitignore`.

Bộ nhớ vận hành cho AI agent: [`AGENTS.md`](AGENTS.md) (có thể lệch nhẹ so với code mới nhất; ưu tiên schema + source).

---

## Ghi chú phát triển

### Quy ước khi sửa

- Sửa **đúng chỗ** liên quan yêu cầu; không tiện tay refactor lan sang vùng khác
- Mọi thay đổi tiền/quota: giữ transaction, ledger, idempotency, refund
- Mọi thay đổi schema: **có migration file trong repo**
- Generate/edit/admin wallet: luôn nghĩ tới retry và double-charge
- User-facing provider API: không trả `api_key` / `base_url` / `api_type` / `model`

### Kiểm tra trước khi coi là xong

```bash
npx prisma generate
npx tsc --noEmit
npm run build
```

Với thay đổi runtime: smoke test login → generate → gallery → (nếu đụng tiền) ledger/balance.

### License / phạm vi

Project phục vụ sử dụng nội bộ / nhóm nhỏ với thu phí ví VND.  
Không phải SDK public cho bên thứ ba. Tự host và tự chịu trách nhiệm cấu hình provider, thanh toán, và tuân thủ điều khoản của từng nhà cung cấp AI.

---

## Tóm tắt nhanh “chạy được cái gì”

| Việc | Cách kiểm chứng |
|---|---|
| Đăng ký user mới | Có 1.000đ, vào được `/generate` |
| Tạo 1 ảnh | Trừ 100đ (user), ảnh hiện gallery |
| Tạo batch 3 ảnh | Trừ 300đ nếu đủ 3 ảnh thành công |
| Provider lỗi | Ledger có refund, số dư hồi lại |
| Video | File stream + thumb gallery |
| PayOS | Chọn gói → QR → webhook → cộng ví |
| Admin | Settings CRUD provider, Admin nạp tiền |

---

*Cập nhật README: 2026-07-09 — bám theo paid v1 + video + PayOS + batch + provider public fields + ChatGPT bridge experimental.*
