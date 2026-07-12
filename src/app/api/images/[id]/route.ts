import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { requireUser } from "@/lib/auth";
import { getImage, getImageFile, getImageThumbnailFile, softDeleteImage } from "@/lib/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await params;
  const record = await getImage(id);
  if (!record) {
    return NextResponse.json({ error: "Không tìm thấy ảnh" }, { status: 404 });
  }
  if (user.role !== "admin" && record.user_id !== user.id) {
    return NextResponse.json({ error: "Không có quyền xem ảnh này" }, { status: 403 });
  }

  const isThumbnail = req.nextUrl.searchParams.get("thumb") === "1";
  const thumbnail = isThumbnail ? await getImageThumbnailFile(record.filename) : null;
  const data = thumbnail?.data ?? getImageFile(record.filename);
  if (!data) {
    return NextResponse.json({ error: "File ảnh bị mất" }, { status: 404 });
  }

  const isThumbnailFallback = Boolean(thumbnail?.isFallback);

  const format = req.nextUrl.searchParams.get("format");
  if (!isThumbnail && (format === "jpg" || format === "jpeg")) {
    const jpeg = await sharp(data).jpeg({ quality: 92 }).toBuffer();
    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `attachment; filename="${id}.jpg"`,
      },
    });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": isThumbnail && !isThumbnailFallback ? "image/webp" : record.mime_type,
      "Cache-Control": isThumbnailFallback ? "private, no-store" : "private, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${isThumbnail && !isThumbnailFallback ? `${id}.thumb.webp` : record.filename}"`,
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await params;
  const record = await getImage(id);
  if (!record) {
    return NextResponse.json({ error: "Ảnh không tồn tại" }, { status: 404 });
  }
  if (user.role !== "admin" && record.user_id !== user.id) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  if (!(await softDeleteImage(id, user.id, user.id, user.role === "admin"))) {
    return NextResponse.json({ error: "Ảnh không tồn tại" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
