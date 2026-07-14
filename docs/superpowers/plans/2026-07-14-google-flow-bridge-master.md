# Google Flow/Whisk Bridge Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai tool Windows một nút, Google Media Bridge chạy 24/7 trên VPS, đường ảnh/video CPA-first và tích hợp IMG Studio mà không làm thay đổi provider đang chạy.

**Architecture:** Thực hiện theo năm phase có cổng dừng độc lập. Phase 1 chứng minh session Flow có thể được chuyển từ Windows sang Chromium ARM64 trên VPS và bridge có thể lấy Bearer `aisandbox` cùng reCAPTCHA token qua browser context hợp lệ. Chỉ khi cổng này đạt mới xây bridge, CPA routing, IMG Studio và tool Windows hoàn chỉnh.

**Tech Stack:** Node.js 22, TypeScript 5.8.3, Vitest 4.1.10, Fastify 5.10.0, Playwright Core 1.61.1, Chromium ARM64, SQLite/better-sqlite3 12.11.1, Next.js 15, Prisma/PostgreSQL, Docker Compose, CLIProxyAPI v7.2.x.

---

## Thứ tự thực hiện bắt buộc

1. [Phase 1 — Session transfer và reCAPTCHA feasibility gate](./2026-07-14-google-flow-phase-1-feasibility.md)
2. [Phase 2 — Google Media Bridge core](./2026-07-14-google-flow-phase-2-bridge.md)
3. [Phase 3 — CPA-first routing](./2026-07-14-google-flow-phase-3-cpa-routing.md)
4. [Phase 4 — IMG Studio integration](./2026-07-14-google-flow-phase-4-img-studio.md)
5. [Phase 5 — Windows one-click enroller và rollout](./2026-07-14-google-flow-phase-5-enroller-rollout.md)

Không chạy song song các phase. Mỗi phase phụ thuộc output và quyết định gate của phase trước.

## Cổng quyết định

| Gate | Điều kiện đạt | Nếu không đạt |
|---|---|---|
| G1 Session transfer | Storage state xuất từ Chrome Windows được Chromium VPS dùng để gọi `/fx/api/auth/session`, token có scope `aisandbox` | Dừng. Chuyển sang thiết kế remote-login browser trên VPS; không xây bridge dựa trên cookie replay |
| G2 Token factory | Browser VPS tạo được reCAPTCHA token bằng API trang Flow mà không giải/bypass CAPTCHA hiện hữu | Dừng. Không triển khai direct upstream automation |
| G3 Direct bridge media | Ảnh và ba mode video chạy trực tiếp qua bridge, job restart-resume đạt | Không nối CPA/IMG Studio |
| G4 CPA image | CPA chính gọi bridge qua `openai-compatibility` và provider cũ vẫn smoke xanh | Giữ ảnh direct/disabled, không sửa CPA core |
| G5 CPA video sidecar | CPA sidecar trỏ `xai-api-key.base-url` vào bridge, create/poll/content đúng và không đụng CPA chính | Đặt `FLOW_VIDEO_ROUTE=direct`; không patch binary CPA |
| G6 Admin canary | IMG Studio admin tạo đủ ảnh/text-video/image-video/start-end, charge/refund/storage đúng | Đặt route Flow `disabled`, giữ provider cũ |
| G7 Soak | 24 giờ, refresh session, restart bridge/sidecar, một account hỏng không làm mất job | Không mở cho user |

## Quy tắc an toàn triển khai

- Không dùng OAuth Antigravity cho Flow; scope không phù hợp.
- Không lưu hoặc commit HAR, cookie, Bearer, refresh token, email đầy đủ, browser profile hoặc signed URL.
- Không tự giải hoặc vượt CAPTCHA. Nếu Google hiển thị CAPTCHA/challenge, account chuyển `reauth_required` và chờ anh hoàn thành thủ công.
- Không dùng pool để né quota/policy. `429` chỉ cooldown; không tự retry vô hạn hoặc tăng tải.
- Video giữ cùng account từ create đến poll/download.
- CPA chính chỉ thêm cấu hình ảnh có namespace riêng. Video CPA-first dùng sidecar cô lập.
- Mỗi route có `cpa|direct|disabled`; `disabled` phải hoạt động ngay cả khi bridge đang lỗi.
- Không commit/push/deploy trừ khi anh cấp quyền rõ cho từng loại hành động. Các bước commit trong phase là checkpoint có điều kiện.

## Model và contract đã xác minh

- Client image model: `flow-nano-banana-2`; upstream model key quan sát được: `NARWHAL`.
- Client video model: `flow-video-fast-4s`; upstream text-video key quan sát được: `abra_t2v_4s`.
- Ảnh: `POST /v1/projects/{projectId}/flowMedia:batchGenerateImages`.
- Text video: `POST /v1/video:batchAsyncGenerateVideoText`.
- Poll video: `POST /v1/video:batchCheckAsyncVideoGenerationStatus`.
- Bridge public contract giữ ổn định dù Google đổi payload nội bộ:

```text
GET  /health
GET  /v1/models
POST /v1/images/generations
POST /v1/videos/generations
POST /v1/videos/edits
GET  /v1/videos/:jobId
GET  /v1/videos/:jobId/content
```

## Verification cuối toàn chương trình

Chạy theo thứ tự:

```powershell
npm test
npm run build
npm --prefix google-media-bridge test
npm --prefix google-media-bridge run build
npm --prefix google-flow-enroller test
npm --prefix google-flow-enroller run build
docker compose config
```

Kỳ vọng: tất cả exit code `0`, không warning chứa secret, không file secret xuất hiện trong `git status --short`. Sau đó mới chạy smoke canary live theo Phase 5.

