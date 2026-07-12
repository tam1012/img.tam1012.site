"use client";

const PRESETS = [
  { id: "sq1k", label: "Vuông 1K", aspectRatio: "1:1", resolution: "1K" },
  { id: "story2k", label: "Story 2K", aspectRatio: "9:16", resolution: "2K" },
  { id: "wide2k", label: "Ngang 2K", aspectRatio: "16:9", resolution: "2K" },
  { id: "wide4k", label: "Ngang 4K", aspectRatio: "16:9", resolution: "4K" },
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
  return (
    <div className="flex flex-wrap gap-2" aria-label="Mẫu kích thước nhanh">
      {PRESETS.map((preset) => {
        const limited = preset.resolution === "4K" && maxResolution === "2K";
        const active = preset.aspectRatio === aspectRatio && preset.resolution === resolution;
        return (
          <span key={preset.id} title={limited ? "Model tối đa 2K" : undefined}>
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
              {preset.label}
            </button>
          </span>
        );
      })}
    </div>
  );
}
