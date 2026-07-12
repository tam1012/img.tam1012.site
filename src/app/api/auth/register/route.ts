import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createUser, publicUser } from "@/lib/users";
import { clientIp, isRegisterBlocked, recordRegistration, isDisposableEmail } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.email && isDisposableEmail(body.email)) {
      return NextResponse.json(
        { error: "Email tạm thời không được hỗ trợ. Vui lòng dùng email thật." },
        { status: 400 },
      );
    }

    const ip = clientIp(req);
    if (isRegisterBlocked(ip)) {
      return NextResponse.json(
        { error: "Quá nhiều lần đăng ký. Vui lòng thử lại sau 1 giờ." },
        { status: 429 },
      );
    }

    // Chỉ tính quota sau khi tạo user thành công — tránh bot đốt slot bằng payload rác
    const user = await createUser({
      email: body.email,
      phone: body.phone,
      password: body.password,
      displayName: body.display_name || body.displayName,
    });

    recordRegistration(ip);

    const session = await getSession();
    session.isLoggedIn = true;
    session.userId = user.id;
    session.role = user.role;
    await session.save();

    return NextResponse.json({ ok: true, user: publicUser(user), role: user.role });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Lỗi đăng ký";
    const status =
      message.includes("đã được đăng ký") ||
      message.includes("Vui lòng") ||
      message.includes("Mật khẩu") ||
      message.includes("Tên hiển thị")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
