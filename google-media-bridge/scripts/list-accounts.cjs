// Chạy BÊN TRONG container bridge (qua docker exec). In danh sách account dạng
// JSON để công cụ ngoài định dạng thành bảng. Admin key đọc từ env container.

async function main() {
  const adminKey = process.env.FLOW_BRIDGE_ADMIN_KEY;
  if (!adminKey) throw new Error("FLOW_BRIDGE_ADMIN_KEY missing in container env");
  const port = process.env.FLOW_BRIDGE_PORT || "8460";
  const res = await fetch(`http://127.0.0.1:${port}/admin/v1/accounts`, {
    headers: { Authorization: `Bearer ${adminKey}` },
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  process.stdout.write(text.trim() + "\n");
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({ error: error instanceof Error ? error.message : "unknown" }) + "\n",
  );
  process.exitCode = 1;
});
