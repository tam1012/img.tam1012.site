"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Match http/https URLs; stop before trailing punctuation common in Vietnamese/English prose. */
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

function stripTrailingPunct(url: string): { href: string; trailing: string } {
  // Keep ) ] } . , ; : ! ? if they are likely sentence punctuation, not part of the URL.
  let href = url;
  let trailing = "";
  while (href.length > 0 && /[.,;:!?)]+$/.test(href)) {
    // Keep balanced closing paren that belongs to the URL (e.g. Wikipedia)
    if (href.endsWith(")")) {
      const open = (href.match(/\(/g) || []).length;
      const close = (href.match(/\)/g) || []).length;
      if (close <= open) break;
    }
    trailing = href.slice(-1) + trailing;
    href = href.slice(0, -1);
  }
  return { href, trailing };
}

function renderNoticeWithLinks(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(URL_RE.source, URL_RE.flags);
  let i = 0;

  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    if (start > last) {
      nodes.push(text.slice(last, start));
    }
    const raw = match[0];
    const { href, trailing } = stripTrailingPunct(raw);
    if (href) {
      nodes.push(
        <a
          key={`url-${i++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 text-amber-50 hover:text-white break-all"
        >
          {href}
        </a>
      );
    }
    if (trailing) nodes.push(trailing);
    last = start + raw.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length > 0 ? nodes : [text];
}

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
        {renderNoticeWithLinks(notice)}
      </div>
    </div>
  );
}
