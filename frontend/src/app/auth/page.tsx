'use client';
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { ClientUser, saveAuth } from "../../lib/auth";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      const path = mode === "signin" ? "/auth/login" : "/auth/signup";
      const body =
        mode === "signin" ? { email, password } : { email, password, name };
      const res = await api(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const { user, token } = res as { user: ClientUser; token?: string };
      if (user && token) {
        saveAuth(user, token);
      }
      router.replace("/workspace");
    } catch (err) {
      console.error(err);
      setError("Authentication failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="space-y-3">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
            SmartWork
          </p>
          <h1 className="text-3xl font-semibold">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
          <p className="text-sm text-slate-600">
            Enter your details to continue.
          </p>
        </div>

        <div className="mt-5 inline-flex rounded-full bg-white/5 p-1 text-xs text-slate-200">
          <button
            onClick={() => setMode("signin")}
            className={`rounded-full px-4 py-1 ${
              mode === "signin" ? "bg-[#5ef3c5] text-[#0b1224] font-semibold" : ""
            }`}
          >
            Sign in
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`rounded-full px-4 py-1 ${
              mode === "signup" ? "bg-[#5ef3c5] text-[#0b1224] font-semibold" : ""
            }`}
          >
            Sign up
          </button>
        </div>

        <div className="mt-6 w-full space-y-3 rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.12)]">
          {mode === "signup" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-slate-200"
            />
          )}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-slate-200"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-slate-200"
          />
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <button
            onClick={handleSubmit}
            disabled={loading || !email || !password || (mode === "signup" && !name)}
            className="w-full rounded-xl bg-[#4ade80] px-4 py-2 text-sm font-semibold text-[#0b1224] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </div>
      </div>
    </main>
  );
}
