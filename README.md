# invite-litellm

Self-service key management for a [LiteLLM
proxy](https://docs.litellm.ai/): a small web app where admins create
teams and share invite links, and team members sign up, accept
invites, and manage their own virtual keys. Invite links give a
limited budget.

It is made of two parts:

- `backend/` — a FastAPI backend managing the admin-only operations
  (invite redemption) and serving the web app.
- `frontend/` — a single-page app (React + [Refine](https://refine.dev))
  managing user keys.

A running [LiteLLM
proxy](https://docs.litellm.ai/docs/proxy/quick_start) is needed
with admin access (master key), reachable from both the browser
(login, key management) and the backend (invite redemption).

## Features

- **Login** against the LiteLLM proxy.
- **Dashboard**: your total spend and budget, your teams with your own
  spend in each, and your virtual keys.
- **Invite links**: either sign in with an existing account or create
  a new one (name, email, password). The invitation page shows the
  team name and the granted budget before signing in. Accepting the
  invite adds the user to the team and issues a team virtual key
  (budget = the team's member budget); each user gets at most one key
  per team, and invited accounts carry no personal budget — all
  spending goes through the team key.
- **Budget**: enforced by the proxy with a maximum amount chosen during
  team creation.
- **Playground**: test a virtual key with a simple chat.
- **Virtual keys dashboard**: list your keys with spend, budget,
  expiry; edit their name, budget, team and allowed models; enable and
  disable, regenerate and delete them.
- **Teams** (admin only): browse teams with their budgets, spend and
  invite links; create teams with a member budget and a generated
  invite link, edit budgets and allowed models, regenerate invite
  links, and inspect every member's keys.
- **Users** (admin only): browse the proxy users with their name,
  email and role.
- **Models**: browse the models with their per-million-token prices —
  members see exactly the models their teams allow, admins the whole
  proxy catalog.
- **Help**: a Python client snippet pointing at your proxy and an
  explanation of the budget mechanisms.

## Running

### Manual build

Requirements:

- Python ≥ 3.13 and [`uv`](https://docs.astral.sh/uv/)
- Node.js and npm (for building the frontend)

Build the frontend, then install and run the backend from `backend/`:

```sh
cd frontend && npm install && npm run build && cd ..
cd backend && uv sync
STATIC_DIR=../frontend/dist uv run invite-litellm
```

The app is then served on http://127.0.0.1:8000. `STATIC_DIR` points
the backend at the built frontend (its default value matches the
Docker image layout, not a source checkout).

### Docker

A prebuilt multi-arch image (amd64/arm64) is published on
[GitHub Container Registry](https://github.com/oschwand/invite-litellm/pkgs/container/invite-litellm):

```sh
docker run --rm -p 8000:8000 \
  -e LITELLM_URL=http://your.litellm:4000 \
  -e LITELLM_MASTER_KEY=sk-... \
  ghcr.io/oschwand/invite-litellm
```

or with the bundled `compose.yml`:

```sh
LITELLM_MASTER_KEY=sk-... docker compose up
```

### Configuration

Configuration can be made either with environment variables or with a
`.env` file in `backend/`:

```sh
LITELLM_URL=http://localhost:4000      # LiteLLM proxy base URL
LITELLM_MASTER_KEY=sk-...              # required for invite redemption —
                                       # the backend refuses to start if it is
                                       # missing or rejected by the proxy
```

The web app fetches `LITELLM_URL` from the backend at startup, so this
one variable configures both; the URL must be reachable from the
browser as well as from the backend.

## Usage

### For admin

1. Sign in with an admin account (by default username `admin` and the proxy master key,
   or the `UI_USERNAME`/`UI_PASSWORD` pair configured on the proxy).
2. Open the **Teams** view and click **Create**: give the team a name, optionally a
   max team budget and a per-member budget, and tick **Create invite link**.
3. Copy the generated invite link (`http://<app>/invite/<team_id>/<code>`) and share it
   with the people you invite. The link (and a copy button) also appears in the Teams
   table for future reference.

Budgets, allowed models and the invite link itself can be changed later from the
team's edit page; regenerating the link invalidates the old one.

Members are automatically granted permission to generate and delete their own team keys.

Beware that teams created this way are granted access to all models on
the proxy. Use the LiteLLM dashboard to configure more precisely.

### For users

1. Open the invite link you received. The invitation page shows the team name and the
   budget granted to your virtual key.
2. Either **create an account** (full name, email, password) or **sign in** if you already
   have one.
3. Click **Accept the invite**: you join the team and a virtual key (`sk-...`) is created.
   It is displayed **once** — copy and store it somewhere safe. Accepting an invite
   twice is refused: reuse your existing key or regenerate it from the key list.
4. Sign in to the dashboard with your email and password to see your keys, spend and
   budget, and to enable/disable, regenerate or delete keys.

## Development

The backend ships an integration test suite: an in-process mock of the
LiteLLM proxy plus the real app served over HTTP, exercised with real
requests (including startup failures on a bad master key):

```sh
cd backend && uv run pytest
```

The frontend has no test suite; `npm run build` type-checks with
`tsc` before building.

## License

MIT — see [LICENSE](LICENSE).

## AI-disclosure

Entirely developed with
[Crush](https://github.com/charmbracelet/crush) and [GLM
5.3](https://docs.z.ai/guides/llm/glm-5.3).
