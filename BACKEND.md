# Backend HTTP API

Reference for the routes served by the FastAPI app in
`backend/src/invite_litellm/app.py` — the single file implementing the whole
API. The app also serves the built SPA from the same origin, which is why the
route list ends with a static catch-all.

Routes are listed in **registration order**. New API routes must be registered
*before* `GET /{file_path:path}`, or the catch-all shadows them.

## Conventions

- **Error bodies** are FastAPI's `{"detail": "<message>"}` with a
  human-readable message. The SPA surfaces `detail` strings directly in its
  error alerts (via `extractErrorMessage`), so messages are written for end
  users, not just logs.
- **Authentication** — three routes accept credentials: invite redemption,
  `GET /models` and `GET /users`, all optionally via an
  `Authorization: Bearer <virtual key>` header that identifies a signed-in
  user (verified against the proxy — see
  [signed-in caller verification](#signed-in-caller-verification)).
  There is no session state; every other route is anonymous.
- **Upstream calls** all go through one master-key-authenticated
  `httpx.AsyncClient` (`LITELLM_URL`, 30 s timeout, no redirect following).
  Callers never talk to the proxy through this service: the SPA contacts
  LiteLLM directly and only uses these routes for redemption, config, the
  team-filtered model list and teammate-name lookups.
- **502** is the generic "the LiteLLM proxy failed me" status; the `detail`
  embeds the upstream error message where one is available.

---

## 1. `GET /invite/{team_id}/{invite_code}`

Serves the SPA shell for an invite link. The path parameters are **not
validated** — validation is the POST's and the SPA's job; this route exists so
the invite URL stays in the address bar (no redirect) for the SPA to parse.

| | |
|---|---|
| Auth | none |
| Response | `index.html` (`text/html`, `Cache-Control: no-cache`) |
| Errors | 404 `{"detail": "Not found"}` — `index.html` missing from `STATIC_DIR` |

## 2. `POST /invite/{team_id}/{invite_key}`

Invite redemption — validates the code, resolves or creates the caller, and
issues a team virtual key. Two caller modes:

**A. Signed-in user** — `Authorization: Bearer <virtual key>` header, no body:

```sh
curl -X POST http://127.0.0.1:8000/invite/good/AbC123xy \
  -H "Authorization: Bearer sk-..."
```

**B. Signup** — no auth header, JSON body:

```sh
curl -X POST http://127.0.0.1:8000/invite/good/AbC123xy \
  -H "Content-Type: application/json" \
  -d '{"full_name": "Ada Lovelace", "email": "ada@example.com", "password": "..."}'
```

(No `Content-Type` is required — the body is parsed as JSON regardless.)

### Pipeline, in order

1. **503** when `LITELLM_MASTER_KEY` is unset (normally unreachable: startup
   fails fast in that case).
2. **Invite validation** (`_team_info_for_invite`): `GET /team/info` with the
   master key, code compared against `metadata.invite_code`.
   → 404 unknown team · 403 bad code · 502 upstream failure or unexpected body.
3. **Permission back-fill** (`_check_invite`): if the team's
   `team_member_permissions` lacks `/key/generate` or `/key/delete`,
   `POST /team/permissions_update` adds them (idempotent union) — otherwise
   LiteLLM blocks team members from managing their own keys.
   → 502 when the update fails.
4. **Caller resolution:**
   - *Bearer mode*: `GET /key/info?key=<token>` (master key) → the key owner's
     `user_id`. → 401 unknown key · 502 upstream failure or missing owner.
     Full contract below in
     [signed-in caller verification](#signed-in-caller-verification).
   - *Signup mode* (`_parse_account` + `_create_user`): all three body fields
     required, stripped, non-empty. → 401 empty body (and no auth header) ·
     400 invalid JSON / not an object / missing field. Then
     `POST /user/new` (`user_role: internal_user`, `auto_create_key: false`,
     `max_budget: 0` — no personal budget, spend is governed by the team key)
     and `POST /user/update` to set the password (`/user/new` has no password
     field). → 409 duplicate email ("An account with this email already
     exists. Sign in with it instead") · 400 other client error (message
     passed through) · 502 upstream failure at either step.
5. **One key per user per team** (`_user_team_key_exists`): pages through
   `GET /key/list` (`return_full_object=true`, 100/page, hard cap 20 pages)
   matching `user_id` + `team_id`. A hit aborts with **409** "You already have
   a virtual key for this team. Sign in and reuse it, or regenerate it from
   the key list." — *before* any team mutation. → 502 when listing fails.
6. **Team membership**: `POST /team/member_add` (`role: user`); "already in
   team"-style errors tolerated (idempotent). → 502 otherwise.
7. **Key generation**: `POST /key/generate` with `models: []` (= inherit all
   models the team can access), `metadata: {"created_via": "invite"}`, and
   `max_budget` = the team's `team_member_budget_table.max_budget` **when one
   is set** (omitted = unlimited key). → 502 on failure or missing key.

### Signed-in caller verification

Bearer mode authenticates the caller against the proxy **before any team
mutation** (`_bearer_token` + `_user_id_from_key`):

```
Authorization: Bearer <virtual key>
  │
  ├─ _bearer_token: anything without a "Bearer " prefix (Basic, etc.) is
  │  treated as *no* auth header → the request falls to signup mode, which
  │ then fails with 401 on the missing body
  │
  └─ GET /key/info?key=<token>          master-key lookup at the proxy
       ├─ 401 / 404        → 401 "Invalid session key"   (unknown key)
       ├─ other non-200    → 502                          (upstream failure)
       └─ 200, no user_id  → 502 "did not report an owner"
  │
  └─ user_id = the key OWNER's id, as reported by the proxy
```

**Guarantees**

- `user_id` never comes from the request. Team membership
  (`POST /team/member_add`) and key generation always target **the owner of
  the presented key** as resolved by the proxy — no route lets a caller
  enroll an arbitrary user.
- Ordering is sequential: the one-key check, `member_add` and
  `key/generate` run only after this gate succeeds. There is no path to a
  team mutation with a token the proxy did not recognize.

**Semantics and limits** (LiteLLM's bearer model — SECURITY.md SEC-09)

- *Possession = identity.* Any existing LiteLLM key authenticates as its
  owner — not only session keys minted by `/v2/login` (which is what the SPA
  sends). A leaked virtual key redeems invites as its owner.
- *Existence-only check.* `/key/info` is an admin lookup, so **blocked or
  expired keys still resolve** and can redeem invites; key status is not
  enforced. (The response already carries `blocked`/`expires` if this ever
  needs tightening.)

### Success

```json
{ "key": "sk-...", "user_id": "user-42", "team_id": "good" }
```

`key` is the plaintext virtual key — the only time it is ever returned; the
SPA shows it once and expects the user to store it.

## 3. `GET /invite/{team_id}/{invite_code}/info`

Team display data for the invite page — works for anonymous visitors because
validation runs with the master key (LiteLLM's own `/team/info` is
admin-gated). Same validation as the POST's step 2, but **side-effect-free**:
no permission back-fill, no writes.

| | |
|---|---|
| Auth | none |
| Response | `{"team_name": "Research Team", "member_budget": 12.5}` — `team_name` from `team_alias` (null when absent/empty), `member_budget` from `team_member_budget_table.max_budget` (null when not a number) |
| Errors | 403 bad code · 404 unknown team · 502 upstream failure · 503 master key unset |

## 4. `GET /config`

Runtime configuration for the SPA: fetched on load to adopt the backend's
`LITELLM_URL` as the proxy base URL and to display the app version in the
footer (the version comes from `importlib.metadata`, so it works in the
container where no source tree exists).

| | |
|---|---|
| Auth | none |
| Response | `{"litellm_url": "http://localhost:4000", "version": "0.2.1"}` (`version` is `"unknown"` when the package metadata is missing) |

## 5. `GET /models`

Model deployments **with their full cost metadata**, limited to what the
signed-in user's teams allow — `/model/info` is admin-gated on the proxy
(internal users get no pricing), so the master key fetches the full list and
this route narrows it per caller. The SPA's models page uses it for non-admin
sessions.

```sh
curl http://127.0.0.1:8000/models -H "Authorization: Bearer sk-..."
curl "http://127.0.0.1:8000/models?team_id=good" -H "Authorization: Bearer sk-..."
```

| | |
|---|---|
| Auth | **required**: `Authorization: Bearer <virtual key>` (same verification as invite redemption's bearer mode) |
| Query | `team_id` (optional) — restrict the view to one team the caller belongs to |
| Response | `{"data": [{"model_name": "gpt-4o", "model_info": {…costs, mode, max_input_tokens…}}, …]}` — same shape as the proxy's `/model/info` |
| Errors | 401 no auth header / unknown key · 403 `?team_id=` the caller does not belong to · 502 upstream failure · 503 master key unset |

Pipeline: verify the bearer key (`GET /key/info`) → resolve the caller's
teams (`GET /user/info` → `user_info.teams`) → read each team's allowlist
(`GET /team/info` → `models`) → fetch every deployment with costs
(`GET /model/info`) → filter. Allowlist semantics: **missing, empty or
`["all-proxy-models"]` means unrestricted** — one unrestricted team in the
set makes every deployment visible; otherwise the union of the allowlists
wins, and allowed-but-undeployed names are returned as bare `{model_name}`
entries (no pricing). A user in no team gets `{"data": []}`.

## 6. `GET /users`

Display names for a comma-separated list of user ids — but only for
users sharing a team with the signed-in caller. The proxy gates
`/user/list` behind admin rights and refuses cross-user `/user/info`
(403 "key not allowed to access this user's info"), so team members
have no way to resolve their teammates' names (the SPA's team card
shows the owner's name, not their email); the master key fetches them
here and the co-membership check keeps this from becoming a directory
of every user.

```sh
curl "http://127.0.0.1:8000/users?user_ids=user-abc" \
  -H "Authorization: Bearer sk-..."
```

| | |
|---|---|
| Auth | **required**: `Authorization: Bearer <virtual key>` (same verification as invite redemption's bearer mode) |
| Query | `user_ids` (comma-separated; empty/absent → `{"users": []}`) |
| Response | `{"users": [{"user_id", "user_alias", "user_email"}]}` — a minimal projection, no budgets or keys |
| Errors | 401 no auth header / unknown key · 502 upstream failure · 503 master key unset |

Pipeline: verify the bearer key (`GET /key/info`) → read the caller's
record (`GET /user/info` → role + `teams`) → for non-admin roles, the
union of those teams' member ids (`GET /team/info` →
`members_with_roles`) filters the requested ids (unknown/non-teammate
ids are silently omitted; admin-tier roles skip the check) →
`GET /user/list?user_ids=` fetches the survivors' rows.

## 7. `GET /{file_path:path}` — static catch-all

Serves the SPA build from `STATIC_DIR`. Resolution rules:

- `""` or `index.html` → the shell (`Cache-Control: no-cache`).
- Existing file → `FileResponse` (Starlette sets `ETag` / `Last-Modified` and
  handles `Range` requests).
- Path escaping the static root (`resolve()` + `is_relative_to` check) →
  **404** — this is the path-traversal guard.
- Missing path **with a file extension** → **404** (broken asset links stay
  debuggable).
- Missing **extensionless** path → the shell (`index.html`), so SPA deep links
  (`/dashboard`, `/keys/edit/:id`, …) survive refresh and hard load. Route 1
  is a specialized case of the same idea for `/invite/...`.

Errors: 404 as above; a missing `index.html` makes every fallback path 404.

---

## Upstream LiteLLM call map

Which proxy endpoints each route needs (all master-key-authenticated):

| Route | `GET /team/info` | `POST /team/permissions_update` | `GET /key/info` | `POST /user/new` | `POST /user/update` | `POST /team/member_add` | `GET /key/list` | `POST /key/generate` | `GET /user/info` | `GET /model/info` | `GET /user/list` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /invite/{t}/{c}` | — | — | — | — | — | — | — | — | — | — | — |
| `POST /invite/{t}/{k}` (bearer) | ✓ | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | — | — | — |
| `POST /invite/{t}/{k}` (signup) | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `GET /invite/{t}/{c}/info` | ✓ | — | — | — | — | — | — | — | — | — | — |
| `GET /models` | ✓ | — | ✓ | — | — | — | — | — | ✓ | ✓ | — |
| `GET /users` | ✓ | — | ✓ | — | — | — | — | — | ✓ | — | ✓ |
| `GET /config`, static | — | — | — | — | — | — | — | — | — | — | — |

Additionally, **at startup** the lifespan verifies the master key with
`GET /key/list?size=1` (any non-200 aborts the process) and pings
`GET /health/liveliness` unauthenticated (unreachable only warns — the SPA's
status banner uses the same any-response-means-reachable semantics).

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `LITELLM_URL` | `http://localhost:4000` | Proxy base URL (must be reachable from the browser too — advertised via `/config`) |
| `LITELLM_MASTER_KEY` | — (required) | Proxy master key; startup aborts when missing or rejected |
| `STATIC_DIR` | `backend/frontend/dist` | SPA build directory; set it when running from source (e.g. `../frontend/dist`) |
| `HOST` / `PORT` | `127.0.0.1` / `8000` | Uvicorn bind (the container sets `HOST=0.0.0.0`) |

Paths resolve from `backend/`, not the repo root; see the root `AGENTS.md`
for the full gotcha list.
