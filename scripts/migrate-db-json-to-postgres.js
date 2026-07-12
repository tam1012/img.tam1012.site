const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

function normalizeEmail(value) {
  const email = value && String(value).trim().toLowerCase();
  return email || null;
}

async function getSeededAdmin() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  if (!email) throw new Error("Cần ADMIN_EMAIL để gán ảnh legacy cho admin");
  const admin = await prisma.user.findUnique({ where: { email } });
  if (!admin || admin.role !== "admin") {
    throw new Error("Admin chưa được seed. Hãy chạy scripts/seed-admin.js trước khi import legacy.");
  }
  return admin;
}

async function ensureLegacyUser() {
  return prisma.user.upsert({
    where: { email: "legacy-guest@local.internal" },
    update: {},
    create: {
      email: "legacy-guest@local.internal",
      passwordHash: await bcrypt.hash("legacy-guest-disabled", 4),
      role: "user",
      status: "blocked",
      displayName: "Legacy Guest",
      wallet: { create: { balanceVnd: 0 } },
    },
  });
}

async function main() {
  const sourcePath = process.argv[2] || path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "db.json");
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Không tìm thấy file db.json tại ${sourcePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(sourcePath, "utf-8"));
  const providers = Array.isArray(raw.providers) ? raw.providers : [];
  const images = Array.isArray(raw.images) ? raw.images : [];
  const providerIds = new Set(providers.map((provider) => provider.id).filter(Boolean));

  const admin = await getSeededAdmin();
  const legacyUser = await ensureLegacyUser();

  for (const provider of providers) {
    await prisma.provider.upsert({
      where: { id: provider.id },
      update: {
        name: provider.name,
        apiType: provider.api_type || "openai",
        baseUrl: provider.base_url || null,
        apiKey: provider.api_key || null,
        model: provider.model,
        isDefault: Boolean(provider.is_default),
        enabled: true,
      },
      create: {
        id: provider.id,
        name: provider.name,
        apiType: provider.api_type || "openai",
        baseUrl: provider.base_url || null,
        apiKey: provider.api_key || null,
        model: provider.model,
        isDefault: Boolean(provider.is_default),
        enabled: true,
        createdAt: provider.created_at ? new Date(provider.created_at) : new Date(),
      },
    });
  }

  for (const image of images) {
    const isDeleted = Boolean(image.deleted_at);
    const userId = image.created_by === "admin" ? admin.id : legacyUser.id;
    const size = String(image.size || "");
    const [width, height] = /^\d+x\d+$/i.test(size) ? size.split("x").map(Number) : [null, null];
    const providerId = providerIds.has(image.provider_id) ? image.provider_id : null;
    const existingImage = await prisma.image.findUnique({ where: { id: image.id } });
    if (existingImage) continue;

    await prisma.image.create({
      data: {
        id: image.id,
        userId,
        prompt: image.prompt,
        editPrompt: image.edit_prompt || null,
        providerId,
        providerName: image.provider_name || "Legacy",
        model: image.model || "unknown",
        quality: image.quality || null,
        resolution: image.size || null,
        width,
        height,
        costVnd: 0,
        filename: image.filename || null,
        mimeType: image.mime_type || "image/webp",
        originalImageId: image.original_image_id || null,
        status: isDeleted ? "deleted" : "completed",
        createdAt: image.created_at ? new Date(image.created_at) : new Date(),
        updatedAt: image.created_at ? new Date(image.created_at) : new Date(),
        deletedAt: image.deleted_at ? new Date(image.deleted_at) : null,
        deletedBy: image.deleted_by || null,
      },
    });
  }

  console.log(`Imported ${providers.length} providers, ${images.length} images.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
