export type UserRole = 'ADMIN' | 'MANAGER' | 'BIDDER' | 'OBSERVER';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  isActive: boolean;
  password?: string;
}

export type CalendarProvider = 'MICROSOFT' | 'GOOGLE';

export interface ProfileAccount {
  id: string;
  profileId: string;
  provider: CalendarProvider;
  email: string;
  displayName?: string | null;
  timezone?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  lastSyncAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProfileAccountWithProfile = ProfileAccount & {
  profileDisplayName?: string | null;
  profileAssignedBidderId?: string | null;
};

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay?: boolean;
  organizer?: string;
  location?: string;
}

export interface BaseInfo extends Record<string, unknown> {
  name?: { first?: string; last?: string };
  contact?: {
    email?: string;
    phone?: string;
    phoneCode?: string;
    phoneNumber?: string;
  };
  links?: Record<string, string> & { linkedin?: string };
  location?: {
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  career?: {
    jobTitle?: string;
    currentCompany?: string;
    yearsExp?: number | string;
    desiredSalary?: string;
  };
  education?: {
    school?: string;
    degree?: string;
    majorField?: string;
    graduationAt?: string;
  };
  workAuth?: { authorized?: boolean; needsSponsorship?: boolean };
  preferences?: Record<string, unknown>;
  defaultAnswers?: Record<string, string>;
}

export interface LabelAlias {
  id: string;
  canonicalKey: string;
  alias: string;
  normalizedAlias: string;
  isBuiltin?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Profile {
  id: string;
  displayName: string;
  baseInfo: BaseInfo;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  assignedBidderId?: string | null;
  assignedBy?: string | null;
  assignedAt?: string | null;
}

export interface Resume {
  id: string;
  profileId: string;
  label: string;
  filePath: string;
  resumeText?: string;
  resumeDescription?: string;
  createdAt: string;
}

export interface Assignment {
  id: string;
  profileId: string;
  bidderUserId: string;
  assignedBy: string;
  assignedAt: string;
  unassignedAt?: string | null;
}

export type SessionStatus =
  | 'OPEN'
  | 'ANALYZED'
  | 'FILLED'
  | 'SUBMITTED'
  | 'ABANDONED'
  | 'ERROR';

export interface ApplicationSession {
  id: string;
  bidderUserId: string;
  profileId: string;
  url: string;
  domain?: string;
  status: SessionStatus;
  recommendedResumeId?: string;
  selectedResumeId?: string;
  jobContext?: Record<string, unknown>;
  formSchema?: Record<string, unknown>;
  fillPlan?: Record<string, unknown>;
  startedAt: string;
  endedAt?: string;
}

export interface ApplicationEvent {
  id: string;
  sessionId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface ApplicationRecord {
  id: string;
  sessionId: string;
  bidderUserId: string;
  profileId: string;
  resumeId?: string | null;
  url: string;
  domain?: string | null;
  createdAt: string;
}

export interface ApplicationSummary {
  id: string;
  sessionId: string;
  bidderUserId?: string | null;
  bidderName?: string | null;
  bidderEmail?: string | null;
  profileId?: string | null;
  profileDisplayName?: string | null;
  resumeId?: string | null;
  resumeLabel?: string | null;
  url?: string | null;
  domain?: string | null;
  createdAt: string;
}

export type LlmProvider = 'OPENAI' | 'HUGGINGFACE';

export interface LlmSettings {
  id: string;
  ownerType: 'ORG' | 'USER';
  ownerId: string;
  provider: LlmProvider;
  encryptedApiKey: string;
  chatModel: string;
  embedModel: string;
  updatedAt: string;
}

export type CommunityThreadType = 'CHANNEL' | 'DM';

export interface CommunityThread {
  id: string;
  threadType: CommunityThreadType;
  name?: string | null;
  description?: string | null;
  createdBy?: string | null;
  isPrivate: boolean;
  createdAt: string;
  lastMessageAt?: string | null;
}

export interface CommunityThreadParticipant {
  id: string;
  name: string;
  email: string;
}

export interface CommunityThreadSummary {
  id: string;
  threadType: CommunityThreadType;
  name?: string | null;
  description?: string | null;
  isPrivate: boolean;
  createdAt: string;
  lastMessageAt?: string | null;
  participants?: CommunityThreadParticipant[];
}

export interface CommunityMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  createdAt: string;
}
