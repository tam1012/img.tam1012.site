import { NextRequest, NextResponse } from "next/server";
import { getImage, getImageFile } from "@/lib/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const record = getImage(id);
  if (!record) {
    return NextResponse.json({ error: "Không tìm thấy ảnh" }, { status: 404 });
  }

  const data = getImageFile(record.filename);
  if (!data) {
    return NextResponse.json({ error: "File ảnh bị mất" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": record.mime_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${record.filename}"`,
    },
  });
}
