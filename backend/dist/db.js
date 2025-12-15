"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.initDb = initDb;
exports.findUserByEmail = findUserByEmail;
exports.findUserById = findUserById;
exports.insertUser = insertUser;
exports.insertProfile = insertProfile;
exports.listProfiles = listProfiles;
exports.listProfilesForBidder = listProfilesForBidder;
exports.findProfileById = findProfileById;
exports.updateProfileRecord = updateProfileRecord;
exports.insertResumeRecord = insertResumeRecord;
exports.deleteResumeById = deleteResumeById;
exports.listResumesByProfile = listResumesByProfile;
exports.findResumeById = findResumeById;
exports.listAssignments = listAssignments;
exports.findActiveAssignmentByProfile = findActiveAssignmentByProfile;
exports.insertAssignmentRecord = insertAssignmentRecord;
exports.closeAssignmentById = closeAssignmentById;
exports.listBidderSummaries = listBidderSummaries;
const pg_1 = require("pg");
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
});
async function initDb() {
    const client = await exports.pool.connect();
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
        // No seed data inserted; database starts empty.
    }
    finally {
        client.release();
    }
}
async function findUserByEmail(email) {
    const { rows } = await exports.pool.query('SELECT id, email, name, role, is_active as "isActive", password FROM users WHERE email = $1', [email]);
    return rows[0];
}
async function findUserById(id) {
    const { rows } = await exports.pool.query('SELECT id, email, name, role, is_active as "isActive", password FROM users WHERE id = $1', [id]);
    return rows[0];
}
async function insertUser(user) {
    await exports.pool.query(`
      INSERT INTO users (id, email, name, role, password, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, password = EXCLUDED.password, is_active = EXCLUDED.is_active
    `, [user.id, user.email, user.name, user.role, user.password ?? 'demo', user.isActive ?? true]);
}
async function insertProfile(profile) {
    await exports.pool.query(`
      INSERT INTO profiles (id, display_name, base_info, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO NOTHING
    `, [
        profile.id,
        profile.displayName,
        JSON.stringify(profile.baseInfo ?? {}),
        profile.createdBy ?? null,
        profile.createdAt ?? new Date().toISOString(),
        profile.updatedAt ?? new Date().toISOString(),
    ]);
}
async function listProfiles() {
    const { rows } = await exports.pool.query(`
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
    `);
    return rows;
}
async function listProfilesForBidder(bidderUserId) {
    const { rows } = await exports.pool.query(`
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
    `, [bidderUserId]);
    return rows;
}
async function findProfileById(id) {
    const { rows } = await exports.pool.query(`
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
    `, [id]);
    return rows[0];
}
async function updateProfileRecord(profile) {
    await exports.pool.query(`
      UPDATE profiles
      SET display_name = $2,
          base_info = $3,
          updated_at = NOW()
      WHERE id = $1
    `, [profile.id, profile.displayName, JSON.stringify(profile.baseInfo ?? {})]);
}
async function insertResumeRecord(resume) {
    await exports.pool.query(`
      INSERT INTO resumes (id, profile_id, label, file_path, resume_text, resume_description, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO NOTHING
    `, [
        resume.id,
        resume.profileId,
        resume.label,
        resume.filePath,
        resume.resumeText ?? null,
        resume.resumeDescription ?? null,
        resume.createdAt,
    ]);
}
async function deleteResumeById(resumeId) {
    await exports.pool.query('DELETE FROM resumes WHERE id = $1', [resumeId]);
}
async function listResumesByProfile(profileId) {
    const { rows } = await exports.pool.query('SELECT id, profile_id as "profileId", label, file_path as "filePath", resume_text as "resumeText", resume_description as "resumeDescription", created_at as "createdAt" FROM resumes WHERE profile_id = $1 ORDER BY created_at DESC', [profileId]);
    return rows;
}
async function findResumeById(resumeId) {
    const { rows } = await exports.pool.query('SELECT id, profile_id as "profileId", label, file_path as "filePath", resume_text as "resumeText", resume_description as "resumeDescription", created_at as "createdAt" FROM resumes WHERE id = $1', [resumeId]);
    return rows[0];
}
async function listAssignments() {
    const { rows } = await exports.pool.query(`
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
    `);
    return rows;
}
async function findActiveAssignmentByProfile(profileId) {
    const { rows } = await exports.pool.query(`
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
    `, [profileId]);
    return rows[0];
}
async function insertAssignmentRecord(assignment) {
    await exports.pool.query(`
      UPDATE profiles
      SET assigned_bidder_id = $2,
          assigned_by = $3,
          assigned_at = $4,
          updated_at = NOW()
      WHERE id = $1
    `, [assignment.profileId, assignment.bidderUserId, assignment.assignedBy, assignment.assignedAt]);
}
async function closeAssignmentById(id) {
    const { rows } = await exports.pool.query(`
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
    `, [id]);
    return rows[0];
}
async function listBidderSummaries() {
    const { rows } = await exports.pool.query(`
    SELECT
      u.id,
      u.name,
      u.email
    FROM users u
    WHERE u.role = 'BIDDER'
    ORDER BY u.name ASC
  `);
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        profiles: [],
    }));
}
