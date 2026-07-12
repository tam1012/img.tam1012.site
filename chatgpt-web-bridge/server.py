"""
ChatGPT Web Image Bridge — FastAPI server.
Exposes /healthz, /api/status, /api/generate endpoints.
Uses chatgpt-imagegen CLI under the hood via subprocess.
"""

import asyncio
import logging
import os
import re
import signal
import uuid

import yaml
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from profile_manager import ProfileManager

# ── Logging ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("bridge")

# ── Config ───────────────────────────────────────────────
CONFIG_PATH = os.environ.get("BRIDGE_CONFIG", "/etc/chatgpt-web-bridge/config.yaml")
ADMIN_TOKEN = os.environ.get("BRIDGE_ADMIN_TOKEN", "")
SAFE_TOKEN_RE = re.compile(r"[^a-zA-Z0-9._:-]")

with open(CONFIG_PATH, "r") as f:
    config = yaml.safe_load(f)

manager = ProfileManager(config)

app = FastAPI(title="ChatGPT Web Image Bridge", version="1.0.0")


# ── Auth dependency ──────────────────────────────────────
def require_auth(request: Request):
    if not ADMIN_TOKEN:
        logger.error("BRIDGE_ADMIN_TOKEN not configured")
        raise HTTPException(status_code=500, detail="Server misconfigured")
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Helpers ──────────────────────────────────────────────
def _safe_token(value: str | None, fallback: str) -> str:
    raw = (value or "").strip()[:120]
    safe = SAFE_TOKEN_RE.sub("", raw)
    return safe or fallback


def _classify_error(stderr: str) -> tuple[str, bool]:
    """Classify error from stderr output. Returns (code, retryable)."""
    lower = stderr.lower()
    if any(kw in lower for kw in ("login", "sign in", "unauthorized")):
        return "NEEDS_LOGIN", False
    if any(kw in lower for kw in ("captcha", "cloudflare", "verify you are human")):
        return "CAPTCHA_REQUIRED", False
    if any(kw in lower for kw in ("rate limit", "too many", "try again later")):
        return "RATE_LIMITED", True
    return "GENERATION_FAILED", True


def _status_for_code(code: str) -> int:
    if code == "RATE_LIMITED":
        return 429
    if code in ("NEEDS_LOGIN", "CAPTCHA_REQUIRED"):
        return 503
    return 500


def _cleanup_file(path: str):
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


async def _stop_process_group(proc: asyncio.subprocess.Process | None):
    if not proc or proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            await asyncio.wait_for(proc.wait(), timeout=2)
            return
        except asyncio.TimeoutError:
            os.killpg(proc.pid, signal.SIGKILL)
            await proc.wait()
    except ProcessLookupError:
        return


def _build_prompt(prompt: str, body: dict) -> str:
    width = body.get("width")
    height = body.get("height")
    aspect_ratio = body.get("aspect_ratio")
    resolution = body.get("resolution")
    quality = body.get("quality")
    requirements = ["Return exactly one final image."]
    if aspect_ratio:
        requirements.append(f"Canvas aspect ratio: {aspect_ratio}.")
    if width and height:
        requirements.append(f"Target resolution: {width} x {height} pixels.")
    if resolution:
        requirements.append(f"Image size tier: {resolution}.")
    if quality:
        requirements.append(f"Quality: {quality}.")
    requirements.append("Fill the entire canvas; do not add borders, padding, frames, or letterboxing.")
    return " ".join(["Output image requirements:", *requirements, prompt])


# ── Routes ───────────────────────────────────────────────
@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/api/status")
async def api_status(request: Request):
    require_auth(request)
    return JSONResponse(manager.get_status())


@app.post("/api/generate")
async def api_generate(request: Request):
    require_auth(request)

    try:
        body = await request.json()
    except Exception:
        fallback_id = str(uuid.uuid4())
        return JSONResponse(
            {"error": "Body JSON không hợp lệ.", "code": "INVALID_INPUT", "retryable": False, "request_id": fallback_id},
            status_code=400,
        )

    request_id = _safe_token(body.get("request_id"), str(uuid.uuid4()))
    prompt = re.sub(r"\s+", " ", (body.get("prompt") or "")).strip()

    max_chars = config.get("runtime", {}).get("max_prompt_chars", 4000)
    if not prompt:
        return JSONResponse(
            {"error": "Prompt không được để trống.", "code": "INVALID_INPUT", "retryable": False, "request_id": request_id},
            status_code=400,
        )
    if len(prompt) > max_chars:
        return JSONResponse(
            {"error": f"Prompt quá dài (tối đa {max_chars} ký tự).", "code": "INVALID_INPUT", "retryable": False, "request_id": request_id},
            status_code=400,
        )

    output_format = _safe_token(body.get("format"), config.get("image_gen", {}).get("default_format", "png")).lower()
    if output_format == "jpg":
        output_format = "jpeg"
    if output_format not in ("png", "jpeg", "webp"):
        return JSONResponse(
            {"error": "Định dạng ảnh không hợp lệ.", "code": "INVALID_INPUT", "retryable": False, "request_id": request_id},
            status_code=400,
        )

    profile = await manager.acquire()
    if not profile:
        return JSONResponse(
            {"error": "Tất cả profile đang bận, thử lại sau.", "code": "NO_PROFILE_AVAILABLE", "retryable": True, "request_id": request_id},
            status_code=503,
        )

    logger.info("[%s] Acquired profile %s; prompt_chars=%d", request_id, profile.name, len(prompt))

    output_dir = config["paths"]["output_dir"]
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{request_id}.{output_format}")

    binary = config.get("image_gen", {}).get("binary", "chatgpt-imagegen")
    display = config.get("runtime", {}).get("display", ":99")
    timeout = config.get("runtime", {}).get("generation_timeout_seconds", 600)
    allowed_sizes = set(config.get("image_gen", {}).get("allowed_sizes", []))
    requested_size = body.get("size")
    if not requested_size and body.get("width") and body.get("height"):
        requested_size = f"{body.get('width')}x{body.get('height')}"
    if requested_size not in allowed_sizes:
        requested_size = "auto"
    full_prompt = _build_prompt(prompt, body)

    chrome_profile = (profile.chrome_profile or "auto").strip() or "auto"
    cmd = [
        binary,
        "--backend", "web",
        "--profile", chrome_profile,
        "--format", output_format,
        "--size", requested_size,
        "--timeout", str(timeout),
        full_prompt,
        "-o", output_path,
    ]

    env = {
        **os.environ,
        "DISPLAY": display,
    }
    # Shared Chromium multi-window: do not force isolated user-data-dir.
    # chrome-use/chatgpt-imagegen web path works via the open browser + extension.
    logger.info(
        "[%s] Running image generation with profile %s label=%s chrome_profile=%s",
        request_id,
        profile.name,
        profile.label or "-",
        chrome_profile,
    )

    proc = None
    released = False

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.error("[%s] Generation timeout, killing process group", request_id)
            await _stop_process_group(proc)
            manager.release(profile, success=False, error_code="GENERATION_TIMEOUT")
            released = True
            return JSONResponse(
                {"error": "Tạo ảnh quá thời gian chờ.", "code": "GENERATION_TIMEOUT", "retryable": True, "request_id": request_id},
                status_code=504,
            )

        stderr_text = stderr.decode("utf-8", errors="replace")[:2000] if stderr else ""

        min_bytes = config.get("runtime", {}).get("min_output_bytes", 1024)
        output_exists = os.path.isfile(output_path) and os.path.getsize(output_path) >= min_bytes

        if proc.returncode != 0 or not output_exists:
            code, retryable = _classify_error(stderr_text)
            logger.error("[%s] Generation failed: code=%s retryable=%s stderr=%s", request_id, code, retryable, stderr_text[:300])
            manager.release(profile, success=False, error_code=code)
            released = True
            return JSONResponse(
                {"error": "Tạo ảnh thất bại. Kiểm tra log bridge để xem chi tiết.", "code": code, "retryable": retryable, "request_id": request_id},
                status_code=_status_for_code(code),
            )

        logger.info("[%s] Success, output_bytes=%d", request_id, os.path.getsize(output_path))
        manager.release(profile, success=True)
        released = True

        return FileResponse(
            output_path,
            media_type=f"image/{output_format}",
            filename=f"{request_id}.{output_format}",
            headers={"X-Request-Id": request_id},
            background=BackgroundTask(_cleanup_file, output_path),
        )

    except asyncio.CancelledError:
        await _stop_process_group(proc)
        if not released:
            manager.release(profile, success=False, error_code="GENERATION_FAILED")
        _cleanup_file(output_path)
        raise
    except Exception:
        await _stop_process_group(proc)
        if not released:
            manager.release(profile, success=False, error_code="GENERATION_FAILED")
        _cleanup_file(output_path)
        logger.exception("[%s] Unexpected bridge error", request_id)
        return JSONResponse(
            {"error": "Bridge gặp lỗi nội bộ.", "code": "GENERATION_FAILED", "retryable": True, "request_id": request_id},
            status_code=500,
        )


# ── Admin profile routes ─────────────────────────────────
@app.post("/api/profiles/{name}/enable")
async def profile_enable(name: str, request: Request):
    require_auth(request)
    ok = manager.enable(name)
    if not ok:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"status": "ok", "profile": name, "enabled": True}


@app.post("/api/profiles/{name}/disable")
async def profile_disable(name: str, request: Request):
    require_auth(request)
    ok = manager.disable(name)
    if not ok:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"status": "ok", "profile": name, "enabled": False}


@app.post("/api/profiles/{name}/clear-errors")
async def profile_clear_errors(name: str, request: Request):
    require_auth(request)
    ok = manager.clear_errors(name)
    if not ok:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"status": "ok", "profile": name, "errors_cleared": True}


# ── Main ───────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    host = config.get("server", {}).get("host", "127.0.0.1")
    port = config.get("server", {}).get("port", 8456)
    uvicorn.run(app, host=host, port=port, log_level="info")
