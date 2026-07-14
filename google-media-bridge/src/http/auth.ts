import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || typeof header !== "string") return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export function requireApiKey(request: FastifyRequest, apiKey: string): void {
  const token = extractBearer(request);
  if (!token || !safeEqual(token, apiKey)) {
    const err = new Error("FLOW_UNAUTHORIZED");
    (err as Error & { statusCode: number }).statusCode = 401;
    throw err;
  }
}

export function requireAdminKey(request: FastifyRequest, adminKey: string): void {
  const token = extractBearer(request);
  if (!token || !safeEqual(token, adminKey)) {
    const err = new Error("FLOW_UNAUTHORIZED");
    (err as Error & { statusCode: number }).statusCode = 401;
    throw err;
  }
}
