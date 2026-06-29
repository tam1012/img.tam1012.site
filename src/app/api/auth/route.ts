import { NextRequest, NextResponse } from "next/server";
import { getSession, getRole, Role } from "@/lib/auth";

export async function GET() {
  const role = await getRole();
  if (!role) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }
  return NextResponse.json({ role });
}

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    let role: Role | null = null;
    if (password === process.env.AUTH_PASSWORD) {
      role = "admin";
    } else if (process.env.GUEST_PASSWORD && password === process.env.GUEST_PASSWORD) {
      role = "guest";
    }

    if (!role) {
      return NextResponse.json({ error: "Sai mật khẩu" }, { status: 401 });
    }

    const session = await getSession();
    session.isLoggedIn = true;
    session.role = role;
    await session.save();

    const res = NextResponse.json({ ok: true, role });
    return res;
  } catch {
    return NextResponse.json({ error: "Lỗi đăng nhập" }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await getSession();
  session.destroy();
  const res = NextResponse.json({ ok: true });
  return res;
}
