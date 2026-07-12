import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  softDeleteImages,
  hardDeleteImages,
  hardDeleteAllUserImages,
  countUserImagesIncludingDeleted,
} from "@/lib/storage";

const MAX_IDS = 200;

function normalizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => String(v || "").trim()).filter(Boolean))].slice(0, MAX_IDS);
}

/**
 * POST /api/images/bulk-delete
 * body:
 *  - { mode: "soft" | "hard", ids: string[] }
 *  - { mode: "hard_all_mine", confirm: "XOA" }  // xóa vĩnh viễn toàn bộ ảnh của chính user
 */
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  let body: {
    mode?: string;
    ids?: unknown;
    confirm?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  const mode = body.mode || "soft";
  const isAdmin = user.role === "admin";

  if (mode === "hard_all_mine") {
    if (body.confirm !== "XOA") {
      return NextResponse.json(
        { error: "Cần confirm đúng chữ XOA để xóa vĩnh viễn toàn bộ ảnh của bạn" },
        { status: 400 },
      );
    }
    const before = await countUserImagesIncludingDeleted(user.id);
    const deleted = await hardDeleteAllUserImages(user.id);
    return NextResponse.json({
      ok: true,
      mode,
      deleted,
      before,
      permanent: true,
    });
  }

  if (mode !== "soft" && mode !== "hard") {
    return NextResponse.json({ error: "mode không hợp lệ" }, { status: 400 });
  }

  const ids = normalizeIds(body.ids);
  if (ids.length === 0) {
    return NextResponse.json({ error: "Thiếu danh sách ảnh" }, { status: 400 });
  }

  if (mode === "soft") {
    const deleted = await softDeleteImages(ids, user.id, user.id, isAdmin);
    return NextResponse.json({
      ok: true,
      mode,
      requested: ids.length,
      deleted,
      permanent: false,
    });
  }

  // hard selected
  const deleted = await hardDeleteImages(ids, user.id, isAdmin);
  return NextResponse.json({
    ok: true,
    mode,
    requested: ids.length,
    deleted,
    permanent: true,
  });
}
