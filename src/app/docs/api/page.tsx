import Link from "next/link";
import AppShell from "@/components/AppShell";

const BASE = "https://imgstudio.site";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
      <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-xs leading-relaxed text-zinc-300 whitespace-pre">
      {children}
    </pre>
  );
}

function Inline({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[11px] text-zinc-300">{children}</code>;
}

export default function ApiDocsPage() {
  return (
    <AppShell>
      <main className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            <Link href="/billing" className="text-zinc-400 hover:text-zinc-200 underline-offset-2 hover:underline">
              ← Nạp tiền / API key
            </Link>
          </p>
          <h1 className="text-lg font-semibold text-zinc-100">Hướng dẫn API v1 — Tạo ảnh</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Dùng cho n8n, Make, script hoặc tool ngoài. Hiện chỉ hỗ trợ <strong className="text-zinc-300">tạo 1 ảnh mỗi request</strong>.
            Chỉnh sửa ảnh và tạo video qua API sẽ làm sau.
          </p>
          <p className="text-sm text-zinc-500">
            Base URL: <Inline>{BASE}</Inline>
          </p>
        </div>

        <Section title="1. Tạo API key">
          <ol className="list-decimal pl-5 space-y-1.5 text-sm text-zinc-400">
            <li>
              Vào{" "}
              <Link href="/billing" className="text-zinc-200 hover:text-white underline-offset-2 hover:underline">
                Nạp tiền
              </Link>{" "}
              → mục <span className="text-zinc-300">API key (n8n / automation)</span>
            </li>
            <li>
              Bấm <span className="text-zinc-300">Tạo API key</span> → <strong className="text-zinc-200">copy ngay</strong> (chỉ hiện 1 lần)
            </li>
            <li>
              Key dạng <Inline>img_...</Inline>. Có thể thu hồi bất cứ lúc nào trên cùng trang
            </li>
          </ol>
          <p className="text-xs text-zinc-500">Tối đa 5 key đang hoạt động / tài khoản. Giữ bí mật như mật khẩu.</p>
        </Section>

        <Section title="2. Xác thực">
          <p className="text-sm text-zinc-400">Mọi request gắn header:</p>
          <Code>{`Authorization: Bearer img_xxxxxxxx`}</Code>
          <p className="text-xs text-zinc-500">
            Automation (n8n) nên dùng API key, không dùng cookie đăng nhập web.
          </p>
        </Section>

        <Section title="3. Endpoint">
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm text-zinc-200 font-medium">Danh sách model / provider</p>
              <Code>{`GET ${BASE}/api/v1/providers
Authorization: Bearer <API_KEY>`}</Code>
              <p className="text-xs text-zinc-500">
                Lấy <Inline>id</Inline> để điền <Inline>provider_id</Inline> khi tạo ảnh.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-zinc-200 font-medium">Tạo ảnh</p>
              <Code>{`POST ${BASE}/api/v1/images/generate
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <chuỗi duy nhất, tối đa 120 ký tự>`}</Code>
              <Code>{`{
  "prompt": "a cat on a windowsill, soft morning light",
  "provider_id": "uuid-provider",
  "aspect_ratio": "1:1",
  "resolution": "1K",
  "quality": "standard"
}`}</Code>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-zinc-400">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="py-2 pr-3 font-medium">Field</th>
                      <th className="py-2 pr-3 font-medium">Bắt buộc</th>
                      <th className="py-2 font-medium">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80">
                    <tr>
                      <td className="py-2 pr-3 text-zinc-300">prompt</td>
                      <td className="py-2 pr-3">Có</td>
                      <td className="py-2">Mô tả ảnh</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 text-zinc-300">provider_id</td>
                      <td className="py-2 pr-3">Có</td>
                      <td className="py-2">Lấy từ /api/v1/providers</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 text-zinc-300">aspect_ratio</td>
                      <td className="py-2 pr-3">Không</td>
                      <td className="py-2">Mặc định 1:1 · 3:2, 4:3, 16:9, 2:3, 3:4, 9:16</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 text-zinc-300">resolution</td>
                      <td className="py-2 pr-3">Không</td>
                      <td className="py-2">Mặc định 1K · 1.5K, 2K, 4K (tuỳ model)</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 text-zinc-300">quality</td>
                      <td className="py-2 pr-3">Không</td>
                      <td className="py-2">standard hoặc high</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 text-zinc-300">count</td>
                      <td className="py-2 pr-3">Không</td>
                      <td className="py-2">Chỉ cho phép 1</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-zinc-500">
                <Inline>Idempotency-Key</Inline> bắt buộc. Retry cùng key sẽ không trừ tiền hai lần.
              </p>
              <p className="text-xs text-zinc-500">Ví dụ response thành công:</p>
              <Code>{`{
  "id": "uuid-image",
  "status": "completed",
  "cost_vnd": 100,
  "balance_vnd": 9900,
  "url": "/api/v1/images/uuid-image/file",
  "provider_name": "...",
  "model": "..."
}`}</Code>
              <p className="text-xs text-zinc-500">
                URL file là đường dẫn tương đối. Full URL = Base URL + <Inline>url</Inline>.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-zinc-200 font-medium">Metadata &amp; file ảnh</p>
              <Code>{`GET ${BASE}/api/v1/images/{id}
GET ${BASE}/api/v1/images/{id}/file
GET ${BASE}/api/v1/images/{id}/file?format=jpg`}</Code>
              <p className="text-xs text-zinc-500">Cùng header Authorization. Mặc định WebP; thêm ?format=jpg nếu cần JPEG.</p>
            </div>
          </div>
        </Section>

        <Section title="4. Ví dụ curl">
          <Code>{`# Providers
curl -s ${BASE}/api/v1/providers \\
  -H "Authorization: Bearer img_YOUR_KEY"

# Tạo ảnh
curl -s ${BASE}/api/v1/images/generate \\
  -H "Authorization: Bearer img_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: run-001" \\
  -d '{
    "prompt": "minimal product photo of a ceramic cup",
    "provider_id": "PASTE_PROVIDER_ID",
    "aspect_ratio": "1:1",
    "resolution": "1K"
  }'

# Tải file
curl -L "${BASE}/api/v1/images/IMAGE_ID/file" \\
  -H "Authorization: Bearer img_YOUR_KEY" \\
  -o out.webp`}</Code>
        </Section>

        <Section title="5. n8n (gợi ý nhanh)">
          <ol className="list-decimal pl-5 space-y-1.5 text-sm text-zinc-400">
            <li>Node HTTP Request · Method POST</li>
            <li>
              URL: <Inline>{BASE}/api/v1/images/generate</Inline>
            </li>
            <li>
              Header <Inline>Authorization</Inline> = <Inline>Bearer img_...</Inline>
            </li>
            <li>
              Header <Inline>Idempotency-Key</Inline> = id lần chạy (vd <Inline>{"{{$execution.id}}"}</Inline>)
            </li>
            <li>Body JSON: prompt, provider_id, …</li>
            <li>
              <strong className="text-zinc-300">Timeout 120–300 giây</strong> (tạo ảnh chạy xong mới trả kết quả)
            </li>
            <li>
              Node sau: GET <Inline>{BASE}{"{{ $json.url }}"}</Inline> với cùng Bearer để lấy file
            </li>
          </ol>
        </Section>

        <Section title="6. Mã lỗi thường gặp">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-400">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="py-2 pr-3 font-medium">HTTP</th>
                  <th className="py-2 font-medium">Ý nghĩa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                <tr>
                  <td className="py-2 pr-3 text-zinc-300">400</td>
                  <td className="py-2">Thiếu field / option sai / count ≠ 1</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-zinc-300">401</td>
                  <td className="py-2">Key sai, đã thu hồi, hoặc thiếu Authorization</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-zinc-300">402</td>
                  <td className="py-2">Hết tiền ví — nạp tại trang Nạp tiền</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-zinc-300">403</td>
                  <td className="py-2">Không có quyền (ảnh người khác, provider admin-only…)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-zinc-300">404</td>
                  <td className="py-2">Provider / ảnh không tồn tại</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-zinc-300">409</td>
                  <td className="py-2">Idempotency-Key trùng request đã fail — dùng key mới</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-zinc-300">429</td>
                  <td className="py-2">Gọi quá nhanh (~20 request tạo ảnh / phút)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-zinc-300">500</td>
                  <td className="py-2">Lỗi server/provider (thường đã hoàn tiền nếu đã trừ)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="7. Giá &amp; giới hạn">
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-zinc-400">
            <li>Giá mỗi ảnh thành công = giá trên web (mặc định 100đ)</li>
            <li>Tài khoản admin không bị trừ tiền</li>
            <li>Provider lỗi sau khi trừ → hệ thống cố hoàn tiền</li>
            <li>Chưa hỗ trợ: edit, video, batch nhiều ảnh, webhook báo xong</li>
          </ul>
        </Section>

        <p className="text-xs text-zinc-600 leading-relaxed pb-4">
          Key lộ → thu hồi ngay trên trang Nạp tiền và tạo key mới. Không đưa key lên URL, chat công khai hay repo.
        </p>
      </main>
    </AppShell>
  );
}
