import { describe, expect, it } from "vitest";
import {
  buildResolvedRoute,
  clampResolutionForProvider,
  normalizeProviderRewriteConfig,
  pickRewriteRule,
  validateProviderRewriteConfig,
  type ProviderRewriteConfig,
} from "@/lib/provider-rewrite";
import type { ProviderConfig } from "@/lib/db";

const gemini: ProviderConfig = {
  id: "gemini-3-pro",
  name: "Gemini 3 Pro Image",
  api_type: "vertex",
  base_url: "",
  api_key: "",
  model: "gemini-3-pro-image",
  is_default: true,
  created_at: new Date().toISOString(),
  enabled: true,
};

const flowPro: ProviderConfig = {
  id: "flow-nano-banana-pro",
  name: "Flow · Nano Banana Pro",
  api_type: "flow",
  base_url: "",
  api_key: "",
  model: "flow-nano-banana-pro",
  is_default: false,
  created_at: new Date().toISOString(),
  enabled: true,
};

describe("provider rewrite config", () => {
  it("normalizes defaults and fills missing fields", () => {
    const cfg = normalizeProviderRewriteConfig({
      enabled: true,
      rules: [
        {
          fromProviderId: " a ",
          toProviderId: "b",
          enabled: 1,
        },
      ],
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0].fromProviderId).toBe("a");
    expect(cfg.rules[0].toProviderId).toBe("b");
    expect(cfg.rules[0].enabled).toBe(false); // strict true only
    expect(cfg.rules[0].applyTo).toBe("both");
    expect(cfg.rules[0].displayMode).toBe("requested");
    expect(cfg.rules[0].id).toBeTruthy();
  });

  it("rejects same source/target, duplicates, and cycles", () => {
    expect(
      validateProviderRewriteConfig({
        enabled: true,
        rules: [
          {
            id: "1",
            enabled: true,
            fromProviderId: "a",
            toProviderId: "a",
            applyTo: "both",
            displayMode: "requested",
          },
        ],
      })?.error,
    ).toMatch(/trùng/i);

    expect(
      validateProviderRewriteConfig({
        enabled: true,
        rules: [
          {
            id: "1",
            enabled: true,
            fromProviderId: "a",
            toProviderId: "b",
            applyTo: "both",
            displayMode: "requested",
          },
          {
            id: "2",
            enabled: false,
            fromProviderId: "a",
            toProviderId: "c",
            applyTo: "both",
            displayMode: "requested",
          },
        ],
      })?.error,
    ).toMatch(/một rule/i);

    expect(
      validateProviderRewriteConfig({
        enabled: true,
        rules: [
          {
            id: "1",
            enabled: true,
            fromProviderId: "a",
            toProviderId: "b",
            applyTo: "both",
            displayMode: "requested",
          },
          {
            id: "2",
            enabled: true,
            fromProviderId: "b",
            toProviderId: "a",
            applyTo: "both",
            displayMode: "requested",
          },
        ],
      })?.error,
    ).toMatch(/vòng/i);
  });

  it("picks enabled rule for action only when master switch on", () => {
    const config: ProviderRewriteConfig = {
      enabled: true,
      rules: [
        {
          id: "r1",
          enabled: true,
          fromProviderId: gemini.id,
          toProviderId: flowPro.id,
          applyTo: "generate",
          displayMode: "requested",
        },
      ],
    };
    expect(pickRewriteRule(config, gemini.id, "generate")?.id).toBe("r1");
    expect(pickRewriteRule(config, gemini.id, "edit")).toBeNull();
    expect(pickRewriteRule({ ...config, enabled: false }, gemini.id, "generate")).toBeNull();
  });

  it("builds display vs actual metadata", () => {
    const requestedView = buildResolvedRoute(gemini, flowPro, "requested", true, "r1");
    expect(requestedView.display.model).toBe(gemini.model);
    expect(requestedView.actualMeta.model).toBe(flowPro.model);
    expect(requestedView.rewritten).toBe(true);

    const actualView = buildResolvedRoute(gemini, flowPro, "actual", true, "r1");
    expect(actualView.display.model).toBe(flowPro.model);
    expect(actualView.actualMeta.providerName).toBe(flowPro.name);
  });

  it("clamps 4K to 2K for flow and expensive Gemini image models", () => {
    expect(clampResolutionForProvider(flowPro, "4K")).toBe("2K");
    expect(clampResolutionForProvider(flowPro, "2K")).toBe("2K");
    // gemini-3-pro-image / gemini-3.1-flash-image: 4K đắt → clamp 2K
    expect(clampResolutionForProvider(gemini, "4K")).toBe("2K");
    expect(clampResolutionForProvider(gemini, "2K")).toBe("2K");
    const flash: ProviderConfig = {
      ...gemini,
      id: "gemini-3.1-flash",
      name: "Gemini 3.1 Flash Image",
      model: "gemini-3.1-flash-image",
    };
    expect(clampResolutionForProvider(flash, "4K")).toBe("2K");
    // Model Gemini khác (vd 2.5 flash) vẫn cho 4K
    const flash25: ProviderConfig = {
      ...gemini,
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash Image",
      model: "gemini-2.5-flash-image",
    };
    expect(clampResolutionForProvider(flash25, "4K")).toBe("4K");
  });
});
