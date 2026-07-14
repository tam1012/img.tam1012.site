# Flow Gate Phase 2 Result

- code_build: pass
- unit_tests: pass
- live_deploy_bridge: pass
- live_enroll_canary: pass (`flow-01`)
- live_verify_session: pass
- live_g3_image: **pass** (`POST /v1/images/generations` HTTP 200, count=1)
- live_g3_text_video: **fail** (upstream `500 Internal error encountered` after payload fixes)
- live_g3_image_video: blocked_by_text_video (+ needs real media upload IDs, not synthetic)
- live_g3_start_end_video: blocked_by_text_video (+ needs real media upload IDs)
- live_g3_restart_resume: not_run
- decision: hold_video_until_live_capture
- evidence:
  - Image canary OK on bridge with nested Flow image contract
  - Video attempts returned:
    - `400` invalid tool `FLOW`
    - `400` unknown fields `useNewMedia` / `requests[0].clientContext`
    - then consistent `500 Internal error` for tools `VIDEO_FX|PINHOLE|none` and model keys
      `veo_3_0_t2v`, `VEO_3_1_T2V_12STEP`, `VEO_3_0_T2V_DISTILLED`, `VEO_2_1_T2V`
  - Video fixes applied: action `VIDEO_GENERATION`, no image-only fields, richer error messages
- next:
  1. Capture one real UI text-video request (body keys + model key + clientContext fields) via browser probe
  2. Align adapter to captured shape
  3. Implement media upload for image/start-end modes
  4. Re-run G3 video + restart-resume
