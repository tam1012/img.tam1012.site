#!/usr/bin/env python3
import json
import os
import sys
import tempfile
from pathlib import Path

SOURCE_DIR = Path(os.environ.get("XAI_AUTH_SOURCE_DIR", "/home/ubuntu/cliproxyapi/auths"))
TARGET_DIR = Path(os.environ.get("XAI_AUTH_TARGET_DIR", "/home/ubuntu/img-studio/secrets/xai-auths"))
TARGET_UID = int(os.environ["XAI_AUTH_TARGET_UID"]) if os.environ.get("XAI_AUTH_TARGET_UID") else None
TARGET_GID = int(os.environ["XAI_AUTH_TARGET_GID"]) if os.environ.get("XAI_AUTH_TARGET_GID") else None


def valid_xai_files() -> list[Path]:
    if not SOURCE_DIR.is_dir():
        raise RuntimeError("xAI auth source directory does not exist")
    result: list[Path] = []
    for file_path in sorted(SOURCE_DIR.glob("xai-*.json")):
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data.get("access_token"), str) and data["access_token"]:
            result.append(file_path)
    return result


def sync() -> int:
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    if TARGET_UID is not None or TARGET_GID is not None:
        os.chown(TARGET_DIR, TARGET_UID if TARGET_UID is not None else -1, TARGET_GID if TARGET_GID is not None else -1)
    os.chmod(TARGET_DIR, 0o700)
    source_files = valid_xai_files()
    desired: set[str] = set()
    changed = 0

    for index, source_file in enumerate(source_files, 1):
        target_name = f"xai-{index:02d}.json"
        desired.add(target_name)
        target_path = TARGET_DIR / target_name
        source_bytes = source_file.read_bytes()
        if target_path.is_file() and target_path.read_bytes() == source_bytes:
            continue
        fd, temp_name = tempfile.mkstemp(prefix=f".{target_name}.", dir=TARGET_DIR)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(source_bytes)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temp_name, 0o600)
            if TARGET_UID is not None or TARGET_GID is not None:
                os.chown(temp_name, TARGET_UID if TARGET_UID is not None else -1, TARGET_GID if TARGET_GID is not None else -1)
            os.replace(temp_name, target_path)
            changed += 1
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    for existing in TARGET_DIR.glob("xai-*.json"):
        if existing.name not in desired:
            existing.unlink()
            changed += 1

    print(f"xAI OAuth sync complete accounts={len(source_files)} changed={changed}")
    return len(source_files)


def main() -> int:
    lock_file = TARGET_DIR.parent / ".xai-auth-sync.lock"
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    with lock_file.open("w") as lock:
        try:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except ImportError:
            pass
        except BlockingIOError:
            print("xAI OAuth sync already running")
            return 0
        try:
            sync()
            return 0
        except Exception as error:
            print(f"xAI OAuth sync failed: {error}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
