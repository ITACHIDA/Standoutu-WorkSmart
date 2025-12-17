'use client';
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/useAuth";
import AdminShell from "../../../components/AdminShell";

type LabelAlias = {
  id: string;
  canonicalKey: string;
  alias: string;
  normalizedAlias: string;
};

type AliasResponse = {
  defaults: Record<string, string[]>;
  custom: LabelAlias[];
};

type TagRow = {
  alias: string;
  isDefault: boolean;
  id?: string;
};

export default function LabelAliasesPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const [defaults, setDefaults] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<LabelAlias[]>([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newAliasLeft, setNewAliasLeft] = useState("");
  const [newAliasRight, setNewAliasRight] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAlias, setEditAlias] = useState("");
  const [editKey, setEditKey] = useState("");
  const rightInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace("/auth");
      return;
    }
    if (user.role !== "ADMIN") {
      router.replace("/workspace");
      return;
    }
    void loadAliases(token);
  }, [loading, user, token, router]);

  const canonicalKeys = useMemo(() => {
    const set = new Set<string>();
    Object.keys(defaults || {}).forEach((k) => set.add(k));
    custom.forEach((c) => set.add(c.canonicalKey));
    return Array.from(set).sort();
  }, [defaults, custom]);

  async function loadAliases(authToken: string) {
    try {
      const data = await api<AliasResponse>("/label-aliases", undefined, authToken);
      const nextDefaults = data.defaults || {};
      const nextCustom = data.custom || [];
      setDefaults(nextDefaults);
      setCustom(nextCustom);
      if (!selectedKey) {
        const allKeys = new Set<string>([
          ...Object.keys(nextDefaults),
          ...nextCustom.map((c) => c.canonicalKey),
        ]);
        const firstKey = Array.from(allKeys)[0] || "";
        setSelectedKey(firstKey);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to load label tags.");
    }
  }

  const tagsForSelected: TagRow[] = useMemo(() => {
    if (!selectedKey) return [];
    const builtin = defaults[selectedKey] ?? [];
    const customTags = custom.filter((c) => c.canonicalKey === selectedKey);
    return [
      ...builtin.map((alias) => ({ alias, isDefault: true })),
      ...customTags.map((c) => ({ alias: c.alias, id: c.id, isDefault: false })),
    ];
  }, [defaults, custom, selectedKey]);

  async function addAlias(targetKey: string, value: string) {
    if (!token) return;
    if (!value.trim() || !targetKey.trim()) {
      setError("Pick a label and enter a tag.");
      return;
    }
    setSavingId(`new-${targetKey}`);
    setError("");
    try {
      await api("/label-aliases", { method: "POST", body: JSON.stringify({ canonicalKey: targetKey, alias: value }) }, token);
      setNewAliasLeft("");
      setNewAliasRight("");
      await loadAliases(token!);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Unable to add tag.");
    } finally {
      setSavingId(null);
    }
  }

  function startEdit(alias: LabelAlias) {
    setEditingId(alias.id);
    setEditAlias(alias.alias);
    setEditKey(alias.canonicalKey);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditAlias("");
    setEditKey("");
  }

  async function saveEdit(id: string) {
    if (!token) return;
    setSavingId(id);
    setError("");
    try {
      await api(`/label-aliases/${id}`, { method: "PATCH", body: JSON.stringify({ canonicalKey: editKey, alias: editAlias }) }, token);
      cancelEdit();
      await loadAliases(token);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Unable to save tag.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeAlias(id: string) {
    if (!token) return;
    setSavingId(id);
    setError("");
    try {
      await api(`/label-aliases/${id}`, { method: "DELETE" }, token);
      if (editingId === id) cancelEdit();
      await loadAliases(token);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Unable to delete tag.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Admin</p>
          <h1 className="text-3xl font-semibold text-slate-900">Label tags</h1>
          <p className="text-sm text-slate-600">
            Choose a label on the left and manage its tags on the right. Built-ins stay read-only; add or edit tags used for autofill and application confirmation checks.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <div className="flex gap-4">
          <section className="w-[30%] rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Labels</h2>
                <p className="text-xs text-slate-500">Select a label to view its tags.</p>
              </div>
              <button
                onClick={() => {
                  setTimeout(() => rightInputRef.current?.focus(), 10);
                }}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-800 hover:bg-slate-100"
              >
                + Add tag
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {canonicalKeys.map((key) => {
                const totalTags = (defaults[key]?.length ?? 0) + custom.filter((c) => c.canonicalKey === key).length;
                const active = key === selectedKey;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedKey(key)}
                    className={`flex w-full items-center justify-between px-4 py-3 text-left transition ${
                      active ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50 text-slate-800"
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold">{key}</span>
                      <span className="text-xs text-slate-500">{totalTags} tags</span>
                    </div>
                    <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white">
                      {totalTags}
                    </span>
                  </button>
                );
              })}
              {canonicalKeys.length === 0 && (
                <div className="px-4 py-6 text-sm text-slate-600">No labels available.</div>
              )}
            </div>
            {selectedKey && (
              <div className="border-t border-slate-200 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Quick add</div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={newAliasLeft}
                    onChange={(e) => setNewAliasLeft(e.target.value)}
                    placeholder="Add tag to selected"
                    className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-slate-300"
                  />
                  <button
                    onClick={() => addAlias(selectedKey, newAliasLeft)}
                    disabled={savingId?.startsWith("new-")}
                    className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="w-[70%] rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {selectedKey || "Select a label"}
                </h2>
                <p className="text-sm text-slate-600">View and edit tags for this label.</p>
              </div>
              {selectedKey && (
                <div className="flex gap-2">
                  <input
                    ref={rightInputRef}
                    value={newAliasRight}
                    onChange={(e) => setNewAliasRight(e.target.value)}
                    placeholder="Add tag"
                    className="w-52 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-slate-300"
                  />
                  <button
                    onClick={() => addAlias(selectedKey, newAliasRight)}
                    disabled={savingId?.startsWith("new-")}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            {!selectedKey ? (
              <div className="px-4 py-6 text-sm text-slate-600">Select a label to see its tags.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {tagsForSelected.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-slate-600">No tags yet. Add one to get started.</div>
                ) : (
                  tagsForSelected.map((tag) => {
                    if (tag.isDefault) {
                      return (
                        <div key={`builtin-${tag.alias}`} className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">Built-in</span>
                            <span className="text-sm text-slate-800">{tag.alias}</span>
                          </div>
                          <span className="text-xs text-slate-400">Locked</span>
                        </div>
                      );
                    }
                    const isEditing = tag.id ? editingId === tag.id : false;
                    return (
                      <div key={tag.id ?? `custom-${tag.alias}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        {isEditing ? (
                          <>
                            <input
                              value={editAlias}
                              onChange={(e) => setEditAlias(e.target.value)}
                              className="min-w-[200px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-slate-300"
                            />
                            <button
                              onClick={() => tag.id && saveEdit(tag.id)}
                              disabled={savingId === tag.id}
                              className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-800 hover:bg-slate-100"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="flex flex-1 items-center gap-2">
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Custom</span>
                              <span className="text-sm text-slate-800">{tag.alias}</span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setEditAlias(tag.alias);
                                  setEditKey(selectedKey);
                                  setEditingId(tag.id ?? null);
                                }}
                                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-800 hover:bg-slate-100"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => tag.id && removeAlias(tag.id)}
                                disabled={savingId === tag.id}
                                className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                              >
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </AdminShell>
  );
}
