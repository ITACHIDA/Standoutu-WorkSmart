'use client';
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import TopNav from "./TopNav";

export default function ManagerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  const links = [
    { href: "/manager/profiles", label: "Profile management" },
    { href: "/manager/bidders", label: "Bidder management" },
  ];

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <TopNav />
      <div className="mx-auto w-full max-w-7xl px-8 py-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-slate-500">Manager console</div>
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
          >
            {open ? "Hide sidebar" : "Show sidebar"}
          </button>
        </div>
        <div className="flex gap-6 min-h-[70vh] items-start">
          {open && (
            <aside className="w-64 shrink-0 space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm self-start sticky top-20 h-fit shadow-[0_20px_60px_-40px_rgba(0,0,0,0.15)]">
              {links.map((link) => {
                const active = pathname.startsWith(link.href);
                return (
              <Link
                key={link.href}
                href={link.href}
                className={`block rounded-xl px-3 py-2 transition ${
                  active ? "bg-slate-100 text-slate-900 border border-slate-200" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            );
              })}
            </aside>
          )}
          <section className="flex-1">{children}</section>
        </div>
      </div>
    </main>
  );
}
