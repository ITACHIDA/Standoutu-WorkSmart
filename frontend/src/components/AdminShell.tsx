'use client';
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import TopNav from "./TopNav";

const links = [
  { href: "/admin/users", label: "Manage users" },
  { href: "/admin/join-requests", label: "Join requests" },
  { href: "/admin/label-aliases", label: "Label tags" },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <TopNav />
      <div className="mx-auto w-full max-w-7xl px-6 py-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-slate-500">Admin console</div>
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
          >
            {open ? "Hide sidebar" : "Show sidebar"}
          </button>
        </div>
        <div className="flex gap-4 min-h-[70vh] items-stretch">
          {open && (
            <aside className="w-60 shrink-0 space-y-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm self-stretch sticky top-20 h-full shadow-[0_20px_60px_-40px_rgba(0,0,0,0.15)]">
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
