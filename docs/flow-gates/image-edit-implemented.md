# Probe + implement note: Flow image edit

## Probe result (2026-07-18)

Contract verified in `google-flow-enroller/state/flow-image-edit-request-meta.json`:

1. `POST /v1/flow/uploadImage` with `imageBytes`, `mimeType`, `fileName`, `isUserUploaded`, `isHidden`, `clientContext`
2. `POST /v1/projects/{projectId}/flowMedia:batchGenerateImages` with
   `imageInputs: [{ imageInputType: "IMAGE_INPUT_TYPE_REFERENCE", name: "<upload-id>" }]`
3. Models: `GEM_PIX_2` (Nano Banana Pro) and `NARWHAL` (Nano Banana 2) share the same path

## Implemented

- Bridge: upload + `POST /v1/images/edits` (both models)
- IMG Studio: `api_type=flow` edit enabled; max 8 reference images
- Route remains `FLOW_IMAGE_ROUTE=direct` → `google-media-bridge`

## Smoke after deploy

1. Rebuild/restart `google-media-bridge` (not covered by app-only GitHub Action alone if image cache stale — rebuild bridge image).
2. On `/edit`, pick **Flow · Nano Banana 2** or **Flow · Nano Banana Pro**, upload 1–2 images, prompt, submit.
3. Expect completed image; on failure check bridge logs for `FLOW_UPSTREAM_REJECTED` / upload name parse.
