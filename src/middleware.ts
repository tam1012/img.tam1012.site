import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const session = req.cookies.get("img-session");
  const { pathname } = req.nextUrl;

  const isPublic = pathname === "/login" || pathname === "/api/auth" || pathname.startsWith("/api/images/");

  if (!session && !isPublic) {
    if (pathname.startsWith("/api/")) {
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
