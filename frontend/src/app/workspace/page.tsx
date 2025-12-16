'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import TopNav from "../../components/TopNav";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";
type DesktopBridge = {
  isElectron?: boolean;
  openJobWindow?: (url: string) => Promise<{ ok?: boolean; error?: string } | void>;
};

type User = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "BIDDER" | "OBSERVER";
};

type BaseInfo = {
  name?: { first?: string; last?: string };
  contact?: { email?: string; phone?: string; phoneCode?: string; phoneNumber?: string };
  links?: Record<string, string> & { linkedin?: string };
  location?: { address?: string; city?: string; state?: string; country?: string; postalCode?: string };
  career?: { jobTitle?: string; currentCompany?: string; yearsExp?: string | number; desiredSalary?: string };
  education?: { school?: string; degree?: string; majorField?: string; graduationAt?: string };
  workAuth?: { authorized?: boolean; needsSponsorship?: boolean };
  preferences?: Record<string, unknown>;
  defaultAnswers?: Record<string, string>;
};

type Profile = {
  id: string;
  displayName: string;
  baseInfo: BaseInfo;
  assignedBidderId?: string;
};

type Resume = {
  id: string;
  profileId: string;
  label: string;
};

type ApplicationSession = {
  id: string;
  bidderUserId: string;
  profileId: string;
  url: string;
  status: string;
  recommendedResumeId?: string;
  selectedResumeId?: string;
  jobContext?: Record<string, unknown>;
  fillPlan?: FillPlan;
  startedAt?: string;
};

type FillPlan = {
  filled?: { field: string; value: string; confidence?: number }[];
  suggestions?: { field: string; suggestion: string }[];
  blocked?: string[];
};

type PageFieldCandidate = {
  field_id?: string;
  id?: string | null;
  name?: string | null;
  label?: string | null;
  ariaName?: string | null;
  placeholder?: string | null;
  questionText?: string | null;
  type?: string | null;
  selector?: string | null;
  locators?: { css?: string; playwright?: string };
  constraints?: Record<string, number>;
  required?: boolean;
};

type AutofillResponse = {
  fillPlan: FillPlan;
  pageFields?: PageFieldCandidate[];
  candidateFields?: PageFieldCandidate[];
};

type AnalyzeResult = {
  recommendedResumeId?: string;
  alternatives?: { id: string; label: string }[];
  jobContext?: Record<string, unknown>;
  ranked?: { id: string; label: string; rank: number; score?: number }[];
  recommendedLabel?: string;
  scores?: Record<string, number>;
  mode?: "tech" | "resume";
  techStacks?: { label: string; score?: number }[];
};

type AnalyzePopupState =
  | { mode: "tech"; items: { label: string; score?: number }[] }
  | { mode: "resume"; items: { id: string; label: string; score?: number }[] };

type Metrics = {
  tried: number;
  submitted: number;
  appliedPercentage: number;
  monthlyApplied?: number;
  recent: ApplicationSession[];
};

async function api(path: string, init?: RequestInit) {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("smartwork_token") : null;
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401) {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("smartwork_token");
        window.localStorage.removeItem("smartwork_user");
        window.location.href = "/auth";
      }
      throw new Error("Unauthorized");
    }
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [resumeChoice, setResumeChoice] = useState<string>("");
  const [url, setUrl] = useState<string>(
    "https://www.wave.com/en/careers/job/5725498004/?source=LinkedIn"
  );
  const [useLlmAutofill, setUseLlmAutofill] = useState(false);
  const [session, setSession] = useState<ApplicationSession | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recommended, setRecommended] = useState<AnalyzeResult | null>(null);
  const [fillPlan, setFillPlan] = useState<FillPlan | null>(null);
  const [capturedFields, setCapturedFields] = useState<PageFieldCandidate[]>([]);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [streamFrame, setStreamFrame] = useState<string>("");
  const [status, setStatus] = useState<string>("Disconnected");
  const [error, setError] = useState<string>("");
  const [loadingAction, setLoadingAction] = useState<string>("");
  const [streamConnected, setStreamConnected] = useState(false);
  const [analyzePopup, setAnalyzePopup] = useState<AnalyzePopupState | null>(null);
  const [useAiAnalyze, setUseAiAnalyze] = useState(false);
  const [showBaseInfo, setShowBaseInfo] = useState(false);
  const [baseInfoView, setBaseInfoView] = useState<BaseInfo>(() => cleanBaseInfo({}));
  const [webviewStatus, setWebviewStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const webviewRef = useRef<Element | null>(null);
  const [isClient, setIsClient] = useState(false);
  const router = useRouter();
  const isBidder = user?.role === "BIDDER";
  const browserSrc = session?.url || url || "";
  const webviewPartition = "persist:smartwork-jobview";

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;
    const stored = window.localStorage.getItem("smartwork_user");
    const storedToken = window.localStorage.getItem("smartwork_token");
    if (stored && storedToken) {
      try {
        const parsed = JSON.parse(stored) as User;
        setUser(parsed);
      } catch {
        router.replace("/auth");
      }
    } else {
      router.replace("/auth");
    }
  }, [isClient, router]);

  const desktopBridge: DesktopBridge | undefined =
    isClient && typeof window !== "undefined"
      ? (window as unknown as { smartwork?: DesktopBridge }).smartwork
      : undefined;
  const isElectron = isClient && Boolean(desktopBridge?.openJobWindow);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId),
    [profiles, selectedProfileId]
  );

  const appliedPct = metrics ? `${metrics.appliedPercentage}%` : "0%";
  const monthlyApplied = metrics?.monthlyApplied ?? 0;
  const filledFields = fillPlan?.filled ?? [];
  const fillSuggestions = fillPlan?.suggestions ?? [];
  const fillBlocked = fillPlan?.blocked ?? [];
  const baseDraft = cleanBaseInfo(baseInfoView);

  async function loadResumes(profileId: string) {
    try {
      const data: Resume[] = await api(`/profiles/${profileId}/resumes`);
      setResumes(data);
      setResumeChoice("");
    } catch (err) {
      console.error(err);
    }
  }

  const refreshMetrics = useCallback(
    async (bidderId?: string) => {
      if (!bidderId && !user) return;
      const id = bidderId ?? user?.id;
      if (!id) return;
      try {
        const m: Metrics = await api(`/metrics/my?bidderUserId=${id}`);
        setMetrics(m);
      } catch (err) {
        console.error(err);
      }
    },
    [user]
  );

  useEffect(() => {
    if (!selectedProfileId || !user) return;
    void loadResumes(selectedProfileId);
    setSession(null);
    setFillPlan(null);
    setCapturedFields([]);
    setRecommended(null);
    setStreamFrame("");
    setStreamConnected(false);
    const base = profiles.find((p) => p.id === selectedProfileId)?.baseInfo;
    setBaseInfoView(cleanBaseInfo(base ?? {}));
    setShowBaseInfo(false);
  }, [selectedProfileId, user, profiles]);

  useEffect(() => {
    if (!session) {
      setStreamFrame("");
      setStreamConnected(false);
      setFrameLoaded(false);
      return;
    }
    setStreamConnected(false);
    setStreamFrame("");
    setFrameLoaded(false);
    const wsBase = API_BASE.replace(/^http/i, "ws");
    const ws = new WebSocket(`${wsBase}/ws/browser/${session.id}`);
    ws.onopen = () => setStreamConnected(true);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string);
        if (msg.type === "frame" && msg.data) {
          setStreamFrame(`data:image/png;base64,${msg.data}`);
          setFrameLoaded(true);
        }
      } catch (err) {
        console.error(err);
      }
    };
    ws.onerror = () => setStreamConnected(false);
    ws.onclose = () => setStreamConnected(false);
    return () => {
      ws.close();
    };
  }, [session]);

  useEffect(() => {
    setWebviewStatus("idle");
  }, [url]);

  useEffect(() => {
    if (!isElectron) return;
    setWebviewStatus("loading");
  }, [browserSrc, isElectron]);

  useEffect(() => {
    if (!isElectron || !webviewRef.current || !browserSrc) return;
    const view = webviewRef.current;
    const handleReady = () => setWebviewStatus("ready");
    const handleFail = () => setWebviewStatus("failed");
    const handleStart = () => setWebviewStatus("loading");
    view.addEventListener("did-finish-load", handleReady);
    view.addEventListener("did-fail-load", handleFail);
    view.addEventListener("did-start-loading", handleStart);
    return () => {
      view.removeEventListener("did-finish-load", handleReady);
      view.removeEventListener("did-fail-load", handleFail);
      view.removeEventListener("did-start-loading", handleStart);
    };
  }, [isElectron, browserSrc]);

  async function handleGo() {
    if (!user || !selectedProfileId || !url) return;
    setLoadingAction("go");
    setError("");
    try {
      const newSession: ApplicationSession = await api("/sessions", {
        method: "POST",
        body: JSON.stringify({
          bidderUserId: user.id,
          profileId: selectedProfileId,
          url,
          selectedResumeId: resumeChoice,
        }),
      });
      setSession(newSession);
      setStatus("Connecting to remote browser...");
      await api(`/sessions/${newSession.id}/go`, { method: "POST" }).catch((err) => {
        console.error(err);
      });
      setStatus("Connected to remote browser");
      void refreshMetrics();
    } catch (err) {
      console.error(err);
      setError("Failed to start session. Check backend logs.");
    } finally {
      setLoadingAction("");
    }
  }

  async function handleAnalyze() {
    if (!session) return;
    setLoadingAction("analyze");
    setError("");
    setAnalyzePopup(null);
    try {
      const res = await api(`/sessions/${session.id}/analyze`, {
        method: "POST",
        body: JSON.stringify({ useAi: useAiAnalyze }),
      });
      const result = res as AnalyzeResult;
      setRecommended(result);
      const mode = result.mode ?? (useAiAnalyze ? "resume" : "tech");

      if (mode === "tech") {
        const techItems =
          (result.techStacks?.length ? result.techStacks : result.ranked ?? []).slice(0, 4).map((t) => ({
            label: t.label,
            score: t.score,
          })) ?? [];
        if (techItems.length) {
          setAnalyzePopup({ mode: "tech", items: techItems });
        }
        setSession({
          ...session,
          status: "ANALYZED",
          jobContext: result.jobContext ?? session.jobContext,
        });
        return;
      }

      if (result.recommendedResumeId) {
        setResumeChoice(result.recommendedResumeId);
      } else if (result.recommendedLabel) {
        const match = resumes.find(
          (r) => r.label.toLowerCase() === result.recommendedLabel?.toLowerCase(),
        );
        if (match) setResumeChoice(match.id);
      }
      if (result.ranked?.length) {
        const top = result.ranked.slice(0, 4);
        if (top.length) {
          const items = top.map((r) => ({ id: r.id ?? r.label, label: r.label, score: r.score }));
          setAnalyzePopup({ mode: "resume", items });
        }
      }
      setSession({
        ...session,
        status: "ANALYZED",
        recommendedResumeId: result.recommendedResumeId ?? session.recommendedResumeId,
        jobContext: result.jobContext ?? session.jobContext,
      });
    } catch (err) {
      console.error(err);
      setError("Analyse failed. Backend must be running.");
    } finally {
      setLoadingAction("");
    }
  }

  async function handleAutofill() {
    if (!session) return;
    setLoadingAction("autofill");
    setError("");
    setCapturedFields([]);
    try {
      const res = (await api(`/sessions/${session.id}/autofill`, {
        method: "POST",
        body: JSON.stringify({ selectedResumeId: resumeChoice || undefined, useLlm: useLlmAutofill }),
      })) as AutofillResponse;
      setFillPlan(res.fillPlan);
      const detected =
        (res.pageFields?.length ? res.pageFields : undefined) ??
        (res.candidateFields?.length ? res.candidateFields : []) ??
        [];
      setCapturedFields(detected);
      setSession({
        ...session,
        status: "FILLED",
        selectedResumeId: resumeChoice || session.selectedResumeId,
      });
    } catch (err) {
      console.error(err);
      setError("Autofill failed. Backend must be running.");
    } finally {
      setLoadingAction("");
    }
  }

  useEffect(() => {
    const fetchForUser = async () => {
      if (!user || user.role === "OBSERVER") return;
      try {
        const profs: Profile[] = await api(`/profiles`);
        const visible =
          user.role === "BIDDER"
            ? profs.filter((p) => p.assignedBidderId === user.id)
            : profs;
        const normalized = visible.map((p) => ({
          ...p,
          baseInfo: cleanBaseInfo(p.baseInfo ?? {}),
        }));
        setProfiles(normalized);
        const defaultProfileId = normalized[0]?.id ?? "";
        setSelectedProfileId(defaultProfileId);
        void refreshMetrics(user.id);
        if (defaultProfileId) {
          void loadResumes(defaultProfileId);
        } else {
          setResumes([]);
        }
      } catch (err) {
        console.error(err);
      }
    };
    void fetchForUser();
  }, [user, refreshMetrics]);

  if (!user) {
    return (
      <main className="min-h-screen w-full bg-white text-slate-900">
        <TopNav />
        <div className="mx-auto max-w-screen-md px-4 py-10 text-center text-sm text-slate-800">
          Redirecting to login...
        </div>
      </main>
    );
  }

  if (user.role === "OBSERVER") {
    return (
      <main className="min-h-screen w-full bg-white text-slate-900">
        <TopNav />
        <div className="mx-auto max-w-screen-md px-4 py-12 text-center space-y-3">
          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-700">Observer</p>
          <h1 className="text-2xl font-semibold">Welcome aboard</h1>
          <p className="text-sm text-slate-700">
            Observers can browse announcements. Workspace actions are disabled.
          </p>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-800">
            <p className="text-sm font-semibold">Stay tuned</p>
            <p className="text-sm text-slate-700">
              Ask an admin to upgrade your role to start bidding.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
    <main className="min-h-screen w-full bg-white text-slate-900">
      <TopNav />
      <div className="mx-auto w-full max-w-7xl px-6 py-8 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-700">
              Application Assist
            </p>
            <h1 className="text-2xl font-semibold">SmartWork Bidder Workspace</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-800">
              {status}
            </div>
            <div className="rounded-full bg-[#5ef3c5] px-3 py-1.5 text-xs font-semibold text-[#0b1224]">
              Ctrl + Shift + F
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {user ? null : null}

        {user ? (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_3.6fr_1.5fr]">
          {/* Left column 15% */}
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-700">
                    Profile
                  </p>
                  <p className="text-lg font-semibold">
                    {selectedProfile?.displayName ?? "Select profile"}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-800">
                  {user?.email ?? "Offline"}
                </span>
              </div>
              {isBidder ? (
                <div className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900">
                  {selectedProfile?.displayName ?? "Assigned profile"}
                </div>
              ) : (
                <select
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-white/10"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-slate-700">Role: {user?.role ?? "Unknown"}</p>
            </div>

            <div className="space-y-3">
              <StatTile
                label="Tried"
                value={metrics ? `${metrics.tried}` : "0"}
                helper="Sessions started"
              />
              <StatTile
                label="Applied"
                value={metrics ? `${metrics.submitted}` : "0"}
                helper="Marked submitted"
              />
              <StatTile
                label="Applied %"
                value={appliedPct}
                helper="Submitted / Tried"
              />
              <StatTile
                label="Monthly applied"
                value={`${monthlyApplied}`}
                helper="This month"
              />
            </div>
          </section>

          {/* Main column 60% */}
          <section className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="text-base font-semibold">Navigate to job URL</div>
                <div className="text-xs text-slate-700">Remote browser stream</div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://"
                  className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-white/10"
                />
                <button
                  onClick={handleGo}
                  disabled={loadingAction === "go" || !selectedProfileId}
                  className="min-w-[110px] rounded-xl bg-[#4ade80] px-4 py-2 text-sm font-semibold text-[#0b1224] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingAction === "go" ? "Connecting..." : "Go"}
                </button>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-700">
                    Remote Browser
                  </p>
                  <p className="text-lg font-semibold">
                    {session ? safeHostname(session.url) : "No URL loaded"}
                  </p>
                </div>
                <div className="text-xs text-[#5ef3c5]">
                  Status: {session ? session.status : "Idle"}
                </div>
              </div>
              <div className="relative min-h-[420px] h-[70vh] max-h-[80vh] overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
                {streamFrame ? (
                  <div className="h-full w-full overflow-auto bg-slate-950">
                    <img
                      src={streamFrame}
                      alt="Remote browser stream"
                      className="block w-full"
                    />
                  </div>
                ) : browserSrc ? (
                  isElectron ? (
                    <div className="relative h-full w-full">
                      {/* @ts-expect-error Electron webview not in TS DOM lib */}
                      <webview
                        ref={webviewRef}
                        key={browserSrc}
                        src={browserSrc}
                        partition={webviewPartition}
                        allowpopups="true"
                        style={{ height: "100%", width: "100%", backgroundColor: "#020617" }}
                      />
                      <div className="absolute top-2 right-3 flex items-center gap-2 text-[11px] text-slate-800">
                        <span className="rounded-full bg-slate-100lack/50 px-2 py-1">Electron view</span>
                        {webviewStatus === "ready" && (
                          <span className="rounded-full bg-[#5ef3c5]/80 px-2 py-1 text-[#0b1224]">
                            Loaded
                          </span>
                        )}
                        {webviewStatus === "loading" && (
                          <span className="rounded-full bg-slate-100lack/50 px-2 py-1 text-slate-800">
                            Loading…
                          </span>
                        )}
                      </div>
                      {webviewStatus === "failed" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 p-4 text-center text-sm text-slate-800">
                          <div className="space-y-2">
                            <div>Could not load this page inside the Electron view.</div>
                            <a
                              href={browserSrc}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center rounded-full bg-[#5ef3c5] px-4 py-2 text-xs font-semibold text-[#0b1224] hover:brightness-110"
                            >
                              Open in browser
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <iframe
                        key={browserSrc}
                        src={browserSrc}
                        className="h-full w-full"
                        allowFullScreen
                        referrerPolicy="no-referrer"
                        onLoad={() => setFrameLoaded(true)}
                      />
                      {!frameLoaded && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 text-slate-800">
                          <div className="text-center space-y-2">
                            <div className="text-sm font-semibold">
                              Site may block iframe embedding.
                            </div>
                            <a
                              href={browserSrc}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center rounded-full bg-[#5ef3c5] px-4 py-2 text-xs font-semibold text-[#0b1224] hover:brightness-110"
                            >
                              Open in new tab
                            </a>
                          </div>
                        </div>
                      )}
                      <div className="absolute top-2 right-2 flex gap-2">
                        <a
                          href={browserSrc}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full bg-slate-100lack/50 px-3 py-1 text-[11px] text-slate-800 hover:bg-slate-100lack/60"
                        >
                          Open in new tab
                        </a>
                      </div>
                    </>
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-800">
                    <div className="text-center">
                      <div className="text-sm font-semibold">No URL loaded</div>
                      <div className="text-xs text-slate-700">
                        Enter a URL and click Go.
                      </div>
                    </div>
                  </div>
                )}
                {streamConnected && (
                  <div className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-slate-100lack/40 px-3 py-1 text-[11px] text-[#5ef3c5]">
                    Streaming
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Right column 25% */}
          <section className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Analyse</p>
                  <span className="text-[11px] text-slate-700">
                    {useAiAnalyze ? "AI compares resumes" : "Detect tech stack only"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setUseAiAnalyze((v) => !v)}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 transition"
                >
                  <span className={`flex h-5 w-10 items-center rounded-full ${useAiAnalyze ? "bg-[#5ef3c5]" : "bg-slate-200"}`}>
                    <span
                      className={`h-4 w-4 rounded-full bg-white shadow transition ${useAiAnalyze ? "translate-x-5" : "translate-x-1"}`}
                    />
                  </span>
                  {useAiAnalyze ? "On" : "Off"}
                </button>
              </div>
              <button
                onClick={handleAnalyze}
                disabled={!session || loadingAction === "analyze"}
                className="w-full rounded-xl bg-[#4ade80] px-4 py-2 text-sm font-semibold text-[#0b1224] shadow-[0_14px_40px_-18px_rgba(94,243,197,0.8)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                  {loadingAction === "analyze" ? "Analysing..." : "Run analyse"}
                </button>
                <div className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-800">
                    <span>Selected resume</span>
                    <span className="rounded-full bg-[#111d38] px-3 py-1 text-[11px] text-[#5ef3c5]">
                      {resumeChoice
                      ? resumes.find((r) => r.id === resumeChoice)?.label ?? "Manual"
                      : "None"}
                  </span>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-600">Manual select</label>
                  <select
                    value={resumeChoice}
                    onChange={(e) => setResumeChoice(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                  >
                    <option value="">None</option>
                    {resumes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-slate-600">
                  {useAiAnalyze
                    ? "AI mode ranks resumes and lets you pick from cards."
                    : "Off mode lists top tech stack from the job description."}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Autofill</p>
                <span className="text-xs text-slate-700">Hotkey: Ctrl+Shift+F</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
                <span>Use LLM fallback</span>
                <button
                  onClick={() => setUseLlmAutofill((v) => !v)}
                  className={`relative flex h-6 w-12 items-center rounded-full transition ${
                    useLlmAutofill ? "bg-[#4ade80]" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                      useLlmAutofill ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                  <span className="sr-only">Toggle LLM autofill</span>
                </button>
              </div>
              <button
                onClick={handleAutofill}
                disabled={!session || loadingAction === "autofill"}
                className="w-full rounded-xl bg-[#4ade80] px-4 py-2 text-sm font-semibold text-[#0b1224] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingAction === "autofill" ? "Filling..." : "Autofill"}
              </button>
              <div className="space-y-3">
                <div className="space-y-2 rounded-xl bg-slate-100 px-3 py-3 text-sm text-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-800">Filled</span>
                    <span className="text-xs text-[#5ef3c5]">
                      {filledFields.length}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-slate-700">
                    {filledFields.length ? (
                      filledFields.map((f) => (
                        <div key={f.field} className="flex items-center justify-between">
                          <span>{f.field}</span>
                          <span className="text-[#5ef3c5]">{f.value}</span>
                        </div>
                      ))
                    ) : (
                      <div>No fields filled yet.</div>
                    )}
                  </div>
                  {fillSuggestions.length ? (
                    <div className="pt-2">
                      <div className="text-xs text-slate-800">Needs review</div>
                      <div className="space-y-1 text-xs text-slate-700">
                        {fillSuggestions.map((s) => (
                          <div key={s.field}>
                            {s.field}: {s.suggestion}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {fillBlocked.length ? (
                    <div className="pt-2">
                      <div className="text-xs text-red-300">Blocked</div>
                      <div className="flex flex-wrap gap-1 text-[11px] text-red-200">
                        {fillBlocked.map((b) => (
                          <span
                            key={b}
                            className="rounded-full bg-red-500/10 px-2 py-1"
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-700">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-800">Captured fields</span>
                    <span className="rounded-full bg-white px-3 py-1 text-[11px] text-slate-700">
                      {capturedFields.length}
                    </span>
                  </div>
                  {capturedFields.length ? (
                    <div className="mt-2 max-h-56 space-y-1 overflow-auto">
                      {capturedFields.slice(0, 50).map((f, idx) => {
                        const title =
                          f.questionText || f.label || f.placeholder || f.field_id || `Field ${idx + 1}`;
                        const metaParts = [
                          f.type,
                          f.required ? "required" : null,
                          f.selector || f.locators?.css,
                        ].filter((v): v is string => Boolean(v));
                        const meta = metaParts.join(" · ");
                        return (
                          <div
                            key={`${f.field_id ?? f.selector ?? f.name ?? f.label ?? idx}-${idx}`}
                            className="rounded-lg bg-white px-2 py-1"
                          >
                            <div className="text-[12px] font-semibold text-slate-900">
                              {title}
                            </div>
                            {meta ? (
                              <div className="text-[11px] text-slate-600">
                                {meta}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-slate-600">
                      Click Autofill to capture the fields we detected on the page.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Profile base info</p>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 shadow-sm transition hover:bg-slate-100"
                  title={showBaseInfo ? "Hide base info" : "Show base info"}
                  onClick={() => setShowBaseInfo((v) => !v)}
                >
                  <TriangleIcon direction={showBaseInfo ? "down" : "left"} />
                  <span className="sr-only">{showBaseInfo ? "Hide base info" : "Show base info"}</span>
                </button>
              </div>
              {showBaseInfo ? (
                <div className="space-y-2 text-sm text-slate-800">
                  <EditableRow label="First name" editing={false} value={baseDraft?.name?.first || "N/A"} />
                  <EditableRow label="Last name" editing={false} value={baseDraft?.name?.last || "N/A"} />
                  <EditableRow label="Email" editing={false} value={baseDraft?.contact?.email || "N/A"} />
                  <EditableRow label="Phone code" editing={false} value={baseDraft?.contact?.phoneCode || "N/A"} />
                  <EditableRow label="Phone number" editing={false} value={baseDraft?.contact?.phoneNumber || "N/A"} />
                  <EditableRow label="Phone (combined)" editing={false} value={formatPhone(baseDraft.contact) || "N/A"} />
                  <EditableRow label="LinkedIn" editing={false} value={baseDraft?.links?.linkedin || "N/A"} />
                  <EditableRow label="Address" editing={false} value={baseDraft?.location?.address || "N/A"} />
                  <EditableRow label="City" editing={false} value={baseDraft?.location?.city || "N/A"} />
                  <EditableRow label="State / Province" editing={false} value={baseDraft?.location?.state || "N/A"} />
                  <EditableRow label="Country" editing={false} value={baseDraft?.location?.country || "N/A"} />
                  <EditableRow label="Postal code" editing={false} value={baseDraft?.location?.postalCode || "N/A"} />
                  <EditableRow label="Job title" editing={false} value={baseDraft?.career?.jobTitle || "N/A"} />
                  <EditableRow label="Current company" editing={false} value={baseDraft?.career?.currentCompany || "N/A"} />
                  <EditableRow label="Years of experience" editing={false} value={(baseDraft?.career?.yearsExp as string) || "N/A"} />
                  <EditableRow label="Desired salary" editing={false} value={baseDraft?.career?.desiredSalary || "N/A"} />
                  <EditableRow label="School" editing={false} value={baseDraft?.education?.school || "N/A"} />
                  <EditableRow label="Degree" editing={false} value={baseDraft?.education?.degree || "N/A"} />
                  <EditableRow label="Major / field" editing={false} value={baseDraft?.education?.majorField || "N/A"} />
                  <EditableRow label="Graduation date" editing={false} value={baseDraft?.education?.graduationAt || "N/A"} />
                  <EditableRow label="Authorized to work" editing={false} value={baseDraft?.workAuth?.authorized ? "Yes" : "No"} />
                </div>
              ) : null}
            </div>
          </section>
        </div>
        ) : (
          <div />
        )}

      </div>
    </main>
    {analyzePopup ? (
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-10 backdrop-blur-sm transition">
        <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white/95 px-6 py-5 shadow-2xl backdrop-blur animate-fade-in">
          <div className="flex items-center justify-between pb-2">
            <div className="text-base font-semibold text-slate-900">
              {analyzePopup.mode === "tech" ? "Top tech stack" : "Resume picks"}
            </div>
            <button
              onClick={() => setAnalyzePopup(null)}
              className="rounded-full px-3 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          <div className="space-y-3">
            {analyzePopup.mode === "tech" ? (
              <div className="space-y-3">
                {analyzePopup.items[0] ? (
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-[#e8fff4] px-5 py-5 shadow-sm">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="text-lg font-semibold text-slate-900">Top Result</div>
                        <div className="text-sm text-slate-700">Job description focus</div>
                      </div>
                      <div className="text-4xl font-bold text-slate-900">{analyzePopup.items[0].label}</div>
                    </div>
                    <div className="mt-4 text-sm text-slate-700">
                      score: {formatScore(analyzePopup.items[0].score)}
                    </div>
                  </div>
                ) : null}
                <div className="space-y-2">
                  {analyzePopup.items.slice(1).map((item, idx) => (
                    <div
                      key={`${item.label}-${idx}`}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <div className="text-sm font-semibold text-slate-900">
                        {ordinal(idx + 2)}: {item.label}
                      </div>
                      <div className="text-xs text-slate-600">score: {formatScore(item.score)}</div>
                    </div>
                  ))}
                  {analyzePopup.items.length < 2 ? (
                    <div className="text-xs text-slate-600">Not enough signals to show more stacks.</div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {analyzePopup.items.map((item, idx) => {
                  const rankLabel = ordinal(idx + 1);
                  const isTop = idx === 0;
                  return (
                    <button
                      key={`${item.id}-${idx}`}
                      onClick={() => {
                        setResumeChoice(item.id);
                        setAnalyzePopup(null);
                      }}
                      className={`group relative flex h-full flex-col justify-between rounded-2xl border px-4 py-4 text-left transition duration-150 ${
                        isTop
                          ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                          : "border-slate-200 bg-white hover:-translate-y-1 hover:shadow"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-semibold leading-tight">
                          {rankLabel}: {item.label}
                        </div>
                        <div
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                            isTop ? "bg-[#5ef3c5] text-slate-900" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          Score {formatScore(item.score)}
                        </div>
                      </div>
                      <div className={`mt-3 text-xs ${isTop ? "text-slate-100" : "text-slate-600"}`}>
                        Click to select this resume automatically.
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

function cleanString(val?: string | number | null) {
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return val.trim();
  return "";
}

function formatPhone(contact?: BaseInfo["contact"]) {
  if (!contact) return "";
  const parts = [contact.phoneCode, contact.phoneNumber].map((p) => cleanString(p)).filter(Boolean);
  const combined = parts.join(" ").trim();
  const fallback = cleanString(contact.phone);
  return combined || fallback;
}

function cleanBaseInfo(base: BaseInfo): BaseInfo {
  const links = { ...(base?.links ?? {}) } as Record<string, string> & { linkedin?: string };
  if (typeof links.linkedin === "string") links.linkedin = links.linkedin.trim();
  return {
    name: { first: cleanString(base?.name?.first), last: cleanString(base?.name?.last) },
    contact: {
      email: cleanString(base?.contact?.email),
      phone: formatPhone(base?.contact),
      phoneCode: cleanString(base?.contact?.phoneCode),
      phoneNumber: cleanString(base?.contact?.phoneNumber),
    },
    links,
    location: {
      address: cleanString(base?.location?.address),
      city: cleanString(base?.location?.city),
      state: cleanString(base?.location?.state),
      country: cleanString(base?.location?.country),
      postalCode: cleanString(base?.location?.postalCode),
    },
    career: {
      jobTitle: cleanString(base?.career?.jobTitle),
      currentCompany: cleanString(base?.career?.currentCompany),
      yearsExp: cleanString(base?.career?.yearsExp as string | number | undefined),
      desiredSalary: cleanString(base?.career?.desiredSalary),
    },
    education: {
      school: cleanString(base?.education?.school),
      degree: cleanString(base?.education?.degree),
      majorField: cleanString(base?.education?.majorField),
      graduationAt: cleanString(base?.education?.graduationAt),
    },
    workAuth: {
      authorized: base?.workAuth?.authorized ?? false,
      needsSponsorship: base?.workAuth?.needsSponsorship ?? false,
    },
    preferences: base?.preferences ?? {},
    defaultAnswers: base?.defaultAnswers ?? {},
  };
}

function buildBaseInfoPayload(base: BaseInfo): BaseInfo {
  const cleaned = cleanBaseInfo(base);
  return { ...cleaned, contact: { ...cleaned.contact, phone: formatPhone(cleaned.contact) } };
}

function formatScore(score?: number) {
  if (typeof score === "number" && Number.isFinite(score)) {
    return score.toFixed(2);
  }
  if (typeof score === "number") return String(score);
  return "N/A";
}

function ordinal(n: number) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function StatTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-slate-700 leading-snug">
        {label}
      </div>
      <div className="text-lg font-semibold leading-tight">{value}</div>
      {helper && <div className="text-[11px] text-slate-500">{helper}</div>}
    </div>
  );
}

function TriangleIcon({ direction }: { direction: "down" | "left" }) {
  const rotation = direction === "down" ? "rotate-0" : "rotate-90";
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 fill-current ${rotation}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 16.5 5 7.5h14z" />
    </svg>
  );
}

function EditableRow({
  label,
  value,
  editing,
  children,
}: {
  label: string;
  value: string;
  editing: boolean;
  children?: ReactNode;
  }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-700">
        <span>{label}</span>
        {!editing && <span className="text-[10px] text-slate-500">View</span>}
      </div>
      <div className="mt-2 text-sm text-slate-900">
        {editing ? (children ?? value ?? "N/A") : value ?? "N/A"}
      </div>
    </div>
  );
}

function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "N/A";
  }
}
