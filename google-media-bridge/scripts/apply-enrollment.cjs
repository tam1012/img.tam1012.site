// Chạy BÊN TRONG container bridge (qua docker exec). Đọc bundle enrollment đã
// mã hoá, gọi admin API trên 127.0.0.1:8460 để thêm mới hoặc đăng nhập lại
// account (bridge tự nhận biết theo email), rồi verify.
//
// Admin key đọc từ FLOW_BRIDGE_ADMIN_KEY trong env container — KHÔNG nhận qua
// tham số để key không lộ ra dòng lệnh/log trên host.
//
// Dùng: node apply-enrollment.cjs <đường-dẫn-bundle.json>

const { readFileSync } = require("node:fs");

async function main() {
  const bundlePath = process.argv[2];
  if (!bundlePath) throw new Error("usage: apply-enrollment.cjs <bundle.json>");

  const adminKey = process.env.FLOW_BRIDGE_ADMIN_KEY;
  if (!adminKey) throw new Error("FLOW_BRIDGE_ADMIN_KEY missing in container env");

  const port = process.env.FLOW_BRIDGE_PORT || "8460";
  const base = `http://127.0.0.1:${port}`;
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

  const post = async (path, body, timeoutMs = 30_000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json = {};
      try {
        json = JSON.parse(text);
      } catch {
        /* keep raw */
      }
      return { status: res.status, json, text };
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`timeout after ${timeoutMs}ms calling ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  // Bridge tự dedup theo email: 201 = account mới, 200 = đăng nhập lại account cũ.
  const enroll = await post("/admin/v1/enrollments", { bundle }, 30_000);
  if (enroll.status !== 201 && enroll.status !== 200) {
    throw new Error(`enroll failed HTTP ${enroll.status}: ${enroll.text.slice(0, 200)}`);
  }
  const account = enroll.json;
  const reauth = enroll.status === 200 || account.reauth === true;

  // Xác nhận account healthy (đồng thời tự khám phá projectId/siteKey nếu thiếu).
  // Timeout 90s — nếu proxy/mạng treo, script phải báo lỗi chứ không đứng im.
  let verifyStatus = "unknown";
  if (account.id) {
    try {
      const verify = await post(`/admin/v1/accounts/${account.id}/verify`, {}, 90_000);
      verifyStatus =
        verify.status === 200
          ? verify.json.status || "healthy"
          : `verify_http_${verify.status}${verify.json?.error ? ":" + verify.json.error : ""}`;
    } catch (error) {
      verifyStatus = error instanceof Error ? `verify_error:${error.message}` : "verify_error";
    }
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      action: reauth ? "reauth" : "new",
      id: account.id || null,
      alias: account.alias || null,
      email: account.email || null,
      status: verifyStatus,
    }) + "\n",
  );
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "unknown" }) + "\n",
  );
  process.exitCode = 1;
});
