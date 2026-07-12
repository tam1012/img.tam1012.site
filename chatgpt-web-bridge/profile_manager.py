"""
Profile manager for chatgpt-web-bridge.
Manages browser profiles: acquires/releases, tracks state, enforces concurrency.
Supports round-robin across multiple ChatGPT accounts / Chromium profiles.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import asyncio
import time
import logging

logger = logging.getLogger(__name__)


@dataclass
class Profile:
    name: str
    profile_dir: str
    chrome_profile: str = "auto"
    label: str | None = None
    enabled: bool = True
    state: str = "idle"  # idle, busy, cooldown, needs_login, captcha_or_cloudflare, rate_limited, disabled
    error_count: int = 0
    cooldown_until: float | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None
    last_success_at: str | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def to_status(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "chrome_profile": self.chrome_profile,
            "state": self.state,
            "enabled": self.enabled,
            "error_count": self.error_count,
            "cooldown_until": (
                datetime.fromtimestamp(self.cooldown_until, tz=timezone.utc).isoformat()
                if self.cooldown_until
                else None
            ),
            "last_error_code": self.last_error_code,
            "last_success_at": self.last_success_at,
        }


class ProfileManager:
    def __init__(self, config: dict):
        self.profiles: dict[str, Profile] = {}
        self._profile_order: list[str] = []
        self._rr_index = 0
        self._global_semaphore = asyncio.Semaphore(config.get("runtime", {}).get("max_global_concurrency", 1))
        self._acquire_timeout = config.get("runtime", {}).get("acquire_timeout_seconds", 30)
        self._cooldown_success = config.get("runtime", {}).get("cooldown_seconds_after_success", 20)
        self._cooldown_error = config.get("runtime", {}).get("cooldown_seconds_after_error", 120)
        self._max_errors = 3

        profiles_dir = config["paths"]["profiles_dir"]
        for p in config.get("profiles", []):
            name = p["name"]
            user_data_dir = p.get("user_data_dir") or f"{profiles_dir}/{name}"
            self.profiles[name] = Profile(
                name=name,
                profile_dir=user_data_dir,
                chrome_profile=p.get("chrome_profile") or "auto",
                label=p.get("label"),
                enabled=p.get("enabled", True),
            )
            self._profile_order.append(name)

    def _refresh_idle(self, p: Profile, now: float) -> None:
        if p.state in ("cooldown", "rate_limited") and p.cooldown_until and now >= p.cooldown_until:
            p.state = "idle"
            p.cooldown_until = None

    def _candidate_order(self, name: str | None) -> list[Profile]:
        if name and name in self.profiles:
            return [self.profiles[name]]
        if not self._profile_order:
            return []
        # Round-robin: start after last used index so we spread across accounts
        n = len(self._profile_order)
        start = self._rr_index % n
        ordered_names = self._profile_order[start:] + self._profile_order[:start]
        return [self.profiles[k] for k in ordered_names]

    async def acquire(self, name: str | None = None, timeout: float | None = None) -> Profile | None:
        """Acquire an available profile. If name given, try that specific one."""
        t = timeout or self._acquire_timeout
        deadline = time.monotonic() + t

        try:
            await asyncio.wait_for(self._global_semaphore.acquire(), timeout=t)
        except asyncio.TimeoutError:
            return None

        while time.monotonic() < deadline:
            candidates = self._candidate_order(name)

            for p in candidates:
                now = time.time()
                self._refresh_idle(p, now)
                if not p.enabled:
                    continue
                # Chỉ lấy profile thật sự rảnh (sau cooldown/rate_limit đã hết)
                if p.state != "idle":
                    continue
                if p.cooldown_until and now < p.cooldown_until:
                    continue
                if p.lock.locked():
                    continue

                try:
                    acquired = await asyncio.wait_for(p.lock.acquire(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue

                if acquired:
                    p.state = "busy"
                    p.cooldown_until = None
                    # next acquire starts after this profile in the list
                    if p.name in self._profile_order:
                        self._rr_index = (self._profile_order.index(p.name) + 1) % len(self._profile_order)
                    logger.info(
                        "Acquired %s (%s) chrome_profile=%s; next_rr=%s",
                        p.name,
                        p.label or "-",
                        p.chrome_profile,
                        self._profile_order[self._rr_index] if self._profile_order else "-",
                    )
                    return p

            await asyncio.sleep(1.0)

        self._global_semaphore.release()
        return None

    def release(self, profile: Profile, success: bool, error_code: str | None = None, error_message: str | None = None):
        """Release a profile back to the pool."""
        if success:
            # Cooldown rõ ràng để status/UI không hiểu nhầm là rảnh ngay
            profile.state = "cooldown"
            profile.error_count = 0
            profile.last_success_at = datetime.now(timezone.utc).isoformat()
            profile.cooldown_until = time.time() + self._cooldown_success
        else:
            profile.error_count += 1
            profile.last_error_code = error_code

            # Map error code to state
            if error_code == "NEEDS_LOGIN":
                profile.state = "needs_login"
                profile.cooldown_until = None
            elif error_code == "CAPTCHA_REQUIRED":
                profile.state = "captcha_or_cloudflare"
                profile.cooldown_until = None
            elif error_code == "RATE_LIMITED":
                profile.state = "rate_limited"
                profile.cooldown_until = time.time() + self._cooldown_error
            else:
                profile.state = "cooldown"
                profile.cooldown_until = time.time() + self._cooldown_error

            if profile.error_count >= self._max_errors and error_code not in ("NEEDS_LOGIN", "CAPTCHA_REQUIRED"):
                profile.state = "disabled"
                logger.warning("Profile %s disabled after %d consecutive errors", profile.name, profile.error_count)

        # Only unlock if currently locked
        if profile.lock.locked():
            profile.lock.release()
        self._global_semaphore.release()

    def get_status(self) -> dict:
        return {
            "status": "ok",
            "profiles": [p.to_status() for p in self.profiles.values()],
        }

    def enable(self, name: str) -> bool:
        p = self.profiles.get(name)
        if not p:
            return False
        p.enabled = True
        if p.state in ("disabled", "needs_login", "captcha_or_cloudflare"):
            p.state = "idle"
            p.error_count = 0
            p.cooldown_until = None
        return True

    def disable(self, name: str) -> bool:
        p = self.profiles.get(name)
        if not p:
            return False
        p.enabled = False
        p.state = "disabled"
        return True

    def clear_errors(self, name: str) -> bool:
        p = self.profiles.get(name)
        if not p:
            return False
        p.error_count = 0
        p.last_error_code = None
        p.last_error_message = None
        p.cooldown_until = None
        if p.state in ("needs_login", "captcha_or_cloudflare", "rate_limited", "cooldown", "disabled"):
            p.state = "idle"
        return True
