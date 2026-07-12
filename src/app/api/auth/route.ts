import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, getSession } from "@/lib/auth";
import { publicUser, verifyUserLogin } from "@/lib/users";
import { clientIp, isLoginBlocked, recordLoginFailure, resetLoginAttempts } from "@/lib/rate-limit";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  return NextResponse.json({ user: publicUser(user), role: user.role });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (isLoginBlocked(ip)) {
    return NextResponse.json({ error: "Bạn đã thử sai quá nhiều lần. Vui lòng thử lại sau ít phút." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const identifier = body.identifier || body.email || body.phone;
    const user = await verifyUserLogin(identifier, body.password);

    if (!user) {
      recordLoginFailure(ip);
      return NextResponse.json({ error: "Sai tài khoản hoặc mật khẩu" }, { status: 401 });
    }

    resetLoginAttempts(ip);
    const session = await getSession();
    session.isLoggedIn = true;
    session.userId = user.id;
    session.role = user.role;
    await session.save();

    return NextResponse.json({ ok: true, user: publicUser(user), role: user.role });
  } catch {
    return NextResponse.json({ error: "Lỗi đăng nhập" }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}
