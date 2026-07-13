import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { Readable } from "node:stream";
import { requireUser } from "@/lib/auth";
import { getVideoFilePath, getVideoById, deleteVideo } from "@/lib/video";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const { id } = await params;

  const video = await getVideoById(id);
  if (!video && user.role !== "admin") {
    return NextResponse.json({ error: "Không tìm thấy video" }, { status: 404 });
  }
  if (video && user.role !== "admin" && video.userId !== user.id) {
    return NextResponse.json({ error: "Không có quyền xem video này" }, { status: 403 });
  }

  const filePath = getVideoFilePath(id);
  if (!filePath) {
    return NextResponse.json({ error: "Không tìm thấy video" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.get("range");

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    let start: number;
    let end: number;

    if (!match[1] && match[2]) {
      const suffix = parseInt(match[2], 10);
      start = Math.max(0, fileSize - suffix);
      end = fileSize - 1;
    } else {
      start = match[1] ? parseInt(match[1], 10) : 0;
      end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
    }

    if (start >= fileSize || end >= fileSize || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const chunkSize = end - start + 1;
    const nodeStream = fs.createReadStream(filePath, { start, end });
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new NextResponse(webStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": "video/mp4",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

  const nodeStream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    headers: {
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Content-Type": "video/mp4",
      "Cache-Control": "private, max-age=31536000, immutable",
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
  const video = await getVideoById(id);
  if (!video) {
    return NextResponse.json({ error: "Video không tồn tại" }, { status: 404 });
  }
  if (user.role !== "admin" && video.userId !== user.id) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  if (!(await deleteVideo(id, user.id))) {
    return NextResponse.json({ error: "Video không tồn tại" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
