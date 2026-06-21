import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type Role = "admin" | "guest";

export interface SessionData {
  isLoggedIn: boolean;
  role: Role;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "fallback-secret-change-me-in-production-please",
  cookieName: "img-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 30,
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function requireAuth(): Promise<boolean> {
  const session = await getSession();
  return session.isLoggedIn === true;
}

export async function requireAdmin(): Promise<boolean> {
  const session = await getSession();
  return session.isLoggedIn === true && session.role === "admin";
}

export async function getRole(): Promise<Role | null> {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session.role || "admin";
}
