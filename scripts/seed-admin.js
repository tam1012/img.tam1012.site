const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

function normalizeEmail(value) {
  const email = value && String(value).trim().toLowerCase();
  return email || null;
}

async function main() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 8) {
    throw new Error("Cần ADMIN_EMAIL và ADMIN_PASSWORD tối thiểu 8 ký tự");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "admin", status: "active" },
    create: {
      email,
      passwordHash,
      displayName: "Admin",
      role: "admin",
      status: "active",
      wallet: { create: { balanceVnd: 0 } },
    },
  });
  console.log(`Admin ready: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
