import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/rate-limit";

describe("clientIp", () => {
  it("trả x-real-ip khi có header (đã trim)", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "  203.0.113.10  " },
    });
    expect(clientIp(req)).toBe("203.0.113.10");
  });

  it("ưu tiên x-real-ip, không lấy phần tử đầu x-forwarded-for (chống spoof)", () => {
    const req = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "1.2.3.4, 10.0.0.1",
        "x-real-ip": "203.0.113.99",
      },
    });
    expect(clientIp(req)).toBe("203.0.113.99");
  });

  it("trả unknown khi không có x-real-ip dù có x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    expect(clientIp(req)).toBe("unknown");
  });

  it("trả unknown khi không có header IP nào", () => {
    const req = new Request("http://localhost");
    expect(clientIp(req)).toBe("unknown");
  });
});
