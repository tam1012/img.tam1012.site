# AGENTS.md — IMG Studio

> Bộ nhớ dài hạn của dự án cho AI Agent. Đọc file này trước khi làm bất kỳ thay đổi nào.

## Mục tiêu

Công cụ cá nhân tạo và chỉnh sửa ảnh bằng AI. Ưu tiên: đơn giản, dễ bảo trì, chi phí thấp. **Không phải SaaS, không đa người dùng, không thương mại.**

## Đối tượng sử dụng

- **Admin** (Ha Tam) — mật khẩu `AUTH_PASSWORD`, toàn quyền, không giới hạn
- **Guest** (bạn bè) — mật khẩu `GUEST_PASSWORD`, không truy cập Settings, giới hạn 50 ảnh/ngày (tạo + chỉnh sửa tính chung, reset theo ngày UTC)

## Chức năng chính

1. **Tạo ảnh** — nhập prompt, chọn provider/kích thước/chất lượng → nhận ảnh
2. **Chỉnh sửa ảnh** — upload ảnh + prompt mô tả chỉnh sửa → nhận ảnh đã sửa
3. **Thư viện** — xem lại tất cả ảnh đã tạo, tải về
4. **Cài đặt AI Provider** — thêm/sửa/xoá provider trên giao diện web (base URL, API key, model)
5. **Lịch sử prompt** — xem và tái sử dụng prompt đã dùng

## Tech stack

| Thành phần | Công nghệ |
|---|---|
| Framework | Next.js 15 (App Router) |
| Styling | Tailwind CSS v4 |
| Ngôn ngữ | TypeScript |
| Lưu trữ metadata | JSON file (`/data/db.json`) |
| Lưu trữ ảnh | Filesystem (`/data/images/`) |
| Auth | iron-session (cookie-based) |
| AI Providers | User-configured (OpenAI-compatible hoặc Gemini), lưu trong db.json |
| Deploy | Docker + nginx + Certbot |
| CI/CD | GitHub Actions |

## Kiến trúc tổng quan

```
Client (Browser) → nginx (SSL termination) → Next.js (port 3456)
                                                ├── Pages (React)
                                                ├── API Routes
                                                │   ├── /api/auth — đăng nhập/đăng xuất
                                                │   ├── /api/generate — tạo ảnh
                                                │   ├── /api/edit — chỉnh sửa ảnh
                                                │   ├── /api/gallery — danh sách ảnh
                                                │   ├── /api/images/[id] — serve ảnh
                                                │   ├── /api/providers — CRUD provider
                                                │   └── /api/prompts — lịch sử prompt
                                                └── Providers (user-configured)
                                                    ├── OpenAI-compatible (custom base URL)
                                                    └── Google Gemini
```

## Cấu trúc thư mục

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # API routes
│   │   ├── auth/           # POST login, DELETE logout
│   │   ├── generate/       # POST tạo ảnh
│   │   ├── edit/           # POST chỉnh sửa ảnh
│   │   ├── gallery/        # GET danh sách ảnh
│   │   ├── images/[id]/    # GET serve file ảnh
│   │   ├── providers/      # GET list, POST create
│   │   ├── providers/[id]/ # PUT update, DELETE
│   │   └── prompts/        # GET lịch sử prompt
│   ├── generate/           # Trang tạo ảnh + prompt history
│   ├── edit/               # Trang chỉnh sửa
│   ├── gallery/            # Trang thư viện
│   ├── settings/           # Trang quản lý AI providers
│   ├── login/              # Trang đăng nhập
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Redirect → /generate
│   └── globals.css         # Tailwind + custom styles
├── components/
│   └── Header.tsx          # Nav bar dùng chung
├── lib/
│   ├── auth.ts             # iron-session config
│   ├── db.ts               # JSON file database
│   ├── storage.ts          # Lưu/đọc ảnh + metadata
│   └── providers/
│       ├── index.ts        # Re-export
│       └── custom.ts       # OpenAI-compatible + Gemini implementation
└── middleware.ts           # Auth redirect
```

## Quy tắc lập trình

- Giữ code tối giản. Không thêm tính năng chưa được yêu cầu.
- Không đổi code xung quanh khi chỉ sửa 1 chỗ.
- Giao diện tối (dark theme), nghiêm túc, không loè loẹt.
- Mọi text hiển thị bằng tiếng Việt.
- Provider mới = user thêm qua giao diện Settings (không cần sửa code).
- API key lưu server-side trong db.json, trả về client đã mask (****abcd).

## Quy tắc bảo mật

- API key KHÔNG bao giờ gửi về client dạng nguyên bản. Luôn mask khi trả về.
- API key lưu trong `/data/db.json` (Docker volume), không trong source code.
- File `.env` nằm trong `.gitignore`, không commit lên git.
- Auth check ở cả middleware (redirect) lẫn API routes (session verify).
- `client_max_body_size 50M` trong nginx cho upload ảnh.

## Quy tắc triển khai

- Sửa ở local → commit → push `main` → GitHub Actions tự deploy.
- Không sửa trực tiếp trên VPS (trừ file `.env` hoặc one-off setup).
- Container name: `img-studio`, port: `3456`.
- Data volume: `img-studio_img-data` → `/data` (persist qua rebuild).

## Quyết định quan trọng

- **JSON file thay vì SQLite**: máy dev Windows không có Visual Studio C++ build tools cho `better-sqlite3`. JSON file đủ cho quy mô nhỏ.
- **Không dùng database server riêng**: giảm complexity, 1 container duy nhất.
- **iron-session**: auth đơn giản, không cần OAuth/JWT cho dự án cá nhân.
- **Dynamic providers**: API key và config provider do user quản lý qua web UI (Settings), không hardcode trong env hay code. Lưu trong db.json trên data volume.

---

*Cập nhật lần cuối: 2026-06-22*
