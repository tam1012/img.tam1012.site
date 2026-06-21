# Quyết định thiết kế — IMG Studio

## 2026-06-22: Chọn Next.js 15 thay vì Express + static files

**Quyết định:** Dùng Next.js 15 (App Router) làm framework chính.

**Lý do:**
- Xử lý cả frontend (React) lẫn backend (API routes) trong 1 project
- Hệ sinh thái React quen thuộc, dễ tìm tài liệu
- Build `standalone` output cho Docker image nhẹ
- Turbopack dev server nhanh

**Hệ quả:** Cần Node.js runtime (không phải static hosting). Docker image ~150MB.

---

## 2026-06-22: Chọn JSON file thay vì SQLite

**Quyết định:** Lưu metadata ảnh trong JSON file (`/data/db.json`) thay vì SQLite.

**Lý do:**
- Ban đầu chọn SQLite (`better-sqlite3`), nhưng package cần native compilation (node-gyp + Visual Studio C++ build tools) mà máy dev Windows không có
- JSON file không cần dependency nào, chạy mọi nơi
- Quy mô dự án nhỏ (vài trăm ảnh), JSON file đủ hiệu năng

**Hệ quả:**
- Không có query phức tạp (filter, search) — cần tự implement nếu cần
- Ghi file là atomic per-process nhưng không an toàn nếu chạy nhiều instance song song
- Nếu lượng ảnh lớn (>10,000), cân nhắc chuyển sang SQLite trên VPS (VPS có build tools)

---

## 2026-06-22: Lưu ảnh trên filesystem thay vì database/cloud storage

**Quyết định:** Ảnh tạo xong được download về VPS, lưu trong `/data/images/`.

**Lý do:**
- URL ảnh từ AI API là tạm thời, hết hạn sau vài giờ
- Filesystem đơn giản, không cần S3/GCS
- Dự án cá nhân, không cần CDN

**Hệ quả:** Dung lượng disk phụ thuộc số ảnh tạo. Mỗi ảnh ~1-5MB. Cần monitor disk space.

---

## 2026-06-22: Xác thực bằng 1 mật khẩu chung

**Quyết định:** Dùng 1 `AUTH_PASSWORD` env var cho tất cả người dùng, không phân biệt account.

**Lý do:**
- Dự án cá nhân, chỉ share cho vài người thân
- Không cần biết ai dùng, không cần quota per-user
- Giảm complexity: không cần database user, form đăng ký, reset password

**Hệ quả:** Không phân biệt được ai tạo ảnh nào. Đổi mật khẩu = đổi env var + tất cả phải đăng nhập lại.

---

## 2026-06-22: Docker thay vì PM2

**Quyết định:** Deploy bằng Docker Compose thay vì PM2 trực tiếp.

**Lý do:**
- Nhất quán với các project khác trên VPS (SynthNews, Dashboard)
- Isolate dependencies, không ảnh hưởng system Node.js
- Volume mount giữ data persist qua rebuild
- Dễ rollback (giữ image cũ)

**Hệ quả:** Build time chậm hơn PM2 (~70s). Cần Docker daemon chạy.

---

## 2026-06-22: Chọn Google Gemini + OpenAI làm provider ban đầu

**Quyết định:** Hỗ trợ 2 provider: Google Gemini (`gemini-2.0-flash-exp`) và OpenAI (`gpt-image-1`).

**Lý do:**
- Google Gemini: miễn phí (free tier), chất lượng tốt
- OpenAI gpt-image-1: chất lượng cao nhất hiện tại, có API chỉnh sửa ảnh
- Provider abstraction cho phép thêm provider mới dễ dàng

**Hệ quả:** Cần API key cho mỗi provider muốn dùng. Provider nào chưa có key sẽ không hiện trong danh sách.

---

*Cập nhật lần cuối: 2026-06-22*
