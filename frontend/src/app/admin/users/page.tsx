'use client';
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { ClientUser } from "../../../lib/auth";
import { useAuth } from "../../../lib/useAuth";
import AdminShell from "../../../components/AdminShell";

const roles = ["ADMIN", "MANAGER", "BIDDER", "OBSERVER"] as const;

export default function AdminUsersPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const [users, setUsers] = useState<ClientUser[]>([]);
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
    void loadUsers(token);
  }, [loading, user, token, router]);

  async function loadUsers(authToken: string) {
    try {
      const list = await api<ClientUser[]>("/users", undefined, authToken);
      setUsers(list);
    } catch (err) {
      console.error(err);
      setError("Failed to load users.");
    }
  }

  async function updateRole(id: string, role: string) {
    if (!token) return;
    setSavingId(id);
    setError("");
    try {
      await api(`/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }, token);
      await loadUsers(token);
    } catch (err) {
      console.error(err);
      setError("Unable to update role.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Admin</p>
          <h1 className="text-3xl font-semibold">User & role management</h1>
          <p className="text-sm text-slate-400">
            Promote observers, manage managers, and keep bidder access in sync.
          </p>
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
            <div>Role</div>
            <div>Actions</div>
          </div>
          <div className="divide-y divide-white/5">
            {users.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-400">No users found.</div>
            ) : (
              users.map((u) => (
                <div key={u.id} className="grid grid-cols-4 items-center px-4 py-3 text-sm text-slate-100">
                  <div className="font-semibold">{u.name}</div>
                  <div className="text-slate-300">{u.email}</div>
                  <div className="text-slate-300">{u.role}</div>
                  <div>
                    <select
                      value={u.role}
                      disabled={savingId === u.id}
                      onChange={(e) => updateRole(u.id, e.target.value)}
                      className="rounded-lg bg-[#0b1224] px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
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
