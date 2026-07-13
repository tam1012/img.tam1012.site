import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";

const KEY_PREFIX = "img_";
const KEY_RANDOM_BYTES = 24; // 48 hex chars → total ~52 chars with prefix
const DISPLAY_PREFIX_LEN = 12; // "img_" + 8 hex
const MAX_ACTIVE_KEYS = 5;
const MAX_NAME_LEN = 40;

export type PublicApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function hashApiKey(plainKey: string): string {
  return createHash("sha256").update(plainKey).digest("hex");
}

export function generatePlainApiKey(): { plainKey: string; keyPrefix: string; keyHash: string } {
  const random = randomBytes(KEY_RANDOM_BYTES).toString("hex");
  const plainKey = `${KEY_PREFIX}${random}`;
  return {
    plainKey,
    keyPrefix: plainKey.slice(0, DISPLAY_PREFIX_LEN),
    keyHash: hashApiKey(plainKey),
  };
}

function toPublic(row: {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): PublicApiKey {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.keyPrefix,
    created_at: row.createdAt.toISOString(),
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    revoked_at: row.revokedAt?.toISOString() ?? null,
  };
}

export async function listApiKeysForUser(userId: string): Promise<PublicApiKey[]> {
  const rows = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toPublic);
}

export async function createApiKeyForUser(
  userId: string,
  name?: string,
): Promise<{ key: PublicApiKey; plainKey: string }> {
  const activeCount = await prisma.apiKey.count({
    where: { userId, revokedAt: null },
  });
  if (activeCount >= MAX_ACTIVE_KEYS) {
    throw new Error(`Mỗi tài khoản tối đa ${MAX_ACTIVE_KEYS} API key đang hoạt động. Hãy thu hồi key cũ trước.`);
  }

  const trimmed = (name?.trim() || "Default").slice(0, MAX_NAME_LEN);
  const { plainKey, keyPrefix, keyHash } = generatePlainApiKey();
  const row = await prisma.apiKey.create({
    data: {
      userId,
      name: trimmed,
      keyPrefix,
      keyHash,
    },
  });
  return { key: toPublic(row), plainKey };
}

export async function revokeApiKeyForUser(userId: string, keyId: string): Promise<PublicApiKey | null> {
  const existing = await prisma.apiKey.findFirst({
    where: { id: keyId, userId },
  });
  if (!existing) return null;
  if (existing.revokedAt) return toPublic(existing);

  const row = await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });
  return toPublic(row);
}

/** Tra key hợp lệ (chưa revoke). Cập nhật lastUsedAt fire-and-forget. */
export async function findUserIdByApiKey(plainKey: string): Promise<string | null> {
  const trimmed = plainKey.trim();
  if (!trimmed.startsWith(KEY_PREFIX) || trimmed.length < 20) return null;

  const keyHash = hashApiKey(trimmed);
  const row = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!row || row.revokedAt) return null;

  // Không chặn request nếu update lastUsedAt lỗi.
  void prisma.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return row.userId;
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || null;
}
