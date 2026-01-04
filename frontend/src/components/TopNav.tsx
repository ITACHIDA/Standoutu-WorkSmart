'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ClientUser, clearAuth, readAuth } from '../lib/auth';

function NavItem({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-2 text-sm transition ${
        active ? 'bg-white/10 text-white' : 'text-slate-200 hover:text-white'
      }`}
    >
      {label}
    </Link>
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<ClientUser | null>(null);

  useEffect(() => {
    const stored = readAuth();
    setUser(stored?.user ?? null);
  }, [pathname]);

  const signOut = () => {
    clearAuth();
    router.push('/auth');
  };

  const isAdmin = user?.role === 'ADMIN';
  const isManager = user?.role === 'MANAGER' || isAdmin;

  return (
    <header className="w-full border-b border-white/5 bg-[#0b1020] backdrop-blur">
      <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between px-4 py-3 text-sm">
        <div className="text-lg font-semibold text-white">
          <Link href="/">SmartWork</Link>
        </div>
        <nav className="flex items-center gap-2">
          <NavItem href="/" label="Home" active={pathname === '/'} />
          <NavItem href="/workspace" label="Workspace" active={pathname.startsWith('/workspace')} />
          <NavItem href="/community" label="Community" active={pathname.startsWith('/community')} />
          <NavItem href="/calendar" label="Calendar" active={pathname.startsWith('/calendar')} />
          <NavItem href="/about" label="About" active={pathname.startsWith('/about')} />
          <NavItem href="/career" label="Career" active={pathname.startsWith('/career')} />
          {isManager && (
            <NavItem
              href="/manager/profiles"
              label="Manager"
              active={pathname.startsWith('/manager')}
            />
          )}
          {isAdmin && (
            <NavItem href="/admin/users" label="Admin" active={pathname.startsWith('/admin')} />
          )}
        </nav>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white">
                {user.name} · {user.role.toLowerCase()}
              </span>
              <button
                onClick={signOut}
                className="rounded-full border border-white/15 px-3 py-1 text-xs text-white hover:bg-white/10"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/auth"
              className="rounded-full bg-[#4ade80] px-4 py-2 text-xs font-semibold text-[#0b1224] shadow-[0_10px_30px_-18px_rgba(74,222,128,0.8)] hover:brightness-110"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
