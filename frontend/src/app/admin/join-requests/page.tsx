'use client';
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { ClientUser } from "../../../lib/auth";
import { useAuth } from "../../../lib/useAuth";
import AdminShell from "../../../components/AdminShell";

export default function JoinRequestsPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const [observers, setObservers] = useState<ClientUser[]>([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

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
    void loadObservers(token);
  }, [loading, user, token, router]);

  async function loadObservers(authToken: string) {
    try {
      const list = await api<ClientUser[]>("/users", undefined, authToken);
      setObservers(list.filter((u) => u.role === "OBSERVER"));
    } catch (err) {
      console.error(err);
      setError("Failed to load join requests.");
    }
  }

  async function approve(id: string, role: "BIDDER" | "MANAGER") {
    if (!token) return;
    setSavingId(id);
    setError("");
    try {
      await api(`/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }, token);
      await loadObservers(token);
    } catch (err) {
      console.error(err);
      setError("Unable to approve request.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Admin</p>
          <h1 className="text-3xl font-semibold">Join requests</h1>
          <p className="text-sm text-slate-400">Approve observer accounts into bidder or manager roles.</p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-3xl border border-white/5 bg-[#0c1329]">
          <div className="grid grid-cols-4 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.14em] text-slate-400">
            <div>Name</div>
            <div>Email</div>
            <div>Current</div>
            <div>Actions</div>
          </div>
          <div className="divide-y divide-white/5">
            {observers.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-400">No pending requests.</div>
            ) : (
              observers.map((u) => (
                <div key={u.id} className="grid grid-cols-4 items-center px-4 py-3 text-sm text-slate-100">
                  <div className="font-semibold">{u.name}</div>
                  <div className="text-slate-300">{u.email}</div>
                  <div className="text-slate-300">{u.role}</div>
                  <div className="flex gap-2 text-xs">
                    <button
                      onClick={() => approve(u.id, "BIDDER")}
                      disabled={savingId === u.id}
                      className="rounded-full bg-[#4ade80] px-3 py-1 font-semibold text-[#0b1224] hover:brightness-110 disabled:opacity-60"
                    >
                      Approve as bidder
                    </button>
                    <button
                      onClick={() => approve(u.id, "MANAGER")}
                      disabled={savingId === u.id}
                      className="rounded-full border border-white/10 px-3 py-1 text-white hover:bg-white/10 disabled:opacity-60"
                    >
                      Approve as manager
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
