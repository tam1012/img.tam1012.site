import { PayOS } from "@payos/node";

export interface TopupPackage {
  id: string;
  amountVnd: number;
}

export const TOPUP_PACKAGES: TopupPackage[] = [
  { id: "p10k", amountVnd: 10000 },
  { id: "p20k", amountVnd: 20000 },
  { id: "p50k", amountVnd: 50000 },
  { id: "p100k", amountVnd: 100000 },
  { id: "p200k", amountVnd: 200000 },
  { id: "p500k", amountVnd: 500000 },
];

export const CUSTOM_MIN_VND = 10000;
export const CUSTOM_MAX_VND = 10000000;

export function findPackage(id: string): TopupPackage | undefined {
  return TOPUP_PACKAGES.find((p) => p.id === id);
}

/** Chuẩn hoá số tiền tự nhập: phải là số nguyên đồng trong [CUSTOM_MIN_VND, CUSTOM_MAX_VND]. */
export function normalizeCustomAmount(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;
  const amount = Math.floor(value);
  if (amount < CUSTOM_MIN_VND || amount > CUSTOM_MAX_VND) return null;
  return amount;
}

let client: PayOS | null = null;

export function getPayos(): PayOS {
  const clientId = process.env.PAYOS_CLIENT_ID;
  const apiKey = process.env.PAYOS_API_KEY;
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY;
  if (!clientId || !apiKey || !checksumKey) {
    throw new Error("PAYOS_NOT_CONFIGURED");
  }
  if (!client) {
    client = new PayOS({ clientId, apiKey, checksumKey });
  }
  return client;
}

export function getBaseUrl(): string {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}
