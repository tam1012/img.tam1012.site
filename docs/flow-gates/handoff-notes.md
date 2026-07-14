# Google Flow Bridge — Handoff notes (2026-07-15)

> Không chứa secret. Đọc `docs/flow-gates/phase-*-result.md` và 5 phase plans.

## Tổng quan trạng thái

| Phase | Code | Live gate | Decision |
|---|---|---|---|
| 1 Feasibility G1/G2 | done | **PASS** local+VPS | continue |
| 2 Bridge core | done (tests/build xanh) | G3 deploy **chưa** (cần duyệt) | continue_code_hold_live_g3 |
| 3 CPA routing | builders/sidecar YAML done | G4/G5 **chưa** | continue_code_hold_live_cpa |
| 4 IMG Studio | routing+client+env done | G6 **chưa** | continue_code_hold_live_g6 |
| 5 Enroller | PKCE/pairing client done | EXE/soak **chưa** | continue_code_hold_rollout |

## Phase 1 contract ảnh (đã verify thật)

- `POST /v1/projects/{projectId}/flowMedia:batchGenerateImages`
- reCAPTCHA action: `IMAGE_GENERATION`
- tool: `PINHOLE`; model: `NARWHAL`
- Body: `clientContext` + `mediaGenerationContext` + `useNewMedia` + `requests[]`
- Token: `clientContext.recaptchaContext.token` + `applicationType=RECAPTCHA_APPLICATION_TYPE_WEB`
- Evidence: local + VPS `FLOW_DIRECT_IMAGE_OK count=1 status=200`

## Việc Anh cần duyệt để mở live

1. **Deploy Google Media Bridge** lên VPS (`docker-compose.bridge.yml`) + cấp env key/vault/private PEM
2. Enroll 1 account canary (tool export/enroll)
3. G3 smoke: image + 3 video modes + restart resume
4. (Tuỳ chọn) Patch CPA chính image provider + bật sidecar video
5. Bật `FLOW_*_ROUTE` trên IMG Studio admin-only canary

## Ràng buộc

- Không commit/push/deploy nếu chưa xin phép rõ
- Không log/commit credential, project id, token, cookie, signed URL
- Không tự giải CAPTCHA; 429 chỉ cooldown
- Chưa commit các file untracked trong phiên này

## Test snapshot (local)

- `google-media-bridge`: 34 tests pass, build exit 0
- `google-flow-enroller`: pairing + security tests pass
- root: flow-routing, flow-client, package boundaries, compose static pass
