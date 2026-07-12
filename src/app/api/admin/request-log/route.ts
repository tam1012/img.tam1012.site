import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getRequestLog, RequestLogKind, RequestLogStatus } from "@/lib/request-log";

const KINDS: RequestLogKind[] = ["generate", "edit", "video"];
const STATUSES: RequestLogStatus[] = ["processing", "completed", "failed", "deleted"];

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const kindParam = params.get("kind");
  const statusParam = params.get("status");
  const model = params.get("model");

  const result = await getRequestLog({
    kind: kindParam && KINDS.includes(kindParam as RequestLogKind) ? (kindParam as RequestLogKind) : null,
    status: statusParam && STATUSES.includes(statusParam as RequestLogStatus) ? (statusParam as RequestLogStatus) : null,
    model: model && model !== "all" ? model : null,
    from: parseDate(params.get("from")),
    to: parseDate(params.get("to")),
    page: Number(params.get("page")) || 1,
    pageSize: Number(params.get("page_size")) || 50,
  });

  return NextResponse.json(result);
}
