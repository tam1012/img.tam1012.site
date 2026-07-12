import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("xAI auth sync deployment", () => {
  it("cài systemd timer và sync trước khi recreate app", () => {
    const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
    expect(workflow).toContain("img-studio-xai-auth-sync.timer");
    expect(workflow).toContain("systemctl enable --now img-studio-xai-auth-sync.timer");
    expect(workflow.indexOf("systemctl start img-studio-xai-auth-sync.service")).toBeLessThan(workflow.indexOf("docker compose up -d"));
  });

  it("timer chạy mỗi phút và service đặt quyền file cho user trong container", () => {
    const service = readFileSync("deploy/systemd/img-studio-xai-auth-sync.service", "utf8");
    const timer = readFileSync("deploy/systemd/img-studio-xai-auth-sync.timer", "utf8");
    expect(service).toContain("User=root");
    expect(service).toContain("XAI_AUTH_TARGET_UID=1001");
    expect(service).toContain("/usr/bin/python3 /home/ubuntu/img-studio/scripts/sync-xai-auth-pool.py");
    expect(timer).toContain("OnUnitActiveSec=1min");
    expect(timer).toContain("Persistent=true");
  });
});
