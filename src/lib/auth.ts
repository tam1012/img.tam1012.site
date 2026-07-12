import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export type Role = "admin" | "user";

export interface SessionData {
  isLoggedIn?: boolean;
  userId?: string;
  role?: Role;
}

export interface CurrentUser {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  role: Role;
  status: "active" | "blocked";
  balanceVnd: number;
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET phải có tối thiểu 32 ký tự");
  }
  return secret;
}

function getSessionOptions(): SessionOptions {
  return {
    password: getSessionSecret(),
    cookieName: "img-session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { wallet: true },
  });

  if (!user || user.status !== "active") return null;

  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    balanceVnd: user.wallet?.balanceVnd ?? 0,
  };
}

export async function requireUser(): Promise<CurrentUser | null> {
  return getCurrentUser();
}

export async function requireAdmin(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  return user?.role === "admin" ? user : null;
}

export async function requireAuth(): Promise<boolean> {
  return Boolean(await getCurrentUser());
}

export async function getRole(): Promise<Role | null> {
  return (await getCurrentUser())?.role ?? null;
}
