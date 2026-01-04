'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import TopNav from '../../components/TopNav';
import { useAuth } from '../../lib/useAuth';
import { CommunityContent } from './CommunityContent';

export default function CommunityPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/auth');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <TopNav />
        <div className="flex items-center justify-center py-20">
          <div className="text-slate-600">Loading...</div>
        </div>
      </main>
    );
  }

  if (user?.role === 'OBSERVER') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <TopNav />
        <div className="mx-auto max-w-2xl px-4 py-20">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-lg text-center">
            <div className="mb-6">
              <div className="mx-auto w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">Access Restricted</h1>
              <p className="text-slate-600">You don't have permission to access the Community page</p>
            </div>
            
            <div className="bg-slate-50 rounded-2xl p-6 mb-6 text-left">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Why can't I access this page?</h2>
              <p className="text-sm text-slate-600 mb-4">
                Your current role (<span className="font-semibold text-slate-900">{user.role}</span>) has view-only permissions. 
                The Community feature requires active participation permissions.
              </p>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">How to get access</h2>
              <ul className="text-sm text-slate-600 space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 mt-0.5">•</span>
                  <span>Contact your administrator to upgrade your role</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 mt-0.5">•</span>
                  <span>Request access through your manager</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 mt-0.5">•</span>
                  <span>Email support with your access request</span>
                </li>
              </ul>
            </div>

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => router.push('/')}
                className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-semibold hover:bg-slate-800 transition"
              >
                Go to Dashboard
              </button>
              <button
                onClick={() => router.push('/workspace')}
                className="px-6 py-3 border border-slate-200 text-slate-700 rounded-2xl font-semibold hover:bg-slate-50 transition"
              >
                Go to Workspace
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return <CommunityContent />;
}
