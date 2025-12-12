import { ApplicationEvent, ApplicationSession, Assignment, LlmSettings, Profile, Resume, User } from './types';

// Empty seeds – start from a clean slate.
export const users: User[] = [];
export const profiles: Profile[] = [];
export const resumes: Resume[] = [];
export const assignments: Assignment[] = [];
export const sessions: ApplicationSession[] = [];
export const events: ApplicationEvent[] = [];
export const llmSettings: LlmSettings[] = [];
