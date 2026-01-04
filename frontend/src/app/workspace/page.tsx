'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import TopNav from "../../components/TopNav";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const CONNECT_TIMEOUT_MS = 20000;
const CHECK_TIMEOUT_MS = 10000;
type DesktopBridge = {
  isElectron?: boolean;
  openJobWindow?: (url: string) => Promise<{ ok?: boolean; error?: string } | void>;
};

type WebviewHandle = HTMLElement & {
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
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
  actions?: FillPlanAction[];
};

type FillPlanAction = {
  field?: string;
  field_id?: string;
  label?: string;
  selector?: string | null;
  action?: "fill" | "select" | "check" | "uncheck" | "click" | "upload" | "skip";
  value?: string;
  confidence?: number;
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

type ApplicationPhraseResponse = {
  phrases: string[];
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
  const [fillPlan, setFillPlan] = useState<FillPlan | null>(null);
  const [capturedFields, setCapturedFields] = useState<PageFieldCandidate[]>([]);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [streamFrame, setStreamFrame] = useState<string>("");
  const [status, setStatus] = useState<string>("Disconnected");
  const [loadingAction, setLoadingAction] = useState<string>("");
  const [streamConnected, setStreamConnected] = useState(false);
  const [analyzePopup, setAnalyzePopup] = useState<AnalyzePopupState | null>(null);
  const [useAiAnalyze, setUseAiAnalyze] = useState(false);
  const [applicationPhrases, setApplicationPhrases] = useState<string[]>([]);
  const [showBaseInfo, setShowBaseInfo] = useState(false);
  const [baseInfoView, setBaseInfoView] = useState<BaseInfo>(() => cleanBaseInfo({}));
  const [webviewStatus, setWebviewStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [checkEnabled, setCheckEnabled] = useState(false);
  const webviewRef = useRef<WebviewHandle | null>(null);
  const [isClient, setIsClient] = useState(false);
  const router = useRouter();
  const showError = useCallback((message: string) => {
    if (!message) return;
    if (typeof window !== "undefined") {
      window.alert(message);
    }
  }, []);
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

  useEffect(() => {
    if (!user) return;
    const loadPhrases = async () => {
      try {
        const data = (await api("/application-phrases")) as ApplicationPhraseResponse;
        if (data?.phrases?.length) {
          setApplicationPhrases(data.phrases);
        }
      } catch (err) {
        console.error("Failed to load application phrases", err);
      }
    };
    void loadPhrases();
  }, [user]);

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
  const baseDraft = cleanBaseInfo(baseInfoView);
  const normalizedCheckPhrases = useMemo(() => {
    const merged = new Map<string, string>();
    applicationPhrases.forEach((phrase) => {
      const normalized = normalizeTextForMatch(phrase);
      if (!normalized) return;
      const squished = normalized.replace(/\s+/g, "");
      merged.set(normalized, squished);
    });
    return Array.from(merged.entries()).map(([normalized, squished]) => ({
      normalized,
      squished,
    }));
  }, [applicationPhrases]);
  const canCheck =
    isElectron &&
    Boolean(session) &&
    checkEnabled &&
    session?.status !== "SUBMITTED" &&
    loadingAction !== "check" &&
    loadingAction !== "go";

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
    setStreamFrame("");
    setStreamConnected(false);
    setCheckEnabled(false);
    const base = profiles.find((p) => p.id === selectedProfileId)?.baseInfo;
    setBaseInfoView(cleanBaseInfo(base ?? {}));
    setShowBaseInfo(false);
  }, [selectedProfileId, user, profiles]);

  useEffect(() => {
    if (!session) {
      setStreamFrame("");
      setStreamConnected(false);
      setFrameLoaded(false);
      setCheckEnabled(false);
      return;
    }
    setStreamConnected(false);
    setStreamFrame("");
    setFrameLoaded(false);
    const base = API_BASE.startsWith("http") ? API_BASE : window.location.origin;
    const wsBase = base.replace(/^http/i, "ws");
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
    setCheckEnabled(false);
  }, [url]);

  useEffect(() => {
    if (!isElectron) return;
    setWebviewStatus("loading");
    setCheckEnabled(false);
  }, [browserSrc, isElectron]);

  useEffect(() => {
    if (!isElectron || !webviewRef.current || !browserSrc) return;
    const view = webviewRef.current;
    const handleReady = () => {
      setWebviewStatus("ready");
      setCheckEnabled(true);
    };
    const handleDomReady = () => {
      setWebviewStatus("ready");
      setCheckEnabled(true);
    };
    const handleStop = () => {
      setWebviewStatus("ready");
      setCheckEnabled(true);
    };
    const handleFail = () => {
      setWebviewStatus("failed");
      setCheckEnabled(false);
    };
    const handleStart = () => {
      setWebviewStatus("loading");
      setCheckEnabled(false);
    };
    view.addEventListener("dom-ready", handleDomReady);
    view.addEventListener("did-stop-loading", handleStop);
    view.addEventListener("did-finish-load", handleReady);
    view.addEventListener("did-fail-load", handleFail);
    view.addEventListener("did-start-loading", handleStart);
    return () => {
      view.removeEventListener("dom-ready", handleDomReady);
      view.removeEventListener("did-stop-loading", handleStop);
      view.removeEventListener("did-finish-load", handleReady);
      view.removeEventListener("did-fail-load", handleFail);
      view.removeEventListener("did-start-loading", handleStart);
    };
  }, [isElectron, browserSrc]);

  const collectWebviewText = useCallback(async (): Promise<string> => {
    const view = webviewRef.current;
    if (!view) return "";
    const script = `(() => {
      const readText = (doc) => {
        if (!doc) return '';
        const body = doc.body;
        const inner = body ? body.innerText || '' : '';
        const content = body ? body.textContent || '' : '';
        const title = doc.title || '';
        return [title, inner, content].filter(Boolean).join('\\n');
      };
      const mainText = readText(document);
      const frames = Array.from(document.querySelectorAll('iframe'));
      const frameText = frames
        .map((frame) => {
          try {
            const doc = frame.contentDocument;
            return readText(doc);
          } catch {
            return '';
          }
        })
        .filter(Boolean)
        .join('\\n');
      return [mainText, frameText].filter(Boolean).join('\\n');
    })()`;
    try {
      const result = await view.executeJavaScript(script, true);
      setWebviewStatus("ready");
      return typeof result === "string" ? result : "";
    } catch (err) {
      console.error("Failed to read webview text", err);
      return "";
    }
  }, []);

  const collectWebviewFields = useCallback(async (): Promise<PageFieldCandidate[]> => {
    const view = webviewRef.current;
    if (!view) return [];
    const script = `(() => {
      const fields = [];
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const textOf = (el) => norm(el && (el.textContent || el.innerText || ''));
      const getWin = (el) =>
        (el && el.ownerDocument && el.ownerDocument.defaultView ? el.ownerDocument.defaultView : window);
      const isVisible = (el) => {
        const win = getWin(el);
        const cs = win.getComputedStyle(el);
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const esc = (doc, v) => {
        const css = doc.defaultView && doc.defaultView.CSS;
        return css && css.escape ? css.escape(v) : v.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
      };
      const getLabelText = (el, doc) => {
        try {
          const labels = el.labels;
          if (labels && labels.length) {
            const t = Array.from(labels).map((n) => textOf(n)).filter(Boolean);
            if (t.length) return t.join(' ');
          }
        } catch {
          /* ignore */
        }
        const id = el.getAttribute('id');
        if (id) {
          const lab = doc.querySelector('label[for="' + esc(doc, id) + '"]');
          const t = textOf(lab);
          if (t) return t;
        }
        const wrap = el.closest('label');
        const t2 = textOf(wrap);
        return t2 || '';
      };
      const getAriaName = (el, doc) => {
        const direct = norm(el.getAttribute('aria-label'));
        if (direct) return direct;
        const labelledBy = norm(el.getAttribute('aria-labelledby'));
        if (labelledBy) {
          const parts = labelledBy
            .split(/\\s+/)
            .map((id) => textOf(doc.getElementById(id)))
            .filter(Boolean);
          return norm(parts.join(' '));
        }
        return '';
      };
      let uid = 0;
      const collectFrom = (doc, prefix) => {
        const nodes = Array.from(
          doc.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
        );
        for (const el of nodes) {
          const tag = el.tagName.toLowerCase();
          const typeAttr = (el.getAttribute('type') || '').toLowerCase();
          const isRich = el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox';
          let type = 'text';
          if (tag === 'select') type = 'select';
          else if (tag === 'textarea') type = 'textarea';
          else if (tag === 'input') type = typeAttr || el.type || 'text';
          else if (isRich) type = 'richtext';
          else type = tag;
          if (['submit', 'button', 'reset', 'image', 'hidden', 'file'].includes(type)) continue;
          if (el.disabled) continue;
          if (!isVisible(el)) continue;
          let key = el.getAttribute('data-smartwork-field');
          if (!key) {
            key = 'sw-' + prefix + '-' + uid;
            uid += 1;
            el.setAttribute('data-smartwork-field', key);
          }
          fields.push({
            field_id: el.getAttribute('name') || null,
            id: el.id || null,
            name: el.getAttribute('name') || null,
            label: getLabelText(el, doc) || null,
            ariaName: getAriaName(el, doc) || null,
            placeholder: el.getAttribute('placeholder') || null,
            type: type || null,
            required: Boolean(el.required),
            selector: '[data-smartwork-field="' + key + '"]',
          });
          if (fields.length >= 300) break;
        }
      };
      collectFrom(document, 'main');
      const frames = Array.from(document.querySelectorAll('iframe'));
      frames.forEach((frame, idx) => {
        try {
          const doc = frame.contentDocument;
          if (doc) collectFrom(doc, 'frame' + idx);
        } catch {
          /* ignore */
        }
      });
      return fields;
    })()`;
    try {
      const result = await view.executeJavaScript(script, true);
      setWebviewStatus("ready");
      return Array.isArray(result) ? (result as PageFieldCandidate[]) : [];
    } catch (err) {
      console.error("Failed to read webview fields", err);
      return [];
    }
  }, []);

  const applyAutofillActions = useCallback(async (actions: FillPlanAction[]) => {
    const view = webviewRef.current;
    if (!view || !actions?.length) return null;
    const payload = JSON.stringify(actions);
    const script = `(() => {
      const actions = ${payload};
      const results = { filled: [], blocked: [] };
      const norm = (s) => (s || '').toLowerCase().replace(/\\s+/g, ' ').trim();
      const escAttr = (doc, v) => {
        const css = doc.defaultView && doc.defaultView.CSS;
        return css && css.escape ? css.escape(v) : v.replace(/["\\\\]/g, '\\\\$&');
      };
      const collectDocs = () => {
        const docs = [document];
        const frames = Array.from(document.querySelectorAll('iframe'));
        frames.forEach((frame) => {
          try {
            const doc = frame.contentDocument;
            if (doc) docs.push(doc);
          } catch {
            /* ignore */
          }
        });
        return docs;
      };
      const dispatch = (el) => {
        const win =
          (el.ownerDocument && el.ownerDocument.defaultView ? el.ownerDocument.defaultView : window);
        el.dispatchEvent(new win.Event('input', { bubbles: true }));
        el.dispatchEvent(new win.Event('change', { bubbles: true }));
      };
      const selectOption = (el, value) => {
        const val = String(value ?? '');
        const options = Array.from(el.options || []);
        const exact = options.find((o) => o.value === val || o.label === val);
        const soft = options.find((o) => o.label && o.label.toLowerCase() === val.toLowerCase());
        const match = exact || soft;
        if (match) {
          el.value = match.value;
          dispatch(el);
          return true;
        }
        el.value = val;
        dispatch(el);
        return false;
      };
      const setValue = (el, value) => {
        const val = String(value ?? '');
        if (typeof el.focus === 'function') el.focus();
        if (el.isContentEditable) {
          el.textContent = val;
        } else {
          el.value = val;
        }
        dispatch(el);
      };
      const findByLabel = (doc, label) => {
        if (!label) return null;
        const target = norm(label);
        if (!target) return null;
        const labels = Array.from(doc.querySelectorAll('label'));
        for (const lab of labels) {
          const text = norm(lab.textContent || '');
          if (!text) continue;
          if (text === target || text.includes(target)) {
            if (lab.control) return lab.control;
            const forId = lab.getAttribute('for');
            if (forId) return doc.getElementById(forId);
          }
        }
        return null;
      };
      const findByNameOrId = (doc, value) => {
        if (!value) return null;
        const esc = escAttr(doc, String(value));
        return (
          doc.querySelector('[name="' + esc + '"]') ||
          doc.getElementById(value) ||
          doc.querySelector('#' + esc)
        );
      };
      const findByHint = (doc, hint) => {
        if (!hint) return null;
        const target = norm(hint);
        if (!target) return null;
        const nodes = Array.from(
          doc.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
        );
        for (const el of nodes) {
          const placeholder = norm(el.getAttribute('placeholder'));
          const aria = norm(el.getAttribute('aria-label'));
          const name = norm(el.getAttribute('name'));
          const id = norm(el.getAttribute('id'));
          if ([placeholder, aria, name, id].some((v) => v && v.includes(target))) {
            return el;
          }
        }
        return null;
      };
      const findElement = (doc, step) => {
        let el = null;
        if (step.selector && typeof step.selector === 'string') {
          try {
            el = doc.querySelector(step.selector);
          } catch {
            el = null;
          }
        }
        if (!el) el = findByNameOrId(doc, step.field_id || step.field);
        if (!el) el = findByLabel(doc, step.label);
        if (!el) el = findByHint(doc, step.label || step.field_id || step.field);
        return el;
      };
      const docs = collectDocs();
      for (const step of actions) {
        const action = step.action || 'fill';
        if (action === 'skip') continue;
        let el = null;
        for (const doc of docs) {
          el = findElement(doc, step);
          if (el) break;
        }
        if (!el) {
          results.blocked.push(step.field || step.selector || step.label || 'field');
          continue;
        }
        if (action === 'upload') {
          results.blocked.push(step.field || step.selector || 'upload');
          continue;
        }
        if (action === 'click') {
          el.click();
          results.filled.push({ field: step.field || step.selector || 'field', value: 'click' });
          continue;
        }
        if (action === 'check' || action === 'uncheck') {
          if ('checked' in el) {
            el.checked = action === 'check';
            dispatch(el);
            results.filled.push({ field: step.field || step.selector || 'field', value: action });
          } else {
            results.blocked.push(step.field || step.selector || 'field');
          }
          continue;
        }
        if (action === 'select') {
          if (el.tagName.toLowerCase() === 'select') {
            selectOption(el, step.value);
          } else {
            setValue(el, step.value);
          }
          results.filled.push({ field: step.field || step.selector || 'field', value: String(step.value ?? '') });
          continue;
        }
        if (el.tagName.toLowerCase() === 'select') {
          selectOption(el, step.value);
          results.filled.push({ field: step.field || step.selector || 'field', value: String(step.value ?? '') });
          continue;
        }
        setValue(el, step.value);
        results.filled.push({ field: step.field || step.selector || 'field', value: String(step.value ?? '') });
      }
      return results;
    })()`;
    try {
      const result = await view.executeJavaScript(script, true);
      if (result && typeof result === "object") {
        return result as { filled?: { field: string; value: string }[]; blocked?: string[] };
      }
      return null;
    } catch (err) {
      console.error("Failed to apply autofill in webview", err);
      return null;
    }
  }, []);

  async function handleGo() {
    if (!user || !selectedProfileId || !url) return;
    setLoadingAction("go");
    setCheckEnabled(false);
    try {
      const newSession: ApplicationSession = await withTimeout(
        api("/sessions", {
          method: "POST",
          body: JSON.stringify({
            bidderUserId: user.id,
            profileId: selectedProfileId,
            url,
            selectedResumeId: resumeChoice,
          }),
        }),
        CONNECT_TIMEOUT_MS,
        "Connecting timed out. Please try again."
      );
      setSession(newSession);
      setStatus("Connecting to remote browser...");
      await withTimeout(
        api(`/sessions/${newSession.id}/go`, { method: "POST" }),
        CONNECT_TIMEOUT_MS,
        "Connecting timed out. Please try again."
      );
      setStatus("Connected to remote browser");
      void refreshMetrics();
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Failed to start session. Check backend logs.";
      showError(message);
      setStatus("Connection failed");
    } finally {
      setLoadingAction("");
    }
  }

  async function handleCheck() {
    if (!session) return;
    setLoadingAction("check");
    setCheckEnabled(false);
    let didSubmit = false;
    try {
      if (!isElectron) {
        showError("Check is only available in the desktop app.");
        return;
      }
      if (!webviewRef.current) {
        showError("Embedded browser is not ready yet. Try again in a moment.");
        return;
      }
      if (webviewStatus === "failed") {
        showError("Embedded browser failed to load. Try again or open in a browser tab.");
        return;
      }
      if (!applicationPhrases.length) {
        showError("No check phrases configured. Ask an admin to add them.");
        return;
      }
      const pageText = await withTimeout(
        collectWebviewText(),
        CHECK_TIMEOUT_MS,
        "Check timed out. Please try again."
      );
      const normalizedPage = normalizeTextForMatch(pageText);
      if (!normalizedPage) {
        showError("No text found on the page to check yet.");
        return;
      }
      const squishedPage = normalizedPage.replace(/\s+/g, "");
      const matchedPhrase = normalizedCheckPhrases.find(
        (phrase) =>
          normalizedPage.includes(phrase.normalized) ||
          (phrase.squished && squishedPage.includes(phrase.squished))
      );
      if (!matchedPhrase) {
        showError("No submission confirmation detected yet.");
        return;
      }
      await withTimeout(
        api(`/sessions/${session.id}/mark-submitted`, { method: "POST" }),
        CHECK_TIMEOUT_MS,
        "Check timed out. Please try again."
      );
      setSession({ ...session, status: "SUBMITTED" });
      didSubmit = true;
      if (user?.id) {
        await refreshMetrics(user.id);
      }
    } catch (err) {
      console.error(err);
      showError("Check failed. Backend must be running.");
    } finally {
      setLoadingAction("");
      if (!didSubmit && isElectron && webviewStatus === "ready") {
        setCheckEnabled(true);
      }
    }
  }

  async function handleAnalyze() {
    if (!session) return;
    setLoadingAction("analyze");
    setAnalyzePopup(null);
    try {
      const res = await api(`/sessions/${session.id}/analyze`, {
        method: "POST",
        body: JSON.stringify({ useAi: useAiAnalyze }),
      });
      const result = res as AnalyzeResult;
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
      showError("Analyse failed. Backend must be running.");
    } finally {
      setLoadingAction("");
    }
  }

  async function handleAutofill() {
    if (!session) return;
    setLoadingAction("autofill");
    try {
      const isDesktop = isElectron;
      if (isDesktop && !webviewRef.current) {
        showError("Embedded browser is not ready yet. Try again in a moment.");
        setLoadingAction("");
        return;
      }
      if (isDesktop && webviewStatus === "failed") {
        showError("Embedded browser failed to load. Try again or open in a browser tab.");
        setLoadingAction("");
        return;
      }
      const pageFields = isDesktop ? await collectWebviewFields() : [];
      if (isDesktop && pageFields.length === 0) {
        showError("No form fields detected in the embedded browser. Try again after the form loads.");
        setLoadingAction("");
        return;
      }
      const res = (await api(`/sessions/${session.id}/autofill`, {
        method: "POST",
        body: JSON.stringify({
          selectedResumeId: resumeChoice || undefined,
          useLlm: useLlmAutofill,
          pageFields: isDesktop ? pageFields : undefined,
        }),
      })) as AutofillResponse;
      const canApply = isElectron && Boolean(webviewRef.current) && Boolean(browserSrc);
      if (canApply && res.fillPlan?.actions?.length) {
        await applyAutofillActions(res.fillPlan.actions);
      }
      setSession({
        ...session,
        status: "FILLED",
        selectedResumeId: resumeChoice || session.selectedResumeId,
      });
    } catch (err) {
      console.error(err);
      showError("Autofill failed. Backend must be running.");
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
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 space-y-4">
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
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <button
                    onClick={handleGo}
                    disabled={loadingAction === "go" || !selectedProfileId}
                    className="min-w-[110px] rounded-xl bg-[#4ade80] px-4 py-2 text-sm font-semibold text-[#0b1224] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loadingAction === "go" ? "Connecting..." : "Go"}
                  </button>
                  <button
                    onClick={handleCheck}
                    disabled={!canCheck}
                    className="min-w-[110px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loadingAction === "check" ? "Checking..." : "Check"}
                  </button>
                </div>
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
                      <webview
                        ref={webviewRef as unknown as React.Ref<HTMLWebViewElement>}
                        key={browserSrc}
                        src={browserSrc}
                        partition={webviewPartition}
                        allowpopups={true}
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

function normalizeTextForMatch(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}
