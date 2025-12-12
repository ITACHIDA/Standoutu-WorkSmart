import { Pool } from 'pg';
import { Assignment, Profile, Resume, User } from './types';

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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS resumes (
        id UUID PRIMARY KEY,
        profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        file_path TEXT,
        resume_text TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id UUID PRIMARY KEY,
        profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
        bidder_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        assigned_by UUID REFERENCES users(id),
        assigned_at TIMESTAMP DEFAULT NOW(),
        unassigned_at TIMESTAMP
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
    `);

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

export async function listProfiles(): Promise<Profile[]> {
  const { rows } = await pool.query<Profile>(
    `
      SELECT
        id,
        display_name AS "displayName",
        base_info AS "baseInfo",
        created_by AS "createdBy",
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
        p.id,
        p.display_name AS "displayName",
        p.base_info AS "baseInfo",
        p.created_by AS "createdBy",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt"
      FROM profiles p
      INNER JOIN assignments a ON a.profile_id = p.id AND a.unassigned_at IS NULL
      WHERE a.bidder_user_id = $1
      ORDER BY p.created_at DESC
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
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM profiles
      WHERE id = $1
    `,
    [id],
  );
  return rows[0];
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
      INSERT INTO resumes (id, profile_id, label, file_path, resume_text, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      resume.id,
      resume.profileId,
      resume.label,
      resume.filePath,
      resume.resumeText ?? null,
      resume.createdAt,
    ],
  );
}

export async function deleteResumeById(resumeId: string) {
  await pool.query('DELETE FROM resumes WHERE id = $1', [resumeId]);
}

export async function listResumesByProfile(profileId: string): Promise<Resume[]> {
  const { rows } = await pool.query<Resume>(
    'SELECT id, profile_id as "profileId", label, file_path as "filePath", resume_text as "resumeText", created_at as "createdAt" FROM resumes WHERE profile_id = $1 ORDER BY created_at DESC',
    [profileId],
  );
  return rows;
}

export async function findResumeById(resumeId: string): Promise<Resume | undefined> {
  const { rows } = await pool.query<Resume>(
    'SELECT id, profile_id as "profileId", label, file_path as "filePath", resume_text as "resumeText", created_at as "createdAt" FROM resumes WHERE id = $1',
    [resumeId],
  );
  return rows[0];
}

export async function listAssignments(): Promise<Assignment[]> {
  const { rows } = await pool.query<Assignment>(
    `
      SELECT
        id,
        profile_id AS "profileId",
        bidder_user_id AS "bidderUserId",
        assigned_by AS "assignedBy",
        assigned_at AS "assignedAt",
        unassigned_at AS "unassignedAt"
      FROM assignments
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
        id,
        profile_id AS "profileId",
        bidder_user_id AS "bidderUserId",
        assigned_by AS "assignedBy",
        assigned_at AS "assignedAt",
        unassigned_at AS "unassignedAt"
      FROM assignments
      WHERE profile_id = $1 AND unassigned_at IS NULL
      ORDER BY assigned_at DESC
      LIMIT 1
    `,
    [profileId],
  );
  return rows[0];
}

export async function insertAssignmentRecord(assignment: Assignment) {
  await pool.query(
    `
      INSERT INTO assignments (id, profile_id, bidder_user_id, assigned_by, assigned_at, unassigned_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      assignment.id,
      assignment.profileId,
      assignment.bidderUserId,
      assignment.assignedBy,
      assignment.assignedAt,
      assignment.unassignedAt ?? null,
    ],
  );
}

export async function closeAssignmentById(id: string): Promise<Assignment | undefined> {
  const { rows } = await pool.query<Assignment>(
    `
      UPDATE assignments
      SET unassigned_at = NOW()
      WHERE id = $1 AND unassigned_at IS NULL
      RETURNING
        id,
        profile_id AS "profileId",
        bidder_user_id AS "bidderUserId",
        assigned_by AS "assignedBy",
        assigned_at AS "assignedAt",
        unassigned_at AS "unassignedAt"
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
  const { rows } = await pool.query<BidderSummary & { profiles: any }>(`
    SELECT
      u.id,
      u.name,
      u.email,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object('id', p.id, 'displayName', p.display_name)
        ) FILTER (WHERE p.id IS NOT NULL),
        '[]'
      ) as profiles
    FROM users u
    LEFT JOIN assignments a ON a.bidder_user_id = u.id AND a.unassigned_at IS NULL
    LEFT JOIN profiles p ON p.id = a.profile_id
    WHERE u.role = 'BIDDER'
    GROUP BY u.id, u.name, u.email
    ORDER BY u.name ASC
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    profiles: r.profiles ?? [],
  }));
}
