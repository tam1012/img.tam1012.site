# AGENTS.md — IMG Studio

> Bộ nhớ dài hạn của dự án cho AI Agent. Đọc file này trước khi làm bất kỳ thay đổi nào.

## Mục tiêu

Công cụ cá nhân tạo và chỉnh sửa ảnh bằng AI. Ưu tiên: đơn giản, dễ bảo trì, chi phí thấp. **Không phải SaaS, không đa người dùng, không thương mại.**

## Đối tượng sử dụng

- Chủ dự án (Ha Tam) và một số bạn bè thân thiết
- Xác thực bằng 1 mật khẩu chung (env var `AUTH_PASSWORD`)

## Chức năng chính

1. **Tạo ảnh** — nhập prompt, chọn provider/kích thước/chất lượng → nhận ảnh
2. **Chỉnh sửa ảnh** — upload ảnh + prompt mô tả chỉnh sửa → nhận ảnh đã sửa
3. **Thư viện** — xem lại tất cả ảnh đã tạo, tải về

## Tech stack

| Thành phần | Công nghệ |
|---|---|
| Framework | Next.js 15 (App Router) |
| Styling | Tailwind CSS v4 |
| Ngôn ngữ | TypeScript |
| Lưu trữ metadata | JSON file (`/data/db.json`) |
| Lưu trữ ảnh | Filesystem (`/data/images/`) |
| Auth | iron-session (cookie-based) |
| AI Providers | Google Gemini API, OpenAI API |
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
                                                │   └── /api/images/[id] — serve ảnh
                                                └── Providers
                                                    ├── Google Gemini
                                                    └── OpenAI
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
│   │   └── images/[id]/    # GET serve file ảnh
│   ├── generate/           # Trang tạo ảnh
│   ├── edit/               # Trang chỉnh sửa
│   ├── gallery/            # Trang thư viện
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
│       ├── index.ts        # Provider registry
│       ├── openai.ts       # OpenAI provider
│       └── google.ts       # Google Gemini provider
└── middleware.ts           # Auth redirect
```

## Quy tắc lập trình

- Giữ code tối giản. Không thêm tính năng chưa được yêu cầu.
- Không đổi code xung quanh khi chỉ sửa 1 chỗ.
- Giao diện tối (dark theme), nghiêm túc, không loè loẹt.
- Mọi text hiển thị bằng tiếng Việt.
- Provider mới = 1 file trong `src/lib/providers/` + đăng ký trong `index.ts`.

## Quy tắc bảo mật

- API key KHÔNG bao giờ gửi về client. Chỉ dùng server-side trong API routes.
- File `.env` nằm trong `.gitignore`, không commit lên git.
- Auth check ở cả middleware (redirect) lẫn API routes (session verify).
- `client_max_body_size 20M` trong nginx cho upload ảnh.

## Quy tắc triển khai

- Sửa ở local → commit → push `main` → GitHub Actions tự deploy.
- Không sửa trực tiếp trên VPS (trừ file `.env` hoặc one-off setup).
- Container name: `img-studio`, port: `3456`.
- Data volume: `img-studio_img-data` → `/data` (persist qua rebuild).

## Quyết định quan trọng

- **JSON file thay vì SQLite**: máy dev Windows không có Visual Studio C++ build tools cho `better-sqlite3`. JSON file đủ cho quy mô nhỏ.
- **Không dùng database server riêng**: giảm complexity, 1 container duy nhất.
- **iron-session**: auth đơn giản, không cần OAuth/JWT cho dự án cá nhân.
- **standalone output**: Next.js build ra folder tự chứa, Docker image nhẹ.

---

*Cập nhật lần cuối: 2026-06-22*
