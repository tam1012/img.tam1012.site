import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logRequestStart, logRequestComplete, logRequestFailed, markRequestLogImageDeleted } from "./request-log";

export interface ProviderConfig {
  id: string;
  name: string;
  api_type: "openai" | "gemini" | "vertex" | "chatgpt_bridge";
  base_url: string;
  api_key: string;
  model: string;
  is_default: boolean;
  created_at: string;
  enabled?: boolean;
}

export interface ImageRecord {
  id: string;
  user_id: string;
  user_label?: string | null;
  prompt: string;
  edit_prompt: string | null;
  provider_id: string;
  provider_name: string;
  model: string;
  size: string | null;
  aspect_ratio: string | null;
  resolution: string | null;
  quality: string | null;
  cost_vnd: number;
  filename: string;
  mime_type: string;
  original_image_id: string | null;
  idempotency_key?: string | null;
  batch_id?: string | null;
  status: string;
  created_by: string;
  created_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
}

type ImageCreateInput = {
  userId: string;
  prompt: string;
  editPrompt?: string | null;
  providerId: string;
  providerName: string;
  model: string;
  aspectRatio?: string | null;
  resolution?: string | null;
  width?: number | null;
  height?: number | null;
  quality?: string | null;
  costVnd: number;
  originalImageId?: string | null;
  idempotencyKey?: string | null;
  batchId?: string | null;
};

function normalizeApiType(value: string): ProviderConfig["api_type"] {
  return value === "gemini" || value === "vertex" || value === "chatgpt_bridge" ? value : "openai";
}

function providerToConfig(provider: {
  id: string;
  name: string;
  apiType: string;
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
  isDefault: boolean;
  enabled: boolean;
  createdAt: Date;
}): ProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    api_type: normalizeApiType(provider.apiType),
    base_url: provider.baseUrl || "",
    api_key: provider.apiKey || "",
    model: provider.model,
    is_default: provider.isDefault,
    enabled: provider.enabled,
    created_at: provider.createdAt.toISOString(),
  };
}

function userLabel(user?: { displayName: string | null; email: string | null; phone: string | null } | null) {
  if (!user) return null;
  return user.displayName || user.email || user.phone || null;
}

function imageToRecord(image: {
  id: string;
  userId: string;
  user?: { displayName: string | null; email: string | null; phone: string | null } | null;
  prompt: string;
  editPrompt: string | null;
  providerId: string | null;
  providerName: string;
  model: string;
  aspectRatio: string | null;
  resolution: string | null;
  width: number | null;
  height: number | null;
  quality: string | null;
  costVnd: number;
  filename: string | null;
  mimeType: string | null;
  originalImageId: string | null;
  idempotencyKey?: string | null;
  batchId?: string | null;
  status: string;
  createdAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
}): ImageRecord {
  const size = image.width && image.height ? `${image.width}x${image.height}` : image.resolution;
  return {
    id: image.id,
    user_id: image.userId,
    user_label: userLabel(image.user),
    prompt: image.prompt,
    edit_prompt: image.editPrompt,
    provider_id: image.providerId || "",
    provider_name: image.providerName,
    model: image.model,
    size,
    aspect_ratio: image.aspectRatio,
    resolution: image.resolution,
    quality: image.quality,
    cost_vnd: image.costVnd,
    filename: image.filename || "",
    mime_type: image.mimeType || "image/webp",
    original_image_id: image.originalImageId,
    idempotency_key: image.idempotencyKey || null,
    batch_id: image.batchId || null,
    status: image.status,
    created_by: image.userId,
    created_at: image.createdAt.toISOString(),
    deleted_at: image.deletedAt?.toISOString() || null,
    deleted_by: image.deletedBy,
  };
}

export async function listProviders(): Promise<ProviderConfig[]> {
  const providers = await prisma.provider.findMany({
    where: { enabled: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return providers.map(providerToConfig);
}

export async function getProviderById(id: string): Promise<ProviderConfig | null> {
  const provider = await prisma.provider.findFirst({ where: { id, enabled: true } });
  return provider ? providerToConfig(provider) : null;
}

export async function getDefaultProvider(): Promise<ProviderConfig | null> {
  const provider =
    (await prisma.provider.findFirst({ where: { enabled: true, isDefault: true } })) ||
    (await prisma.provider.findFirst({ where: { enabled: true }, orderBy: { createdAt: "asc" } }));
  return provider ? providerToConfig(provider) : null;
}

export async function addProvider(provider: ProviderConfig) {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (provider.is_default) {
      await tx.provider.updateMany({ where: { enabled: true }, data: { isDefault: false } });
    }
    await tx.provider.create({
      data: {
        id: provider.id,
        name: provider.name,
        apiType: provider.api_type,
        baseUrl: provider.base_url || null,
        apiKey: provider.api_key || null,
        model: provider.model,
        isDefault: provider.is_default,
        enabled: provider.enabled ?? true,
        createdAt: new Date(provider.created_at),
      },
    });
  });
}

export async function updateProvider(id: string, updates: Partial<ProviderConfig>) {
  const data: Prisma.ProviderUpdateManyMutationInput = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.api_type !== undefined) data.apiType = updates.api_type;
  if (updates.base_url !== undefined) data.baseUrl = updates.base_url || null;
  if (updates.api_key !== undefined) data.apiKey = updates.api_key || null;
  if (updates.model !== undefined) data.model = updates.model;
  if (updates.is_default !== undefined) data.isDefault = updates.is_default;
  if (updates.enabled !== undefined) data.enabled = updates.enabled;

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (updates.is_default) {
      await tx.provider.updateMany({ where: { enabled: true, NOT: { id } }, data: { isDefault: false } });
    }
    const result = await tx.provider.updateMany({ where: { id }, data });
    return result.count > 0;
  });
  return updated;
}

export async function deleteProvider(id: string): Promise<boolean> {
  return updateProvider(id, { enabled: false, is_default: false });
}

async function insertImageRecord(input: ImageCreateInput): Promise<ImageRecord> {
  const image = await prisma.$transaction(async (tx) => {
    const created = await tx.image.create({
      data: {
        userId: input.userId,
        prompt: input.prompt,
        editPrompt: input.editPrompt || null,
        providerId: input.providerId,
        providerName: input.providerName,
        model: input.model,
        aspectRatio: input.aspectRatio || null,
        resolution: input.resolution || null,
        width: input.width || null,
        height: input.height || null,
        quality: input.quality || null,
        costVnd: input.costVnd,
        originalImageId: input.originalImageId || null,
        idempotencyKey: input.idempotencyKey || null,
        batchId: input.batchId || null,
        status: "processing",
      },
      include: { user: true },
    });

    const kind = created.editPrompt || created.originalImageId ? "edit" : "generate";
    await logRequestStart(tx, {
      userId: created.userId,
      kind,
      model: created.model,
      providerName: created.providerName,
      costVnd: created.costVnd,
      aspectRatio: created.aspectRatio,
      resolution: created.resolution,
      batchId: created.batchId,
      relatedImageId: created.id,
    });

    return created;
  });
  return imageToRecord(image);
}

export async function createImageRecord(input: ImageCreateInput): Promise<ImageRecord> {
  return (await createImageRecordOnce(input)).record;
}

export async function createImageRecordOnce(input: ImageCreateInput): Promise<{ record: ImageRecord; created: boolean }> {
  try {
    return { record: await insertImageRecord(input), created: true };
  } catch (error: unknown) {
    if (input.idempotencyKey && typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "P2002") {
      const existing = await getImageByIdempotencyKey(input.idempotencyKey, input.userId);
      if (existing) return { record: existing, created: false };
    }
    throw error;
  }
}

export async function completeImageRecord(id: string, updates: { filename: string; mimeType: string; model?: string }) {
  // Update image + ImageUsage trong 1 transaction; upsert giữ retry idempotent.
  const image = await prisma.$transaction(async (tx) => {
    const image = await tx.image.update({
      where: { id },
      data: {
        filename: updates.filename,
        mimeType: updates.mimeType,
        model: updates.model,
        status: "completed",
        errorMessage: null,
      },
      include: { user: true },
    });

    // Usage bất biến cho stats — hard-delete Image sau này không xóa dòng này.
    const isEdit = Boolean(image.editPrompt || image.originalImageId);
    await tx.imageUsage.upsert({
      where: { imageId: image.id },
      update: {},
      create: {
        userId: image.userId,
        imageId: image.id,
        kind: isEdit ? "edit" : "generate",
        model: image.model,
        providerName: image.providerName,
        costVnd: image.costVnd,
        createdAt: image.createdAt,
      },
    });

    await logRequestComplete(tx, { relatedImageId: image.id }, { model: image.model });

    return image;
  });

  return imageToRecord(image);
}

export async function failImageRecord(id: string, errorMessage: string) {
  await prisma.$transaction(async (tx) => {
    await tx.image.updateMany({
      where: { id },
      data: {
        status: "failed",
        errorMessage: errorMessage.slice(0, 1000),
      },
    });
    await logRequestFailed(tx, { relatedImageId: id }, errorMessage);
  });
}

export async function getImageById(id: string, includeDeleted = false): Promise<ImageRecord | null> {
  const image = await prisma.image.findFirst({
    where: {
      id,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
    include: { user: true },
  });
  return image ? imageToRecord(image) : null;
}

export async function getImageByIdempotencyKey(idempotencyKey: string, userId: string): Promise<ImageRecord | null> {
  const image = await prisma.image.findFirst({
    where: { idempotencyKey, userId, deletedAt: null },
    include: { user: true },
  });
  return image ? imageToRecord(image) : null;
}

export async function listImages(limit = 50, offset = 0, userId?: string): Promise<ImageRecord[]> {
  const images = await prisma.image.findMany({
    where: {
      status: "completed",
      deletedAt: null,
      ...(userId ? { userId } : {}),
    },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: limit,
  });
  return images.map(imageToRecord);
}

export async function countImages(userId?: string): Promise<number> {
  return prisma.image.count({
    where: {
      status: "completed",
      deletedAt: null,
      ...(userId ? { userId } : {}),
    },
  });
}

export async function getUniquePrompts(limit = 30, userId?: string): Promise<{ prompt: string; provider_name: string; model: string; created_at: string }[]> {
  const images = await prisma.image.findMany({
    where: {
      status: "completed",
      deletedAt: null,
      ...(userId ? { userId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(limit * 4, limit),
  });
  const seen = new Set<string>();
  const results: { prompt: string; provider_name: string; model: string; created_at: string }[] = [];
  for (const img of images) {
    if (seen.has(img.prompt)) continue;
    seen.add(img.prompt);
    results.push({
      prompt: img.prompt,
      provider_name: img.providerName,
      model: img.model,
      created_at: img.createdAt.toISOString(),
    });
    if (results.length >= limit) break;
  }
  return results;
}

export async function softDeleteImage(id: string, deletedBy: string, ownerUserId: string, isAdmin: boolean): Promise<boolean> {
  const result = await prisma.image.updateMany({
    where: { id, deletedAt: null, ...(isAdmin ? {} : { userId: ownerUserId }) },
    data: {
      status: "deleted",
      deletedAt: new Date(),
      deletedBy,
    },
  });
  if (result.count > 0) {
    await markRequestLogImageDeleted([id], deletedBy, "soft");
  }
  return result.count > 0;
}

/** Soft-delete nhiều ảnh; user thường chỉ ảnh của mình, admin mọi id. */
export async function softDeleteImages(
  ids: string[],
  deletedBy: string,
  ownerUserId: string,
  isAdmin: boolean,
): Promise<number> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;
  const result = await prisma.image.updateMany({
    where: {
      id: { in: uniqueIds },
      deletedAt: null,
      ...(isAdmin ? {} : { userId: ownerUserId }),
    },
    data: {
      status: "deleted",
      deletedAt: new Date(),
      deletedBy,
    },
  });
  if (result.count > 0) {
    await markRequestLogImageDeleted(uniqueIds, deletedBy, "soft");
  }
  return result.count;
}

/**
 * Xóa vĩnh viễn record ảnh (+ caller xóa file).
 * User thường: chỉ ảnh của mình. Admin: id bất kỳ.
 * Trả về filename để dọn disk.
 */
export async function hardDeleteImages(
  ids: string[],
  ownerUserId: string,
  isAdmin: boolean,
): Promise<{ deleted: number; filenames: string[] }> {
  const uniqueIds = [...new Set(ids.filter(Boolean))].slice(0, 200);
  if (uniqueIds.length === 0) return { deleted: 0, filenames: [] };

  const rows = await prisma.image.findMany({
    where: {
      id: { in: uniqueIds },
      ...(isAdmin ? {} : { userId: ownerUserId }),
    },
    select: { id: true, filename: true },
  });
  if (rows.length === 0) return { deleted: 0, filenames: [] };

  const rowIds = rows.map((r) => r.id);
  // Đánh dấu log trước khi xóa record (không FK cascade nên phải chủ động).
  await markRequestLogImageDeleted(rowIds, ownerUserId, "hard");

  const result = await prisma.image.deleteMany({
    where: { id: { in: rowIds } },
  });
  return {
    deleted: result.count,
    filenames: rows.map((r) => r.filename).filter((f): f is string => Boolean(f)),
  };
}

/** Xóa vĩnh viễn TOÀN BỘ ảnh của 1 user (privacy). Không đụng ảnh người khác. */
export async function hardDeleteAllUserImages(userId: string): Promise<{ deleted: number; filenames: string[] }> {
  const rows = await prisma.image.findMany({
    where: { userId },
    select: { id: true, filename: true },
  });
  if (rows.length === 0) return { deleted: 0, filenames: [] };

  await markRequestLogImageDeleted(rows.map((r) => r.id), userId, "hard");

  const result = await prisma.image.deleteMany({ where: { userId } });
  return {
    deleted: result.count,
    filenames: rows.map((r) => r.filename).filter((f): f is string => Boolean(f)),
  };
}

export async function countUserImagesIncludingDeleted(userId: string): Promise<number> {
  return prisma.image.count({ where: { userId } });
}

export async function getImagesByBatchId(batchId: string): Promise<ImageRecord[]> {
  const images = await prisma.image.findMany({
    where: { batchId, deletedAt: null },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  return images.map(imageToRecord);
}
