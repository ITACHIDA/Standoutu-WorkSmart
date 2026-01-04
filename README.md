# SmartWork – Application Assist (MVP)

Single-server prototype for Admin/Manager/Bidder roles with remote-browser style work page, analyse, and autofill stubs. Built for a 10–20 user team: Fastify + TypeScript backend and Next.js + Tailwind frontend. Storage is local disk; Postgres can be added later.

## Prerequisites
- Node.js 18+ (Node 22 is fine)
- npm

## Install
```bash
npm install        # installs root workspace tooling (none) and sets up package-lock for both workspaces
cd backend && npm install
cd ../frontend && npm install
```
> The first `npm install` only wires the workspace; `frontend` and `backend` each hold their own dependencies.

## Run (two terminals)
Backend (Fastify on port 4000):
```bash
npm --workspace backend run dev
```

Frontend (Next.js dev server on port 3000):
```bash
npm --workspace frontend run dev
```

Electron shell (loads the frontend URL):
```bash
npm --workspace electron start
```
- Electron now auto-hosts the same Next.js UI when `FRONTEND_URL` is unreachable (it boots an embedded Next server on port `3300`). If both fail, it falls back to the minimal shell. Set `API_BASE` in your env to point at your backend. `FRONTEND_URL` still overrides the frontend URL when available.

Open http://localhost:3000. The app auto-logins the demo bidder `bidder@smartwork.local`.

## Backend overview (`backend/src`)
- `index.ts`: Fastify app with CORS + WS hooks, auth stub, profiles/resumes/sessions endpoints, metrics, LLM settings stub.
- `data.ts`: Seed users (admin/manager/bidder), one profile, two resumes, assignment, in-memory sessions/events/settings.
- `types.ts`: Domain types for users, profiles, resumes, assignments, sessions, events, LLM settings.

Notable endpoints (MVP):
- `POST /auth/login` – email only, returns demo token + user.
- `GET /profiles?userId=` – role-filtered (bidder sees assigned).
- `GET /profiles/:id/resumes` – resumes per profile.
- `POST /sessions` – create session and log event.
- `POST /sessions/:id/go|analyze|autofill|mark-submitted` – stub flows with fill plan sample.
- `GET /metrics/my?bidderUserId=` – tried/submitted/applied%.
- `GET/POST /settings/llm` – org-level LLM config placeholder.

## Frontend overview (`frontend/src/app/page.tsx`)
- Three-column work page: left stats/profile selector; middle URL + “remote browser” canvas + analyse/resume choice; right base info + autofill results + session status.
- Uses `NEXT_PUBLIC_API_BASE` from the frontend env file.
- Hotkey hint shown (Ctrl+Shift+F); actual hotkey wiring ready for a future handler.
- Remote browser area is a placeholder canvas for the Playwright stream.

## Next steps
1) Replace in-memory data with Postgres models (users/profiles/resumes/assignments/sessions/events/llm_settings).  
2) Add auth (JWT) and real RBAC guards.  
3) Integrate Playwright streaming (CDP screencast) into `/ws/browser/:sessionId` and render frames on the canvas.  
4) Implement job-context extraction + embedding search (pgvector) and real LLM selection.  
5) Implement form schema extraction + deterministic mapping + LLM-backed fill plan executor.  
6) Add manager/admin dashboards, settings UI, and resume upload pipeline (local storage path `/data/resumes/{profileId}/{resumeId}.pdf`).  
7) Harden metrics and audit logging; add submission confirmation flow.

## Scripts
- `npm --workspace backend run build` – type-check backend.
- `npm --workspace frontend run lint` – lint frontend.

## Configuration
- Frontend: set `NEXT_PUBLIC_API_BASE` in `frontend/.env.local`.
- Backend: adjust port via `PORT` env; replace seeded data in `data.ts`.
