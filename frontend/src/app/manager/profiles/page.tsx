'use client';
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, API_BASE } from "../../../lib/api";
import { useAuth } from "../../../lib/useAuth";
import ManagerShell from "../../../components/ManagerShell";

type BaseInfo = {
  name?: { first?: string; last?: string };
  contact?: { email?: string; phone?: string; phoneCode?: string; phoneNumber?: string };
  location?: { address?: string; city?: string; state?: string; country?: string; postalCode?: string };
  career?: { jobTitle?: string; currentCompany?: string; yearsExp?: string | number; desiredSalary?: string };
  education?: { school?: string; degree?: string; majorField?: string; graduationAt?: string };
  workAuth?: { authorized?: boolean; needsSponsorship?: boolean };
  links?: Record<string, string> & { linkedin?: string };
  preferences?: Record<string, unknown>;
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
  resumeDescription?: string;
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

type SectionKey = "contact" | "location" | "career" | "education" | "workAuth";

const srOnly = "absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0";

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
  const [newResumeDescription, setNewResumeDescription] = useState("");
  const [newResumeFile, setNewResumeFile] = useState<File | null>(null);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [viewResume, setViewResume] = useState<Resume | null>(null);
  const [viewUrl, setViewUrl] = useState<string>("");
  const [viewError, setViewError] = useState<string>("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [showResumes, setShowResumes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingResumeId, setSavingResumeId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignBidderId, setAssignBidderId] = useState<string>("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState(getEmptyCreateForm());
  const defaultSectionState = {
    contact: { show: false, edit: false },
    location: { show: false, edit: false },
    career: { show: false, edit: false },
    education: { show: false, edit: false },
    workAuth: { show: false, edit: false },
  };
  const [sectionState, setSectionState] = useState(defaultSectionState);
  const toggleSection = (key: SectionKey, field: "show" | "edit") => {
    setSectionState((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: !prev[key][field] },
    }));
  };
  const setSectionEdit = (key: SectionKey, value: boolean) => {
    setSectionState((prev) => ({
      ...prev,
      [key]: { ...prev[key], edit: value },
    }));
  };
  const startSectionEdit = (key: SectionKey) => {
    setSectionState((prev) => ({
      ...prev,
      [key]: { ...prev[key], show: true, edit: true },
    }));
  };
  const resetSectionDraft = (key: SectionKey) => {
    if (!selectedProfile) return;
    const clean = cleanBaseInfo(selectedProfile.baseInfo);
    setDraftBase((prev) => {
      const next = { ...prev };
      switch (key) {
        case "contact":
          next.name = { ...clean.name };
          next.contact = { ...clean.contact };
          next.links = { ...(clean.links ?? {}) };
          break;
        case "location":
          next.location = { ...clean.location };
          break;
        case "career":
          next.career = { ...clean.career };
          break;
        case "education":
          next.education = { ...clean.education };
          break;
        case "workAuth":
          next.workAuth = { ...clean.workAuth };
          break;
        default:
          break;
      }
      return next;
    });
  };
  const cancelSectionEdit = (key: SectionKey) => {
    resetSectionDraft(key);
    setSectionState((prev) => ({
      ...prev,
      [key]: { ...prev[key], edit: false, show: true },
    }));
  };
  const saveSection = (key: SectionKey) => {
    void handleSaveProfile(key);
  };

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
    setSectionState(defaultSectionState);
    setShowResumes(false);
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

  async function handleSaveProfile(sectionKey?: SectionKey) {
    if (!selectedProfile || !token) return;
    setSaving(true);
    setError("");
    try {
      const basePayload = buildBaseInfoPayload(draftBase);
      const updated = await api<Profile>(
        `/profiles/${selectedProfile.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            displayName: selectedProfile.displayName,
            baseInfo: basePayload,
          }),
        },
        token,
      );
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === updated.id ? { ...updated, baseInfo: cleanBaseInfo(updated.baseInfo) } : p,
        ),
      );
      setDraftBase(cleanBaseInfo(updated.baseInfo));
      if (sectionKey) setSectionEdit(sectionKey, false);
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
          body: JSON.stringify({
            label: newResumeLabel.trim(),
            description: newResumeDescription.trim() || undefined,
            fileData,
            fileName,
          }),
        },
        token,
      );
      setResumes((prev) => [created, ...prev]);
      setNewResumeLabel("");
      setNewResumeDescription("");
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
                    setCreateForm(getEmptyCreateForm());
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
                    setSectionState(defaultSectionState);
                    setShowResumes(false);
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

          <div
            className={`fixed top-0 right-0 z-40 h-full w-full max-w-2xl transform border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ${detailOpen ? "translate-x-0" : "translate-x-full"}`}
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
                          {b.name}
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
                  <SectionHeader
                    title="Contact"
                    state={sectionState.contact}
                    onToggleShow={() => toggleSection("contact", "show")}
                    onEdit={() => startSectionEdit("contact")}
                    onSave={() => {
                      if (saving) return;
                      saveSection("contact");
                    }}
                    onCancel={() => cancelSectionEdit("contact")}
                  />
                  {sectionState.contact.show
                    ? sectionState.contact.edit
                      ? (
                        <>
                          <LabeledInput label="First name" value={draft.name?.first ?? ""} onChange={(v) => updateBase("name.first", v)} />
                          <LabeledInput label="Last name" value={draft.name?.last ?? ""} onChange={(v) => updateBase("name.last", v)} />
                          <LabeledInput label="Email" value={draft.contact?.email ?? ""} onChange={(v) => updateBase("contact.email", v)} />
                          <LabeledInput label="Phone code" value={draft.contact?.phoneCode ?? ""} onChange={(v) => updateBase("contact.phoneCode", v)} />
                          <LabeledInput label="Phone number" value={draft.contact?.phoneNumber ?? ""} onChange={(v) => updateBase("contact.phoneNumber", v)} />
                          <LabeledInput label="LinkedIn" value={draft.links?.linkedin ?? ""} onChange={(v) => updateBase("links.linkedin", v)} />
                        </>
                      )
                      : (
                        <>
                          <ReadRow label="First name" value={draft.name?.first ?? "-"} />
                          <ReadRow label="Last name" value={draft.name?.last ?? "-"} />
                          <ReadRow label="Email" value={draft.contact?.email ?? "-"} />
                          <ReadRow label="Phone code" value={draft.contact?.phoneCode ?? "-"} />
                          <ReadRow label="Phone number" value={draft.contact?.phoneNumber ?? "-"} />
                          <ReadRow label="Phone (combined)" value={formatPhone(draft.contact)} />
                          <ReadRow label="LinkedIn" value={draft.links?.linkedin ?? "-"} />
                        </>
                      )
                    : null}

                  <SectionHeader
                    title="Location"
                    state={sectionState.location}
                    onToggleShow={() => toggleSection("location", "show")}
                    onEdit={() => startSectionEdit("location")}
                    onSave={() => {
                      if (saving) return;
                      saveSection("location");
                    }}
                    onCancel={() => cancelSectionEdit("location")}
                  />
                  {sectionState.location.show
                    ? sectionState.location.edit
                      ? (
                        <>
                          <LabeledInput label="Address" value={draft.location?.address ?? ""} onChange={(v) => updateBase("location.address", v)} />
                          <LabeledInput label="City" value={draft.location?.city ?? ""} onChange={(v) => updateBase("location.city", v)} />
                          <LabeledInput label="State / Province" value={draft.location?.state ?? ""} onChange={(v) => updateBase("location.state", v)} />
                          <LabeledInput label="Country" value={draft.location?.country ?? ""} onChange={(v) => updateBase("location.country", v)} />
                          <LabeledInput label="Postal code" value={draft.location?.postalCode ?? ""} onChange={(v) => updateBase("location.postalCode", v)} />
                        </>
                      )
                      : (
                        <>
                          <ReadRow label="Address" value={draft.location?.address ?? "-"} />
                          <ReadRow label="City" value={draft.location?.city ?? "-"} />
                          <ReadRow label="State / Province" value={draft.location?.state ?? "-"} />
                          <ReadRow label="Country" value={draft.location?.country ?? "-"} />
                          <ReadRow label="Postal code" value={draft.location?.postalCode ?? "-"} />
                        </>
                      )
                    : null}

                  <SectionHeader
                    title="Career"
                    state={sectionState.career}
                    onToggleShow={() => toggleSection("career", "show")}
                    onEdit={() => startSectionEdit("career")}
                    onSave={() => {
                      if (saving) return;
                      saveSection("career");
                    }}
                    onCancel={() => cancelSectionEdit("career")}
                  />
                  {sectionState.career.show
                    ? sectionState.career.edit
                      ? (
                        <>
                          <LabeledInput label="Job title" value={draft.career?.jobTitle ?? ""} onChange={(v) => updateBase("career.jobTitle", v)} />
                          <LabeledInput label="Current company" value={draft.career?.currentCompany ?? ""} onChange={(v) => updateBase("career.currentCompany", v)} />
                          <LabeledInput label="Years of experience" value={(draft.career?.yearsExp as string) ?? ""} onChange={(v) => updateBase("career.yearsExp", v)} />
                          <LabeledInput label="Desired salary" value={draft.career?.desiredSalary ?? ""} onChange={(v) => updateBase("career.desiredSalary", v)} />
                        </>
                      )
                      : (
                        <>
                          <ReadRow label="Job title" value={draft.career?.jobTitle ?? "-"} />
                          <ReadRow label="Current company" value={draft.career?.currentCompany ?? "-"} />
                          <ReadRow label="Years of experience" value={(draft.career?.yearsExp as string) ?? "-"} />
                          <ReadRow label="Desired salary" value={draft.career?.desiredSalary ?? "-"} />
                        </>
                      )
                    : null}

                  <SectionHeader
                    title="Education"
                    state={sectionState.education}
                    onToggleShow={() => toggleSection("education", "show")}
                    onEdit={() => startSectionEdit("education")}
                    onSave={() => {
                      if (saving) return;
                      saveSection("education");
                    }}
                    onCancel={() => cancelSectionEdit("education")}
                  />
                  {sectionState.education.show
                    ? sectionState.education.edit
                      ? (
                        <>
                          <LabeledInput label="School" value={draft.education?.school ?? ""} onChange={(v) => updateBase("education.school", v)} />
                          <LabeledInput label="Degree" value={draft.education?.degree ?? ""} onChange={(v) => updateBase("education.degree", v)} />
                          <LabeledInput label="Major / field" value={draft.education?.majorField ?? ""} onChange={(v) => updateBase("education.majorField", v)} />
                          <LabeledInput label="Graduation date" value={draft.education?.graduationAt ?? ""} onChange={(v) => updateBase("education.graduationAt", v)} />
                        </>
                      )
                      : (
                        <>
                          <ReadRow label="School" value={draft.education?.school ?? "-"} />
                          <ReadRow label="Degree" value={draft.education?.degree ?? "-"} />
                          <ReadRow label="Major / field" value={draft.education?.majorField ?? "-"} />
                          <ReadRow label="Graduation date" value={draft.education?.graduationAt ?? "-"} />
                        </>
                      )
                    : null}

                  <SectionHeader
                    title="Authorized to work"
                    state={sectionState.workAuth}
                    onToggleShow={() => toggleSection("workAuth", "show")}
                    onEdit={() => startSectionEdit("workAuth")}
                    onSave={() => {
                      if (saving) return;
                      saveSection("workAuth");
                    }}
                    onCancel={() => cancelSectionEdit("workAuth")}
                  />
                  {sectionState.workAuth.show
                    ? sectionState.workAuth.edit
                      ? (
                        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                          <input
                            type="checkbox"
                            checked={Boolean(draft.workAuth?.authorized)}
                            onChange={(e) => updateBase("workAuth.authorized", e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-[#0b1224]"
                          />
                          Authorized to work
                        </label>
                      )
                      : (
                        <ReadRow
                          label="Authorized to work"
                          value={draft.workAuth?.authorized ? "Yes" : "No"}
                        />
                      )
                    : null}
                </div>

                <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                        Resumes
                      </p>
                      <p className="text-sm text-slate-600">Add or remove profile resumes.</p>
                    </div>
                  <div className="flex items-center gap-2">
                      <IconButton onClick={() => setShowResumes((v) => !v)} title={showResumes ? "Hide resumes" : "Show resumes"}>
                        <TriangleIcon direction={showResumes ? "down" : "left"} />
                        <span className={srOnly}>{showResumes ? "Hide resumes" : "Show resumes"}</span>
                      </IconButton>
                      <IconButton onClick={() => setShowResumeModal(true)} title="Add resume">
                        <PlusIcon />
                        <span className={srOnly}>Add resume</span>
                      </IconButton>
                  </div>
                  </div>
                  {showResumes ? (
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
                              {r.resumeDescription ? (
                                <div className="text-xs text-slate-600 line-clamp-2">{r.resumeDescription}</div>
                              ) : null}
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
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

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
                      setNewResumeDescription("");
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
                  <label className="space-y-1 text-sm">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-600">Description (optional)</span>
                    <textarea
                      value={newResumeDescription}
                      onChange={(e) => setNewResumeDescription(e.target.value)}
                      placeholder="Short summary of this resume version"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-1 ring-transparent focus:ring-slate-300"
                      rows={3}
                    />
                  </label>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={() => {
                      if (savingResumeId === "new") return;
                      setShowResumeModal(false);
                      setNewResumeLabel("");
                      setNewResumeDescription("");
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
                  <LabeledInput
                    label="Phone code"
                    value={createForm.phoneCode}
                    onChange={(v) => setCreateForm((f) => ({ ...f, phoneCode: v }))}
                  />
                  <LabeledInput
                    label="Phone number"
                    value={createForm.phoneNumber}
                    onChange={(v) => setCreateForm((f) => ({ ...f, phoneNumber: v }))}
                  />
                  <LabeledInput
                    label="LinkedIn"
                    value={createForm.linkedin}
                    onChange={(v) => setCreateForm((f) => ({ ...f, linkedin: v }))}
                  />
                  <LabeledInput
                    label="Address"
                    value={createForm.address}
                    onChange={(v) => setCreateForm((f) => ({ ...f, address: v }))}
                  />
                  <LabeledInput
                    label="City"
                    value={createForm.city}
                    onChange={(v) => setCreateForm((f) => ({ ...f, city: v }))}
                  />
                  <LabeledInput
                    label="State/Province"
                    value={createForm.state}
                    onChange={(v) => setCreateForm((f) => ({ ...f, state: v }))}
                  />
                  <LabeledInput
                    label="Country"
                    value={createForm.country}
                    onChange={(v) => setCreateForm((f) => ({ ...f, country: v }))}
                  />
                  <LabeledInput
                    label="Postal code"
                    value={createForm.postalCode}
                    onChange={(v) => setCreateForm((f) => ({ ...f, postalCode: v }))}
                  />
                  <LabeledInput
                    label="Job title"
                    value={createForm.jobTitle}
                    onChange={(v) => setCreateForm((f) => ({ ...f, jobTitle: v }))}
                  />
                  <LabeledInput
                    label="Current company"
                    value={createForm.currentCompany}
                    onChange={(v) => setCreateForm((f) => ({ ...f, currentCompany: v }))}
                  />
                  <LabeledInput
                    label="Years of experience"
                    value={createForm.yearsExp}
                    onChange={(v) => setCreateForm((f) => ({ ...f, yearsExp: v }))}
                  />
                  <LabeledInput
                    label="Desired salary"
                    value={createForm.desiredSalary}
                    onChange={(v) => setCreateForm((f) => ({ ...f, desiredSalary: v }))}
                  />
                  <LabeledInput
                    label="School"
                    value={createForm.school}
                    onChange={(v) => setCreateForm((f) => ({ ...f, school: v }))}
                  />
                  <LabeledInput
                    label="Degree"
                    value={createForm.degree}
                    onChange={(v) => setCreateForm((f) => ({ ...f, degree: v }))}
                  />
                  <LabeledInput
                    label="Major / field"
                    value={createForm.majorField}
                    onChange={(v) => setCreateForm((f) => ({ ...f, majorField: v }))}
                  />
                  <LabeledInput
                    label="Graduation date"
                    value={createForm.graduationAt}
                    onChange={(v) => setCreateForm((f) => ({ ...f, graduationAt: v }))}
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
                  {viewResume.resumeDescription ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                      {viewResume.resumeDescription}
                    </div>
                  ) : null}
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
                setSectionState(defaultSectionState);
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
      const baseInfo = buildBaseInfoPayload({
        name: { first: createForm.firstName, last: createForm.lastName },
        contact: {
          email: createForm.email,
          phoneCode: createForm.phoneCode,
          phoneNumber: createForm.phoneNumber,
        },
        location: {
          address: createForm.address,
          city: createForm.city,
          state: createForm.state,
          country: createForm.country,
          postalCode: createForm.postalCode,
        },
        links: { linkedin: createForm.linkedin },
        career: {
          jobTitle: createForm.jobTitle,
          currentCompany: createForm.currentCompany,
          yearsExp: createForm.yearsExp,
          desiredSalary: createForm.desiredSalary,
        },
        education: {
          school: createForm.school,
          degree: createForm.degree,
          majorField: createForm.majorField,
          graduationAt: createForm.graduationAt,
        },
      });
      const created = await api<Profile>(
        "/profiles",
        {
          method: "POST",
          body: JSON.stringify({
            displayName: createForm.displayName.trim(),
            firstName: createForm.firstName.trim() || undefined,
            lastName: createForm.lastName.trim() || undefined,
            email: createForm.email.trim() || undefined,
            phoneCode: createForm.phoneCode.trim() || undefined,
            phoneNumber: createForm.phoneNumber.trim() || undefined,
            address: createForm.address.trim() || undefined,
            city: createForm.city.trim() || undefined,
            state: createForm.state.trim() || undefined,
            country: createForm.country.trim() || undefined,
            postalCode: createForm.postalCode.trim() || undefined,
            linkedin: createForm.linkedin.trim() || undefined,
            jobTitle: createForm.jobTitle.trim() || undefined,
            currentCompany: createForm.currentCompany.trim() || undefined,
            yearsExp: createForm.yearsExp.trim() || undefined,
            desiredSalary: createForm.desiredSalary.trim() || undefined,
            school: createForm.school.trim() || undefined,
            degree: createForm.degree.trim() || undefined,
            majorField: createForm.majorField.trim() || undefined,
            graduationAt: createForm.graduationAt.trim() || undefined,
            baseInfo,
          }),
        },
        token,
      );
      await loadProfiles(token);
      setSelectedId(created.id);
      setDetailOpen(true);
      setAddOpen(false);
      setCreateForm(getEmptyCreateForm());
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
    switch (path) {
      case "name.first":
        next.name = { ...next.name, first: String(value) };
        break;
      case "name.last":
        next.name = { ...next.name, last: String(value) };
        break;
      case "contact.email":
        next.contact = { ...next.contact, email: String(value) };
        break;
      case "contact.phoneCode":
        next.contact = { ...next.contact, phoneCode: String(value) };
        break;
      case "contact.phoneNumber":
        next.contact = { ...next.contact, phoneNumber: String(value) };
        break;
      case "links.linkedin":
        next.links = { ...(next.links ?? {}), linkedin: String(value) };
        break;
      case "location.address":
        next.location = { ...next.location, address: String(value) };
        break;
      case "location.city":
        next.location = { ...next.location, city: String(value) };
        break;
      case "location.state":
        next.location = { ...next.location, state: String(value) };
        break;
      case "location.country":
        next.location = { ...next.location, country: String(value) };
        break;
      case "location.postalCode":
        next.location = { ...next.location, postalCode: String(value) };
        break;
      case "career.jobTitle":
        next.career = { ...next.career, jobTitle: String(value) };
        break;
      case "career.currentCompany":
        next.career = { ...next.career, currentCompany: String(value) };
        break;
      case "career.yearsExp":
        next.career = { ...next.career, yearsExp: String(value) };
        break;
      case "career.desiredSalary":
        next.career = { ...next.career, desiredSalary: String(value) };
        break;
      case "education.school":
        next.education = { ...next.education, school: String(value) };
        break;
      case "education.degree":
        next.education = { ...next.education, degree: String(value) };
        break;
      case "education.majorField":
        next.education = { ...next.education, majorField: String(value) };
        break;
      case "education.graduationAt":
        next.education = { ...next.education, graduationAt: String(value) };
        break;
      case "workAuth.authorized":
        next.workAuth = { ...(next.workAuth ?? {}), authorized: Boolean(value) };
        break;
      default:
        break;
    }
    if (path.startsWith("contact.")) {
      next.contact = { ...(next.contact ?? {}), phone: formatPhone(next.contact) };
    }
    return next;
  });
}

}

function SectionHeader({
  title,
  state,
  onToggleShow,
  onEdit,
  onSave,
  onCancel,
}: {
  title: string;
  state: { show: boolean; edit: boolean };
  onToggleShow: () => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="md:col-span-2 flex items-center justify-between pt-1">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="flex items-center gap-2 text-xs">
        <IconButton onClick={onToggleShow} title={state.show ? "Hide section" : "Show section"}>
          <TriangleIcon direction={state.show ? "down" : "left"} />
          <span className={srOnly}>{state.show ? "Hide" : "Show"}</span>
        </IconButton>
        {state.edit ? (
          <>
            <IconButton onClick={onSave} title="Save section">
              <CheckIcon />
              <span className={srOnly}>Save</span>
            </IconButton>
            <IconButton onClick={onCancel} title="Cancel editing">
              <CloseIcon />
              <span className={srOnly}>Cancel</span>
            </IconButton>
          </>
        ) : (
          <IconButton onClick={onEdit} title="Edit section">
            <PenIcon />
            <span className={srOnly}>Edit</span>
          </IconButton>
        )}
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 shadow-sm transition hover:bg-slate-100"
    >
      {children}
    </button>
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

function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true" focusable="false">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm18-10.5a1.06 1.06 0 0 0 0-1.5L18.75 3a1.06 1.06 0 0 0-1.5 0l-1.88 1.88 3.75 3.75L21 6.75z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true" focusable="false">
      <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true" focusable="false">
      <path d="M6.225 4.811 4.81 6.225 10.586 12l-5.775 5.775 1.414 1.414L12 13.414l5.775 5.775 1.414-1.414L13.414 12l5.775-5.775-1.414-1.414L12 10.586z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true" focusable="false">
      <path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2z" />
    </svg>
  );
}

function cleanBaseInfo(base: BaseInfo): BaseInfo {
  return {
    name: { first: cleanString(base?.name?.first), last: cleanString(base?.name?.last) },
    contact: {
      email: cleanString(base?.contact?.email),
      phone: formatPhone(base?.contact),
      phoneCode: cleanString(base?.contact?.phoneCode),
      phoneNumber: cleanString(base?.contact?.phoneNumber),
    },
    location: {
      address: cleanString(base?.location?.address),
      city: cleanString(base?.location?.city),
      state: cleanString(base?.location?.state),
      country: cleanString(base?.location?.country),
      postalCode: cleanString(base?.location?.postalCode),
    },
    links: { ...(base?.links ?? {}), linkedin: cleanString(base?.links?.linkedin) },
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
    workAuth: { authorized: base?.workAuth?.authorized ?? false, needsSponsorship: base?.workAuth?.needsSponsorship ?? false },
    preferences: base?.preferences ?? {},
    defaultAnswers: base?.defaultAnswers ?? {},
  };
}

function buildBaseInfoPayload(base: BaseInfo): BaseInfo {
  const cleaned = cleanBaseInfo(base);
  return {
    ...cleaned,
    contact: { ...cleaned.contact, phone: formatPhone(cleaned.contact) },
  };
}

function cleanString(val?: string | number | null) {
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return val.trim();
  return "";
}

function formatPhone(contact?: BaseInfo["contact"]) {
  if (!contact) return "";
  const parts = [contact.phoneCode, contact.phoneNumber]
    .map((p) => cleanString(p))
    .filter(Boolean);
  const combined = parts.join(" ").trim();
  const fallback = cleanString(contact.phone);
  return combined || fallback;
}

function getEmptyCreateForm() {
  return {
    displayName: "",
    firstName: "",
    lastName: "",
    email: "",
    phoneCode: "",
    phoneNumber: "",
    address: "",
    city: "",
    state: "",
    country: "",
    postalCode: "",
    linkedin: "",
    jobTitle: "",
    currentCompany: "",
    yearsExp: "",
    desiredSalary: "",
    school: "",
    degree: "",
    majorField: "",
    graduationAt: "",
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
      <div className="mt-1 text-slate-900">{value || "-"}</div>
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
