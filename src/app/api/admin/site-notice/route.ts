import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getSiteNotice, normalizeSiteNotice, setSiteNotice, SITE_NOTICE_MAX } from "@/lib/site-settings";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }
  const data = await getSiteNotice();
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const raw = typeof body.notice === "string" ? body.notice : "";
    if (raw.length > SITE_NOTICE_MAX) {
      return NextResponse.json(
        { error: `Ghi chú tối đa ${SITE_NOTICE_MAX} ký tự` },
        { status: 400 },
      );
    }
    const data = await setSiteNotice(normalizeSiteNotice(raw), admin.id);
    return NextResponse.json({ ok: true, ...data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Không lưu được ghi chú";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
