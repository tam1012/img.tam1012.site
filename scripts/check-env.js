function requireEnv(name, minLength = 1) {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(`${name} phải có tối thiểu ${minLength} ký tự`);
  }
}

function assertFlowPair(routeName, routeValue, baseName, keyName) {
  if (routeValue !== "cpa" && routeValue !== "direct") return;
  const base = process.env[baseName];
  const key = process.env[keyName];
  if (!base || !base.trim()) {
    throw new Error(`${routeName}=${routeValue} yêu cầu ${baseName}`);
  }
  if (!key || key.length < 32) {
    throw new Error(`${routeName}=${routeValue} yêu cầu ${keyName} (>=32)`);
  }
}

requireEnv("SESSION_SECRET", 32);
requireEnv("ADMIN_EMAIL", 3);
requireEnv("ADMIN_PASSWORD", 8);
requireEnv("DATABASE_URL", 10);

const imageRoute = process.env.FLOW_IMAGE_ROUTE || "disabled";
const videoRoute = process.env.FLOW_VIDEO_ROUTE || "disabled";
if (imageRoute === "cpa") {
  assertFlowPair("FLOW_IMAGE_ROUTE", "cpa", "FLOW_CPA_IMAGE_BASE_URL", "FLOW_CPA_IMAGE_API_KEY");
} else if (imageRoute === "direct") {
  assertFlowPair("FLOW_IMAGE_ROUTE", "direct", "FLOW_BRIDGE_BASE_URL", "FLOW_BRIDGE_API_KEY");
}
if (videoRoute === "cpa") {
  assertFlowPair("FLOW_VIDEO_ROUTE", "cpa", "FLOW_CPA_VIDEO_BASE_URL", "FLOW_CPA_VIDEO_API_KEY");
} else if (videoRoute === "direct") {
  assertFlowPair("FLOW_VIDEO_ROUTE", "direct", "FLOW_BRIDGE_BASE_URL", "FLOW_BRIDGE_API_KEY");
}

console.log("Environment OK");
