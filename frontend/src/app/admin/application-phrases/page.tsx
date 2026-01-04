'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminShell from '../../../components/AdminShell';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/useAuth';

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

const APPLICATION_SUCCESS_KEY = 'application_success';

export default function ApplicationPhrasesPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const [phrases, setPhrases] = useState<LabelAlias[]>([]);
  const [newPhrase, setNewPhrase] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPhrase, setEditPhrase] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace('/auth');
      return;
    }
    if (user.role !== 'ADMIN') {
      router.replace('/workspace');
      return;
    }
    void loadPhrases(token);
  }, [loading, user, token, router]);

  const sortedPhrases = useMemo(
    () => [...phrases].sort((a, b) => a.alias.localeCompare(b.alias)),
    [phrases],
  );

  async function loadPhrases(authToken: string) {
    try {
      const data = await api<AliasResponse>('/label-aliases', undefined, authToken);
      const next = (data.custom || []).filter(
        (item) => item.canonicalKey === APPLICATION_SUCCESS_KEY,
      );
      setPhrases(next);
    } catch (err) {
      console.error(err);
      setError('Failed to load application phrases.');
    }
  }

  async function addPhrase() {
    if (!token) return;
    const phrase = newPhrase.trim();
    if (!phrase) {
      setError('Enter a phrase to add.');
      return;
    }
    setSavingId('new');
    setError('');
    try {
      await api(
        '/label-aliases',
        { method: 'POST', body: JSON.stringify({ canonicalKey: APPLICATION_SUCCESS_KEY, alias: phrase }) },
        token,
      );
      setNewPhrase('');
      await loadPhrases(token);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Unable to add phrase.');
    } finally {
      setSavingId(null);
    }
  }

  function startEdit(phrase: LabelAlias) {
    setEditingId(phrase.id);
    setEditPhrase(phrase.alias);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditPhrase('');
  }

  async function saveEdit(id: string) {
    if (!token) return;
    const phrase = editPhrase.trim();
    if (!phrase) {
      setError('Phrase cannot be empty.');
      return;
    }
    setSavingId(id);
    setError('');
    try {
      await api(
        `/label-aliases/${id}`,
        { method: 'PATCH', body: JSON.stringify({ canonicalKey: APPLICATION_SUCCESS_KEY, alias: phrase }) },
        token,
      );
      cancelEdit();
      await loadPhrases(token);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Unable to save phrase.');
    } finally {
      setSavingId(null);
    }
  }

  async function removePhrase(id: string) {
    if (!token) return;
    setSavingId(id);
    setError('');
    try {
      await api(`/label-aliases/${id}`, { method: 'DELETE' }, token);
      if (editingId === id) cancelEdit();
      await loadPhrases(token);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Unable to delete phrase.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Admin</p>
          <h1 className="text-3xl font-semibold text-slate-900">Application phrases</h1>
          <p className="text-sm text-slate-600">
            Manage the phrases used to confirm an application was submitted.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Phrases</h2>
              <p className="text-xs text-slate-500">{sortedPhrases.length} total</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newPhrase}
                onChange={(e) => setNewPhrase(e.target.value)}
                placeholder="Add phrase"
                className="w-60 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-slate-300"
              />
              <button
                onClick={addPhrase}
                disabled={savingId === 'new'}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
              >
                Add
              </button>
            </div>
          </div>

          {sortedPhrases.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">No phrases yet. Add one to get started.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {sortedPhrases.map((phrase) => {
                const isEditing = editingId === phrase.id;
                return (
                  <div key={phrase.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    {isEditing ? (
                      <>
                        <input
                          value={editPhrase}
                          onChange={(e) => setEditPhrase(e.target.value)}
                          className="min-w-[240px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-1 ring-transparent focus:ring-slate-300"
                        />
                        <button
                          onClick={() => saveEdit(phrase.id)}
                          disabled={savingId === phrase.id}
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
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                            Phrase
                          </span>
                          <span className="text-sm text-slate-800">{phrase.alias}</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEdit(phrase)}
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-800 hover:bg-slate-100"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => removePhrase(phrase.id)}
                            disabled={savingId === phrase.id}
                            className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
