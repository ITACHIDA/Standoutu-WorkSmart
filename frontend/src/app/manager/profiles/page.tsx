'use client';
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ManagerShell from "../../../components/ManagerShell";
import { api } from "../../../lib/api";
import { ClientUser } from "../../../lib/auth";
import { useAuth } from "../../../lib/useAuth";

type Profile = {
  id: string;
  displayName: string;
  baseInfo?: {
    location?: { city?: string; country?: string };
    contact?: { email?: string; phone?: string };
  };
  updatedAt?: string;
};

type Assignment = {
  id: string;
  profileId: string;
  bidderUserId: string;
  assignedAt: string;
  unassignedAt?: string | null;
};

export default function ManagerProfilesPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [users, setUsers] = useState<ClientUser[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user || !token) {
      router.replace("/auth");
      return;
    }
    if (user.role !== "MANAGER" && user.role !== "ADMIN") {
      router.replace("/workspace");
      return;
    }
    void loadData(token, user.id);
  }, [loading, user, token, router]);

  async function loadData(authToken: string, actorId: string) {
    try {
      const [profRes, assignRes, usersRes] = await Promise.all([
        api<Profile[]>(`/profiles?userId=${actorId}`, undefined, authToken),
        api<Assignment[]>("/assignments", undefined, authToken),
        api<ClientUser[]>("/users", undefined, authToken),
      ]);
      setProfiles(profRes);
      setAssignments(assignRes);
      setUsers(usersRes);
    } catch (err) {
      console.error(err);
      setError("Failed to load profiles.");
    }
  }

  async function handleCreateProfile() {
    if (!token) return;
    setSaving(true);
    setError("");
    try {
      await api(
        "/profiles",
        {
          method: "POST",
          body: JSON.stringify({
            displayName,
            firstName,
            lastName,
            email,
          }),
        },
        token
      );
      setDisplayName("");
      setFirstName("");
      setLastName("");
      setEmail("");
      if (user) {
        await loadData(token, user.id);
      }
      setShowModal(false);
    } catch (err) {
      console.error(err);
      setError("Failed to create profile.");
    } finally {
      setSaving(false);
    }
  }

  const activeAssignments = useMemo(() => {
    const map = new Map<string, Assignment>();
    assignments
      .filter((a) => !a.unassignedAt)
      .forEach((a) => map.set(a.profileId, a as Assignment & { unassignedAt?: string | null }));
    return map;
  }, [assignments]);

  const userById = useMemo(() => {
    const map = new Map<string, ClientUser>();
    users.forEach((u) => map.set(u.id, u));
    return map;
  }, [users]);

  return (
    <ManagerShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Manager</p>
            <h1 className="text-3xl font-semibold text-slate-900">Profiles overview</h1>
            <p className="text-sm text-slate-600">
              Review bidder assignments and profile coverage. Observers cannot view this area.
            </p>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setShowModal(true)}
              className="rounded-full bg-[#4ade80] px-4 py-2 text-sm font-semibold text-[#0b1224] shadow-[0_14px_40px_-24px_rgba(74,222,128,0.9)] hover:brightness-110"
            >
              Add profile
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-5 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.14em] text-slate-500">
            <div>Name</div>
            <div>Location</div>
            <div>Contact</div>
            <div>Assigned bidder</div>
            <div>Updated</div>
          </div>
          <div className="divide-y divide-slate-200">
            {profiles.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">No profiles found.</div>
            ) : (
              profiles.map((p) => {
                const assignment = activeAssignments.get(p.id);
                const bidder = assignment ? userById.get(assignment.bidderUserId) : null;
                const location =
                  p.baseInfo?.location?.city || p.baseInfo?.location?.country
                    ? `${p.baseInfo?.location?.city ?? ""}${p.baseInfo?.location?.city ? ", " : ""}${p.baseInfo?.location?.country ?? ""}`
                    : "—";
                return (
                  <div key={p.id} className="grid grid-cols-5 items-center px-4 py-3 text-sm text-slate-900">
                    <div className="font-semibold">{p.displayName}</div>
                    <div className="text-slate-600">{location}</div>
                    <div className="text-slate-700">
                      {p.baseInfo?.contact?.email ?? "—"}
                      {p.baseInfo?.contact?.phone ? (
                        <span className="ml-1 text-xs text-slate-500">· {p.baseInfo.contact.phone}</span>
                      ) : null}
                    </div>
                    <div className="text-slate-700">
                      {bidder ? `${bidder.name} (${bidder.email})` : "Unassigned"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "—"}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl text-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Create profile</p>
                <p className="text-sm text-slate-700">Add a candidate profile to assign to bidders.</p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-slate-200"
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional)"
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-slate-200"
              />
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name (optional)"
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-slate-200"
              />
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name (optional)"
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-slate-200"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleCreateProfile}
                disabled={saving || !displayName}
                className="rounded-xl bg-[#4ade80] px-4 py-2 text-sm font-semibold text-[#0b1224] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Creating..." : "Save profile"}
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-800 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </ManagerShell>
  );
}
