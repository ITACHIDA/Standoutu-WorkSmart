'use client';
import Link from "next/link";
import TopNav from "../components/TopNav";

export default function Page() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <TopNav />
      <div className="w-full bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-center px-6 py-16 text-center">
          <div className="space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1 text-[11px] uppercase tracking-[0.28em] text-slate-500">
              SmartWork platform
            </span>
            <h1 className="text-4xl font-semibold leading-tight text-slate-900">All roles. One streamlined surface.</h1>
            <p className="text-base text-slate-600 max-w-2xl">
              Manage bidders, managers, and admins with a full-width, distraction-free workspace built for Electron and web.
            </p>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/auth"
              className="rounded-xl bg-[#4ade80] px-8 py-3 text-sm font-semibold text-[#0b1224] shadow-[0_18px_50px_-28px_rgba(74,222,128,0.5)] hover:brightness-110"
            >
              Go to login
            </Link>
            <Link
              href="/workspace"
              className="rounded-xl border border-slate-200 px-8 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Open workspace
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
