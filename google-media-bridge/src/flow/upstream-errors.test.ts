import { describe, expect, it } from "vitest";
import {
  extractUpstreamDetail,
  formatUpstreamRejected,
  isTransientUpstreamError,
  publicFlowError,
} from "./upstream-errors.js";

describe("upstream-errors", () => {
  it("formats timeout and 5xx with detail", () => {
    expect(formatUpstreamRejected(0, "FETCH_TIMEOUT")).toBe(
      "FLOW_UPSTREAM_REJECTED status=timeout FETCH_TIMEOUT",
    );
    expect(
      formatUpstreamRejected(502, JSON.stringify({ error: { message: "HIGH_TRAFFIC" } })),
    ).toBe("FLOW_UPSTREAM_REJECTED status=502 HIGH_TRAFFIC");
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

  it("public message suggests retry for transient", () => {
    const pub = publicFlowError("FLOW_UPSTREAM_REJECTED status=502 HIGH_TRAFFIC");
    expect(pub.code).toBe("FLOW_UPSTREAM_REJECTED");
    expect(pub.message).toMatch(/nghẽn|30 giây/i);
    expect(publicFlowError("FLOW_REAUTH_REQUIRED").message).toBe("FLOW_REAUTH_REQUIRED");
  });
});
