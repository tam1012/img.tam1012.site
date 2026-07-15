"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { formatDateTime, useLocale, useT } from "@/i18n";

type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export default function ApiKeysPanel() {
  const t = useT();
  const { locale } = useLocale();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/api-keys");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("apiKeys.loadFailed"));
      setKeys(data.keys || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("apiKeys.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    setError("");
    setFreshSecret(null);
    setCopied(false);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Default" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("apiKeys.createFailed"));
      setFreshSecret(data.secret);
      setName("");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("apiKeys.createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget || revoking) return;
    setRevoking(true);
    setError("");
    try {
      const res = await fetch(`/api/api-keys/${revokeTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t("apiKeys.revokeFailed"));
      setRevokeTarget(null);
      if (freshSecret?.startsWith(revokeTarget.key_prefix)) setFreshSecret(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("apiKeys.revokeFailed"));
    } finally {
      setRevoking(false);
    }
  }

  async function copySecret() {
    if (!freshSecret) return;
    try {
      await navigator.clipboard.writeText(freshSecret);
      setCopied(true);
    } catch {
      setError(t("apiKeys.copyFailed"));
    }
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">{t("apiKeys.title")}</h2>
          <p className="mt-1 text-sm text-zinc-400">{t("apiKeys.description")}</p>
        </div>
        <Link href="/docs/api" className="shrink-0 text-xs text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
          {t("apiKeys.docs")}
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("apiKeys.namePlaceholder")}
          maxLength={40}
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={creating}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {creating ? t("apiKeys.creating") : t("apiKeys.create")}
        </button>
      </div>

      {freshSecret && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4 space-y-2">
          <p className="text-sm text-amber-100 font-medium">{t("apiKeys.copyNow")}</p>
          <code className="block break-all rounded-md bg-zinc-950 px-3 py-2 text-xs text-zinc-200 border border-zinc-800">
            {freshSecret}
          </code>
          <button
            type="button"
            onClick={() => void copySecret()}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-200 transition-colors cursor-pointer"
          >
            {copied ? t("apiKeys.copied") : t("apiKeys.copy")}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-6">
          <span className="spinner" />
        </div>
      ) : activeKeys.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("apiKeys.empty")}</p>
      ) : (
        <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 overflow-hidden">
          {activeKeys.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-950/40">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 truncate">{k.name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {k.key_prefix}… · {t("apiKeys.created", { date: formatDateTime(k.created_at, locale) })}
                  {k.last_used_at
                    ? ` · ${t("apiKeys.lastUsed", { date: formatDateTime(k.last_used_at, locale) })}`
                    : ` · ${t("apiKeys.neverUsed")}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRevokeTarget(k)}
                className="shrink-0 px-2 py-1 text-xs text-red-400/80 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer"
              >
                {t("apiKeys.revoke")}
              </button>
            </div>
          ))}
        </div>
      )}

      {revokedKeys.length > 0 && (
        <details className="text-sm text-zinc-500">
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-300">
            {t("apiKeys.revokedList", { count: revokedKeys.length })}
          </summary>
          <ul className="mt-2 space-y-1 pl-1">
            {revokedKeys.map((k) => (
              <li key={k.id} className="text-xs">
                {k.name} · {k.key_prefix}… ·{" "}
                {k.revoked_at ? t("apiKeys.revokedAt", { date: formatDateTime(k.revoked_at, locale) }) : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-zinc-600 leading-relaxed">
        {t("apiKeys.endpointHint")}{" "}
        <Link href="/docs/api" className="text-zinc-400 hover:text-zinc-200 underline-offset-2 hover:underline">
          {t("apiKeys.viewDocs")}
        </Link>
        .
      </p>

      <ConfirmDialog
        open={revokeTarget !== null}
        title={t("apiKeys.confirmTitle")}
        description={
          revokeTarget
            ? t("apiKeys.confirmDesc", { name: revokeTarget.name, prefix: revokeTarget.key_prefix })
            : undefined
        }
        confirmLabel={t("apiKeys.revoke")}
        tone="danger"
        loading={revoking}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void handleRevoke()}
      />
    </section>
  );
}
