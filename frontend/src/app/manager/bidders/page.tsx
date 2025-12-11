'use client';
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/useAuth";
import ManagerShell from "../../../components/ManagerShell";

type BidderSummary = {
  id: string;
  name: string;
  email: string;
  profiles: { id: string; displayName: string }[];
};

export default function ManagerBiddersPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const [bidders, setBidders] = useState<BidderSummary[]>([]);
  const [error, setError] = useState("");

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
    void loadData(token);
  }, [loading, user, token, router]);

  async function loadData(authToken: string) {
    try {
      const summaries = await api<BidderSummary[]>("/manager/bidders/summary", undefined, authToken);
      setBidders(summaries);
    } catch (err) {
      console.error(err);
      setError("Failed to load bidders.");
    }
  }

  return (
    <ManagerShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Manager</p>
          <h1 className="text-3xl font-semibold text-slate-900">Bidder roster</h1>
          <p className="text-sm text-slate-600">Track bidder assignments pulled from the database.</p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-3 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.14em] text-slate-600">
            <div>Name</div>
            <div>Email</div>
            <div>Profiles</div>
          </div>
          <div className="divide-y divide-slate-200">
            {bidders.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-600">No bidders found.</div>
            ) : (
              bidders.map((b) => (
                <div key={b.id} className="grid grid-cols-3 items-center px-4 py-3 text-sm text-slate-800">
                  <div className="font-semibold text-slate-900">{b.name}</div>
                  <div className="text-slate-700">{b.email}</div>
                  <div className="text-slate-700">
                    {b.profiles.length === 0 ? (
                      <span className="text-slate-500 text-xs">Unassigned</span>
                    ) : (
                      <div className="flex flex-wrap gap-1 text-xs">
                        {b.profiles.map((p) => (
                          <span key={p.id} className="rounded-full bg-slate-100 px-2 py-1 text-slate-800">
                            {p.displayName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </ManagerShell>
  );
}
