'use client';
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, API_BASE } from "../../../lib/api";
import { useAuth } from "../../../lib/useAuth";
import ManagerShell from "../../../components/ManagerShell";

type BaseInfo = {
  name?: { first?: string; last?: string };
  contact?: { email?: string; phone?: string };
  location?: { city?: string; country?: string };
  workAuth?: { authorized?: boolean; needsSponsorship?: boolean };
  links?: Record<string, string>;
  defaultAnswers?: Record<string, string>;
};

type Profile = {
  id: string;
  displayName: string;
  baseInfo: BaseInfo;
  createdAt: string;
  updatedAt: string;
};

type Resume = {
  id: string;
  profileId: string;
  label: string;
  filePath?: string;
  resumeText?: string;
  createdAt: string;
};

type Assignment = {
  id: string;
  profileId: string;
  bidderUserId: string;
  assignedBy: string;
  assignedAt: string;
  unassignedAt?: string | null;
};

type User = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "BIDDER" | "OBSERVER";
  isActive?: boolean;
};

export default function ManagerProfilesPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [bidders, setBidders] = useState<User[]>([]);
  const [draftBase, setDraftBase] = useState<BaseInfo>({});
  const [newResumeLabel, setNewResumeLabel] = useState("");
  const [newResumeFile, setNewResumeFile] = useState<File | null>(null);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [viewResume, setViewResume] = useState<Resume | null>(null);
  const [viewUrl, setViewUrl] = useState<string>("");
  const [viewError, setViewError] = useState<string>("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingResumeId, setSavingResumeId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignBidderId, setAssignBidderId] = useState<string>("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    displayName: "",
    firstName: "",
    lastName: "",
    email: "",
  });

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedId),
    [profiles, selectedId],
  );
  const activeAssignment = useMemo(
    () => assignments.find((a) => a.profileId === selectedId && !a.unassignedAt),
    [assignments, selectedId],
  );

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
    void loadProfiles(token);
    void loadBidders(token);
    void loadAssignments(token);
  }, [loading, user, token, router]);

  useEffect(() => {
    if (!selectedProfile || !token) return;
    setDraftBase(cleanBaseInfo(selectedProfile.baseInfo));
    void loadResumes(selectedProfile.id, token);
    setEditing(false);
    if (activeAssignment) {
      setAssignBidderId(activeAssignment.bidderUserId);
    } else if (bidders[0]) {
      setAssignBidderId(bidders[0].id);
    }
  }, [selectedProfile, token]);

  async function loadProfiles(authToken: string) {
    try {
      const list = await api<Profile[]>("/profiles", undefined, authToken);
      setProfiles(list);
      setSelectedId("");
      setDetailOpen(false);
      setAddOpen(false);
    } catch (err) {
      console.error(err);
      setError("Failed to load profiles.");
    }
  }

  async function loadResumes(profileId: string, authToken: string) {
    try {
      const list = await api<Resume[]>(`/profiles/${profileId}/resumes`, undefined, authToken);
      setResumes(list);
    } catch (err) {
      console.error(err);
      setError("Failed to load resumes.");
    }
  }

  async function loadAssignments(authToken: string) {
    try {
      const list = await api<Assignment[]>("/assignments", undefined, authToken);
      setAssignments(list);
    } catch (err) {
      console.error(err);
      setError("Failed to load assignments.");
    }
  }

  async function loadBidders(authToken: string) {
    try {
      const list = await api<User[]>("/users", undefined, authToken);
      const filtered = list.filter((u) => u.role === "BIDDER" && u.isActive !== false);
      setBidders(filtered);
      if (!assignBidderId && filtered[0]) setAssignBidderId(filtered[0].id);
    } catch (err) {
      console.error(err);
      setError("Failed to load bidders.");
    }
  }

  async function handleSaveProfile() {
    if (!selectedProfile || !token) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api<Profile>(
        `/profiles/${selectedProfile.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            displayName: selectedProfile.displayName,
            baseInfo: draftBase,
          }),
        },
        token,
      );
      setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setEditing(false);
    } catch (err) {
      console.error(err);
      setError("Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddResume() {
    if (!selectedProfile || !token || !newResumeLabel.trim()) return;
    setSavingResumeId("new");
    setError("");
    try {
      let fileData: string | undefined;
      let fileName: string | undefined;
      if (newResumeFile) {
        fileName = newResumeFile.name;
        fileData = await readFileAsBase64(newResumeFile);
      }
      const created = await api<Resume>(
        `/profiles/${selectedProfile.id}/resumes`,
        {
          method: "POST",
          body: JSON.stringify({ label: newResumeLabel.trim(), fileData, fileName }),
        },
        token,
      );
      setResumes((prev) => [created, ...prev]);
      setNewResumeLabel("");
      setNewResumeFile(null);
      setShowResumeModal(false);
    } catch (err) {
      console.error(err);
      setError("Failed to add resume.");
    } finally {
      setSavingResumeId(null);
    }
  }

  useEffect(() => {
    if (!viewResume || !token) {
      if (viewUrl) {
        URL.revokeObjectURL(viewUrl);
        setViewUrl("");
      }
      setViewError("");
      return;
    }
    let revokeUrl = "";
    let cancelled = false;
    const load = async () => {
      try {
        setViewError("");
        setViewUrl("");
        const res = await fetch(`${API_BASE}/resumes/${viewResume.id}/file`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          setViewError("Unable to load resume file.");
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revokeUrl = url;
        setViewUrl(url);
      } catch (err) {
        console.error(err);
        setViewError("Unable to load resume file.");
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [viewResume, token]);

  async function handleRemoveResume(resumeId: string) {
    if (!selectedProfile || !token) return;
    setSavingResumeId(resumeId);
    setError("");
    try {
      await api(`/profiles/${selectedProfile.id}/resumes/${resumeId}`, { method: "DELETE" }, token);
      setResumes((prev) => prev.filter((r) => r.id !== resumeId));
    } catch (err) {
      console.error(err);
      setError("Failed to remove resume.");
    } finally {
      setSavingResumeId(null);
    }
  }

  const draft = cleanBaseInfo(draftBase);
  const creatingDisabled =
    createLoading || !createForm.displayName.trim() || createForm.displayName.trim().length < 2;

  return (
    <ManagerShell>
      <div className="grid gap-6 lg:grid-cols-[280px,1fr]">
        <aside className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Profiles</div>
            <button
              onClick={() => {
                setAddOpen(true);
                setDetailOpen(false);
                setSelectedId("");
                setCreateForm({ displayName: "", firstName: "", lastName: "", email: "" });
              }}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
            >
              Add profile
            </button>
          </div>
          <div className="space-y-2">
            {profiles.length === 0 ? (
              <div className="text-sm text-slate-600">No profiles available.</div>
            ) : (
              profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedId(p.id);
                    setDetailOpen(true);
                  }}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                    selectedId === p.id
                      ? "bg-slate-100 text-slate-900 border border-slate-200"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <div className="font-semibold">{p.displayName}</div>
                  <div className="text-xs text-slate-500">
                    Updated {new Date(p.updatedAt).toLocaleDateString()}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="space-y-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {showResumeModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
              <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-slate-900">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Add resume</p>
                    <p className="text-sm text-slate-600">Upload a resume file and label it.</p>
                  </div>
                  <button
                    onClick={() => {
                      if (savingResumeId === "new") return;
                      setShowResumeModal(false);
                      setNewResumeLabel("");
                      setNewResumeFile(null);
                    }}
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  <label className="space-y-1 text-sm">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-600">Label</span>
                    <input
                      value={newResumeLabel}
                      onChange={(e) => setNewResumeLabel(e.target.value)}
                      placeholder="e.g. Backend resume"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-transparent focus:ring-slate-300"
                    />
                  </label>
                  <div className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-600">File</span>
                    <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-700 hover:border-slate-400 hover:bg-slate-100 transition cursor-pointer">
                      <span className="text-sm font-semibold">
                        {newResumeFile ? "Replace resume file" : "Click to choose or drop file"}
                      </span>
                      <span className="text-xs text-slate-500">PDF, DOC, DOCX, or TXT up to ~5MB</span>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.txt"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          setNewResumeFile(file);
                          if (file && !newResumeLabel.trim()) {
                            const base = file.name.replace(/\.[^/.]+$/, "");
                            setNewResumeLabel(base);
                          }
                        }}
                        className="hidden"
                      />
                      {newResumeFile && (
                        <div className="rounded-full bg-white px-3 py-1 text-xs text-slate-800 border border-slate-200">
                          {newResumeFile.name} ({Math.max(1, Math.round(newResumeFile.size / 1024))} KB)
                        </div>
                      )}
                    </label>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={() => {
                      if (savingResumeId === "new") return;
                      setShowResumeModal(false);
                      setNewResumeLabel("");
                      setNewResumeFile(null);
                    }}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-800 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddResume}
                    disabled={
                      savingResumeId === "new" ||
                      !newResumeLabel.trim() ||
                      newResumeLabel.trim().length < 2 ||
                      !newResumeFile
                    }
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingResumeId === "new" ? "Uploading..." : "Save resume"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {addOpen && (
            <div
              className="fixed top-0 right-0 z-50 h-full w-full max-w-2xl transform border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300"
            >
              <div className="flex h-full flex-col overflow-y-auto p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Create profile</p>
                    <h1 className="text-2xl font-semibold text-slate-900">New profile</h1>
                    <p className="text-sm text-slate-600">Provide display name and optional contact info.</p>
                  </div>
                  <button
                    onClick={() => setAddOpen(false)}
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  <LabeledInput
                    label="Display name*"
                    value={createForm.displayName}
                    onChange={(v) => setCreateForm((f) => ({ ...f, displayName: v }))}
                  />
                  <LabeledInput
                    label="Email"
                    value={createForm.email}
                    onChange={(v) => setCreateForm((f) => ({ ...f, email: v }))}
                  />
                  <LabeledInput
                    label="First name"
                    value={createForm.firstName}
                    onChange={(v) => setCreateForm((f) => ({ ...f, firstName: v }))}
                  />
                  <LabeledInput
                    label="Last name"
                    value={createForm.lastName}
                    onChange={(v) => setCreateForm((f) => ({ ...f, lastName: v }))}
                  />
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    onClick={() => setAddOpen(false)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-800 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateProfile}
                    disabled={creatingDisabled}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {createLoading ? "Creating..." : "Save profile"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div
            className={`fixed top-0 right-0 z-40 h-full w-full max-w-2xl transform border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ${
              detailOpen ? "translate-x-0" : "translate-x-full"
            }`}
          >
            {selectedProfile ? (
              <div className="flex h-full flex-col overflow-y-auto p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Profile</p>
                    <h1 className="text-2xl font-semibold text-slate-900">
                      {selectedProfile.displayName}
                    </h1>
                    <p className="text-sm text-slate-600">
                      Manage core details and contact information.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {editing ? (
                      <>
                        <button
                          onClick={handleSaveProfile}
                          disabled={saving}
                          className="rounded-xl bg-[#4ade80] px-4 py-2 text-sm font-semibold text-[#0b1224] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {saving ? "Saving..." : "Save profile"}
                        </button>
                        <button
                          onClick={() => {
                            setDraftBase(cleanBaseInfo(selectedProfile.baseInfo));
                            setNewResumeLabel("");
                            setEditing(false);
                          }}
                          className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-800 hover:bg-slate-100"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setEditing(true)}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-800 hover:bg-slate-100"
                      >
                        Edit details
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                        Assignment
                      </p>
                      <p className="text-sm text-slate-600">
                        Link this profile to an active bidder.
                      </p>
                    </div>
                    <div className="text-xs text-slate-500">
                      {activeAssignment
                        ? `Assigned since ${new Date(activeAssignment.assignedAt).toLocaleDateString()}`
                        : "Unassigned"}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <select
                      value={assignBidderId}
                      onChange={(e) => setAssignBidderId(e.target.value)}
                      className="w-full md:w-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-transparent focus:ring-slate-300"
                    >
                      {bidders.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.email})
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={handleAssign}
                        disabled={assignLoading || !assignBidderId}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {assignLoading ? "Saving..." : activeAssignment ? "Update" : "Assign"}
                      </button>
                      {activeAssignment && (
                        <button
                          onClick={() => handleUnassign(activeAssignment.id)}
                          disabled={assignLoading}
                          className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Unassign
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  {editing ? (
                    <>
                      <LabeledInput
                        label="First name"
                        value={draft.name?.first ?? ""}
                        onChange={(v) => updateBase("name.first", v)}
                      />
                      <LabeledInput
                        label="Last name"
                        value={draft.name?.last ?? ""}
                        onChange={(v) => updateBase("name.last", v)}
                      />
                      <LabeledInput
                        label="Email"
                        value={draft.contact?.email ?? ""}
                        onChange={(v) => updateBase("contact.email", v)}
                      />
                      <LabeledInput
                        label="Phone"
                        value={draft.contact?.phone ?? ""}
                        onChange={(v) => updateBase("contact.phone", v)}
                      />
                      <LabeledInput
                        label="City"
                        value={draft.location?.city ?? ""}
                        onChange={(v) => updateBase("location.city", v)}
                      />
                      <LabeledInput
                        label="Country"
                        value={draft.location?.country ?? "—"}
                        onChange={(v) => updateBase("location.country", v)}
                      />
                      <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.workAuth?.authorized)}
                          onChange={(e) => updateBase("workAuth.authorized", e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-[#0b1224]"
                        />
                        Authorized to work
                      </label>
                    </>
                  ) : (
                    <>
                      <ReadRow label="First name" value={draft.name?.first ?? "â€”"} />
                      <ReadRow label="Last name" value={draft.name?.last ?? "â€”"} />
                      <ReadRow label="Email" value={draft.contact?.email ?? "â€”"} />
                      <ReadRow label="Phone" value={draft.contact?.phone ?? "â€”"} />
                      <ReadRow label="City" value={draft.location?.city ?? "â€”"} />
                      <ReadRow label="Country" value={draft.location?.country ?? "—"} />
                      <ReadRow
                        label="Authorized to work"
                        value={draft.workAuth?.authorized ? "Yes" : "No"}
                      />
                    </>
                  )}
                </div>

                <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                        Resumes
                      </p>
                      <p className="text-sm text-slate-600">Add or remove profile resumes.</p>
                    </div>
                    <button
                      onClick={() => setShowResumeModal(true)}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                    >
                      Add resume
                    </button>
                  </div>
                  <div className="space-y-2">
                    {resumes.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-600">
                        No resumes yet.
                      </div>
                    ) : (
                    resumes.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800"
                      >
                        <button onClick={() => setViewResume(r)} className="text-left">
                          <div className="font-semibold text-slate-900 underline">{r.label}</div>
                          <div className="text-xs text-slate-500">
                            Added {new Date(r.createdAt).toLocaleDateString()}
                          </div>
                        </button>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setViewResume(r)}
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-800 hover:bg-slate-100"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleRemoveResume(r.id)}
                            disabled={savingResumeId === r.id}
                            className="text-xs text-red-500 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savingResumeId === r.id ? "Removing..." : "Remove"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              </div>
            ) : null}
          </div>

          {viewResume && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
              onClick={() => {
                setViewResume(null);
                if (viewUrl) URL.revokeObjectURL(viewUrl);
                setViewUrl("");
                setViewError("");
              }}
            >
              <div
                className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-slate-900"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Resume</p>
                    <h2 className="text-xl font-semibold text-slate-900">{viewResume.label}</h2>
                  </div>
                  <button
                    onClick={() => {
                      setViewResume(null);
                      if (viewUrl) URL.revokeObjectURL(viewUrl);
                      setViewUrl("");
                      setViewError("");
                    }}
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {viewResume.resumeText && viewResume.resumeText.trim()
                      ? viewResume.resumeText
                      : "No extracted text available for this resume."}
                  </div>
                  <div className="h-[520px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    {viewError ? (
                      <div className="flex h-full items-center justify-center text-sm text-red-500">
                        {viewError}
                      </div>
                    ) : viewUrl ? (
                      <iframe
                        src={viewUrl}
                        className="h-full w-full bg-white"
                        title={viewResume.label}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-600">
                        Loading PDF...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {detailOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/30"
              onClick={() => {
                setDetailOpen(false);
                setEditing(false);
              }}
            />
          )}
          {addOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/30"
              onClick={() => setAddOpen(false)}
            />
          )}
        </section>
      </div>
    </ManagerShell>
  );

  async function handleAssign() {
    if (!selectedProfile || !assignBidderId || !token || !user) return;
    setAssignLoading(true);
    setError("");
    try {
      await api(
        "/assignments",
        {
          method: "POST",
          body: JSON.stringify({
            profileId: selectedProfile.id,
            bidderUserId: assignBidderId,
            assignedBy: user.id,
          }),
        },
        token,
      );
      await loadAssignments(token);
    } catch (err) {
      console.error(err);
      setError("Failed to assign profile.");
    } finally {
      setAssignLoading(false);
    }
  }

  async function handleCreateProfile() {
    if (!token || !user) return;
    if (!createForm.displayName.trim()) return;
    setCreateLoading(true);
    setError("");
    try {
      const created = await api<Profile>(
        "/profiles",
        {
          method: "POST",
          body: JSON.stringify({
            displayName: createForm.displayName.trim(),
            firstName: createForm.firstName.trim() || undefined,
            lastName: createForm.lastName.trim() || undefined,
            email: createForm.email.trim() || undefined,
          }),
        },
        token,
      );
      await loadProfiles(token);
      setSelectedId(created.id);
      setDetailOpen(true);
      setAddOpen(false);
    } catch (err) {
      console.error(err);
      setError("Failed to create profile.");
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleUnassign(assignmentId: string) {
    if (!token) return;
    setAssignLoading(true);
    setError("");
    try {
      await api(`/assignments/${assignmentId}/unassign`, { method: "POST", body: "{}" }, token);
      await loadAssignments(token);
      setAssignBidderId(bidders[0]?.id ?? "");
    } catch (err) {
      console.error(err);
      setError("Failed to unassign profile.");
    } finally {
      setAssignLoading(false);
    }
  }

  function updateBase(path: string, value: string | boolean) {
    setDraftBase((prev) => {
      const next = cleanBaseInfo(prev);
      if (path.startsWith("name.")) {
        const key = path.split(".")[1];
        next.name = { ...(next.name ?? {}), [key]: value as string };
      } else if (path.startsWith("contact.")) {
        const key = path.split(".")[1];
        next.contact = { ...(next.contact ?? {}), [key]: value as string };
      } else if (path.startsWith("location.")) {
        const key = path.split(".")[1];
        next.location = { ...(next.location ?? {}), [key]: value as string };
      } else if (path === "workAuth.authorized") {
        next.workAuth = { ...(next.workAuth ?? {}), authorized: Boolean(value) };
      }
      return next;
    });
  }
}

function cleanBaseInfo(base: BaseInfo): BaseInfo {
  return {
    name: { first: base?.name?.first ?? "", last: base?.name?.last ?? "" },
    contact: { email: base?.contact?.email ?? "", phone: base?.contact?.phone ?? "" },
    location: { city: base?.location?.city ?? "", country: base?.location?.country ?? "" },
    workAuth: { authorized: base?.workAuth?.authorized ?? false, needsSponsorship: base?.workAuth?.needsSponsorship ?? false },
    links: base?.links ?? {},
    defaultAnswers: base?.defaultAnswers ?? {},
  };
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-[0.18em] text-slate-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-transparent focus:ring-slate-300"
      />
    </label>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-slate-900">{value || "—"}</div>
    </div>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const [, data] = result.split(",");
        resolve(data ?? "");
      } else {
        reject(new Error("Unable to read file"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
