# Changelog — IMG Studio

## 2026-06-22 — Dynamic Provider Management

### Tính năng mới
- **Trang Cài đặt (Settings)** — quản lý AI provider trên giao diện web
  - Thêm/sửa/xoá provider tự do
  - Mỗi provider: tên, loại API (OpenAI-compatible hoặc Gemini), base URL, API key, model
  - Hỗ trợ custom base URL cho proxy/relay services
  - Đặt provider mặc định
  - API key hiển thị đã mask (****abcd)
- **Lịch sử prompt** — panel trên trang Tạo ảnh, click để tái sử dụng prompt cũ
- Bỏ hardcoded providers — không cần set API key trong .env nữa

### Thay đổi kiến trúc
- Provider config lưu trong db.json thay vì env vars
- API routes mới: /api/providers, /api/providers/[id], /api/prompts
- Xoá providers/openai.ts và providers/google.ts, thay bằng providers/custom.ts
- Nav bar thêm link "Cài đặt"

---

## 2026-06-22 — Initial Release

### Tính năng
- Trang tạo ảnh AI với Google Gemini và OpenAI
- Trang chỉnh sửa ảnh (upload + prompt)
- Thư viện ảnh với modal xem chi tiết
- Đăng nhập bằng mật khẩu chung
- Tải ảnh về máy
- Giao diện dark theme, responsive
- Phím tắt Ctrl+Enter để tạo/sửa ảnh nhanh

### Hạ tầng
- Deploy Docker trên VPS Oracle Singapore
- nginx reverse proxy + SSL (Certbot)
- GitHub Actions CI/CD (push main → auto deploy)
- JSON file-based storage cho metadata
- Filesystem storage cho ảnh

---

*Mỗi thay đổi đáng kể sẽ được ghi lại ở đây.*
