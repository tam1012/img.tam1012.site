"use client";

import { useEffect, useState } from "react";

export default function SiteNoticeBanner() {
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/site-notice")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.notice) setNotice(String(data.notice));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!notice) return null;

  return (
    <div className="border-b border-amber-900/40 bg-amber-950/30">
      <div className="max-w-6xl mx-auto px-4 py-2.5 text-sm text-amber-100/90 whitespace-pre-wrap text-center">
        {notice}
      </div>
    </div>
  );
}
