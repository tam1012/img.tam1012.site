import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

const SIGNUP_CREDIT_VND = 1000;
const DISPLAY_NAME_MAX = 100;
/** Chữ (kể cả tiếng Việt), số, khoảng trắng, dấu . ' - ; không cho HTML/ký tự lạ */
const DISPLAY_NAME_RE = /^[\p{L}\p{N}]+(?:[ .'\-][\p{L}\p{N}]+)*$/u;

export function normalizeEmail(value?: string | null) {
  const email = value?.trim().toLowerCase();
  return email || null;
}

export function normalizePhone(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return null;
  let phone = raw.replace(/[\s().-]/g, "");
  if (phone.startsWith("+84")) phone = `0${phone.slice(3)}`;
  if (phone.startsWith("84")) phone = `0${phone.slice(2)}`;
  return /^0\d{9,10}$/.test(phone) ? phone : null;
}

/** Chuẩn hoá + validate tên hiển thị. Trả null nếu để trống. Ném Error nếu không hợp lệ. */
export function normalizeDisplayName(value?: string | null): string | null {
  if (value == null) return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length > DISPLAY_NAME_MAX) {
    throw new Error(`Tên hiển thị tối đa ${DISPLAY_NAME_MAX} ký tự`);
  }
  if (!DISPLAY_NAME_RE.test(name)) {
    throw new Error("Tên hiển thị chỉ gồm chữ, số, khoảng trắng và dấu . ' -");
  }
  return name;
}

export function publicUser(user: {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  role: "admin" | "user";
  status: "active" | "blocked";
  createdAt?: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    display_name: user.displayName,
    role: user.role,
    status: user.status,
    created_at: user.createdAt?.toISOString(),
  };
}

export async function createUser(input: { email?: string | null; phone?: string | null; password: string; displayName?: string | null }) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const displayName = normalizeDisplayName(input.displayName);

  if (!email && !phone) throw new Error("Vui lòng nhập email hoặc số điện thoại hợp lệ");
  if (!input.password || input.password.length < 8) throw new Error("Mật khẩu cần tối thiểu 8 ký tự");

  const existed = await prisma.user.findFirst({
    where: { OR: [email ? { email } : {}, phone ? { phone } : {}].filter((item) => Object.keys(item).length > 0) },
  });
  if (existed) throw new Error("Email hoặc số điện thoại đã được đăng ký");

  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.create({
    data: {
      email,
      phone,
      displayName,
      passwordHash,
      role: "user",
      status: "active",
      wallet: { create: { balanceVnd: SIGNUP_CREDIT_VND } },
      ledger: {
        create: {
          type: "topup_manual",
          amountVnd: SIGNUP_CREDIT_VND,
          balanceAfterVnd: SIGNUP_CREDIT_VND,
          note: "Tặng 10 ảnh khi tạo tài khoản",
        },
      },
    },
  });
}

export async function verifyUserLogin(identifier: string, password: string) {
  const value = identifier?.trim();
  if (!value || !password) return null;

  const normalizedEmail = normalizeEmail(value);
  const normalizedPhone = normalizePhone(value);
  const where = [normalizedEmail ? { email: normalizedEmail } : null, normalizedPhone ? { phone: normalizedPhone } : null].filter(Boolean) as { email?: string; phone?: string }[];
  if (where.length === 0) return null;

  const user = await prisma.user.findFirst({
    where: { OR: where },
  });
  if (!user || user.status !== "active") return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}
