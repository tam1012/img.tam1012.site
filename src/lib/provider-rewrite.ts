import { randomUUID } from "crypto";
import type { ProviderConfig } from "./db";
import { getProviderById } from "./db";
import { maxResolutionForProvider } from "./image-options";
import { prisma } from "./prisma";

export const PROVIDER_REWRITE_KEY = "provider_rewrite";

export type RewriteApplyTo = "generate" | "edit" | "both";
export type RewriteDisplayMode = "requested" | "actual";
export type RewriteAction = "generate" | "edit";

export type ProviderRewriteRule = {
  id: string;
  enabled: boolean;
  fromProviderId: string;
  toProviderId: string;
  applyTo: RewriteApplyTo;
  displayMode: RewriteDisplayMode;
};

export type ProviderRewriteConfig = {
  enabled: boolean;
  rules: ProviderRewriteRule[];
};

export type ResolvedProviderRoute = {
  requested: ProviderConfig;
  actual: ProviderConfig;
  rewritten: boolean;
  displayMode: RewriteDisplayMode;
  /** Ghi vào Image (gallery / user-facing). */
  display: {
    providerId: string;
    providerName: string;
    model: string;
  };
  /** Ghi vào RequestLog + ImageUsage (admin / stats). */
  actualMeta: {
    providerId: string;
    providerName: string;
    model: string;
  };
  ruleId?: string;
};

export const DEFAULT_PROVIDER_REWRITE_CONFIG: ProviderRewriteConfig = {
  enabled: false,
  rules: [],
};

function isApplyTo(value: unknown): value is RewriteApplyTo {
  return value === "generate" || value === "edit" || value === "both";
}

function isDisplayMode(value: unknown): value is RewriteDisplayMode {
  return value === "requested" || value === "actual";
}

function ruleApplies(rule: ProviderRewriteRule, action: RewriteAction): boolean {
  return rule.applyTo === "both" || rule.applyTo === action;
}

/** Chuẩn hoá JSON config từ DB / admin body. */
export function normalizeProviderRewriteConfig(raw: unknown): ProviderRewriteConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PROVIDER_REWRITE_CONFIG, rules: [] };
  const obj = raw as Record<string, unknown>;
  const enabled = obj.enabled === true;
  const rulesIn = Array.isArray(obj.rules) ? obj.rules : [];
  const rules: ProviderRewriteRule[] = [];

  for (const item of rulesIn) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const fromProviderId = typeof r.fromProviderId === "string" ? r.fromProviderId.trim() : "";
    const toProviderId = typeof r.toProviderId === "string" ? r.toProviderId.trim() : "";
    if (!fromProviderId || !toProviderId) continue;
    rules.push({
      id: typeof r.id === "string" && r.id.trim() ? r.id.trim() : randomUUID(),
      enabled: r.enabled === true,
      fromProviderId,
      toProviderId,
      applyTo: isApplyTo(r.applyTo) ? r.applyTo : "both",
      displayMode: isDisplayMode(r.displayMode) ? r.displayMode : "requested",
    });
  }

  return { enabled, rules };
}

export type ProviderRewriteValidationError = {
  error: string;
};

/**
 * Validate cấu hình trước khi lưu.
 * providerIds = tập id provider đang enabled (nếu có) để báo sớm rule trỏ vào chỗ chết.
 */
export function validateProviderRewriteConfig(
  config: ProviderRewriteConfig,
  providerIds?: Set<string>,
): ProviderRewriteValidationError | null {
  if (config.rules.length > 50) {
    return { error: "Tối đa 50 rule rewrite" };
  }

  const fromSeen = new Set<string>();
  for (const rule of config.rules) {
    if (!rule.fromProviderId || !rule.toProviderId) {
      return { error: "Mỗi rule cần provider nguồn và đích" };
    }
    if (rule.fromProviderId === rule.toProviderId) {
      return { error: "Provider nguồn và đích không được trùng nhau" };
    }
    if (fromSeen.has(rule.fromProviderId)) {
      return { error: "Mỗi provider nguồn chỉ được một rule" };
    }
    fromSeen.add(rule.fromProviderId);

    if (providerIds) {
      if (!providerIds.has(rule.fromProviderId)) {
        return { error: `Provider nguồn không tồn tại hoặc đã tắt: ${rule.fromProviderId}` };
      }
      if (!providerIds.has(rule.toProviderId)) {
        return { error: `Provider đích không tồn tại hoặc đã tắt: ${rule.toProviderId}` };
      }
    }
  }

  // Chặn vòng 2 chiều A→B và B→A khi cả hai rule đều bật.
  const enabledPairs = config.rules
    .filter((r) => r.enabled)
    .map((r) => `${r.fromProviderId}=>${r.toProviderId}`);
  for (const rule of config.rules.filter((r) => r.enabled)) {
    const reverse = `${rule.toProviderId}=>${rule.fromProviderId}`;
    if (enabledPairs.includes(reverse)) {
      return { error: "Không cho phép rule vòng (A→B và B→A cùng bật)" };
    }
  }

  return null;
}

export async function getProviderRewriteConfig(): Promise<ProviderRewriteConfig> {
  const row = await prisma.siteSetting.findUnique({ where: { key: PROVIDER_REWRITE_KEY } });
  if (!row?.value?.trim()) return { ...DEFAULT_PROVIDER_REWRITE_CONFIG, rules: [] };
  try {
    return normalizeProviderRewriteConfig(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_PROVIDER_REWRITE_CONFIG, rules: [] };
  }
}

export async function setProviderRewriteConfig(
  input: unknown,
  adminId: string,
  providerIds?: Set<string>,
): Promise<{ ok: true; config: ProviderRewriteConfig } | { ok: false; error: string }> {
  const config = normalizeProviderRewriteConfig(input);
  const err = validateProviderRewriteConfig(config, providerIds);
  if (err) return { ok: false, error: err.error };

  await prisma.siteSetting.upsert({
    where: { key: PROVIDER_REWRITE_KEY },
    create: {
      key: PROVIDER_REWRITE_KEY,
      value: JSON.stringify(config),
      updatedBy: adminId,
    },
    update: {
      value: JSON.stringify(config),
      updatedBy: adminId,
    },
  });
  return { ok: true, config };
}

/** Pure: chọn rule khớp từ config đã load. */
export function pickRewriteRule(
  config: ProviderRewriteConfig,
  fromProviderId: string,
  action: RewriteAction,
): ProviderRewriteRule | null {
  if (!config.enabled) return null;
  for (const rule of config.rules) {
    if (!rule.enabled) continue;
    if (rule.fromProviderId !== fromProviderId) continue;
    if (!ruleApplies(rule, action)) continue;
    return rule;
  }
  return null;
}

export function buildResolvedRoute(
  requested: ProviderConfig,
  actual: ProviderConfig,
  displayMode: RewriteDisplayMode,
  rewritten: boolean,
  ruleId?: string,
): ResolvedProviderRoute {
  const useRequested = displayMode === "requested";
  return {
    requested,
    actual,
    rewritten,
    displayMode,
    display: useRequested
      ? { providerId: requested.id, providerName: requested.name, model: requested.model }
      : { providerId: actual.id, providerName: actual.name, model: actual.model },
    actualMeta: {
      providerId: actual.id,
      providerName: actual.name,
      model: actual.model,
    },
    ruleId,
  };
}

/**
 * Resolve provider sau rewrite (1 hop).
 * Nếu rule trỏ tới provider tắt/mất → fail closed (không rewrite, chạy provider user chọn).
 */
export async function resolveProviderRoute(
  requested: ProviderConfig,
  action: RewriteAction,
  config?: ProviderRewriteConfig,
): Promise<ResolvedProviderRoute> {
  const cfg = config ?? (await getProviderRewriteConfig());
  const rule = pickRewriteRule(cfg, requested.id, action);
  if (!rule) {
    return buildResolvedRoute(requested, requested, "requested", false);
  }

  const target = await getProviderById(rule.toProviderId);
  if (!target) {
    // Fail closed: giữ provider user chọn để không gãy request oan.
    return buildResolvedRoute(requested, requested, "requested", false);
  }

  return buildResolvedRoute(requested, target, rule.displayMode, true, rule.id);
}

/**
 * Nếu provider thật chỉ hỗ trợ tối đa 2K mà user gửi 4K → hạ xuống 2K.
 * (Tránh rewrite Gemini→Flow rồi vẫn ép 4K.)
 */
export function clampResolutionForProvider(
  provider: ProviderConfig,
  resolution: string,
): string {
  const max = maxResolutionForProvider(provider);
  if (resolution === "4K" && max === "2K") return "2K";
  return resolution;
}
