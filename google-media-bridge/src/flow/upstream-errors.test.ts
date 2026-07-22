import { describe, expect, it } from "vitest";
import {
  EDIT_MAX_ACCOUNT_ATTEMPTS,
  GENERATE_MAX_ACCOUNT_ATTEMPTS,
  extractUpstreamDetail,
  formatUpstreamRejected,
  isBrowserTransientError,
  isRetryableAccountError,
  isTransientUpstreamError,
  publicFlowError,
} from "./upstream-errors.js";

describe("upstream-errors", () => {
  it("formats timeout and 5xx with detail and optional stage", () => {
    expect(formatUpstreamRejected(0, "FETCH_TIMEOUT")).toBe(
      "FLOW_UPSTREAM_REJECTED status=timeout FETCH_TIMEOUT",
    );
    expect(
      formatUpstreamRejected(502, JSON.stringify({ error: { message: "HIGH_TRAFFIC" } })),
    ).toBe("FLOW_UPSTREAM_REJECTED status=502 HIGH_TRAFFIC");
    expect(formatUpstreamRejected(502, "HIGH_TRAFFIC", "upload")).toBe(
      "FLOW_UPSTREAM_REJECTED status=502 stage=upload HIGH_TRAFFIC",
    );
  });

  it("extracts detail from JSON or plain text", () => {
    expect(extractUpstreamDetail(JSON.stringify({ error: { message: "busy" } }))).toBe("busy");
    expect(extractUpstreamDetail("plain oops")).toBe("plain oops");
  });

  it("treats 5xx/timeout/high_traffic as transient, not 4xx auth", () => {
    expect(isTransientUpstreamError("FLOW_UPSTREAM_REJECTED status=502")).toBe(true);
    expect(isTransientUpstreamError("FLOW_UPSTREAM_REJECTED status=timeout FETCH_TIMEOUT")).toBe(
      true,
    );
    expect(isTransientUpstreamError("FLOW_UPSTREAM_REJECTED status=500 HIGH_TRAFFIC")).toBe(true);
    expect(isTransientUpstreamError("FLOW_UPSTREAM_REJECTED")).toBe(true);
    expect(isTransientUpstreamError("FLOW_UPSTREAM_REJECTED status=400 bad")).toBe(false);
    expect(isTransientUpstreamError("FLOW_UPSTREAM_REJECTED status=401")).toBe(false);
    expect(isTransientUpstreamError("FLOW_UPSTREAM_REJECTED status=403")).toBe(false);
    expect(isTransientUpstreamError("FLOW_REAUTH_REQUIRED")).toBe(false);
  });

  it("classifies browser blips and retryable account errors", () => {
    expect(isBrowserTransientError("page.evaluate: Target closed")).toBe(true);
    expect(isBrowserTransientError("FLOW_UPSTREAM_REJECTED status=502")).toBe(false);
    expect(isRetryableAccountError("FLOW_REAUTH_REQUIRED")).toBe(true);
    expect(isRetryableAccountError("FLOW_QUOTA_EXCEEDED")).toBe(true);
    expect(isRetryableAccountError("FLOW_RECAPTCHA_FAILED")).toBe(true);
    expect(isRetryableAccountError("FLOW_UPSTREAM_REJECTED status=502")).toBe(true);
    expect(isRetryableAccountError("page.evaluate: Execution context was destroyed")).toBe(true);
    expect(isRetryableAccountError("FLOW_INVALID_REQUEST")).toBe(false);
    expect(isRetryableAccountError("FLOW_UPSTREAM_REJECTED status=400 bad")).toBe(false);
  });

  it("keeps stronger retry budget for edit vs generate", () => {
    expect(EDIT_MAX_ACCOUNT_ATTEMPTS).toBeGreaterThanOrEqual(3);
    expect(GENERATE_MAX_ACCOUNT_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(EDIT_MAX_ACCOUNT_ATTEMPTS).toBeGreaterThan(GENERATE_MAX_ACCOUNT_ATTEMPTS);
  });

  it("public message suggests retry for transient", () => {
    const pub = publicFlowError("FLOW_UPSTREAM_REJECTED status=502 HIGH_TRAFFIC");
    expect(pub.code).toBe("FLOW_UPSTREAM_REJECTED");
    expect(pub.message).toMatch(/nghẽn|30 giây/i);
    expect(publicFlowError("FLOW_REAUTH_REQUIRED").message).toBe("FLOW_REAUTH_REQUIRED");
    expect(publicFlowError("page.evaluate: Target closed").message).toMatch(/nghẽn|30 giây/i);
  });
});
