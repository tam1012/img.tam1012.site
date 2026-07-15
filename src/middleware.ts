import { NextRequest, NextResponse } from "next/server";

function hasBearerAuth(req: NextRequest): boolean {
  const header = req.headers.get("authorization") || "";
  return /^Bearer\s+\S+/i.test(header);
}

export function middleware(req: NextRequest) {
  const session = req.cookies.get("img-session");
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/api/auth" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/register" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/payos/webhook" ||
    pathname === "/favicon.ico" ||
    // Public API v1: cho phép vào route để tự kiểm tra Bearer (không cần cookie).
    pathname.startsWith("/api/v1/");

  if (!session && !isPublic) {
    if (pathname.startsWith("/api/")) {
      // API key management vẫn cần session; nếu gửi Bearer nhầm vào route khác thì cũng 401.
      if (hasBearerAuth(req) && pathname.startsWith("/api/v1/")) {
        return NextResponse.next();
      }
      return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (session && pathname === "/login") {
    return NextResponse.redirect(new URL("/generate", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
