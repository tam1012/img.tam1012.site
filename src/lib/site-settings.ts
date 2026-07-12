import { prisma } from "./prisma";

export const SITE_NOTICE_KEY = "site_notice";
export const SITE_NOTICE_MAX = 500;

export const ADMIN_CONTACT = {
  telegramHandle: "ThongThaiTuaThanTien",
  telegramUrl: "https://t.me/ThongThaiTuaThanTien",
  label: "Liên hệ admin: Telegram @ThongThaiTuaThanTien",
} as const;

export function normalizeSiteNotice(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, SITE_NOTICE_MAX);
}

export async function getSiteNotice(): Promise<{ notice: string; updated_at: string | null }> {
  const row = await prisma.siteSetting.findUnique({ where: { key: SITE_NOTICE_KEY } });
  return {
    notice: row?.value?.trim() || "",
    updated_at: row?.updatedAt?.toISOString() ?? null,
  };
}

export async function setSiteNotice(notice: string, adminId: string) {
  const value = normalizeSiteNotice(notice);
  const row = await prisma.siteSetting.upsert({
    where: { key: SITE_NOTICE_KEY },
    create: { key: SITE_NOTICE_KEY, value, updatedBy: adminId },
    update: { value, updatedBy: adminId },
  });
  return {
    notice: row.value,
    updated_at: row.updatedAt.toISOString(),
  };
}
