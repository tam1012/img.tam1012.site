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

const GENERATE_WINDOW_MS = 60 * 1000;
const MAX_GENERATE_PER_WINDOW = 20;
const generateStore = new Map<string, Entry>();

/**
 * Rate-limit tạo/sửa ảnh & video theo user: tối đa 20 request / phút.
 * Chặn spam script gọi thẳng API (case doandk23 spam ~50 req/s khi balance=0).
 * Trả về true nếu đã vượt ngưỡng và cần chặn (429).
 */
export function isGenerateRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = generateStore.get(userId);
  if (!entry || now > entry.resetAt) {
    generateStore.set(userId, { count: 1, resetAt: now + GENERATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_GENERATE_PER_WINDOW;
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
