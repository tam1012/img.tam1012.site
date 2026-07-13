import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Chấp nhận cả prisma thường lẫn tx trong transaction.
type Db = Prisma.TransactionClient | typeof prisma;

export type RequestDeleteMode = "soft" | "hard";

/** Ghi dòng nhật ký request mới (trạng thái processing). Upsert theo relatedImageId/relatedVideoId để retry idempotent. */
export async function logRequestStart(
  db: Db,
  input: {
    userId: string;
    kind: RequestLogKind;
    model: string;
    providerName?: string | null;
    account?: string | null;
    costVnd: number;
    aspectRatio?: string | null;
    resolution?: string | null;
    batchId?: string | null;
    relatedImageId?: string | null;
    relatedVideoId?: string | null;
  },
): Promise<void> {
  const data = {
    userId: input.userId,
    kind: input.kind,
    model: input.model,
    providerName: input.providerName ?? null,
    account: input.account ?? null,
    costVnd: input.costVnd,
    aspectRatio: input.aspectRatio ?? null,
    resolution: input.resolution ?? null,
    batchId: input.batchId ?? null,
    relatedImageId: input.relatedImageId ?? null,
    relatedVideoId: input.relatedVideoId ?? null,
    status: "processing" as const,
  };
  if (input.relatedImageId) {
    await db.requestLog.upsert({ where: { relatedImageId: input.relatedImageId }, update: {}, create: data });
  } else if (input.relatedVideoId) {
    await db.requestLog.upsert({ where: { relatedVideoId: input.relatedVideoId }, update: {}, create: data });
  } else {
    await db.requestLog.create({ data });
  }
}

/** Đánh dấu request hoàn tất (completed) theo media id. */
export async function logRequestComplete(
  db: Db,
  ref: { relatedImageId?: string | null; relatedVideoId?: string | null },
  updates?: { model?: string; costVnd?: number },
): Promise<void> {
  const where = ref.relatedImageId
    ? { relatedImageId: ref.relatedImageId }
    : ref.relatedVideoId
      ? { relatedVideoId: ref.relatedVideoId }
      : null;
  if (!where) return;
  await db.requestLog.updateMany({
    where,
    data: {
      status: "completed",
      errorMessage: null,
      ...(updates?.model ? { model: updates.model } : {}),
      ...(typeof updates?.costVnd === "number" ? { costVnd: updates.costVnd } : {}),
    },
  });
}

/** Đánh dấu request thất bại (failed) theo media id. */
export async function logRequestFailed(
  db: Db,
  ref: { relatedImageId?: string | null; relatedVideoId?: string | null },
  errorMessage: string,
): Promise<void> {
  const where = ref.relatedImageId
    ? { relatedImageId: ref.relatedImageId }
    : ref.relatedVideoId
      ? { relatedVideoId: ref.relatedVideoId }
      : null;
  if (!where) return;
  await db.requestLog.updateMany({
    where,
    data: { status: "failed", errorMessage: errorMessage.slice(0, 1000) },
  });
}

/** Đánh dấu media nguồn đã bị xóa — giữ nguyên dòng log để truy vết. */
export async function markRequestLogImageDeleted(
  imageIds: string[],
  deletedBy: string,
  mode: RequestDeleteMode,
): Promise<void> {
  const ids = [...new Set(imageIds.filter(Boolean))];
  if (ids.length === 0) return;
  await prisma.requestLog.updateMany({
    where: { relatedImageId: { in: ids } },
    data: { mediaDeletedAt: new Date(), mediaDeletedBy: deletedBy, mediaDeleteMode: mode },
  });
}

/** Đánh dấu video nguồn đã bị xóa vĩnh viễn — giữ nguyên dòng log để truy vết. */
export async function markRequestLogVideoDeleted(videoId: string, deletedBy: string): Promise<void> {
  if (!videoId) return;
  await prisma.requestLog.updateMany({
    where: { relatedVideoId: videoId },
    data: { mediaDeletedAt: new Date(), mediaDeletedBy: deletedBy, mediaDeleteMode: "hard" },
  });
}

export type RequestLogKind = "generate" | "edit" | "video";
export type RequestLogStatus = "processing" | "completed" | "failed" | "deleted";

export interface RequestLogRow {
  id: string;
  kind: RequestLogKind;
  model: string;
  provider_name: string | null;
  account: string | null;
  user_label: string;
  user_id: string;
  status: RequestLogStatus;
  duration_ms: number | null;
  cost_vnd: number;
  aspect_ratio: string | null;
  resolution: string | null;
  error_message: string | null;
  batch_id: string | null;
  created_at: string;
  media_deleted_at: string | null;
  media_deleted_by: string | null;
  media_delete_mode: RequestDeleteMode | null;
}

export interface RequestLogSummary {
  total: number;
  completed: number;
  failed: number;
  processing: number;
  success_rate: number | null;
  avg_duration_ms: number | null;
}

export interface RequestLogResult {
  rows: RequestLogRow[];
  total: number;
  page: number;
  page_size: number;
  models: string[];
  summary: RequestLogSummary;
}

export interface RequestLogQuery {
  kind?: RequestLogKind | null;
  status?: RequestLogStatus | null;
  model?: string | null;
  from?: Date | null;
  to?: Date | null;
  page?: number;
  pageSize?: number;
}

type UserPick = { id: string; displayName: string | null; email: string | null; phone: string | null };

function userLabel(user: UserPick): string {
  return user.displayName || user.email || user.phone || user.id.slice(0, 8);
}

function durationMs(status: string, createdAt: Date, updatedAt: Date): number | null {
  if (status === "processing") return null;
  const ms = updatedAt.getTime() - createdAt.getTime();
  return ms >= 0 ? ms : null;
}

function createdAtRange(from?: Date | null, to?: Date | null) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
}

/**
 * Nhật ký request tạo/sửa ảnh + tạo video, đọc từ bảng RequestLog bất biến.
 * duration_ms là ước lượng (updatedAt − createdAt); luồng chạy đồng bộ nên xấp xỉ thời gian gọi model.
 * Dòng log KHÔNG mất khi media bị xóa; media đã xóa mang cờ media_deleted_*.
 * Bộ lọc status "deleted" nghĩa là "media nguồn đã bị xóa" (không phải trạng thái request).
 */
export async function getRequestLog(query: RequestLogQuery): Promise<RequestLogResult> {
  const page = Math.max(1, Math.floor(query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(query.pageSize || 50)));
  const dateRange = createdAtRange(query.from, query.to);

  const where: Prisma.RequestLogWhereInput = {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.model ? { model: query.model } : {}),
    ...(dateRange ? { createdAt: dateRange } : {}),
    ...(query.status === "deleted"
      ? { NOT: { mediaDeletedAt: null } }
      : query.status
        ? { status: query.status }
        : {}),
  };

  const userSelect = { select: { id: true, displayName: true, email: true, phone: true } };

  const [total, records, summary, modelRows] = await Promise.all([
    prisma.requestLog.count({ where }),
    prisma.requestLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: userSelect },
    }),
    buildSummary(where),
    prisma.requestLog.findMany({ distinct: ["model"], select: { model: true }, take: 100 }),
  ]);

  const rows: RequestLogRow[] = records.map((r) => ({
    id: r.id,
    kind: r.kind as RequestLogKind,
    model: r.model,
    provider_name: r.providerName,
    account: r.account,
    user_label: userLabel(r.user),
    user_id: r.userId,
    status: r.status as RequestLogStatus,
    duration_ms: durationMs(r.status, r.createdAt, r.updatedAt),
    cost_vnd: r.costVnd,
    aspect_ratio: r.aspectRatio,
    resolution: r.resolution,
    error_message: r.errorMessage,
    batch_id: r.batchId,
    created_at: r.createdAt.toISOString(),
    media_deleted_at: r.mediaDeletedAt?.toISOString() || null,
    media_deleted_by: r.mediaDeletedBy,
    media_delete_mode: (r.mediaDeleteMode as RequestDeleteMode | null) || null,
  }));

  const models = [...new Set(modelRows.map((m) => m.model).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return { rows, total, page, page_size: pageSize, models, summary };
}

async function buildSummary(where: Prisma.RequestLogWhereInput): Promise<RequestLogSummary> {
  const [groups, durRows] = await Promise.all([
    prisma.requestLog.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.requestLog.findMany({
      where: { ...where, status: "completed" },
      select: { createdAt: true, updatedAt: true },
      take: 1000,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  let completed = 0, failed = 0, processing = 0, total = 0;
  for (const g of groups) {
    const c = g._count._all;
    total += c;
    if (g.status === "completed") completed += c;
    else if (g.status === "failed") failed += c;
    else if (g.status === "processing") processing += c;
  }

  const finished = completed + failed;
  const success_rate = finished > 0 ? completed / finished : null;

  const durations = durRows
    .map((r) => r.updatedAt.getTime() - r.createdAt.getTime())
    .filter((ms) => ms >= 0);
  const avg_duration_ms = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  return { total, completed, failed, processing, success_rate, avg_duration_ms };
}
