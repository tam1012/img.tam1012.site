/**
 * Upsert Google Flow image providers (Nano Banana 2 + Pro).
 * Credentials come from env FLOW_BRIDGE_* / FLOW_IMAGE_ROUTE, not from provider.api_key.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const FLOW_PROVIDERS = [
  {
    id: "flow-nano-banana-2",
    name: "Flow · Nano Banana 2",
    model: "flow-nano-banana-2",
  },
  {
    id: "flow-nano-banana-pro",
    name: "Flow · Nano Banana Pro",
    model: "flow-nano-banana-pro",
  },
];

async function main() {
  for (const p of FLOW_PROVIDERS) {
    await prisma.provider.upsert({
      where: { id: p.id },
      update: {
        name: p.name,
        apiType: "flow",
        baseUrl: "",
        apiKey: "",
        model: p.model,
        enabled: true,
        // do not force default
      },
      create: {
        id: p.id,
        name: p.name,
        apiType: "flow",
        baseUrl: "",
        apiKey: "",
        model: p.model,
        isDefault: false,
        enabled: true,
      },
    });
    console.log(`Flow provider ready: ${p.id}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
