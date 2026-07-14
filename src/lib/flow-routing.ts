export type FlowRoute =
  | { route: "disabled" }
  | { route: "cpa" | "direct"; baseUrl: string; apiKey: string; model: string };

function endpoint(
  route: string | undefined,
  baseUrl: string | undefined,
  apiKey: string | undefined,
  model: string,
): FlowRoute {
  if (route !== "cpa" && route !== "direct") return { route: "disabled" };
  const normalized = baseUrl?.trim().replace(/\/$/, "");
  if (!normalized || !apiKey || apiKey.length < 32) return { route: "disabled" };
  return { route, baseUrl: normalized, apiKey, model };
}

export function resolveFlowImageRoute(env: Record<string, string | undefined>): FlowRoute {
  const route = env.FLOW_IMAGE_ROUTE;
  return route === "cpa"
    ? endpoint(route, env.FLOW_CPA_IMAGE_BASE_URL, env.FLOW_CPA_IMAGE_API_KEY, "flow-nano-banana-2")
    : endpoint(route, env.FLOW_BRIDGE_BASE_URL, env.FLOW_BRIDGE_API_KEY, "flow-nano-banana-2");
}

export function resolveFlowVideoRoute(env: Record<string, string | undefined>): FlowRoute {
  const route = env.FLOW_VIDEO_ROUTE;
  return route === "cpa"
    ? endpoint(route, env.FLOW_CPA_VIDEO_BASE_URL, env.FLOW_CPA_VIDEO_API_KEY, "grok-imagine-video")
    : endpoint(route, env.FLOW_BRIDGE_BASE_URL, env.FLOW_BRIDGE_API_KEY, "flow-video-fast-4s");
}

export function flowModelsPublic(env: Record<string, string | undefined>): boolean {
  return env.FLOW_MODELS_PUBLIC === "true";
}

export function assertFlowEnv(env: Record<string, string | undefined>): string[] {
  const errors: string[] = [];
  const image = env.FLOW_IMAGE_ROUTE;
  const video = env.FLOW_VIDEO_ROUTE;
  if (image === "cpa" || image === "direct") {
    const resolved = resolveFlowImageRoute(env);
    if (resolved.route === "disabled") {
      errors.push(
        image === "cpa"
          ? "FLOW_CPA_IMAGE_BASE_URL/FLOW_CPA_IMAGE_API_KEY"
          : "FLOW_BRIDGE_BASE_URL/FLOW_BRIDGE_API_KEY",
      );
    }
  }
  if (video === "cpa" || video === "direct") {
    const resolved = resolveFlowVideoRoute(env);
    if (resolved.route === "disabled") {
      errors.push(
        video === "cpa"
          ? "FLOW_CPA_VIDEO_BASE_URL/FLOW_CPA_VIDEO_API_KEY"
          : "FLOW_BRIDGE_BASE_URL/FLOW_BRIDGE_API_KEY",
      );
    }
  }
  return errors;
}
