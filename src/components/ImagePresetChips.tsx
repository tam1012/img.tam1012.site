"use client";

import { useT } from "@/i18n";

const PRESET_IDS = [
  { id: "sq1k", labelKey: "presets.sq1k" as const, aspectRatio: "1:1", resolution: "1K" },
  { id: "story2k", labelKey: "presets.story2k" as const, aspectRatio: "9:16", resolution: "2K" },
  { id: "wide2k", labelKey: "presets.wide2k" as const, aspectRatio: "16:9", resolution: "2K" },
  { id: "wide4k", labelKey: "presets.wide4k" as const, aspectRatio: "16:9", resolution: "4K" },
];

interface ImagePresetChipsProps {
  aspectRatio: string;
  resolution: string;
  maxResolution?: "2K" | "4K";
  disabled?: boolean;
  onSelect: (aspectRatio: string, resolution: string) => void;
}

export default function ImagePresetChips({
  aspectRatio,
  resolution,
  maxResolution,
  disabled = false,
  onSelect,
}: ImagePresetChipsProps) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2" aria-label={t("presets.aria")}>
      {PRESET_IDS.map((preset) => {
        const limited = preset.resolution === "4K" && maxResolution === "2K";
        const active = preset.aspectRatio === aspectRatio && preset.resolution === resolution;
        return (
          <span key={preset.id} title={limited ? t("presets.limited2k") : undefined}>
            <button
              type="button"
              aria-pressed={active}
              disabled={disabled || limited}
              onClick={() => onSelect(preset.aspectRatio, preset.resolution)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors cursor-pointer disabled:cursor-not-allowed ${
                active
                  ? "border-blue-500/70 bg-blue-500/15 text-blue-200"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              } disabled:border-zinc-800 disabled:bg-zinc-900/50 disabled:text-zinc-600`}
            >
              {t(preset.labelKey)}
            </button>
          </span>
        );
      })}
    </div>
  );
}
