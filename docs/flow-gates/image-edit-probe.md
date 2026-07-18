# Probe: Flow image edit contract

## Mục tiêu

Bắt **shape request** khi user **edit ảnh** trên Google Flow (Nano Banana Pro / `GEM_PIX_2`), để sau này implement edit trên `google-media-bridge`.

Không lưu token, cookie, base64 đầy đủ — chỉ keys + kiểu đã redaction.

## Cách chạy (Windows)

Trong thư mục `google-flow-enroller`:

- Double-click `probe-edit-anh.bat`, **hoặc**
- `npm run probe:image-edit-meta`

## Thao tác trên Flow

1. Đăng nhập nếu được hỏi.
2. Chọn model **Nano Banana Pro** (Precise) nếu UI có.
3. Làm **edit / image-to-image**:
   - Upload hoặc chọn 1 ảnh
   - Gõ prompt chỉnh sửa
   - Bấm Generate
4. **Không** chỉ text→image (probe sẽ bỏ qua vì `imageInputs` rỗng).

Cửa sổ tự đóng khi bắt được generate có `imageInputs` khác rỗng.

## Output

`google-flow-enroller/state/flow-image-edit-request-meta.json` (đã gitignore qua `state/`)

Các field quan trọng:

- `pathTemplate` — endpoint generate
- `imageModelName`
- `imageInputsCount`
- `requestFieldKeys` — keys trong từng `requests[]`
- `nestedShape` — cấu trúc đã che blob/token
- `uploads[]` — nếu Flow upload media trước khi generate

## Cách đọc kết quả (cho bước implement sau)

| Quan sát | Ý nghĩa implement |
|---|---|
| `imageInputs` có `rawImageBytes` / `inlineData` | Có thể gửi bytes thẳng, **không** cần upload riêng |
| `imageInputs` chỉ có `mediaId` / `name` + có `uploads[]` | Cần implement **upload → mediaId → generate** |
| Chỉ thấy text generate | Anh thao tác text-only; chạy lại đúng edit |

## Không làm trong probe này

- Không implement edit production
- Không đổi IMG Studio / CPA
- Không push credential lên VPS
