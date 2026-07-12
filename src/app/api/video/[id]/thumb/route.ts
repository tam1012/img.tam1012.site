import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { requireUser } from "@/lib/auth";
import { getVideoFilePath, getVideoById } from "@/lib/video";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const THUMBS_DIR = path.join(DATA_DIR, "videos", "thumbs");

function getThumbPath(id: string): string {
  return path.join(THUMBS_DIR, `${id}.jpg`);
}

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
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const videoPath = getVideoFilePath(id);
  if (!videoPath) {
    return NextResponse.json({ error: "Không tìm thấy video" }, { status: 404 });
  }

  const thumbPath = getThumbPath(id);

  if (!fs.existsSync(thumbPath)) {
    fs.mkdirSync(THUMBS_DIR, { recursive: true });
    try {
      execFileSync("ffmpeg", [
        "-i", videoPath,
        "-frames:v", "1",
        "-q:v", "8",
        "-vf", "scale='min(640,iw)':-2",
        thumbPath,
      ], { timeout: 10_000, stdio: "ignore" });
    } catch {
      return NextResponse.json({ error: "Tạo thumbnail thất bại" }, { status: 500 });
    }
  }

  if (!fs.existsSync(thumbPath)) {
    return NextResponse.json({ error: "Thumbnail không tồn tại" }, { status: 404 });
  }

  const data = fs.readFileSync(thumbPath);
  return new NextResponse(data, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Length": String(data.length),
    },
  });
}
