# Kiến trúc hệ thống — IMG Studio

## Tổng quan

```
┌──────────┐     HTTPS      ┌───────────┐    HTTP     ┌──────────────┐
│ Browser  │ ──────────────► │   nginx   │ ──────────► │  Next.js     │
│          │ ◄────────────── │ (SSL/443) │ ◄────────── │  (port 3456) │
└──────────┘                 └───────────┘             └──────┬───────┘
                                                              │
                                              ┌───────────────┼───────────────┐
                                              │               │               │
                                        ┌─────▼─────┐  ┌─────▼─────┐  ┌──────▼──────┐
                                        │  Google    │  │  OpenAI   │  │  Filesystem │
                                        │  Gemini   │  │  API      │  │  /data/     │
                                        │  API      │  │           │  │  ├─ db.json  │
                                        └───────────┘  └───────────┘  │  └─ images/  │
                                                                      └─────────────┘
```

## Luồng xử lý request

### Trang thường (GET /generate, /edit, /gallery)

1. Middleware kiểm tra cookie `img-session` tồn tại
2. Nếu không có → redirect `/login`
3. Nếu có → Next.js serve static page (pre-rendered tại build time)

### Đăng nhập (POST /api/auth)

1. Client gửi `{ password }` dạng JSON
2. API so sánh với `AUTH_PASSWORD` → role `admin`, hoặc `GUEST_PASSWORD` → role `guest`
3. Đúng → tạo iron-session cookie (mã hóa, httpOnly, 30 ngày, kèm role)
4. Sai → trả 401

## Luồng tạo ảnh

```
Client                    API /api/generate              Provider             Storage
  │                             │                           │                    │
  │  POST {prompt,provider,     │                           │                    │
  │        size,quality}        │                           │                    │
  │ ───────────────────────────►│                           │                    │
  │                             │  Verify session           │                    │
  │                             │  Get provider instance    │                    │
  │                             │ ─────────────────────────►│                    │
  │                             │                           │                    │
  │                             │  { data: Buffer,          │                    │
  │                             │    mimeType, model }      │                    │
  │                             │ ◄─────────────────────────│                    │
  │                             │                           │                    │
  │                             │  saveImage(buffer, meta)  │                    │
  │                             │ ──────────────────────────────────────────────►│
  │                             │                           │                    │
  │                             │  { id, filename }         │  Write file        │
  │                             │ ◄──────────────────────────────────────────────│
  │                             │                           │  Update db.json    │
  │  { id, url, prompt,         │                           │                    │
  │    provider, model }        │                           │                    │
  │ ◄───────────────────────────│                           │                    │
```

## Luồng chỉnh sửa ảnh

Tương tự tạo ảnh, nhưng:
1. Client gửi **FormData** (multipart) gồm: file ảnh gốc + prompt + provider + size
2. API đọc file ảnh thành Buffer
3. Gọi provider với cả ảnh gốc + prompt chỉnh sửa
4. Lưu kết quả giống flow tạo ảnh

## Luồng lưu trữ dữ liệu

### Metadata (`/data/db.json`)

```json
{
  "images": [
    {
      "id": "uuid",
      "prompt": "...",
      "edit_prompt": null,
      "provider": "google",
      "model": "gemini-2.0-flash-exp",
      "size": "square",
      "quality": "high",
      "filename": "uuid.png",
      "mime_type": "image/png",
      "original_image_id": null,
      "created_by": "admin",
      "created_at": "2026-06-22T..."
    }
  ]
}
```

- Mảng `images` sắp xếp mới nhất trước (unshift)
- Mỗi lần thay đổi → ghi lại toàn bộ file

### File ảnh (`/data/images/`)

- Tên file: `{uuid}.{ext}` (png/jpg/webp)
- Ảnh được tải từ AI API về lưu local, không phụ thuộc URL tạm

## Serve ảnh (GET /api/images/[id])

1. Lookup metadata trong db.json theo id
2. Đọc file ảnh từ disk
3. Trả về với `Content-Type` đúng và `Cache-Control: immutable` (ảnh không thay đổi sau khi tạo)

## Provider abstraction

Tất cả provider xử lý trong 1 file `src/lib/providers/custom.ts`, chia theo `api_type`:

- **OpenAI-compatible** (`api_type: "openai"`) — dùng OpenAI SDK. Model Gemini/Imagen qua proxy được tự động route sang chat completions thay vì images endpoint.
- **Google Gemini** (`api_type: "gemini"`) — dùng `@google/generative-ai` SDK trực tiếp.

Provider config do user quản lý qua trang Settings (lưu trong `db.json`), không hardcode trong code hay env.

Hai hàm chính:
```typescript
generateImage(config: ProviderConfig, params: GenerateParams): Promise<GeneratedImage>
editImage(config: ProviderConfig, params: EditParams): Promise<GeneratedImage>
```

---

*Cập nhật lần cuối: 2026-06-29*
