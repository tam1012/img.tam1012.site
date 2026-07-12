"use client";

import Header from "@/components/Header";
import MobileNav from "@/components/MobileNav";
import SiteFooter from "@/components/SiteFooter";
import SiteNoticeBanner from "@/components/SiteNoticeBanner";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <SiteNoticeBanner />
      <div className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </div>
      <MobileNav />
    </div>
  );
}
