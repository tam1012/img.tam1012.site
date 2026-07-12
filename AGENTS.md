# AGENTS.md — IMG Studio

> Bộ nhớ dài hạn của dự án cho AI Agent. Đọc file này trước khi làm thay đổi lớn.

## Mục tiêu

Công cụ tạo/chỉnh ảnh và video bằng AI cho nhóm nhỏ/semi-public. Bản hiện tại là **paid v1**: có tài khoản riêng, ví VND, ledger, PayOS nạp tự động và admin điều chỉnh thủ công.

## Vai trò sử dụng

- **Admin** — user role `admin`, xem toàn bộ ảnh, quản lý provider, quản lý user, cộng/trừ tiền, mặc định không bị trừ tiền khi tạo/chỉnh ảnh.
- **User** — user role `user`, chỉ xem ảnh của chính mình, bị trừ tiền theo giá mỗi ảnh.

## Chức năng chính

1. **Đăng ký/đăng nhập** bằng email hoặc số điện thoại + mật khẩu.
2. **Tạo ảnh** — mỗi ảnh thành công trừ `IMAGE_PRICE_VND` (mặc định 100đ), provider lỗi thì hoàn tiền.
3. **Chỉnh sửa ảnh** — cùng cơ chế charge/refund như tạo ảnh.
4. **Thư viện riêng theo user** — admin xem tất cả, user chỉ xem ảnh của mình.
5. **Quản lý provider** — CRUD provider trong giao diện web, API key luôn mask khi trả về client.
6. **Ví tiền & ledger** — theo dõi số dư, số ảnh còn tạo được, lịch sử topup/charge/refund.
7. **Admin page** — xem danh sách user, balance, số ảnh, ledger, nạp/điều chỉnh tiền thủ công.
8. **Billing page** — PayOS + lịch sử giao dịch cho user.
9. **Tạo video** — Google Veo và Grok Imagine Video, charge/refund như ảnh.
10. **Prompt Refine** — mọi user đã đăng nhập dùng `gemini-3-flash-agent` trên Generate/Edit/Video; preview, sửa và hoàn tác trước khi gửi.

## Tech stack

| Thành phần | Công nghệ |
|---|---|
| Framework | Next.js 15 (App Router) |
| Styling | Tailwind CSS v4 |
| Ngôn ngữ | TypeScript |
| Database | PostgreSQL 16 |
| ORM | Prisma |
| Auth | iron-session |
| Password hash | bcryptjs |
| Ảnh | Filesystem `/data/images/` |
| Legacy import | `db.json` chỉ dùng cho migration |
| Deploy | Docker Compose + nginx + Certbot |
| CI/CD | GitHub Actions |

## Kiến trúc tổng quan

```text
Browser → nginx → Next.js app (3456)
                  ├── App Router pages
                  ├── API routes
                  ├── Prisma → PostgreSQL
                  ├── Providers runtime (openai/gemini/vertex)
                  ├── Grok Image/Video → api.x.ai trực tiếp qua OAuth pool
                  └── Filesystem /data/images
```

## Cấu trúc thư mục chính

```text
prisma/
├── schema.prisma
└── migrations/

scripts/
├── seed-admin.js
├── migrate-db-json-to-postgres.js
└── sync-xai-auth-pool.py

src/
├── app/
│   ├── api/auth/{login,register,logout}
│   ├── api/me
│   ├── api/wallet
│   ├── api/wallet/ledger
│   ├── api/admin/users
│   ├── api/admin/users/[id]
│   ├── api/admin/users/[id]/wallet-adjust
│   ├── api/generate
│   ├── api/edit
│   ├── api/gallery
│   ├── api/images/[id]
│   ├── api/providers
│   ├── api/prompts
│   ├── api/prompt-refine
│   ├── api/video
│   ├── login/
│   ├── generate/
│   ├── edit/
│   ├── gallery/
│   ├── billing/
│   ├── admin/
│   └── settings/
├── components/PromptRefineControls.tsx
└── lib/
    ├── auth.ts
    ├── prisma.ts
    ├── db.ts
    ├── storage.ts
    ├── wallet.ts
    ├── users.ts
    ├── pricing.ts
    ├── prompt-refine.ts
    ├── prompt-refine-rate-limit.ts
    ├── xai-auth-pool.ts
    ├── video.ts
    └── providers/
```

## Quy tắc nghiệp vụ

- `IMAGE_PRICE_VND` mặc định 100 nếu env thiếu/hỏng.
- User mới đăng ký được tặng sẵn 1.000đ, tương đương 10 ảnh ở giá mặc định 100đ/ảnh.
- User thường: tạo/chỉnh ảnh thành công mới coi là đã tiêu tiền; nếu provider fail phải refund.
- Wallet update phải qua transaction + ledger.
- Generate/edit/admin wallet APIs dùng `Idempotency-Key` để tránh retry bị trừ/cộng tiền hai lần.
- Không cho balance âm.
- Ảnh là private theo owner; không public `/api/images/[id]`.
- Admin free để test vận hành dễ hơn, nhưng ảnh admin vẫn gắn `userId` thật.
- `db.json` không còn là storage runtime cho ví/provider/image; chỉ giữ để import dữ liệu cũ.
- Prompt refine là thao tác riêng trước Generate/Edit/Video, không nằm trong charge pipeline; giới hạn 10 lần/phút/user.
- Grok Image và Grok Video gọi thẳng `https://api.x.ai/v1`, không đi qua CPA request router.
- Pool xAI round-robin, cooldown account khi 429/quota, reload token khi 401; một video giữ cùng account trong cả create/poll/download.

## Quy tắc bảo mật

- API key không trả về client dạng nguyên bản.
- Session phải có `userId` + `role`; không dùng mật khẩu chung `AUTH_PASSWORD/GUEST_PASSWORD` cho luồng chính nữa.
- Middleware chỉ là lớp chặn nhẹ; quyền thật phải check trong API routes.
- Không xóa `/data/db.json` cũ khi migrate nếu chưa xác minh xong.
- Trước deploy migration phải backup `/data`.
- Không log email/token OAuth; log xAI chỉ dùng ID vô danh `xai-01`, `xai-02`...
- App chỉ đọc bản copy xAI trong `/run/secrets/xai-auths`; CPA vẫn là nơi quản lý/refresh token gốc.

## Quy tắc triển khai

- Sửa local → kiểm tra → push `main` → GitHub Actions deploy.
- Docker Compose có 2 service: `img-studio-db` và `img-studio`.
- App startup production chạy: `check-env.js` → `prisma migrate deploy` → `seed-admin.js` → import legacy nếu còn `/data/db.json` → `server.js`.
- Env quan trọng: `POSTGRES_PASSWORD`, `DATABASE_URL`, `SESSION_SECRET`, `IMAGE_PRICE_VND`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
- systemd timer `img-studio-xai-auth-sync.timer` chạy mỗi phút, chỉ ghi file OAuth khi bytes thay đổi; add/remove account CPA tự phản ánh mà không restart app.

## Điểm cần nhớ

- `src/lib/providers/custom.ts` vẫn là runtime chính cho provider; đừng vô tình làm hỏng logic OpenAI/Gemini/Vertex đang chạy.
- `scripts/migrate-db-json-to-postgres.js` phải idempotent mức cơ bản: không import đè ảnh cũ đã có.
- Nếu sửa UI liên quan ví tiền, nhớ đồng bộ `/api/me`, Header, generate, edit, billing, admin.
- `grok-imagine-image*` từng hỏng qua CPA v7.2.65/v7.2.66 dù gọi đúng `/v1/images/generations`; direct xAI đã được production smoke test và nhanh hơn rõ rệt.
- Source of truth trạng thái mới nhất: `docs/current-state.md`.
