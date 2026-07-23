const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

type Entry = { count: number; resetAt: number };
const store = new Map<string, Entry>();

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Trả về true nếu IP đã vượt ngưỡng đăng nhập sai và cần bị chặn tạm thời. */
export function isLoginBlocked(ip: string): boolean {
  const entry = store.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    store.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function resetLoginAttempts(ip: string): void {
  store.delete(ip);
}

const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const MAX_REGISTRATIONS = 3;
const registerStore = new Map<string, Entry>();

export function isRegisterBlocked(ip: string): boolean {
  const entry = registerStore.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    registerStore.delete(ip);
    return false;
  }
  return entry.count >= MAX_REGISTRATIONS;
}

export function recordRegistration(ip: string): void {
  const now = Date.now();
  const entry = registerStore.get(ip);
  if (!entry || now > entry.resetAt) {
    registerStore.set(ip, { count: 1, resetAt: now + REGISTER_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

const DISPOSABLE_DOMAINS = new Set([
  "mail.com",
  "yopmail.com",
  "yopmail.fr",
  "tempmail.com",
  "tempmail.org",
  "temp-mail.org",
  "temp-mail.com",
  "10minutemail.com",
  "10minutemail.net",
  "guerrillamail.com",
  "guerrillamail.org",
  "guerrillamail.net",
  "guerrillamail.de",
  "sharklasers.com",
  "grr.la",
  "mailinator.com",
  "mailinator.net",
  "mailinator.org",
  "mailnesia.com",
  "maildrop.cc",
  "dispostable.com",
  "throwaway.email",
  "throwawaymail.com",
  "fakeinbox.com",
  "emailondeck.com",
  "getnada.com",
  "nada.email",
  "trashmail.com",
  "trashmail.net",
  "trashmail.org",
  "trashmail.me",
  "spambog.com",
  "spambog.de",
  "discard.email",
  "discardmail.com",
  "mailsac.com",
  "mailcatch.com",
  "mytemp.email",
  "moakt.com",
  "atomicmail.io",
  "tempinbox.com",
  "pokemail.net",
  "spam4.me",
  "emailfake.com",
  "email-fake.com",
  "fakemail.net",
  "tmpmail.org",
  "tmpmailer.com",
  "tmpeml.com",
  "tmail.io",
  "tmails.net",
  "harakirimail.com",
  "mintemail.com",
  "mohmal.com",
  "armyspy.com",
  "cuvox.de",
  "dayrep.com",
  "rhyta.com",
  "teleworm.us",
  "jourrapide.com",
  "einrot.com",
  "gustr.com",
  "superrito.com",
  "fleckens.hu",
]);

/**
 * Giới hạn tạo/sửa ảnh + video theo user (chống spam song song / đốt quota provider).
 *
 * - Tối đa 3 đơn vị / 60s / user (ảnh generate, edit, video = 1; batch count=n = n).
 * - Cùng lúc chỉ 1 job / user; job sau xếp hàng im (client chỉ thấy loading).
 * - Batch không cấm: count > 3 thì chờ cửa sổ trống rồi chạy full batch.
 * - Chờ tối đa 120s rồi mới 429 với message chung, không lộ "đang có job khác".
 */
const USER_GEN_WINDOW_MS = 60_000;
const USER_GEN_MAX_UNITS = 3;
const USER_GEN_MAX_WAIT_MS = 120_000;

export const USER_GENERATION_BUSY_MESSAGE =
  "Hệ thống đang bận, vui lòng thử lại sau";

export class UserGenerationLimitError extends Error {
  readonly status = 429;

  constructor(message = USER_GENERATION_BUSY_MESSAGE) {
    super(message);
    this.name = "UserGenerationLimitError";
  }
}

type UserGenWaiter = {
  units: number;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type UserGenState = {
  running: boolean;
  /** Mỗi phần tử = 1 đơn vị đã dùng tại mốc thời gian đó. */
  stamps: number[];
  waiters: UserGenWaiter[];
  pumpTimer: ReturnType<typeof setTimeout> | null;
};

export class UserGenerationLimiter {
  private states = new Map<string, UserGenState>();

  constructor(
    private readonly maxUnits = USER_GEN_MAX_UNITS,
    private readonly windowMs = USER_GEN_WINDOW_MS,
    private readonly maxWaitMs = USER_GEN_MAX_WAIT_MS,
    private readonly now = () => Date.now(),
  ) {}

  /** Dành cho test: xóa toàn bộ trạng thái. */
  reset(): void {
    for (const state of this.states.values()) {
      if (state.pumpTimer) clearTimeout(state.pumpTimer);
      for (const w of state.waiters) {
        if (w.timer) clearTimeout(w.timer);
      }
    }
    this.states.clear();
  }

  /**
   * Chờ im tới khi user rảnh (không job khác) và còn đủ slot,
   * rồi chiếm hàng đợi + reserve `units`. Trả về hàm release() phải gọi khi xong.
   */
  acquire(userId: string, units = 1): Promise<() => void> {
    const need = Math.max(1, Math.floor(Number(units) || 1));
    const state = this.getState(userId);
    const deadline = this.now() + this.maxWaitMs;

    return new Promise<() => void>((resolve, reject) => {
      const waiter: UserGenWaiter = {
        units: need,
        resolve,
        reject,
        deadline,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        this.failWaiter(userId, waiter, new UserGenerationLimitError());
      }, Math.max(0, deadline - this.now()));
      state.waiters.push(waiter);
      this.pump(userId);
    });
  }

  private getState(userId: string): UserGenState {
    let state = this.states.get(userId);
    if (!state) {
      state = { running: false, stamps: [], waiters: [], pumpTimer: null };
      this.states.set(userId, state);
    }
    return state;
  }

  private prune(state: UserGenState, now: number): void {
    const cutoff = now - this.windowMs;
    while (state.stamps.length > 0 && state.stamps[0] <= cutoff) {
      state.stamps.shift();
    }
  }

  /** Batch lớn hơn max: chỉ start khi cửa sổ đang trống. */
  private canFit(state: UserGenState, units: number, now: number): boolean {
    this.prune(state, now);
    if (units <= this.maxUnits) {
      return state.stamps.length + units <= this.maxUnits;
    }
    return state.stamps.length === 0;
  }

  private msUntilFit(state: UserGenState, units: number, now: number): number {
    this.prune(state, now);
    if (this.canFit(state, units, now)) return 0;
    if (state.stamps.length === 0) return this.windowMs;

    if (units <= this.maxUnits) {
      // Cần bỏ bớt stamp cũ cho đủ chỗ.
      const overflow = state.stamps.length + units - this.maxUnits;
      const idx = Math.min(overflow - 1, state.stamps.length - 1);
      return Math.max(1, state.stamps[idx] + this.windowMs - now);
    }
    // Batch > max: chờ stamp cũ nhất hết hạn hết cửa sổ.
    const last = state.stamps[state.stamps.length - 1];
    return Math.max(1, last + this.windowMs - now);
  }

  private failWaiter(userId: string, waiter: UserGenWaiter, err: Error): void {
    const state = this.states.get(userId);
    if (!state) return;
    const idx = state.waiters.indexOf(waiter);
    if (idx === -1) return;
    state.waiters.splice(idx, 1);
    if (waiter.timer) {
      clearTimeout(waiter.timer);
      waiter.timer = null;
    }
    waiter.reject(err);
  }

  private schedulePump(userId: string, delayMs: number): void {
    const state = this.getState(userId);
    if (state.pumpTimer) clearTimeout(state.pumpTimer);
    state.pumpTimer = setTimeout(() => {
      state.pumpTimer = null;
      this.pump(userId);
    }, Math.max(1, delayMs));
  }

  private pump(userId: string): void {
    const state = this.getState(userId);
    if (state.running) return;

    const now = this.now();
    while (state.waiters.length > 0 && state.waiters[0].deadline <= now) {
      const expired = state.waiters.shift()!;
      if (expired.timer) {
        clearTimeout(expired.timer);
        expired.timer = null;
      }
      expired.reject(new UserGenerationLimitError());
    }
    if (state.waiters.length === 0) return;

    const waiter = state.waiters[0];
    const waitMs = this.msUntilFit(state, waiter.units, now);
    if (waitMs > 0) {
      const remaining = waiter.deadline - now;
      if (remaining <= 0) {
        this.failWaiter(userId, waiter, new UserGenerationLimitError());
        this.pump(userId);
        return;
      }
      this.schedulePump(userId, Math.min(waitMs, remaining));
      return;
    }

    // Đủ điều kiện: chiếm slot + đánh dấu running.
    state.waiters.shift();
    if (waiter.timer) {
      clearTimeout(waiter.timer);
      waiter.timer = null;
    }
    const acquiredAt = this.now();
    for (let i = 0; i < waiter.units; i++) {
      state.stamps.push(acquiredAt);
    }
    state.running = true;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      state.running = false;
      this.pump(userId);
    };
    waiter.resolve(release);
  }
}

export const userGenerationLimiter = new UserGenerationLimiter();

/** Bọc create/edit/video: chờ im theo hàng đợi user rồi chạy fn. */
export async function withUserGenerationLimit<T>(
  userId: string,
  units: number,
  fn: () => Promise<T>,
): Promise<T> {
  const release = await userGenerationLimiter.acquire(userId, units);
  try {
    return await fn();
  } finally {
    release();
  }
}

export function isDisposableEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1) return false;
  const domain = normalized.slice(atIndex + 1);
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // chặn subdomain kiểu mail.yopmail.com, a.tmpmailer.com
  for (const blocked of DISPOSABLE_DOMAINS) {
    if (domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}
