import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireUserFromRequest } from "@/lib/auth";
import { getImage, getImageFile } from "@/lib/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "API key không hợp lệ hoặc đã thu hồi" }, { status: 401 });
  }

  const { id } = await params;
  const record = await getImage(id);
  if (!record || record.status === "deleted" || record.deleted_at || !record.filename) {
    return NextResponse.json({ error: "Không tìm thấy ảnh" }, { status: 404 });
  }
  if (user.role !== "admin" && record.user_id !== user.id) {
    return NextResponse.json({ error: "Không có quyền xem ảnh này" }, { status: 403 });
  }

  const data = getImageFile(record.filename);
  if (!data) {
    return NextResponse.json({ error: "File ảnh bị mất" }, { status: 404 });
  }

  const format = req.nextUrl.searchParams.get("format");
  if (format === "jpg" || format === "jpeg") {
    const jpeg = await sharp(data).jpeg({ quality: 92 }).toBuffer();
    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${id}.jpg"`,
      },
    });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": record.mime_type || "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${record.filename}"`,
    },
  });
}
