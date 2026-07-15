import type { Metadata } from "next";
import Providers from "@/components/Providers";
import "./globals.css";

const SITE_URL = "https://imgstudio.site";
const SITE_TITLE = "IMG Studio — Tạo và chỉnh ảnh, video bằng AI";
const SITE_DESCRIPTION =
  "Gom nhiều model AI hàng đầu vào một nơi. Mô tả ý tưởng bằng tiếng Việt, nhận ảnh và video chất lượng cao. Tặng 10 ảnh miễn phí khi đăng ký.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "IMG Studio",
  description: SITE_DESCRIPTION,
  icons: { icon: "/favicon.svg" },
  openGraph: {
    type: "website",
    siteName: "IMG Studio",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "vi_VN",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "IMG Studio" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
