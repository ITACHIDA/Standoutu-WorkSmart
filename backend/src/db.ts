import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import {
  ApplicationRecord,
  ApplicationSummary,
  Assignment,
  CommunityMessage,
  CommunityThread,
  CommunityThreadSummary,
  LabelAlias,
  Profile,
  ProfileAccount,
  ProfileAccountWithProfile,
  Resume,
  User,
} from './types';
import {
  APPLICATION_SUCCESS_DEFAULTS,
  APPLICATION_SUCCESS_KEY,
  normalizeLabelAlias,
} from './labelAliases';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        password TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY,
        display_name TEXT NOT NULL,
        base_info JSONB DEFAULT '{}'::jsonb,
        created_by UUID,
        assigned_bidder_id UUID REFERENCES users(id),
        assigned_by UUID REFERENCES users(id),
        assigned_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS resumes (
        id UUID PRIMARY KEY,
        profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        file_path TEXT,
        resume_text TEXT,
        resume_description TEXT,
        resume_json JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        bidder_user_id UUID REFERENCES users(id),
        profile_id UUID REFERENCES profiles(id),
        url TEXT,
        domain TEXT,
        status TEXT,
        recommended_resume_id UUID,
        selected_resume_id UUID,
        job_context JSONB,
        form_schema JSONB,
        fill_plan JSONB,
        started_at TIMESTAMP,
        ended_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS applications (
        id UUID PRIMARY KEY,
        session_id UUID UNIQUE,
        bidder_user_id UUID,
        profile_id UUID,
        resume_id UUID,
        url TEXT,
        domain TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY,
        session_id UUID,
        event_type TEXT,
        payload JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS llm_settings (
        id UUID PRIMARY KEY,
        owner_type TEXT,
        owner_id TEXT,
        provider TEXT,
        encrypted_api_key TEXT,
        chat_model TEXT,
        embed_model TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS label_aliases (
        id UUID PRIMARY KEY,
        canonical_key TEXT NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS profile_accounts (
        id UUID PRIMARY KEY,
        profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'MICROSOFT',
        email TEXT NOT NULL,
        display_name TEXT,
        timezone TEXT DEFAULT 'UTC',
        status TEXT DEFAULT 'ACTIVE',
        last_sync_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (profile_id, email)
      );

      CREATE TABLE IF NOT EXISTS community_threads (
        id UUID PRIMARY KEY,
        thread_type TEXT NOT NULL,
        name TEXT,
        name_key TEXT UNIQUE,
        description TEXT,
        created_by UUID REFERENCES users(id),
        is_private BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        last_message_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS community_thread_members (
        id UUID PRIMARY KEY,
        thread_id UUID REFERENCES community_threads(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        role TEXT DEFAULT 'MEMBER',
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (thread_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS community_messages (
        id UUID PRIMARY KEY,
        thread_id UUID REFERENCES community_threads(id) ON DELETE CASCADE,
        sender_id UUID REFERENCES users(id),
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS seed_flags (
        key TEXT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_profile_accounts_profile ON profile_accounts(profile_id);
      CREATE INDEX IF NOT EXISTS idx_applications_bidder ON applications(bidder_user_id);
      CREATE INDEX IF NOT EXISTS idx_applications_profile ON applications(profile_id);
      CREATE INDEX IF NOT EXISTS idx_community_members_thread ON community_thread_members(thread_id);
      CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_thread_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_community_messages_thread ON community_messages(thread_id);

      -- Backfill schema changes at startup to avoid missing migration runs.
      ALTER TABLE IF EXISTS resumes
        DROP COLUMN IF EXISTS resume_json;

      ALTER TABLE IF EXISTS resumes
        ADD COLUMN IF NOT EXISTS resume_description TEXT;

      ALTER TABLE IF EXISTS profiles
        ADD COLUMN IF NOT EXISTS assigned_bidder_id UUID REFERENCES users(id);
      ALTER TABLE IF EXISTS profiles
        ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES users(id);
      ALTER TABLE IF EXISTS profiles
        ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;

      DROP TABLE IF EXISTS assignments;
    `);

    const seedKey = 'application_phrases_seed';
    const { rows: seedRows } = await client.query<{ key: string }>(
      'SELECT key FROM seed_flags WHERE key = $1',
      [seedKey],
    );
    if (seedRows.length === 0) {
      const { rows: existing } = await client.query<{ id: string }>(
        'SELECT id FROM label_aliases WHERE canonical_key = $1 LIMIT 1',
        [APPLICATION_SUCCESS_KEY],
      );
      if (existing.length === 0) {
        for (const phrase of APPLICATION_SUCCESS_DEFAULTS) {
          const normalized = normalizeLabelAlias(phrase);
          if (!normalized) continue;
          await client.query(
            `
              INSERT INTO label_aliases (id, canonical_key, alias, normalized_alias)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (normalized_alias) DO NOTHING
            `,
            [randomUUID(), APPLICATION_SUCCESS_KEY, phrase, normalized],
          );
        }
      }
      await client.query('INSERT INTO seed_flags (key) VALUES ($1)', [seedKey]);
    }

    const communitySeedKey = 'community_default_channels_seed';
    const { rows: communitySeedRows } = await client.query<{ key: string }>(
      'SELECT key FROM seed_flags WHERE key = $1',
      [communitySeedKey],
    );
    if (communitySeedRows.length === 0) {
      const defaults = [
        {
          name: 'general',
          description: 'Company-wide discussions and daily updates.',
        },
        {
          name: 'announcements',
          description: 'Important notices from the team.',
        },
        {
          name: 'sandbox',
          description: 'Play area to try things out.',
        },
      ];
      for (const channel of defaults) {
        const key = channel.name.trim().toLowerCase();
        if (!key) continue;
        await client.query(
          `
            INSERT INTO community_threads (id, thread_type, name, name_key, description, created_by, is_private)
            VALUES ($1, 'CHANNEL', $2, $3, $4, NULL, FALSE)
            ON CONFLICT (name_key) DO NOTHING
          `,
          [randomUUID(), channel.name.trim(), key, channel.description ?? null],
        );
      }
      await client.query('INSERT INTO seed_flags (key) VALUES ($1)', [communitySeedKey]);
    }

    // No seed data inserted; database starts empty.
  } finally {
    client.release();
  }
}

export async function findUserByEmail(email: string) {
  const { rows } = await pool.query<User>(
    'SELECT id, email, name, role, is_active as "isActive", password FROM users WHERE email = $1',
    [email],
  );
  return rows[0];
}

export async function findUserById(id: string) {
  const { rows } = await pool.query<User>(
    'SELECT id, email, name, role, is_active as "isActive", password FROM users WHERE id = $1',
    [id],
  );
  return rows[0];
}

export async function insertUser(user: User) {
  await pool.query(
    `
      INSERT INTO users (id, email, name, role, password, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, password = EXCLUDED.password, is_active = EXCLUDED.is_active
    `,
    [user.id, user.email, user.name, user.role, user.password ?? 'demo', user.isActive ?? true],
  );
}

export async function insertProfile(profile: {
  id: string;
  displayName: string;
  baseInfo: Record<string, unknown>;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}) {
  await pool.query(
    `
      INSERT INTO profiles (id, display_name, base_info, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      profile.id,
      profile.displayName,
      JSON.stringify(profile.baseInfo ?? {}),
      profile.createdBy ?? null,
      profile.createdAt ?? new Date().toISOString(),
      profile.updatedAt ?? new Date().toISOString(),
    ],
  );
}

export async function insertApplication(record: ApplicationRecord) {
  await pool.query(
    `
      INSERT INTO applications (
        id,
        session_id,
        bidder_user_id,
        profile_id,
        resume_id,
        url,
        domain,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (session_id) DO NOTHING
    `,
    [
      record.id,
      record.sessionId,
      record.bidderUserId,
      record.profileId,
      record.resumeId ?? null,
      record.url,
      record.domain ?? null,
      record.createdAt,
    ],
  );
}

export async function listProfiles(): Promise<Profile[]> {
  const { rows } = await pool.query<Profile>(
    `
      SELECT
        id,
        display_name AS "displayName",
        base_info AS "baseInfo",
        created_by AS "createdBy",
        assigned_bidder_id AS "assignedBidderId",
        assigned_by AS "assignedBy",
        assigned_at AS "assignedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM profiles
      ORDER BY created_at DESC
    `,
  );
  return rows;
}

export async function listProfilesForBidder(bidderUserId: string): Promise<Profile[]> {
  const { rows } = await pool.query<Profile>(
    `
      SELECT
        id,
        display_name AS "displayName",
        base_info AS "baseInfo",
        created_by AS "createdBy",
        assigned_bidder_id AS "assignedBidderId",
        assigned_by AS "assignedBy",
        assigned_at AS "assignedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM profiles
      WHERE assigned_bidder_id = $1
      ORDER BY created_at DESC
    `,
    [bidderUserId],
  );
  return rows;
}

export async function findProfileById(id: string): Promise<Profile | undefined> {
  const { rows } = await pool.query<Profile>(
    `
      SELECT
        id,
        display_name AS "displayName",
        base_info AS "baseInfo",
        created_by AS "createdBy",
        assigned_bidder_id AS "assignedBidderId",
        assigned_by AS "assignedBy",
        assigned_at AS "assignedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM profiles
      WHERE id = $1
    `,
    [id],
  );
  return rows[0];
}

export async function listProfileAccountsForUser(
  actor: User,
  profileId?: string,
): Promise<ProfileAccountWithProfile[]> {
  const { rows } = await pool.query<ProfileAccountWithProfile>(
    `
      SELECT
        pa.id,
        pa.profile_id AS "profileId",
        pa.provider,
        pa.email,
        pa.display_name AS "displayName",
        pa.timezone,
        pa.status,
        pa.last_sync_at AS "lastSyncAt",
        pa.created_at AS "createdAt",
        pa.updated_at AS "updatedAt",
        p.display_name AS "profileDisplayName",
        p.assigned_bidder_id AS "profileAssignedBidderId"
      FROM profile_accounts pa
      JOIN profiles p ON p.id = pa.profile_id
      WHERE
        ($1 = 'ADMIN' OR $1 = 'MANAGER' OR p.assigned_bidder_id = $2)
        AND ($3::uuid IS NULL OR pa.profile_id = $3)
      ORDER BY pa.updated_at DESC, pa.created_at DESC
    `,
    [actor.role, actor.id, profileId ?? null],
  );
  return rows;
}

export async function findProfileAccountById(id: string): Promise<ProfileAccountWithProfile | undefined> {
  const { rows } = await pool.query<ProfileAccountWithProfile>(
    `
      SELECT
        pa.id,
        pa.profile_id AS "profileId",
        pa.provider,
        pa.email,
        pa.display_name AS "displayName",
        pa.timezone,
        pa.status,
        pa.last_sync_at AS "lastSyncAt",
        pa.created_at AS "createdAt",
        pa.updated_at AS "updatedAt",
        p.display_name AS "profileDisplayName",
        p.assigned_bidder_id AS "profileAssignedBidderId"
      FROM profile_accounts pa
      JOIN profiles p ON p.id = pa.profile_id
      WHERE pa.id = $1
      LIMIT 1
    `,
    [id],
  );
  return rows[0];
}

export async function upsertProfileAccount(account: {
  id: string;
  profileId: string;
  provider?: string;
  email: string;
  displayName?: string | null;
  timezone?: string | null;
  status?: string | null;
  lastSyncAt?: string | null;
}): Promise<ProfileAccount> {
  const { rows } = await pool.query<ProfileAccount>(
    `
      INSERT INTO profile_accounts (id, profile_id, provider, email, display_name, timezone, status, last_sync_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (profile_id, email) DO UPDATE
        SET provider = EXCLUDED.provider,
            display_name = EXCLUDED.display_name,
            timezone = EXCLUDED.timezone,
            status = EXCLUDED.status,
            last_sync_at = COALESCE(EXCLUDED.last_sync_at, profile_accounts.last_sync_at),
            updated_at = NOW()
      RETURNING
        id,
        profile_id AS "profileId",
        provider,
        email,
        display_name AS "displayName",
        timezone,
        status,
        last_sync_at AS "lastSyncAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      account.id,
      account.profileId,
      account.provider ?? 'MICROSOFT',
      account.email,
      account.displayName ?? null,
      account.timezone ?? 'UTC',
      account.status ?? 'ACTIVE',
      account.lastSyncAt ?? null,
    ],
  );
  return rows[0];
}

export async function touchProfileAccount(id: string, lastSyncAt?: string) {
  await pool.query(
    `
      UPDATE profile_accounts
      SET last_sync_at = $2,
          updated_at = NOW()
      WHERE id = $1
    `,
    [id, lastSyncAt ?? new Date().toISOString()],
  );
}

export async function updateProfileRecord(profile: {
  id: string;
  displayName: string;
  baseInfo: Record<string, unknown>;
}) {
  await pool.query(
    `
      UPDATE profiles
      SET display_name = $2,
          base_info = $3,
          updated_at = NOW()
      WHERE id = $1
    `,
    [profile.id, profile.displayName, JSON.stringify(profile.baseInfo ?? {})],
  );
}

export async function insertResumeRecord(resume: Resume) {
  await pool.query(
    `
      INSERT INTO resumes (id, profile_id, label, file_path, resume_text, resume_description, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      resume.id,
      resume.profileId,
      resume.label,
      resume.filePath,
      resume.resumeText ?? null,
      resume.resumeDescription ?? null,
      resume.createdAt,
    ],
  );
}

export async function deleteResumeById(resumeId: string) {
  await pool.query('DELETE FROM resumes WHERE id = $1', [resumeId]);
}

export async function listResumesByProfile(profileId: string): Promise<Resume[]> {
  const { rows } = await pool.query<Resume>(
    'SELECT id, profile_id as "profileId", label, file_path as "filePath", resume_text as "resumeText", resume_description as "resumeDescription", created_at as "createdAt" FROM resumes WHERE profile_id = $1 ORDER BY created_at DESC',
    [profileId],
  );
  return rows;
}

export async function findResumeById(resumeId: string): Promise<Resume | undefined> {
  const { rows } = await pool.query<Resume>(
    'SELECT id, profile_id as "profileId", label, file_path as "filePath", resume_text as "resumeText", resume_description as "resumeDescription", created_at as "createdAt" FROM resumes WHERE id = $1',
    [resumeId],
  );
  return rows[0];
}

export async function listAssignments(): Promise<Assignment[]> {
  const { rows } = await pool.query<Assignment>(
    `
      SELECT
        id AS "id",
        id AS "profileId",
        assigned_bidder_id AS "bidderUserId",
        assigned_by AS "assignedBy",
        assigned_at AS "assignedAt",
        NULL::TIMESTAMP AS "unassignedAt"
      FROM profiles
      WHERE assigned_bidder_id IS NOT NULL
      ORDER BY assigned_at DESC
    `,
  );
  return rows;
}

export async function findActiveAssignmentByProfile(
  profileId: string,
): Promise<Assignment | undefined> {
  const { rows } = await pool.query<Assignment>(
    `
      SELECT
        id AS "id",
        id AS "profileId",
        assigned_bidder_id AS "bidderUserId",
        assigned_by AS "assignedBy",
        assigned_at AS "assignedAt",
        NULL::TIMESTAMP AS "unassignedAt"
      FROM profiles
      WHERE id = $1 AND assigned_bidder_id IS NOT NULL
      LIMIT 1
    `,
    [profileId],
  );
  return rows[0];
}

export async function insertAssignmentRecord(assignment: Assignment) {
  await pool.query(
    `
      UPDATE profiles
      SET assigned_bidder_id = $2,
          assigned_by = $3,
          assigned_at = $4,
          updated_at = NOW()
      WHERE id = $1
    `,
    [assignment.profileId, assignment.bidderUserId, assignment.assignedBy, assignment.assignedAt],
  );
}

export async function closeAssignmentById(id: string): Promise<Assignment | undefined> {
  const { rows } = await pool.query<Assignment>(
    `
      UPDATE profiles
      SET assigned_bidder_id = NULL,
          assigned_by = NULL,
          assigned_at = NULL,
          updated_at = NOW()
      WHERE id = $1
      RETURNING
        id AS "id",
        id AS "profileId",
        NULL::UUID AS "bidderUserId",
        NULL::UUID AS "assignedBy",
        NULL::TIMESTAMP AS "assignedAt",
        NULL::TIMESTAMP AS "unassignedAt"
    `,
    [id],
  );
  return rows[0];
}

export type BidderSummary = {
  id: string;
  name: string;
  email: string;
  profiles: { id: string; displayName: string }[];
};

export async function listBidderSummaries(): Promise<BidderSummary[]> {
  const { rows } = await pool.query<BidderSummary & { profiles?: { id: string; displayName: string }[] }>(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        COALESCE(
          json_agg(
            json_build_object('id', p.id, 'displayName', p.display_name)
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'::json
        ) AS profiles
      FROM users u
      LEFT JOIN profiles p ON p.assigned_bidder_id = u.id
      WHERE u.role = 'BIDDER' AND u.is_active IS NOT FALSE
      GROUP BY u.id, u.name, u.email
      ORDER BY u.name ASC
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    profiles: r.profiles ?? [],
  }));
}

export async function listApplications(): Promise<ApplicationSummary[]> {
  const { rows } = await pool.query<ApplicationSummary>(
    `
      SELECT
        a.id,
        a.session_id AS "sessionId",
        a.bidder_user_id AS "bidderUserId",
        u.name AS "bidderName",
        u.email AS "bidderEmail",
        a.profile_id AS "profileId",
        p.display_name AS "profileDisplayName",
        a.resume_id AS "resumeId",
        r.label AS "resumeLabel",
        a.url AS "url",
        a.domain AS "domain",
        a.created_at AS "createdAt"
      FROM applications a
      LEFT JOIN users u ON u.id = a.bidder_user_id
      LEFT JOIN profiles p ON p.id = a.profile_id
      LEFT JOIN resumes r ON r.id = a.resume_id
      ORDER BY a.created_at DESC
    `,
  );
  return rows;
}

export async function listLabelAliases(): Promise<LabelAlias[]> {
  const { rows } = await pool.query<LabelAlias>(
    `
      SELECT
        id,
        canonical_key AS "canonicalKey",
        alias,
        normalized_alias AS "normalizedAlias",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM label_aliases
      ORDER BY created_at ASC
    `,
  );
  return rows;
}

export async function findLabelAliasById(id: string): Promise<LabelAlias | undefined> {
  const { rows } = await pool.query<LabelAlias>(
    `
      SELECT
        id,
        canonical_key AS "canonicalKey",
        alias,
        normalized_alias AS "normalizedAlias",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM label_aliases
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );
  return rows[0];
}

export async function findLabelAliasByNormalized(normalized: string): Promise<LabelAlias | undefined> {
  const { rows } = await pool.query<LabelAlias>(
    `
      SELECT
        id,
        canonical_key AS "canonicalKey",
        alias,
        normalized_alias AS "normalizedAlias",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM label_aliases
      WHERE normalized_alias = $1
      LIMIT 1
    `,
    [normalized],
  );
  return rows[0];
}

export async function insertLabelAlias(alias: LabelAlias) {
  await pool.query(
    `
      INSERT INTO label_aliases (id, canonical_key, alias, normalized_alias, created_at, updated_at)
      VALUES ($1, $2, $3, $4, COALESCE($5, NOW()), COALESCE($6, NOW()))
      ON CONFLICT (normalized_alias) DO NOTHING
    `,
    [
      alias.id,
      alias.canonicalKey,
      alias.alias,
      alias.normalizedAlias,
      alias.createdAt ?? new Date().toISOString(),
      alias.updatedAt ?? new Date().toISOString(),
    ],
  );
}

export async function updateLabelAliasRecord(alias: LabelAlias) {
  await pool.query(
    `
      UPDATE label_aliases
      SET canonical_key = $2,
          alias = $3,
          normalized_alias = $4,
          updated_at = COALESCE($5, NOW())
      WHERE id = $1
    `,
    [alias.id, alias.canonicalKey, alias.alias, alias.normalizedAlias, alias.updatedAt ?? new Date().toISOString()],
  );
}

export async function deleteLabelAlias(id: string) {
  await pool.query('DELETE FROM label_aliases WHERE id = $1', [id]);
}

export async function listCommunityChannels(): Promise<CommunityThread[]> {
  const { rows } = await pool.query<CommunityThread>(
    `
      SELECT
        id,
        thread_type AS "threadType",
        name,
        description,
        created_by AS "createdBy",
        is_private AS "isPrivate",
        created_at AS "createdAt",
        last_message_at AS "lastMessageAt"
      FROM community_threads
      WHERE thread_type = 'CHANNEL'
      ORDER BY name ASC
    `,
  );
  return rows;
}

export async function listCommunityDmThreads(userId: string): Promise<CommunityThreadSummary[]> {
  const { rows } = await pool.query<CommunityThreadSummary & { participants?: CommunityThreadSummary['participants'] }>(
    `
      SELECT
        t.id,
        t.thread_type AS "threadType",
        t.name,
        t.description,
        t.is_private AS "isPrivate",
        t.created_at AS "createdAt",
        t.last_message_at AS "lastMessageAt",
        COALESCE(
          json_agg(
            json_build_object('id', u.id, 'name', u.name, 'email', u.email)
          ) FILTER (WHERE u.id IS NOT NULL),
          '[]'::json
        ) AS participants
      FROM community_threads t
      JOIN community_thread_members m ON m.thread_id = t.id AND m.user_id = $1
      LEFT JOIN community_thread_members m2 ON m2.thread_id = t.id
      LEFT JOIN users u ON u.id = m2.user_id AND u.id <> $1
      WHERE t.thread_type = 'DM'
      GROUP BY t.id
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
    `,
    [userId],
  );
  return rows.map((row) => ({
    ...row,
    participants: row.participants ?? [],
  }));
}

export async function findCommunityChannelByKey(nameKey: string): Promise<CommunityThread | undefined> {
  const { rows } = await pool.query<CommunityThread>(
    `
      SELECT
        id,
        thread_type AS "threadType",
        name,
        description,
        created_by AS "createdBy",
        is_private AS "isPrivate",
        created_at AS "createdAt",
        last_message_at AS "lastMessageAt"
      FROM community_threads
      WHERE thread_type = 'CHANNEL' AND name_key = $1
      LIMIT 1
    `,
    [nameKey],
  );
  return rows[0];
}

export async function findCommunityThreadById(id: string): Promise<CommunityThread | undefined> {
  const { rows } = await pool.query<CommunityThread>(
    `
      SELECT
        id,
        thread_type AS "threadType",
        name,
        description,
        created_by AS "createdBy",
        is_private AS "isPrivate",
        created_at AS "createdAt",
        last_message_at AS "lastMessageAt"
      FROM community_threads
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );
  return rows[0];
}

export async function isCommunityThreadMember(threadId: string, userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: number }>(
    `
      SELECT 1 as ok
      FROM community_thread_members
      WHERE thread_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [threadId, userId],
  );
  return rows.length > 0;
}

export async function insertCommunityThread(thread: {
  id: string;
  threadType: CommunityThread['threadType'];
  name?: string | null;
  nameKey?: string | null;
  description?: string | null;
  createdBy?: string | null;
  isPrivate?: boolean;
  createdAt?: string;
}): Promise<CommunityThread> {
  const createdAt = thread.createdAt ?? new Date().toISOString();
  const { rows } = await pool.query<CommunityThread>(
    `
      INSERT INTO community_threads (
        id,
        thread_type,
        name,
        name_key,
        description,
        created_by,
        is_private,
        created_at,
        last_message_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
      RETURNING
        id,
        thread_type AS "threadType",
        name,
        description,
        created_by AS "createdBy",
        is_private AS "isPrivate",
        created_at AS "createdAt",
        last_message_at AS "lastMessageAt"
    `,
    [
      thread.id,
      thread.threadType,
      thread.name ?? null,
      thread.nameKey ?? null,
      thread.description ?? null,
      thread.createdBy ?? null,
      thread.isPrivate ?? false,
      createdAt,
    ],
  );
  return rows[0];
}

export async function insertCommunityThreadMember(member: {
  id: string;
  threadId: string;
  userId: string;
  role?: string;
  joinedAt?: string;
}) {
  await pool.query(
    `
      INSERT INTO community_thread_members (id, thread_id, user_id, role, joined_at)
      VALUES ($1, $2, $3, $4, COALESCE($5, NOW()))
      ON CONFLICT (thread_id, user_id) DO NOTHING
    `,
    [member.id, member.threadId, member.userId, member.role ?? 'MEMBER', member.joinedAt ?? null],
  );
}

export async function findCommunityDmThreadId(userId: string, otherUserId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ id: string }>(
    `
      SELECT t.id
      FROM community_threads t
      JOIN community_thread_members m1 ON m1.thread_id = t.id AND m1.user_id = $1
      JOIN community_thread_members m2 ON m2.thread_id = t.id AND m2.user_id = $2
      WHERE t.thread_type = 'DM'
      LIMIT 1
    `,
    [userId, otherUserId],
  );
  return rows[0]?.id;
}

export async function getCommunityDmThreadSummary(
  threadId: string,
  userId: string,
): Promise<CommunityThreadSummary | undefined> {
  const { rows } = await pool.query<CommunityThreadSummary & { participants?: CommunityThreadSummary['participants'] }>(
    `
      SELECT
        t.id,
        t.thread_type AS "threadType",
        t.name,
        t.description,
        t.is_private AS "isPrivate",
        t.created_at AS "createdAt",
        t.last_message_at AS "lastMessageAt",
        COALESCE(
          json_agg(
            json_build_object('id', u.id, 'name', u.name, 'email', u.email)
          ) FILTER (WHERE u.id IS NOT NULL),
          '[]'::json
        ) AS participants
      FROM community_threads t
      JOIN community_thread_members m ON m.thread_id = t.id AND m.user_id = $1
      LEFT JOIN community_thread_members m2 ON m2.thread_id = t.id
      LEFT JOIN users u ON u.id = m2.user_id AND u.id <> $1
      WHERE t.thread_type = 'DM' AND t.id = $2
      GROUP BY t.id
      LIMIT 1
    `,
    [userId, threadId],
  );
  const row = rows[0];
  if (!row) return undefined;
  return { ...row, participants: row.participants ?? [] };
}

export async function listCommunityMessages(threadId: string): Promise<CommunityMessage[]> {
  const { rows } = await pool.query<CommunityMessage>(
    `
      SELECT
        m.id,
        m.thread_id AS "threadId",
        m.sender_id AS "senderId",
        u.name AS "senderName",
        m.body,
        m.created_at AS "createdAt"
      FROM community_messages m
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.thread_id = $1
      ORDER BY m.created_at ASC
      LIMIT 200
    `,
    [threadId],
  );
  return rows;
}

export async function listCommunityThreadMemberIds(threadId: string): Promise<string[]> {
  const { rows } = await pool.query<{ userId: string }>(
    `
      SELECT user_id AS "userId"
      FROM community_thread_members
      WHERE thread_id = $1
    `,
    [threadId],
  );
  return rows.map((row) => row.userId);
}

export async function insertCommunityMessage(message: CommunityMessage): Promise<CommunityMessage> {
  const createdAt = message.createdAt ?? new Date().toISOString();
  const { rows } = await pool.query<CommunityMessage>(
    `
      WITH inserted AS (
        INSERT INTO community_messages (id, thread_id, sender_id, body, created_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, thread_id, sender_id, body, created_at
      )
      SELECT
        inserted.id,
        inserted.thread_id AS "threadId",
        inserted.sender_id AS "senderId",
        u.name AS "senderName",
        inserted.body,
        inserted.created_at AS "createdAt"
      FROM inserted
      LEFT JOIN users u ON u.id = inserted.sender_id
    `,
    [message.id, message.threadId, message.senderId, message.body, createdAt],
  );
  await pool.query('UPDATE community_threads SET last_message_at = $2 WHERE id = $1', [
    message.threadId,
    createdAt,
  ]);
  return rows[0];
}
