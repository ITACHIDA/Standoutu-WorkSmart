'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  contact?: { email?: string; phone?: string };
  links?: Record<string, string>;
  location?: { city?: string; country?: string };
  workAuth?: { authorized?: boolean; needsSponsorship?: boolean };
  defaultAnswers?: Record<string, string>;
};

type Profile = {
  id: string;
  displayName: string;
  baseInfo: BaseInfo;
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

type AnalyzeResult = {
  recommendedResumeId?: string;
  alternatives?: { id: string; label: string }[];
  jobContext?: Record<string, unknown>;
};

type Metrics = {
  tried: number;
  submitted: number;
  appliedPercentage: number;
  monthlyApplied?: number;
  recent: ApplicationSession[];
};

type Assignment = {
  id: string;
  profileId: string;
  bidderUserId: string;
  assignedBy: string;
  assignedAt: string;
  unassignedAt?: string | null;
};

async function api(path: string, init?: RequestInit) {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("smartwork_token") : null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
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
  const [session, setSession] = useState<ApplicationSession | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recommended, setRecommended] = useState<AnalyzeResult | null>(null);
  const [fillPlan, setFillPlan] = useState<FillPlan | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [streamFrame, setStreamFrame] = useState<string>("");
  const [status, setStatus] = useState<string>("Disconnected");
  const [error, setError] = useState<string>("");
  const [loadingAction, setLoadingAction] = useState<string>("");
  const [streamConnected, setStreamConnected] = useState(false);
  const [editingBaseInfo, setEditingBaseInfo] = useState(false);
  const [draftBaseInfo, setDraftBaseInfo] = useState<BaseInfo>({});
  const [webviewStatus, setWebviewStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const webviewRef = useRef<Element | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [allSessions, setAllSessions] = useState<ApplicationSession[]>([]);
  const [assignProfileId, setAssignProfileId] = useState<string>("");
  const [assignBidderId, setAssignBidderId] = useState<string>("");
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
        setToken(storedToken);
      } catch {
        router.replace("/auth");
      }
    } else {
      router.replace("/auth");
    }
  }, [isClient, router]);

  useEffect(() => {
    if (!isClient || !token || !user || user.role === "OBSERVER") return;
    void loadUsers();
  }, [isClient, token, user]);

  useEffect(() => {
    if (!assignProfileId && profiles[0]) {
      setAssignProfileId(profiles[0].id);
    }
  }, [assignProfileId, profiles]);

  useEffect(() => {
    if (assignBidderId) return;
    const bidder = allUsers.find((u) => u.role === "BIDDER");
    if (bidder) setAssignBidderId(bidder.id);
  }, [assignBidderId, allUsers]);

  const desktopBridge: DesktopBridge | undefined =
    isClient && typeof window !== "undefined"
      ? (window as unknown as { smartwork?: DesktopBridge }).smartwork
      : undefined;
  const isElectron = isClient && Boolean(desktopBridge?.openJobWindow);

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId),
    [profiles, selectedProfileId]
  );
  const userById = useMemo(() => {
    const map = new Map<string, User>();
    allUsers.forEach((u) => map.set(u.id, u));
    return map;
  }, [allUsers]);
  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const appliedPct = metrics ? `${metrics.appliedPercentage}%` : "0%";
  const monthlyApplied = metrics?.monthlyApplied ?? 0;

  async function loadResumes(profileId: string) {
    try {
      const data: Resume[] = await api(`/profiles/${profileId}/resumes`);
      setResumes(data);
      if (data[0]) setResumeChoice(data[0].id);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadUsers() {
    try {
      const list: User[] = await api("/users");
      setAllUsers(list);
    } catch (err) {
      console.error(err);
      setError("Unable to load users.");
    }
  }

  const refreshAssignments = useCallback(async () => {
    try {
      const data: Assignment[] = await api("/assignments");
      setAssignments(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const refreshSessions = useCallback(
    async (forUser?: User | null) => {
      try {
        const target = forUser ?? user;
        const query =
          target && target.role === "BIDDER" ? `?bidderUserId=${target.id}` : "";
      const list: ApplicationSession[] = await api(`/sessions${query}`);
        setAllSessions(list);
      } catch (err) {
        console.error(err);
      }
    },
    [user]
  );

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
    setRecommended(null);
    setStreamFrame("");
    setStreamConnected(false);
    setEditingBaseInfo(false);
    const base = profiles.find((p) => p.id === selectedProfileId)?.baseInfo;
    setDraftBaseInfo(base ?? {});
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
      void refreshSessions();
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
    try {
      const res = await api(`/sessions/${session.id}/analyze`, {
        method: "POST",
      });
      setRecommended(res as AnalyzeResult);
      if (res.recommendedResumeId) {
        setResumeChoice(res.recommendedResumeId);
      }
      setSession({ ...session, status: "ANALYZED" });
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
    try {
      const res = await api(`/sessions/${session.id}/autofill`, {
        method: "POST",
      });
      setFillPlan(res.fillPlan);
      setSession({ ...session, status: "FILLED" });
    } catch (err) {
      console.error(err);
      setError("Autofill failed. Backend must be running.");
    } finally {
      setLoadingAction("");
    }
  }

  function updateDraftBaseInfo(path: string, value: string | boolean) {
    setDraftBaseInfo((prev) => {
      const next = { ...prev };
      if (path.startsWith("name.")) {
        const key = path.split(".")[1];
        next.name = { ...(prev.name ?? {}), [key]: value as string };
      } else if (path.startsWith("contact.")) {
        const key = path.split(".")[1];
        next.contact = { ...(prev.contact ?? {}), [key]: value as string };
      } else if (path.startsWith("location.")) {
        const key = path.split(".")[1];
        next.location = { ...(prev.location ?? {}), [key]: value as string };
      } else if (path === "workAuth.authorized") {
        next.workAuth = { ...(prev.workAuth ?? {}), authorized: Boolean(value) };
      }
      return next;
    });
  }

  function handleSaveBaseInfo() {
    if (!selectedProfileId) return;
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === selectedProfileId ? { ...p, baseInfo: draftBaseInfo } : p
      )
    );
    setEditingBaseInfo(false);
  }

  function handleCancelBaseInfo() {
    setDraftBaseInfo(selectedProfile?.baseInfo ?? {});
    setEditingBaseInfo(false);
  }

  async function handleAssignProfileToBidder() {
    if (!assignProfileId || !assignBidderId || !user) return;
    setLoadingAction("assign");
    setError("");
    try {
      await api("/assignments", {
        method: "POST",
        body: JSON.stringify({
          profileId: assignProfileId,
          bidderUserId: assignBidderId,
          assignedBy: user.id,
        }),
      });
      await refreshAssignments();
    } catch (err) {
      console.error(err);
      setError("Failed to assign profile.");
    } finally {
      setLoadingAction("");
    }
  }

  async function handleUnassign(assignmentId: string) {
    setLoadingAction("unassign");
    setError("");
    try {
      await api(`/assignments/${assignmentId}/unassign`, { method: "POST" });
      await refreshAssignments();
    } catch (err) {
      console.error(err);
      setError("Failed to unassign profile.");
    } finally {
      setLoadingAction("");
    }
  }

  const activeAssignments = assignments.filter((a) => !a.unassignedAt);
  const bidderOptions = allUsers.filter((u) => u.role === "BIDDER");

  useEffect(() => {
    const fetchForUser = async () => {
      if (!user || user.role === "OBSERVER") return;
      try {
        const profs: Profile[] = await api(`/profiles?userId=${user.id}`);
        setProfiles(profs);
        const defaultProfileId = profs[0]?.id ?? "";
        setSelectedProfileId(defaultProfileId);
        setAssignProfileId(defaultProfileId);
        void refreshMetrics(user.id);
        void refreshAssignments();
        void refreshSessions(user);
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
  }, [user, refreshMetrics, refreshAssignments, refreshSessions]);

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
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Analyse</p>
                <span className="text-[11px] text-slate-700">Pick best resume</span>
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
                <select
                  value={resumeChoice}
                  onChange={(e) => setResumeChoice(e.target.value)}
                  className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-white/10"
                >
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Autofill</p>
                <span className="text-xs text-slate-700">Hotkey: Ctrl+Shift+F</span>
              </div>
              <button
                onClick={handleAutofill}
                disabled={!session || loadingAction === "autofill"}
                className="w-full rounded-xl bg-[#4ade80] px-4 py-2 text-sm font-semibold text-[#0b1224] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingAction === "autofill" ? "Filling..." : "Autofill"}
              </button>
              <div className="space-y-2 rounded-xl bg-slate-100 px-3 py-3 text-sm text-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-slate-800">Filled</span>
                  <span className="text-xs text-[#5ef3c5]">
                    {fillPlan?.filled?.length ?? 0}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-slate-700">
                  {fillPlan?.filled?.map((f) => (
                    <div key={f.field} className="flex items-center justify-between">
                      <span>{f.field}</span>
                      <span className="text-[#5ef3c5]">{f.value}</span>
                    </div>
                  )) || <div>No fields filled yet.</div>}
                </div>
                {fillPlan?.suggestions?.length ? (
                  <div className="pt-2">
                    <div className="text-xs text-slate-800">Needs review</div>
                    <div className="space-y-1 text-xs text-slate-700">
                      {fillPlan.suggestions.map((s) => (
                        <div key={s.field}>
                          {s.field}: {s.suggestion}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {fillPlan?.blocked?.length ? (
                  <div className="pt-2">
                    <div className="text-xs text-red-300">Blocked</div>
                    <div className="flex flex-wrap gap-1 text-[11px] text-red-200">
                      {fillPlan.blocked.map((b) => (
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
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Profile base info</p>
                {!editingBaseInfo ? (
                  <button
                    className="text-xs text-[#5ef3c5] hover:underline"
                    onClick={() => {
                      setDraftBaseInfo(selectedProfile?.baseInfo ?? {});
                      setEditingBaseInfo(true);
                    }}
                  >
                    Edit
                  </button>
                ) : (
                  <div className="flex gap-2 text-xs">
                    <button
                      className="rounded-lg bg-[#5ef3c5] px-3 py-1 font-semibold text-[#0b1224]"
                      onClick={handleSaveBaseInfo}
                    >
                      Save
                    </button>
                    <button
                      className="rounded-lg bg-white/10 px-3 py-1 text-slate-900"
                      onClick={handleCancelBaseInfo}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-2 text-sm text-slate-800">
                <EditableRow
                  label="Name"
                  editing={editingBaseInfo}
                  value={`${draftBaseInfo?.name?.first ?? ""} ${draftBaseInfo?.name?.last ?? ""}`.trim() || "N/A"}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={draftBaseInfo?.name?.first ?? ""}
                      onChange={(e) => updateDraftBaseInfo("name.first", e.target.value)}
                      placeholder="First"
                      className="rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
                    />
                    <input
                      value={draftBaseInfo?.name?.last ?? ""}
                      onChange={(e) => updateDraftBaseInfo("name.last", e.target.value)}
                      placeholder="Last"
                      className="rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
                    />
                  </div>
                </EditableRow>
                <EditableRow
                  label="Email"
                  editing={editingBaseInfo}
                  value={draftBaseInfo?.contact?.email ?? "N/A"}
                >
                  <input
                    value={draftBaseInfo?.contact?.email ?? ""}
                    onChange={(e) => updateDraftBaseInfo("contact.email", e.target.value)}
                    className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
                  />
                </EditableRow>
                <EditableRow
                  label="Phone"
                  editing={editingBaseInfo}
                  value={draftBaseInfo?.contact?.phone ?? "N/A"}
                >
                  <input
                    value={draftBaseInfo?.contact?.phone ?? ""}
                    onChange={(e) => updateDraftBaseInfo("contact.phone", e.target.value)}
                    className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
                  />
                </EditableRow>
                <EditableRow
                  label="Location"
                  editing={editingBaseInfo}
                  value={
                    draftBaseInfo?.location
                      ? `${draftBaseInfo.location.city ?? ""}, ${draftBaseInfo.location.country ?? ""}`
                      : "N/A"
                  }
                >
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={draftBaseInfo?.location?.city ?? ""}
                      onChange={(e) => updateDraftBaseInfo("location.city", e.target.value)}
                      placeholder="City"
                      className="rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
                    />
                    <input
                      value={draftBaseInfo?.location?.country ?? ""}
                      onChange={(e) => updateDraftBaseInfo("location.country", e.target.value)}
                      placeholder="Country"
                      className="rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
                    />
                  </div>
                </EditableRow>
                <EditableRow
                  label="Work auth"
                  editing={editingBaseInfo}
                  value={
                    draftBaseInfo?.workAuth?.authorized ? "Authorized" : "Unknown"
                  }
                >
                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={Boolean(draftBaseInfo?.workAuth?.authorized)}
                      onChange={(e) =>
                        updateDraftBaseInfo("workAuth.authorized", e.target.checked)
                      }
                      className="h-4 w-4 rounded border-white/30 bg-slate-100"
                    />
                    Authorized to work
                  </label>
                </EditableRow>
              </div>
            </div>
          </section>
        </div>
        ) : (
          <div />
        )}

        {user && (user.role === "ADMIN" || user.role === "MANAGER") && (
          <section className="rounded-3xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-slate-700">
                  Admin & Manager
                </p>
                <p className="text-lg font-semibold">Assignments & oversight</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-800">
                Org visibility
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Assign profile</p>
                  <span className="text-[11px] text-slate-700">Profiles x bidders</span>
                </div>
                <div className="space-y-3 text-sm text-slate-800">
                  <div>
                    <p className="mb-1 text-xs text-slate-700">Profile</p>
                    <select
                      value={assignProfileId}
                      onChange={(e) => setAssignProfileId(e.target.value)}
                      className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-white/10"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-700">Bidder</p>
                    <select
                      value={assignBidderId}
                      onChange={(e) => setAssignBidderId(e.target.value)}
                      className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-white/10"
                    >
                      {bidderOptions.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.email})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={handleAssignProfileToBidder}
                    disabled={loadingAction === "assign" || !assignProfileId || !assignBidderId}
                    className="w-full rounded-xl bg-[#4ade80] px-4 py-2 text-sm font-semibold text-[#0b1224] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loadingAction === "assign" ? "Assigning..." : "Assign now"}
                  </button>
                  <p className="text-[11px] text-slate-500">
                    One active assignment per profile. Reassigning will require unassigning first.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Active assignments</p>
                  <span className="text-[11px] text-slate-700">{activeAssignments.length}</span>
                </div>
                <div className="space-y-2 text-sm text-slate-800 max-h-[280px] overflow-auto pr-1">
                  {activeAssignments.length === 0 ? (
                    <div className="text-xs text-slate-700">No active assignments.</div>
                  ) : (
                    activeAssignments.map((a) => {
                      const prof = profileById.get(a.profileId);
                      const bidder = userById.get(a.bidderUserId);
                      return (
                        <div
                          key={a.id}
                          className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold">{prof?.displayName ?? "Unknown profile"}</p>
                              <p className="text-[11px] text-slate-700">
                                Bidder: {bidder?.name ?? "Unknown"} ({bidder?.email ?? "?"})
                              </p>
                            </div>
                            <button
                              onClick={() => handleUnassign(a.id)}
                              disabled={loadingAction === "unassign"}
                              className="text-[11px] text-red-300 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Unassign
                            </button>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Since {new Date(a.assignedAt).toLocaleDateString()}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Recent sessions</p>
                  <span className="text-[11px] text-slate-700">{allSessions.length}</span>
                </div>
                <div className="space-y-2 text-sm text-slate-800 max-h-[280px] overflow-auto pr-1">
                  {allSessions.length === 0 ? (
                    <div className="text-xs text-slate-700">No sessions yet.</div>
                  ) : (
                    allSessions.slice(0, 6).map((s) => {
                      const bidder = userById.get(s.bidderUserId);
                      return (
                        <div
                          key={s.id}
                          className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold">{safeHostname(s.url)}</p>
                            <span className="rounded-full bg-slate-100lack/40 px-2 py-1 text-[11px] text-slate-800">
                              {s.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-700">
                            {`${bidder?.name ?? "Unknown"} -> ${new Date(s.startedAt ?? "").toLocaleDateString()}`}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
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

function EditableRow({
  label,
  value,
  editing,
  children,
}: {
  label: string;
  value: string;
  editing: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-700">
        <span>{label}</span>
        {!editing && <span className="text-[10px] text-slate-500">View</span>}
      </div>
      <div className="mt-2 text-sm text-slate-900">
        {editing ? children : value || "N/A"}
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





