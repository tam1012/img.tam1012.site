const MEMORIAL_END = Date.parse("2026-07-28T00:00:00+07:00");

const TITLE = "Đời đời nhớ ơn các Anh hùng Liệt sĩ";
const DATES = "27/7/1947 – 27/7/2026";

const bgStyle = {
  backgroundImage: "url(/memorial-27-7.jpg)",
  backgroundSize: "cover",
  backgroundPosition: "center",
} as const;

export default function MemorialBanner({ variant = "strip" }: { variant?: "large" | "strip" }) {
  if (Date.now() >= MEMORIAL_END) return null;

  const large = variant === "large";

  return (
    <section
      className={`relative w-full overflow-hidden border-b border-red-950/60 bg-cover bg-center ${
        large ? "h-[220px] sm:h-[280px]" : "h-[110px] sm:h-[130px]"
      }`}
      style={bgStyle}
      role="img"
      aria-label={`${TITLE} · ${DATES}`}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/25" />
      <div
        className={`absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-4 text-center ${
          large ? "pb-6 sm:pb-8" : "pb-3.5 sm:pb-4"
        }`}
      >
        <p
          className={`font-semibold tracking-tight text-white drop-shadow-lg ${
            large ? "text-2xl sm:text-4xl" : "text-lg sm:text-2xl"
          }`}
        >
          {TITLE}
        </p>
        <p
          className={`text-amber-100 drop-shadow ${
            large ? "mt-2 text-base sm:text-lg" : "mt-1 text-xs sm:text-sm"
          }`}
        >
          {DATES}
        </p>
      </div>
    </section>
  );
}
