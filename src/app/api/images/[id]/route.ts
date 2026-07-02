import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getImage, getImageFile, getImageThumbnailFile, softDeleteImage } from "@/lib/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const record = getImage(id);
  if (!record) {
    return NextResponse.json({ error: "Không tìm thấy ảnh" }, { status: 404 });
  }

  const isThumbnail = req.nextUrl.searchParams.get("thumb") === "1";
  const thumbnail = isThumbnail ? await getImageThumbnailFile(record.filename) : null;
  const data = thumbnail?.data ?? getImageFile(record.filename);
  if (!data) {
    return NextResponse.json({ error: "File ảnh bị mất" }, { status: 404 });
  }

  const isThumbnailFallback = Boolean(thumbnail?.isFallback);

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": isThumbnail && !isThumbnailFallback ? "image/webp" : record.mime_type,
      "Cache-Control": isThumbnailFallback
        ? "private, no-store"
        : "private, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${isThumbnail && !isThumbnailFallback ? `${id}.thumb.webp` : record.filename}"`,
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const { id } = await params;
  if (!softDeleteImage(id, "admin")) {
    return NextResponse.json({ error: "Ảnh không tồn tại" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
