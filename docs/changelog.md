# Changelog — IMG Studio

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
