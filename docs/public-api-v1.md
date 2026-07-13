# Public API v1 — Tạo ảnh (MVP)

> Dành cho automation (n8n, Make, script). Chỉ hỗ trợ **tạo 1 ảnh / request**. Edit ảnh và video sẽ làm sau.

**Trang user (đăng nhập):** `https://imgstudio.site/docs/api` — bản đọc trên web, link từ `/billing` và menu tài khoản.

Base URL production: `https://imgstudio.site`

## 1. Tạo API key

1. Đăng nhập web → **Nạp tiền** (`/billing`)
2. Mục **API key (n8n / automation)** → **Tạo API key**
3. **Copy key ngay** (chỉ hiện 1 lần). Format: `img_...`
4. Thu hồi key bất cứ lúc nào trên cùng trang

Giới hạn: tối đa **5 key đang hoạt động** / tài khoản. DB chỉ lưu hash, không lưu plain key.

## 2. Xác thực

Mọi request public API:

```http
Authorization: Bearer img_xxxxxxxx
```

Không dùng cookie session cho n8n (có thể dùng session trên web, nhưng automation nên dùng key).

## 3. Endpoints

### 3.1. Danh sách provider

```http
GET /api/v1/providers
Authorization: Bearer <API_KEY>
```

Response:

```json
{
  "providers": [
    {
      "id": "uuid-provider",
      "name": "Grok Imagine",
      "is_default": true,
      "max_resolution": "2K"
    }
  ]
}
```

Dùng `id` làm `provider_id` khi tạo ảnh.

### 3.2. Tạo ảnh

```http
POST /api/v1/images/generate
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <chuỗi duy nhất, tối đa 120 ký tự>
```

Body:

```json
{
  "prompt": "a cat sitting on a windowsill, soft morning light",
  "provider_id": "uuid-provider",
  "aspect_ratio": "1:1",
  "resolution": "1K",
  "quality": "standard"
}
```

| Field | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|
| `prompt` | có | — | Mô tả ảnh |
| `provider_id` | có | — | Lấy từ `/api/v1/providers` |
| `aspect_ratio` | không | `1:1` | `1:1`, `3:2`, `4:3`, `16:9`, `2:3`, `3:4`, `9:16` |
| `resolution` | không | `1K` | `1K`, `1.5K`, `2K`, `4K` (tuỳ provider) |
| `quality` | không | `standard` | `standard` hoặc `high` |
| `count` | không | `1` | MVP **chỉ cho phép 1** |

**Idempotency-Key bắt buộc.** Nếu n8n retry cùng key → không trừ tiền 2 lần (trả lại ảnh cũ nếu đã xong).

Response thành công `200`:

```json
{
  "id": "uuid-image",
  "status": "completed",
  "prompt": "...",
  "provider_name": "...",
  "model": "...",
  "aspect_ratio": "1:1",
  "resolution": "1K",
  "quality": "standard",
  "cost_vnd": 100,
  "balance_vnd": 9900,
  "url": "/api/v1/images/uuid-image/file",
  "created_at": "2026-07-13T10:00:00.000Z",
  "reused": false
}
```

URL file là path tương đối. Full URL: `https://imgstudio.site` + `url`.

### 3.3. Metadata ảnh

```http
GET /api/v1/images/{id}
Authorization: Bearer <API_KEY>
```

### 3.4. File ảnh

```http
GET /api/v1/images/{id}/file
Authorization: Bearer <API_KEY>
```

- Mặc định WebP
- Thêm `?format=jpg` nếu cần JPEG

Cùng key (hoặc admin) mới xem được ảnh của user đó.

## 4. Mã lỗi thường gặp

| HTTP | Ý nghĩa |
|---|---|
| 400 | Thiếu field / option sai / count ≠ 1 |
| 401 | Key sai, đã thu hồi, hoặc thiếu Authorization |
| 402 | Hết tiền ví |
| 403 | Không có quyền (vd provider admin-only, ảnh người khác) |
| 404 | Provider / ảnh không tồn tại |
| 409 | Idempotency-Key trùng request đã fail — dùng key mới |
| 429 | Rate limit (≈20 request tạo ảnh / phút / user) |
| 500 | Lỗi provider / server (thường đã hoàn tiền nếu đã trừ) |
| 202 | Request trùng đang xử lý — đợi rồi gọi lại cùng Idempotency-Key |

## 5. Ví dụ curl

```bash
# 1) Lấy provider
curl -s https://imgstudio.site/api/v1/providers \
  -H "Authorization: Bearer img_YOUR_KEY"

# 2) Tạo ảnh
curl -s https://imgstudio.site/api/v1/images/generate \
  -H "Authorization: Bearer img_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: n8n-run-001" \
  -d '{
    "prompt": "minimal product photo of a ceramic cup",
    "provider_id": "PASTE_PROVIDER_ID",
    "aspect_ratio": "1:1",
    "resolution": "1K"
  }'

# 3) Tải file
curl -L "https://imgstudio.site/api/v1/images/IMAGE_ID/file" \
  -H "Authorization: Bearer img_YOUR_KEY" \
  -o out.webp
```

## 6. n8n (HTTP Request)

1. Node **HTTP Request** — Method `POST`
2. URL: `https://imgstudio.site/api/v1/images/generate`
3. Authentication: **Header Auth** hoặc generic header:
   - Name: `Authorization` · Value: `Bearer img_...`
4. Headers thêm: `Idempotency-Key` = `{{$execution.id}}` (hoặc uuid mỗi lần chạy)
5. Body JSON: `prompt`, `provider_id`, ...
6. **Timeout:** đặt **120–300 giây** (generate chạy sync, có thể lâu)
7. Node sau: HTTP Request GET `https://imgstudio.site{{ $json.url }}` với cùng Bearer để lấy binary ảnh

## 7. Giá & giới hạn

- Giá = giá web (`IMAGE_PRICE_VND`, mặc định 100đ / ảnh thành công)
- Admin không bị trừ tiền
- Provider lỗi sau khi trừ → hệ thống cố hoàn tiền (như web)
- Chưa hỗ trợ: edit, video, batch `count>1`, webhook async

## 8. Bảo mật

- Không commit key vào repo / chat công khai
- Key lộ → thu hồi ngay trên `/billing` và tạo key mới
- Không gửi key lên URL query
