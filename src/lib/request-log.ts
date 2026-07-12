import { prisma } from "./prisma";

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
 * Nhật ký request tạo/sửa ảnh + tạo video, gộp từ bảng Image và Video.
 * duration_ms là ước lượng (updatedAt − createdAt); luồng chạy đồng bộ nên xấp xỉ thời gian gọi model.
 * Bao gồm cả ảnh đã soft-delete (request vẫn từng xảy ra).
 */
export async function getRequestLog(query: RequestLogQuery): Promise<RequestLogResult> {
  const page = Math.max(1, Math.floor(query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(query.pageSize || 50)));
  const dateRange = createdAtRange(query.from, query.to);

  const wantImages = query.kind !== "video";
  const wantVideos = query.kind !== "generate" && query.kind !== "edit";

  // Image "kind" (generate/edit) không phải cột riêng mà suy từ editPrompt/originalImageId,
  // nên lọc theo kind cho ảnh được thực hiện sau khi map, không ở tầng DB.
  const imageWhere = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.model ? { model: query.model } : {}),
    ...(dateRange ? { createdAt: dateRange } : {}),
  };
  const videoWhere = {
    ...(query.status && query.status !== "deleted" ? { status: query.status } : {}),
    ...(query.model ? { model: query.model } : {}),
    ...(dateRange ? { createdAt: dateRange } : {}),
  };

  const userSelect = { select: { id: true, displayName: true, email: true, phone: true } };

  // Để phân trang đúng trên union 2 bảng: lấy tối đa (page*pageSize) dòng mới nhất từ mỗi nguồn,
  // gộp, sort desc theo thời gian rồi cắt trang. Đủ cho quy mô hiện tại.
  const takeCap = page * pageSize;

  const [images, videos] = await Promise.all([
    wantImages
      ? prisma.image.findMany({
          where: imageWhere,
          orderBy: { createdAt: "desc" },
          take: takeCap,
          select: {
            id: true, userId: true, model: true, providerName: true, status: true,
            costVnd: true, aspectRatio: true, resolution: true, errorMessage: true,
            batchId: true, editPrompt: true, originalImageId: true,
            createdAt: true, updatedAt: true, user: userSelect,
          },
        })
      : Promise.resolve([]),
    wantVideos
      ? prisma.video.findMany({
          where: videoWhere,
          orderBy: { createdAt: "desc" },
          take: takeCap,
          select: {
            id: true, userId: true, model: true, status: true, costVnd: true,
            aspectRatio: true, resolution: true, account: true, errorMessage: true,
            createdAt: true, updatedAt: true, user: userSelect,
          },
        })
      : Promise.resolve([]),
  ]);

  const rows: RequestLogRow[] = [];

  for (const img of images) {
    const kind: RequestLogKind = img.editPrompt || img.originalImageId ? "edit" : "generate";
    if (query.kind && query.kind !== kind) continue;
    rows.push({
      id: img.id,
      kind,
      model: img.model,
      provider_name: img.providerName,
      account: null,
      user_label: userLabel(img.user),
      user_id: img.userId,
      status: img.status as RequestLogStatus,
      duration_ms: durationMs(img.status, img.createdAt, img.updatedAt),
      cost_vnd: img.costVnd,
      aspect_ratio: img.aspectRatio,
      resolution: img.resolution,
      error_message: img.errorMessage,
      batch_id: img.batchId,
      created_at: img.createdAt.toISOString(),
    });
  }

  for (const vid of videos) {
    rows.push({
      id: vid.id,
      kind: "video",
      model: vid.model,
      provider_name: null,
      account: vid.account,
      user_label: userLabel(vid.user),
      user_id: vid.userId,
      status: vid.status as RequestLogStatus,
      duration_ms: durationMs(vid.status, vid.createdAt, vid.updatedAt),
      cost_vnd: vid.costVnd,
      aspect_ratio: vid.aspectRatio,
      resolution: vid.resolution,
      error_message: vid.errorMessage,
      batch_id: null,
      created_at: vid.createdAt.toISOString(),
    });
  }

  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const total = await countRequestLog(query, wantImages, wantVideos, imageWhere, videoWhere);
  const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  const models = await distinctModels(wantImages, wantVideos);
  const summary = await buildSummary(query, wantImages, wantVideos, imageWhere, videoWhere);

  return { rows: pageRows, total, page, page_size: pageSize, models, summary };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countRequestLog(query: RequestLogQuery, wantImages: boolean, wantVideos: boolean, imageWhere: any, videoWhere: any): Promise<number> {
  // Khi lọc theo kind generate/edit, count ảnh chính xác cần phân biệt edit — dùng where bổ sung.
  const [imgCount, vidCount] = await Promise.all([
    wantImages ? prisma.image.count({ where: { ...imageWhere, ...imageKindWhere(query.kind) } }) : Promise.resolve(0),
    wantVideos ? prisma.video.count({ where: videoWhere }) : Promise.resolve(0),
  ]);
  return imgCount + vidCount;
}

function imageKindWhere(kind?: RequestLogKind | null) {
  if (kind === "edit") return { OR: [{ NOT: { editPrompt: null } }, { NOT: { originalImageId: null } }] };
  if (kind === "generate") return { editPrompt: null, originalImageId: null };
  return {};
}

async function distinctModels(wantImages: boolean, wantVideos: boolean): Promise<string[]> {
  const [imgModels, vidModels] = await Promise.all([
    wantImages ? prisma.image.findMany({ distinct: ["model"], select: { model: true }, take: 100 }) : Promise.resolve([]),
    wantVideos ? prisma.video.findMany({ distinct: ["model"], select: { model: true }, take: 100 }) : Promise.resolve([]),
  ]);
  const set = new Set<string>();
  for (const r of imgModels) if (r.model) set.add(r.model);
  for (const r of vidModels) if (r.model) set.add(r.model);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildSummary(query: RequestLogQuery, wantImages: boolean, wantVideos: boolean, imageWhere: any, videoWhere: any): Promise<RequestLogSummary> {
  const imgWhere = { ...imageWhere, ...imageKindWhere(query.kind) };
  const [imgGroups, vidGroups, imgDur, vidDur] = await Promise.all([
    wantImages ? prisma.image.groupBy({ by: ["status"], where: imgWhere, _count: { _all: true } }) : Promise.resolve([]),
    wantVideos ? prisma.video.groupBy({ by: ["status"], where: videoWhere, _count: { _all: true } }) : Promise.resolve([]),
    wantImages ? prisma.image.findMany({ where: { ...imgWhere, status: "completed" }, select: { createdAt: true, updatedAt: true }, take: 1000, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    wantVideos ? prisma.video.findMany({ where: { ...videoWhere, status: "completed" }, select: { createdAt: true, updatedAt: true }, take: 1000, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ]);

  let completed = 0, failed = 0, processing = 0, total = 0;
  for (const g of [...imgGroups, ...vidGroups]) {
    const c = g._count._all;
    total += c;
    if (g.status === "completed") completed += c;
    else if (g.status === "failed") failed += c;
    else if (g.status === "processing") processing += c;
  }

  const finished = completed + failed;
  const success_rate = finished > 0 ? completed / finished : null;

  const durations = [...imgDur, ...vidDur]
    .map((r) => r.updatedAt.getTime() - r.createdAt.getTime())
    .filter((ms) => ms >= 0);
  const avg_duration_ms = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  return { total, completed, failed, processing, success_rate, avg_duration_ms };
}
