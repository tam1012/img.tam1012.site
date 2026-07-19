# IMG Studio — Current State

> Snapshot ngày 2026-07-13. Đọc cùng `AGENTS.md` trước khi sửa code/deploy.

## Production

- Domain chính: `https://imgstudio.site`.
- `https://img.tam1012.site` redirect 308 và giữ path/query.
- Source/deploy: local repo → push `main` → GitHub Actions → `/home/ubuntu/img-studio`.
- Compose: `img-studio` + `img-studio-db`; PostgreSQL 16, Prisma, filesystem `/data`.
- Generation hiện chạy synchronous trong API route; không có background worker/ImageJob runtime.

## Public API v1 (tạo + chỉnh sửa ảnh)

- User active tạo/thu hồi API key tại `/billing` (UI `ApiKeysPanel`); tối đa 5 key active/user.
- Key format `img_…`; DB chỉ lưu SHA-256 hash + prefix mask; plain key hiện 1 lần lúc tạo.
- Auth: `Authorization: Bearer <key>` qua `requireUserFromRequest` (ưu tiên Bearer, fallback cookie session).
- Middleware cho phép `/api/v1/*` không cần cookie.
- Endpoints: `GET /api/v1/providers`, `POST /api/v1/images/generate` (count=1), `POST /api/v1/images/edit` (multipart, 1 ảnh ra), `GET /api/v1/images/:id`, `GET /api/v1/images/:id/file`.
- Generate dùng shared helper `src/lib/generate-image.ts`; edit dùng `src/lib/edit-image.ts` (web `/api/edit` và `/api/generate` count=1 cũng gọi chung lõi).
- Edit nhận `multipart/form-data` (field `images` nhiều file, `prompt`, `provider_id`, `aspect_ratio`, `resolution`, `quality`); giới hạn tổng upload 9.5MB, số ảnh gốc theo provider (gpt-image/gemini 8, còn lại 1); chatgpt_bridge chưa hỗ trợ.
- Idempotency-Key bắt buộc (generate + edit, đều atomic qua `createImageRecordOnce`); rate limit 20/phút/user; giá = web.
- Chưa có: video/batch/webhook async.
- Docs user (login): `/docs/api`. Bản repo: `docs/public-api-v1.md`.

## Prompt Refine

- Public cho mọi user đã đăng nhập trên `/generate`, `/edit`, `/video`.
- Mission: viết lại ý thô/ngắn/lủng củng thành 1 prompt rõ, đủ chi tiết cho model, đồng thời làm dịu wording dễ vướng policy theo tầng (severe / grey zone swimwear-body / risky combos / không over-sanitize horror-nghệ thuật). Prompt đã tốt và an toàn thì chỉ chỉnh nhẹ.
- UI dùng chung `src/components/PromptRefineControls.tsx`: user bấm chủ động, xem/sửa prompt và có thể hoàn tác.
- Model: `gemini-3-flash-agent` qua CPA OpenAI-compatible/OAuth Antigravity.
- Giữ nguyên ngôn ngữ gốc; không tự dịch Việt/Anh/Trung hay ngôn ngữ khác.
- Context riêng: `generate`, `edit` (giữ phần không đổi), `video` (motion/camera/continuity khi phù hợp).
- API `POST /api/prompt-refine` yêu cầu session, rate limit 10 lần/phút/user; không charge, không ghi ledger, lỗi không đổi prompt.
- Env: `PROMPT_REFINE_BASE_URL`, `PROMPT_REFINE_API_KEY`, `PROMPT_REFINE_MODEL`, `PROMPT_REFINE_TIMEOUT_MS` (mặc định 25s, trần 30s).
- Timeout/abort trả message tiếng Việt; lỗi không đổi prompt hiện tại.

## Grok/xAI direct routing

- `grok-imagine-image` và `grok-imagine-image-quality` gọi trực tiếp `https://api.x.ai/v1/images/...`.
- Grok Video gọi trực tiếp `https://api.x.ai/v1/videos/...`.
- Không đi qua CPA router nên request không xuất hiện trong CPA Manager Plus.
- CPA vẫn quản lý và refresh OAuth gốc; Img Studio chỉ đọc pool copy read-only.
- Pool dùng round-robin; 429/quota → cooldown và thử account khác; 401 → reload token.
- Video chọn một account cho cả create/poll/download; DB/log lưu ID vô danh, không lưu email/token.
- Production smoke test đã xác nhận Image Quality và Video HTTP 200, rotation qua nhiều ID (`xai-01`, `xai-02`, `xai-03`).

## xAI OAuth auto sync

- CPA source: `/home/ubuntu/cliproxyapi/auths/xai-*.json`.
- App pool host: `/home/ubuntu/img-studio/secrets/xai-auths/xai-*.json`.
- Container mount: `/run/secrets/xai-auths` read-only.
- `scripts/sync-xai-auth-pool.py` lọc riêng xAI, đổi tên vô danh, copy atomically.
- File không đổi byte-for-byte thì không replace, giữ inode/mtime (`changed=0`).
- Account thêm/xóa/refresh trong CPA tự phản ánh tối đa khoảng một phút, không restart app.
- systemd: `img-studio-xai-auth-sync.service` + `.timer`, enabled/active, chạy mỗi phút.

## Provider boundaries

- OpenAI/GPT Image, Gemini, Imagen và Vertex vẫn theo provider runtime hiện tại trong `src/lib/providers/custom.ts`.
- Chưa chuyển Gemini/GPT Image sang direct; chờ Grok direct chạy ổn định 1–2 ngày rồi mới đánh giá.
- Không route Grok Image trở lại CPA v7.2.65/v7.2.66: đã tái hiện CPA trả 503 ngay tại đúng `/v1/images/generations` trước upstream.

## Verification snapshot

- Prompt Refine public commit: `a591f26`.
- xAI direct pool commits: `9d63c26`, `73a2921`.
- xAI auto-sync commits: `4c5e9c6`, `18c586c`.
- Public API v1 MVP: schema `ApiKey`, `/api/v1/*`, UI `/billing`, docs `docs/public-api-v1.md` (local tests pass; chờ deploy + smoke production).

## Operational rules

- Không in/persist token, OAuth email, API key hoặc credential JSON vào log/chat/repo.
- Deploy phải kiểm tra GitHub Actions và runtime thật; với Grok kiểm tra log `[xAI image]` / `[xAI video]` chỉ có account ID vô danh.
- Workflow hiện chưa có concurrency lock; tránh push nhiều commit sát nhau hoặc hủy run cũ nếu run mới đã bao gồm toàn bộ thay đổi.
