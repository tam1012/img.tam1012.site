import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_CONTACT } from "@/lib/site-settings";

export const metadata: Metadata = {
  title: "Điều khoản dịch vụ — IMG Studio",
  description:
    "Điều khoản dịch vụ IMG Studio: nền tảng trung gian tạo ảnh/video AI, trách nhiệm người dùng, ví Credit và hoàn khi lỗi kỹ thuật.",
  alternates: { canonical: "/terms" },
};

const UPDATED_AT = "19/07/2026";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3 border-t border-zinc-800 pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-zinc-400">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
        <div className="mx-auto flex min-h-14 max-w-3xl items-center justify-between gap-4 px-4 py-2">
          <Link href="/" className="text-lg font-semibold tracking-tight text-zinc-100 hover:text-white">
            IMG Studio
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/login" className="text-zinc-400 transition-colors hover:text-zinc-200">
              Đăng nhập
            </Link>
            <Link
              href="/login?tab=register"
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            >
              Đăng ký
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-10">
        <div className="mb-8 space-y-2">
          <p className="text-xs text-zinc-500">
            <Link href="/" className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline">
              ← Trang chủ
            </Link>
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
            Điều khoản dịch vụ
          </h1>
          <p className="text-sm text-zinc-500">
            Hệ thống:{" "}
            <a
              href="https://imgstudio.site"
              className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
            >
              https://imgstudio.site
            </a>
          </p>
          <p className="text-xs text-zinc-600">Cập nhật lần cuối: {UPDATED_AT}</p>
        </div>

        <div className="space-y-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
          <Section id="chap-nhan" title="1. Chấp nhận Điều khoản">
            <P>
              Bằng việc truy cập, đăng ký tài khoản, nạp tiền hoặc sử dụng bất kỳ dịch vụ nào (bao gồm giao
              diện Website và hệ thống API) của IMG Studio, bạn xác nhận đã đọc, hiểu và đồng ý bị ràng
              buộc bởi toàn bộ nội dung của Điều khoản dịch vụ này. Nếu bạn không đồng ý với bất kỳ điều
              khoản nào, vui lòng ngừng sử dụng dịch vụ ngay lập tức.
            </P>
          </Section>

          <Section id="ban-chat" title="2. Bản chất Dịch vụ (Nền tảng trung gian)">
            <P>
              IMG Studio là nền tảng công nghệ trung gian (Aggregator). Chúng tôi cung cấp hạ tầng kỹ thuật
              để kết nối người dùng với mô hình trí tuệ nhân tạo tạo sinh (Generative AI) của các nhà cung
              cấp bên thứ ba (&quot;Provider&quot;).
            </P>
            <Ul
              items={[
                <>IMG Studio không tự phát triển, không sở hữu và không vận hành các mô hình AI này.</>,
                <>
                  Dịch vụ của chúng tôi chỉ bao gồm: cung cấp giao diện/API kết nối, truyền tải tác vụ
                  (job), quản lý Ví Credit và hiển thị thư viện ảnh/video cá nhân (Gallery).
                </>,
                <>
                  IMG Studio <strong className="font-medium text-zinc-300">không</strong> áp dụng bộ lọc
                  nội dung sáng tạo riêng ngoài kỹ thuật hệ thống và chính sách của từng Provider.
                </>,
              ]}
            />
          </Section>

          <Section id="provider" title="3. Điều khoản bắc cầu với Provider">
            <P>
              Các mô hình AI trên hệ thống được cung cấp bởi các nhà cung cấp AI bên thứ ba được tích hợp
              tại từng thời điểm (danh sách model hiển thị trên giao diện).
            </P>
            <Ul
              items={[
                <>
                  Mỗi Provider có chính sách bảo mật, bộ lọc nội dung (content filter), giới hạn kỹ thuật
                  và điều kiện sử dụng riêng.
                </>,
                <>
                  Bạn có trách nhiệm tìm hiểu và tuân thủ Điều khoản / chính sách của từng Provider tương
                  ứng với model mà bạn lựa chọn để tạo ảnh/video.
                </>,
                <>
                  Việc một request bị Provider từ chối do bộ lọc của họ{" "}
                  <strong className="font-medium text-zinc-300">không</strong> đồng nghĩa IMG Studio cấm
                  đoán nội dung của bạn.
                </>,
                <>
                  Nếu hành vi của bạn (đặc biệt khi lặp lại hoặc quy mô lớn) dẫn đến khóa, giới hạn API
                  phía Provider, hoặc gây thiệt hại vận hành hạ tầng IMG Studio, chúng tôi có thể tạm
                  khóa hoặc chấm dứt tài khoản theo Mục 9.
                </>,
              ]}
            />
          </Section>

          <Section id="as-is" title="4. Đặc thù đầu ra AI và Từ chối bảo đảm">
            <P>
              Dịch vụ được cung cấp trên cơ sở nguyên trạng <strong className="font-medium text-zinc-300">&quot;AS IS&quot;</strong> và{" "}
              <strong className="font-medium text-zinc-300">&quot;AS AVAILABLE&quot;</strong>. Bạn thừa nhận và chấp nhận:
            </P>
            <Ul
              items={[
                <>
                  <strong className="font-medium text-zinc-300">Tính xác suất:</strong> Output mang tính
                  ngẫu nhiên. Chúng tôi không bảo đảm Output luôn đúng 100% theo prompt, không bảo đảm
                  tính thẩm mỹ, và không bảo đảm không trùng lặp ý tưởng với người dùng khác.
                </>,
                <>
                  <strong className="font-medium text-zinc-300">Bộ lọc / từ chối:</strong> Request bị chậm,
                  lỗi hoặc bị Provider từ chối là kết quả phía Provider hoặc hạ tầng kỹ thuật — không
                  đồng nghĩa nền tảng kiểm duyệt nội dung theo bộ quy tắc riêng.
                </>,
                <>
                  <strong className="font-medium text-zinc-300">Không đảm bảo tạo được mọi nội dung:</strong>{" "}
                  Cùng một ý tưởng, model này có thể gen được, model khác không. Đó là đặc thù dịch vụ
                  multi-provider.
                </>,
              ]}
            />
          </Section>

          <Section id="trach-nhiem" title="5. Trách nhiệm của Người dùng về Nội dung">
            <P>
              Bạn chịu <strong className="font-medium text-zinc-300">hoàn toàn trách nhiệm</strong> trước
              pháp luật, cơ quan quản lý nhà nước và bên thứ ba đối với toàn bộ dữ liệu do bạn đưa lên
              hoặc tạo ra từ hệ thống (Prompt, hình ảnh/video tải lên, và Output nhận về).
            </P>
            <P>
              IMG Studio không kiểm duyệt nội dung theo bộ quy tắc sáng tạo riêng. Tuy nhiên, bạn cam kết
              không sử dụng dịch vụ vào các mục đích trái pháp luật Việt Nam và pháp luật nơi bạn cư trú;
              không xâm phạm quyền sở hữu trí tuệ, nhãn hiệu hoặc quyền riêng tư của cá nhân/tổ chức khác
              (bao gồm dùng Output để bôi nhọ, lừa đảo hoặc gây hại bất hợp pháp).
            </P>
            <P>
              Mọi tranh chấp, khiếu nại hoặc thiệt hại phát sinh từ nội dung của bạn do bạn tự xử lý và
              bồi thường. IMG Studio miễn trừ trách nhiệm và không đại diện pháp lý cho bạn, trong phạm vi
              pháp luật cho phép.
            </P>
          </Section>

          <Section id="output" title="6. Quyền đối với Dữ liệu đầu ra (Output)">
            <Ul
              items={[
                <>
                  Giữa bạn và IMG Studio, bạn toàn quyền quyết định việc sử dụng, lưu trữ, chia sẻ hoặc
                  thương mại hóa các Output do chính tài khoản của bạn tạo ra, trong phạm vi cho phép của
                  pháp luật và điều khoản của Provider cung cấp model đó.
                </>,
                <>
                  Bạn cấp cho IMG Studio quyền kỹ thuật tối thiểu, không độc quyền, để xử lý job, truyền
                  tải dữ liệu, hiển thị trên Gallery cá nhân, sao lưu kỹ thuật và chống gian lận.
                </>,
                <>
                  IMG Studio không bảo đảm Output được bảo hộ quyền tác giả hoặc quyền sở hữu trí tuệ tại
                  bất kỳ quốc gia nào. Bạn tự rà soát rủi ro pháp lý trước khi thương mại hóa.
                </>,
              ]}
            />
          </Section>

          <Section id="xoa-vps" title="7. Xóa dữ liệu & rủi ro hạ tầng">
            <P>
              <strong className="font-medium text-zinc-300">Xóa theo yêu cầu user:</strong> Khi bạn chủ
              động xóa một ảnh/video hoặc yêu cầu xóa tài khoản theo quy trình hệ thống, dữ liệu liên
              quan sẽ không còn khả dụng để bạn (hoặc hỗ trợ) khôi phục cho mục đích sử dụng thông thường.
              Có thể còn bản sao kỹ thuật tạm thời trong chu kỳ sao lưu hạ tầng, nhưng chúng tôi{" "}
              <strong className="font-medium text-zinc-300">không cam kết</strong> phục hồi theo yêu cầu.
              Bạn có trách nhiệm tự tải về máy trước khi xóa.
            </P>
            <P>
              <strong className="font-medium text-zinc-300">Rủi ro hạ tầng:</strong> Dữ liệu Gallery lưu
              trên máy chủ có thể mất mát do sự cố bất khả kháng hoặc sự cố nhà cung cấp hạ tầng (ổ cứng,
              trung tâm dữ liệu, v.v.). IMG Studio không chịu trách nhiệm đền bù tài sản đối với tệp tin
              bị mất trong các trường hợp đó. Hãy tải về và sao lưu bản quan trọng.
            </P>
          </Section>

          <Section id="vi" title="8. Cơ chế Ví, trừ tiền và hoàn Credit">
            <P>
              <strong className="font-medium text-zinc-300">Bản chất Ví:</strong> Số dư được nạp qua cổng
              thanh toán (ví dụ PayOS) và dùng làm Credit trên hệ thống. Đây không phải tài khoản ngân
              hàng, không sinh lãi, và <strong className="font-medium text-zinc-300">không rút tiền mặt</strong>{" "}
              hay chuyển khoản ngược lại theo mặc định.
            </P>
            <P>
              <strong className="font-medium text-zinc-300">Nạp tiền:</strong> Khoản đã nạp thành công
              thường không hoàn về ngân hàng/ví điện tử, trừ lỗi thu phí đã được xác minh hoặc trường hợp
              pháp luật bắt buộc.
            </P>
            <P>
              <strong className="font-medium text-zinc-300">Trừ Credit:</strong> Hệ thống chỉ trừ Credit khi
              job hoàn tất theo quy trình và Output được trả về tài khoản/Gallery (hoặc tương đương qua
              API), theo bảng giá tại thời điểm tạo.
            </P>
            <P>
              <strong className="font-medium text-zinc-300">Hoàn Credit (vào Ví):</strong> Được xem xét /
              thực hiện khi: lỗi xử lý phía backend IMG Studio; API Provider trả lỗi hệ thống
              (5xx/timeout); hoặc đã trừ Credit nhưng không có tệp Output hợp lệ trả về.
            </P>
            <P>
              <strong className="font-medium text-zinc-300">Không hoàn Credit</strong> trong các trường hợp
              điển hình:
            </P>
            <Ul
              items={[
                <>Bạn không ưng ý kết quả (thẩm mỹ, chi tiết, “không đúng gu”).</>,
                <>Prompt/Output bị bộ lọc của Provider chặn hoặc từ chối.</>,
                <>Cấu hình sai thông số trong phạm vi hệ thống cho phép.</>,
                <>Job đã tạo thành công và trả file.</>,
              ]}
            />
            <P>
              Credit khuyến mãi / tặng: không quy đổi tiền mặt; có thể bị thu hồi nếu phát hiện lạm dụng
              (multi-account, gian lận…).
            </P>
          </Section>

          <Section id="lam-dung" title="9. Gian lận, lạm dụng và chấm dứt dịch vụ">
            <P>IMG Studio nghiêm cấm các hành vi sau:</P>
            <Ul
              items={[
                <>Tấn công, quét lỗ hổng, DDoS, lạm dụng hạ tầng hoặc bot phá hoại hệ thống.</>,
                <>
                  Gian lận thanh toán, lợi dụng lỗi hệ thống để trục lợi Credit, tạo hàng loạt tài khoản
                  ảo (multi-account) để bào khuyến mãi.
                </>,
                <>Chia sẻ công khai hoặc bán lại API Key / tài khoản cho nhiều người dùng chung.</>,
              ]}
            />
            <P>
              Khi phát hiện dấu hiệu trên, hoặc theo yêu cầu hợp pháp của cơ quan nhà nước, IMG Studio có
              quyền tạm khóa hoặc chấm dứt tài khoản, thu hồi Credit khuyến mãi và/hoặc tịch thu số dư liên
              quan hành vi gian lận — có thể không báo trước. Việc khóa theo mục này nhằm bảo vệ vận hành
              và tuân thủ pháp luật, không phải bộ quy tắc kiểm duyệt nội dung sáng tạo.
            </P>
          </Section>

          <Section id="gioi-han" title="10. Giới hạn trách nhiệm">
            <P>
              Trong phạm vi tối đa pháp luật cho phép, IMG Studio không chịu trách nhiệm cho thiệt hại
              gián tiếp, mất lợi nhuận, mất dữ liệu hoặc cơ hội kinh doanh phát sinh từ việc sử dụng hoặc
              không thể sử dụng dịch vụ.
            </P>
            <P>
              Nếu phát sinh nghĩa vụ bồi thường theo phán quyết/cơ quan có thẩm quyền, tổng mức bồi thường
              tài chính tối đa đối với một tài khoản không vượt quá: (a) số Credit của request liên quan,
              hoặc (b) tổng tiền nạp thành công trong 30 ngày gần nhất trước sự cố — và trong mọi trường
              hợp <strong className="font-medium text-zinc-300">không quá 1.000.000 VND (một triệu đồng)</strong>
              , trừ khi pháp luật bắt buộc mức khác.
            </P>
          </Section>

          <Section id="bat-kha-khang" title="11. Sự kiện bất khả kháng">
            <P>
              Hệ thống được miễn trừ trách nhiệm do gián đoạn dịch vụ hoặc mất dữ liệu bởi nguyên nhân
              ngoài tầm kiểm soát hợp lý, bao gồm: sự cố Internet (đứt cáp…), sập nguồn diện rộng, nhà
              cung cấp VPS/Cloud gián đoạn hoặc khóa hạ tầng, Provider AI đổi chính sách API hoặc dừng
              hoạt động, tấn công mạng quy mô lớn (DDoS), hoặc thay đổi hành lang pháp lý / yêu cầu cơ
              quan quản lý nhà nước.
            </P>
          </Section>

          <Section id="thay-doi" title="12. Thay đổi Điều khoản">
            <P>
              IMG Studio có quyền cập nhật Điều khoản để phù hợp vận hành thực tế. Phiên bản mới nhất được
              công bố tại{" "}
              <Link href="/terms" className="text-zinc-300 underline-offset-2 hover:text-white hover:underline">
                https://imgstudio.site/terms
              </Link>
              . Thay đổi quan trọng có thể được nhắc thêm qua website/banner khi phù hợp. Việc bạn tiếp
              tục duy trì tài khoản và sử dụng dịch vụ sau khi điều khoản mới được đăng tải đồng nghĩa
              với việc chấp nhận thay đổi đó.
            </P>
          </Section>

          <Section id="luat" title="13. Luật áp dụng và giải quyết tranh chấp">
            <P>
              Điều khoản này được điều chỉnh và giải thích theo pháp luật nước Cộng hòa Xã hội Chủ nghĩa
              Việt Nam. Tranh chấp trước hết giải quyết bằng thương lượng thiện chí. Không thành, vụ việc
              được đưa ra Tòa án có thẩm quyền tại Việt Nam.
            </P>
          </Section>

          <Section id="lien-he" title="14. Thông tin liên hệ">
            <P>Thắc mắc, báo lỗi kỹ thuật hoặc khiếu nại về trừ/hoàn Credit:</P>
            <Ul
              items={[
                <>
                  Website:{" "}
                  <a
                    href="https://imgstudio.site"
                    className="text-zinc-300 underline-offset-2 hover:text-white hover:underline"
                  >
                    https://imgstudio.site
                  </a>
                </>,
                <>
                  Email hỗ trợ:{" "}
                  <a
                    href="mailto:support@imgstudio.site"
                    className="text-zinc-300 underline-offset-2 hover:text-white hover:underline"
                  >
                    support@imgstudio.site
                  </a>
                </>,
                <>
                  Telegram:{" "}
                  <a
                    href={ADMIN_CONTACT.telegramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-300 underline-offset-2 hover:text-white hover:underline"
                  >
                    @{ADMIN_CONTACT.telegramHandle}
                  </a>
                </>,
              ]}
            />
          </Section>
        </div>

        <p className="mt-8 text-center text-xs text-zinc-600">
          Bằng việc sử dụng IMG Studio, bạn xác nhận đã đọc và đồng ý Điều khoản này.
        </p>
      </main>

      <footer className="border-t border-zinc-800">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-4 text-center text-xs text-zinc-500">
          <span>IMG Studio</span>
          <span className="text-zinc-700">·</span>
          <Link href="/terms" className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline">
            Điều khoản dịch vụ
          </Link>
          <span className="text-zinc-700">·</span>
          <a
            href={ADMIN_CONTACT.telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
          >
            @{ADMIN_CONTACT.telegramHandle}
          </a>
        </div>
      </footer>
    </div>
  );
}
