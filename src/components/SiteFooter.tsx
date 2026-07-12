import { ADMIN_CONTACT } from "@/lib/site-settings";

export default function SiteFooter() {
  return (
    <footer className="border-t border-zinc-800 mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-3 text-center text-xs text-zinc-500">
        Liên hệ admin: Telegram{" "}
        <a
          href={ADMIN_CONTACT.telegramUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-300 hover:text-zinc-100 underline-offset-2 hover:underline"
        >
          @{ADMIN_CONTACT.telegramHandle}
        </a>
      </div>
    </footer>
  );
}
