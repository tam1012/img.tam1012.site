"use client";

import { useState } from "react";

interface PromptRefineControlsProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  mode: "generate" | "edit" | "video";
  aspectRatio?: string;
  resolution?: string;
  disabled?: boolean;
}

export default function PromptRefineControls({
  prompt,
  onPromptChange,
  mode,
  aspectRatio,
  resolution,
  disabled = false,
}: PromptRefineControlsProps) {
  const [isRefining, setIsRefining] = useState(false);
  const [originalPrompt, setOriginalPrompt] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function refine() {
    if (disabled || isRefining || !prompt.trim()) return;
    const promptBeforeRefine = prompt;
    setIsRefining(true);
    setError("");
    try {
      const res = await fetch("/api/prompt-refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptBeforeRefine.trim(),
          mode,
          aspect_ratio: aspectRatio,
          resolution,
        }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.prompt !== "string") {
        throw new Error(data.error || "Không thể cải thiện prompt lúc này");
      }
      setOriginalPrompt((current) => current ?? promptBeforeRefine);
      onPromptChange(data.prompt);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Không thể cải thiện prompt lúc này");
    } finally {
      setIsRefining(false);
    }
  }

  function undo() {
    if (originalPrompt === null) return;
    onPromptChange(originalPrompt);
    setOriginalPrompt(null);
    setError("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={refine}
          disabled={disabled || isRefining || !prompt.trim()}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {isRefining ? "Đang viết lại…" : "Viết lại prompt rõ hơn"}
        </button>
        {originalPrompt !== null && (
          <button
            type="button"
            onClick={undo}
            disabled={disabled || isRefining}
            className="px-2 py-2 text-xs text-zinc-500 transition-colors hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Hoàn tác
          </button>
        )}
        <span className="text-[11px] text-zinc-600">Cứ viết ngắn hay lủng củng cũng được, hệ thống sẽ viết lại cho rõ, giữ nguyên ngôn ngữ và ý chính.</span>
      </div>
      {error && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
          {error} Prompt hiện tại vẫn được giữ nguyên.
        </div>
      )}
    </div>
  );
}
