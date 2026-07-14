import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

async function main() {
  const config = loadConfig();
  const bridge = await buildApp(config);
  await bridge.app.listen({ host: config.host, port: config.port });

  const shutdown = async (signal: string) => {
    bridge.app.log.info({ signal }, "shutting down");
    const timer = setTimeout(() => process.exit(1), 30_000);
    try {
      await bridge.close();
      clearTimeout(timer);
      process.exit(0);
    } catch (error) {
      bridge.app.log.error({ err: error }, "shutdown failed");
      clearTimeout(timer);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  process.stderr.write(
    `FLOW_BRIDGE_BOOT_FAILED ${error instanceof Error ? error.message : "unknown"}\n`,
  );
  process.exit(1);
});
