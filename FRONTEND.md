# Frontend routes

Reference for the routes of the SPA (`frontend/src/App.tsx` defines them all;
one folder per page under `frontend/src/pages/`). Deep links survive refresh
and hard loads because the backend's static catch-all serves the SPA shell
for unknown extensionless paths — see `BACKEND.md`.

The route set splits into three access tiers:

| Tier | Routes |
|---|---|
| **Public** (no sign-in) | `/login`, `/invite/:team_id/:invite_code` |
| **User dashboard** (any signed-in account) | `/dashboard`, `/keys`, `/keys/edit/:id`, `/models`, `/playground`, `/help`, `/profile` |
| **Administration** (admin sessions) | `/teams`, `/teams/edit/:id`, `/users` |
| **Mixed** (user view + admin-only section) | `/team/:team_id` |

## Roles and what "admin" means

- The role comes from the session JWT's `user_role` claim (`internal_user`,
  `org_admin`, `proxy_admin`, …), decoded client-side after `/v2/login`.
- **The only client-side gate is cosmetic**: `accessControlProvider`
  (`frontend/src/providers/access.ts`) hides the *Teams* and *Users* sider
  entries when the role is `internal_user`. The routes themselves stay
  reachable by URL for anyone signed in.
- **Enforcement is the proxy's.** Every page's data calls go straight to
  LiteLLM with the session's virtual key; admin endpoints (`/team/list`,
  `/user/list`, `/key/block`, …) answer 400/403 for internal users, and the
  page surfaces that error. Nothing sensitive is hidden by the frontend
  alone.

## Layout

All authenticated routes render inside the app shell — `ThemedLayout` with:

- a **sider** menu (Dashboard, Keys, Teams, Users, Models, Playground, Help;
  Teams and Users hidden for `internal_user` — `/profile` is *not* in the
  sider, it is reached from the header's user button),
- a **header** (light/dark toggle, profile button),
- a **footer** (repo link, app version from the backend's `/config`,
  "Connected to `<proxy URL>`"),
- the **server status banner** above every page (unauthenticated
  `/health/liveliness` ping on the proxy; also shown on `/login`, **not** on
  the invite page — that flow targets the invite backend, not the proxy).

The public routes (`/login`, `/invite/...`) render full-screen cards without
the shell.

---

## Public routes

### `/login` — sign-in

Custom login form (username + password, no email-format validation — LiteLLM
usernames such as `admin` are not emails) posted to the proxy's hidden
`POST /v2/login`. On success the session JWT is saved and the app redirects
to `/dashboard`. Already-signed-in visitors are bounced to `/keys`.

### `/invite/:team_id/:invite_code` — invite redemption

The page invite links point at; the only unauthenticated route besides
`/login`. Two modes:

- **Anonymous** — "Create account" tab (`{full_name, email, password}`) or
  "Sign in" tab (direct `/v2/login` POST, staying on the page). After
  signing in or for visitors with a live session: an **accept view** showing
  the team name and the budget the new key will carry (from the invite
  backend's `GET /invite/{team_id}/{code}/info`).
- **Accept** — `POST`s to its own URL (the invite backend — full contract in
  `BACKEND.md`). Success displays the returned plaintext virtual key exactly
  once.

---

## User dashboard routes

What a regular invited member (`internal_user`) uses day to day. Admins see
the same pages with broader data where the proxy allows it.

### `/dashboard` — home

"My total spend" / "My budget", "My teams" (with the user's own per-team
spend), and "My virtual keys" (filtered to the signed-in user). Redirect
target after login and for the bare `/` path.

### `/keys` — virtual key list

The keys the proxy returns for the session — for internal users their own,
for admins every key on the proxy. Columns: name, owner, team, spend/budget,
expiry, blocked, models; row actions: **Edit**, **Regenerate** (delete +
re-create copying every attribute; the new plaintext key shown once),
**Enable/Disable**, **Delete** (block/unblock are admin-tier — internal
users get 403 from the proxy).

### `/keys/edit/:id` — edit one key

Name, budget, team, allowed models; saves via `/key/update` with the key's
token hash.

### `/models` — model catalog

Per-million-token pricing and modes. Internal users see exactly the models
their session may call (via the OpenAI-compatible `/v1/models`); admins see
the full `/model/info` catalog.

### `/playground` — chat test

Test a **user-pasted** virtual key (never the session key) against
`/chat/completions` with a free-text model name.

### `/help` — usage help

Python `openai` client snippet pointing at the live proxy URL, plus the
budget-mechanism explanation (key budget vs team budget vs member budget).

### `/profile` — identity

Name, id, email, role tag, logout button. Reached from the header's user
button; no sider entry.

---

## Administration routes

Team and user management. These sider entries are hidden for
`internal_user` sessions; the proxy rejects their API calls regardless, so
the hiding is presentation, not access control.

### `/teams` — team list (admin)

Per team: name, key count, team budget, member budget, total spend, allowed
models, **invite link** (copyable, opens `/invite/{team_id}/{code}`) and
Edit. The header **Create** button opens the team-creation modal: name,
optional team + member budgets, and a "Create invite link" switch
(crypto-random 8-char code); the created team always gets
`team_member_permissions: ["/key/generate", "/key/delete"]` so members can
manage their own keys. The full invite link is shown once on creation.

### `/teams/edit/:id` — team edit (admin)

Name, team budget, member budget, allowed models; an **invite link** row
shows the current code (copyable) with a Create/Regenerate action
(`POST /team/update` of a fresh code in `metadata.invite_code`; regenerate
confirms first — it invalidates the shared old link).

### `/users` — proxy user list (admin)

All proxy users: name, email, role. Read-only.

---

## Mixed route

### `/team/:team_id` — team detail

Note the singular `/team/` prefix — distinct from the admin `/teams` routes.

For **every team member**: the team card (with invite link when one is set)
and a **"My virtual keys"** table (the user's own keys in this team).

For **team admins only** (`/team/{id}/members/me` reporting
`role === "admin"`): an extra "Team keys (all members)" table showing every
member's keys.

---

## Remaining routes

| Path | Behaviour |
|---|---|
| `/` | Navigates to `/dashboard` (which lands on `/login` when unauthenticated) |
| `*` | Authenticated: Refine `ErrorComponent` (404 page) · unauthenticated: redirect to `/login` |

The `Register` and `ForgotPassword` page files exist under
`frontend/src/pages/` but are **unrouted and unused** — LiteLLM OSS has no
direct signup or password reset; signup happens exclusively through invite
links.
