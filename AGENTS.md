# AGENTS.md

## What this is

`invite-litellm` is self-service key management for a [LiteLLM](https://docs.litellm.ai/) proxy: admins create teams and share invite links (`/invite/<team_id>/<code>`); members redeem them (sign in or create an account) and manage their own virtual keys. Two independent parts in one git repo:

- **`backend/`** — the Python `uv` project (`src/` layout, package `invite_litellm`, FastAPI, Python ≥ 3.13). Two jobs: serve the built SPA and redeem invites server-side using the proxy's master key. The version in `backend/pyproject.toml` is the single source of truth, surfaced at runtime via `importlib.metadata` → `GET /config` → SPA footer (works in the container where no source tree exists).
- **`frontend/`** — the SPA: **Refine v5 + React 19 + TypeScript + Ant Design 5 + Vite 6** (the original Alpine.js app was removed — "refine is the new frontend"). **Read `frontend/AGENTS.md` before any frontend work** — it contains hard-won LiteLLM API knowledge (the hidden `/v2/login` endpoint, auth via the JWT `key` claim, key-regeneration simulation, the three error-body shapes) that is not discoverable from the code or the LiteLLM OpenAPI spec.

Also at the root: `Dockerfile` (multi-stage image — **currently stale**, see Gotchas), `compose.yml` (runs the prebuilt ghcr.io image), `.github/workflows/docker.yml` (multi-arch publish to `ghcr.io/oschwand/invite-litellm` on `v*.*.*` tags or manual dispatch), and `README.md` (user-facing — keep it in sync when commands or layout change).

## Backend

The whole package is two files: `backend/src/invite_litellm/app.py` (FastAPI app, all routes and LiteLLM calls) and `__init__.py` (`main()` runs uvicorn on `HOST`/`PORT`, defaults `127.0.0.1:8000`; the Dockerfile sets `HOST=0.0.0.0`).

Routes, in registration order (order matters — see Gotchas):

1. `GET /invite/{team_id}/{invite_code}` — serves `index.html` **directly** (no redirect, so the invite URL stays in the address bar for the SPA to parse), `Cache-Control: no-cache`.
2. `POST /invite/{team_id}/{invite_key}` — invite redemption (below).
3. `GET /config` — `{litellm_url, version}`; the SPA fetches it on load to adopt the backend's runtime `LITELLM_URL` and display the version in the footer.
4. `GET /{file_path:path}` — catch-all static server for the SPA build (`FileResponse`; 404 on missing files and on path traversal via `is_relative_to`).

### Invite redemption: `POST /invite/{team_id}/{invite_key}`

Returns 503 when `LITELLM_MASTER_KEY` is unset. `_check_invite` validates the code against the team's `metadata.invite_code` (`GET /team/info`, master-key auth) → 404 unknown team, 403 bad code, 502 upstream failure. It also **ensures team members can manage their own keys**: LiteLLM blocks team members from `/key/generate`/`/key/delete` (401 "Team member does not have permissions for endpoint") unless `team_member_permissions` includes them, so missing routes are back-filled via `POST /team/permissions_update` (idempotent union — makes teams created before this change, whose invite links are already shared, work too).

Two caller modes (matching the SPA invite page):

- **`Authorization: Bearer <virtual key>`** (signed-in user): resolves the caller's `user_id` via `GET /key/info` (401 on unknown key).
- **No auth + JSON body `{full_name, email, password}`** (signup): `POST /user/new` (`auto_create_key: false`, role `internal_user`) then sets the password via `POST /user/update` (`/user/new` has no password field). Duplicate email → clean 409 "An account with this email already exists. Sign in with it instead".

Both modes then enforce **one key per user per team**: `GET /key/list` (`return_full_object=true`, 100/page, hard cap 20 pages) matching `user_id`+`team_id`; a hit aborts with 409 "You already have a virtual key for this team. Sign in and reuse it, or regenerate it from the key list" *before* `POST /team/member_add` runs ("already in team" errors tolerated → idempotent). Finally `POST /key/generate` with the team's member budget (`team_member_budget_table.max_budget`) as `max_budget`, `models: []` (empty list = no restriction = inherit all models) and `metadata: {created_via: invite}`. Returns `{key, user_id, team_id}` — the plaintext `sk-...` key is shown once by the SPA.

All upstream LiteLLM calls go through one master-key-authenticated `httpx.AsyncClient` (`LITELLM_URL`, 30 s timeout); failures become FastAPI `detail` strings the frontend's `extractErrorMessage` understands. At startup the lifespan pings unauthenticated `GET /health/liveliness` (5 s timeout, any HTTP response = reachable — same semantics as the SPA's status banner) and logs; startup is never blocked. The module logger carries its own stderr handler because uvicorn configures no root handlers. Known LiteLLM quirk: session keys from `POST /v2/login` may be invalidated by key-management calls (re-login fixes it) — more in `frontend/AGENTS.md`.

### Configuration

Env vars, loaded with `python-dotenv` from `backend/.env` (real env vars win — but note that file does not exist; see Gotcha 2): `LITELLM_URL` (default `http://localhost:4000`), `LITELLM_MASTER_KEY` (required for the POST route), `STATIC_DIR` (default `backend/frontend/dist`, which never exists when running from source — set it), `HOST`/`PORT`.

## Commands

### Backend

```sh
cd backend
uv sync
STATIC_DIR=../frontend/dist LITELLM_MASTER_KEY=sk-... uv run invite-litellm
```

`uv sync` installs the project editable; `uv run invite-litellm` starts uvicorn on `HOST`/`PORT` (default `127.0.0.1:8000`). Launch from `backend/` so the relative `STATIC_DIR` resolves. Serving requires `frontend/dist` (run `npm run build` in `frontend/` first); redemption additionally requires a reachable LiteLLM proxy.

### Frontend (full details in `frontend/AGENTS.md`)

```sh
cd frontend
npm install        # .npmrc forces legacy-peer-deps — use npm, not yarn/pnpm
npm run build      # tsc FIRST (type errors fail the build before Vite runs) → dist/
npx tsc --noEmit   # typecheck only — preferred check
npx eslint .       # lint (there is no `lint` script in package.json)
```

Never start the dev server yourself (`npm run dev`) — the user keeps one running; typecheck instead.

### Container / CI

- `compose.yml` pulls the prebuilt multi-arch image: `docker compose up` with `LITELLM_URL` / `LITELLM_MASTER_KEY` in the environment.
- The root `Dockerfile` (node:22 builds the SPA → uv builds the venv → slim non-root runtime; `LITELLM_URL` is a build-time default, `LITELLM_MASTER_KEY` runtime-only, `.dockerignore` keeps `.env` out) is **stale**: it still copies `pyproject.toml uv.lock …` and `src/` from the repo root, but they moved to `backend/` — a build from the root fails until those paths are fixed. `.github/workflows/docker.yml` builds it on `v*.*.*` tags; the last green build (v0.2.0) predates the move.
- `frontend/Dockerfile` is the create-refine-app scaffold's standalone image — unused.

## Gotchas

1. **`backend/pyproject.toml` deliberately declares no `readme`/`license-files`**: those files live at the repo root and uv_build cannot include files outside the project directory — re-adding those declarations makes `uv sync` fail with `failed to open file …/backend/README.md`. uv ≥ 0.13 also warns that the pinned `uv_build>=0.12.6,<0.13.0` build backend does not include the current uv version (warning only).
2. **Paths resolve from `backend/`, not the repo root**: `_PROJECT_ROOT = Path(__file__).resolve().parents[2]` equals `backend/`, so the dotenv path is `backend/.env` (does not exist — the **repo-root `.env` is NOT read**) and the static default is `backend/frontend/dist` (never exists). Pass `STATIC_DIR` (resolved against your cwd) and real env vars.
3. **The repo-root `.env` is tracked in git** (currently placeholder test values, `sk-1234`). The root `.gitignore` does not ignore it; only `.dockerignore` keeps it out of images. Do not put a real master key there without untracking it first.
4. **Catch-all route order**: any new backend API route must be registered *before* `GET /{file_path:path}` in `app.py`, or it is shadowed.
5. **Stale root `Dockerfile`**: it still copies `pyproject.toml uv.lock …` and `src/` from the repo root, but they moved to `backend/` — a build from the root fails until those paths are fixed (details in Container/CI above).
6. **No tests and no Python lint/CI** — the only automated checks in the repo are the frontend `tsc` gate inside `npm run build` and manual `npx eslint .`. `.pytest_cache/` at the root is a leftover; there are no test files.
7. A live LiteLLM proxy for testing is expected at `http://localhost:4000` (swagger at `/`, OpenAPI at `/openapi.json`). Its `/v2/login` route is hidden from that spec — see `frontend/AGENTS.md`.

## Git

Single repository; `backend/` and `frontend/` are plain subdirectories. Keep commits scoped to the part you touched (root files, `backend/`, or `frontend/`).
