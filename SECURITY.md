# Security Analysis — invite-litellm

| | |
|---|---|
| **Date** | 2026-11-19 |
| **Reviewed commit** | `6ff58fe` ("cover the upstream failure paths in the backend tests") |
| **Method** | Manual static code review (backend in depth, frontend auth/session paths, Docker/CI configuration). No dynamic testing, no automated dependency CVE scan. |
| **Scope** | `backend/src/invite_litellm/`, `backend/tests/`, `frontend/src/` (auth, session, invite, code generation), `Dockerfile`, `compose.yml`, `.github/workflows/docker.yml`, `.env`, `.gitignore`, `README.md` |

## 1. Executive summary

invite-litellm is a thin, well-scoped service: it serves a static SPA, validates invite
codes against a LiteLLM proxy using the proxy's master key, creates accounts, and issues
budgeted team keys. There is **no critical finding**: no injection, no path traversal, no
secret written to logs by the application itself, and the container/CI hygiene is good.

The most serious risks are **operational and deployment-shaped** rather than code bugs:

1. The repo-root `.env` is **tracked in git** while `compose.yml` reads the master key
   from it — the natural setup flow writes the proxy's master key into a committed file.
2. Nothing enforces or even documents **TLS** for the three network legs (browser↔backend,
   browser↔proxy, backend↔proxy); passwords, virtual keys and the master key all transit
   these legs, and every default URL is plain `http://`.
3. There is **no rate limiting** on any endpoint, including the side-effect-free invite-code
   validation oracle, and **no email verification** on invite signup.

In the code itself, the notable issues are a **race condition** in the one-key-per-team
guard, **unlimited-spend keys** when a team has no member budget configured, missing
security headers, and long-lived bearer credentials stored in `localStorage`.

**Finding counts:** 0 critical · 2 high · 7 medium · 7 low · 3 informational.

| ID | Severity | Finding |
|---|---|---|
| [SEC-01](#sec-01-high--tracked-env-is-a-master-key-leak-waiting-to-happen) | High | Tracked `.env` + compose interpolation = master key committed to git |
| [SEC-02](#sec-02-high-deployment-conditional--no-tls-by-default-on-any-leg) | High* | No TLS on any network leg by default; secrets transit plaintext |
| [SEC-03](#sec-03-medium--no-rate-limiting-or-lockout-anywhere) | Medium | No rate limiting or lockout anywhere |
| [SEC-04](#sec-04-medium--race-in-the-one-key-per-team-guard) | Medium | Race condition lets one user mint several team keys |
| [SEC-05](#sec-05-medium--no-email-verification-on-invite-signup) | Medium | No email verification — identity squatting via shared links |
| [SEC-06](#sec-06-medium--unlimited-spend-keys-when-no-member-budget-is-set) | Medium | Keys without any budget when the team has no member budget |
| [SEC-07](#sec-07-medium--no-security-headers-no-csp) | Medium | No security headers, no CSP (localStorage session amplifies XSS) |
| [SEC-08](#sec-08-medium--long-lived-bearer-credentials-in-localstorage-keys-never-expire) | Medium | Session + virtual keys in localStorage; invite keys never expire |
| [SEC-09](#sec-09-medium--any-leaked-user-key--any-invite-link--new-keys-in-the-victims-name) | Medium | Any leaked user key + any invite link = new keys in the victim's name |
| [SEC-10](#sec-10-low--unbounded-request-body-on-the-redemption-endpoint) | Low | Unbounded request body on the redemption endpoint |
| [SEC-11](#sec-11-low--half-created-accounts-when-password-setting-fails) | Low | Half-created accounts when password setting fails |
| [SEC-12](#sec-12-low--no-password-policy) | Low | No password policy (server or client) |
| [SEC-13](#sec-13-low--upstream-error-strings-passed-through-to-clients) | Low | Upstream error strings passed through to clients |
| [SEC-14](#sec-14-low--invite-codes-and-keys-in-urls-logs-and-history) | Low | Invite codes and keys in URLs, access logs, browser history |
| [SEC-15](#sec-15-low--anonymous-information-disclosure) | Low | Team enumeration (404 vs 403); `/config` exposes internal URL + version |
| [SEC-16](#sec-16-low--ci-supply-chain-actions-pinned-by-tag-no-dependency-auditing) | Low | CI actions pinned by tag; no dependency auditing |
| [SEC-17](#sec-17-informational--invite-redemption-silently-widens-team-permissions) | Info | Redemption silently widens team-member permissions |
| [SEC-18](#sec-18-informational--modulo-bias-in-invite-code-generation) | Info | Negligible modulo bias in invite code generation |
| [SEC-19](#sec-19-informational--non-constant-time-invite-code-comparison) | Info | Non-constant-time invite code comparison |

\* SEC-02 is high **conditional on deployment**: safe on a loopback/private network, high
impact if deployed as the README's quickstart suggests (public host, `http://` proxy URL).

## 2. Architecture and trust model

Three parties and three network legs:

```
                 ┌────────────────────┐
   leg A (TLS?)  │   FastAPI backend  │   leg C (TLS?)
┌────────────┐   │  serves SPA build  │   ┌──────────────────┐
│  Browser   ├──►│  POST /invite/...  ├──►│  LiteLLM proxy   │
│  (SPA)     │   │  GET  .../info     │   │  master-key auth │
└─────┬──────┘   │  GET  /config      │   └──────────────────┘
      │          └────────────────────┘
      │  leg B (TLS?) — the SPA talks to the proxy DIRECTLY:
      └──────────────────► /v2/login, /key/*, /team/*, /chat/completions
```

- **Leg A (browser → backend):** the SPA build, invite redemption, invite info. Anonymous
  for invite flows; the signup mode carries a chosen password, the signed-in mode carries
  the user's virtual key as `Authorization: Bearer`.
- **Leg B (browser → LiteLLM proxy):** login (`POST /v2/login` with username/password),
  all key/team/user management with the session's virtual key as Bearer. The proxy URL is
  advertised to the browser by `GET /config`.
- **Leg C (backend → proxy):** all admin operations with **`LITELLM_MASTER_KEY`** — full
  proxy admin power (list/generate/delete any key, create users, update any team).

Trust assumptions baked into the design:

1. **The master key is the root of trust.** The backend process is equivalent to a proxy
   administrator; compromising the backend host or container compromises the entire proxy
   (all teams, all budgets, all keys). There is no scoped credential in LiteLLM OSS for
   the endpoints this service needs (`/user/new`, `/team/member_add`, `/key/generate` with
   a chosen `user_id`).
2. **Invite links are bearer capabilities.** `/invite/{team_id}/{code}` grants whoever
   holds it: account creation, team membership, and a key with the team's member budget.
   The code (8 chars, ≈ 47.6 bits) is the only secret; `team_id` is not secret.
3. **Possession of a LiteLLM virtual key ≈ being its owner.** The redemption endpoint
   accepts any valid key and acts as that key's `user_id` (see SEC-09).

## 3. Findings

### SEC-01 (High) — Tracked `.env` is a master key leak waiting to happen

**Location:** `.env` (tracked), `.gitignore`, `compose.yml:8`, `backend/src/invite_litellm/app.py:19`

The repository **tracks `.env` in git** (verified with `git ls-files`; it currently holds
the placeholder `sk-1234`), and the root `.gitignore` does not ignore it. Meanwhile
`compose.yml` interpolates `LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY}` — and Docker
Compose automatically loads variable substitutions from the project root `.env`.

So the *documented* compose workflow (`LITELLM_MASTER_KEY=sk-... docker compose up` works,
but the natural next step "put it in `.env` so I don't have to export it") writes the
**real proxy master key into a git-tracked file**. One `git add .` + push later, the key
that unlocks the whole proxy (see SEC-02's blast radius) is public. Note the trap is
asymmetric: the backend itself reads `backend/.env` (which does not exist and is not
tracked) — only the compose path leads to the tracked file.

**Recommendation:**
1. `git rm --cached .env` and add `.env` to `.gitignore` (keep `.env.example` with
   placeholders, tracked, as the template).
2. Add a repo-level pre-commit guard or CI check that fails if `.env` differs from the
   placeholder.
3. Consider documenting `LITELLM_MASTER_KEY_FILE` support (read from a file path / Docker
   secret) so the secret never needs to live in a compose variable at all.

### SEC-02 (High, deployment-conditional) — No TLS by default on any leg

**Location:** `backend/src/invite_litellm/app.py:23` (`http://localhost:4000` default), `compose.yml:4-5` (`8000:8000` binds all interfaces), `README.md:77-81` (`docker run` example with `LITELLM_URL=http://your.litellm:4000`)

Nothing generates, requires, or even mentions TLS:

- **Leg B (browser → proxy):** the SPA sends login **passwords** (`POST /v2/login`) and
  **virtual keys** as Bearer headers directly to `litellm_url`. If that URL is `http://`
  across an untrusted network, both are sniffable and modifiable in transit.
- **Leg C (backend → proxy):** the **master key** travels in every upstream request's
  Authorization header; chosen passwords (signup) and freshly generated virtual keys
  travel in bodies. Same exposure.
- **Leg A (browser → backend):** `compose.yml` publishes port 8000 on all host interfaces
  with no TLS guidance; the README quickstart points at a plain `http://` proxy URL,
  suggesting a public plaintext deployment is an anticipated setup.

A passive observer on leg B or C obtains user credentials and keys; on leg C they obtain
the master key (full proxy compromise). An active MitM does not even need to modify
traffic: letting the victim's redemption succeed and capturing the returned plaintext
virtual key is enough.

**Recommendation:**
1. Document "TLS is mandatory for legs B and C unless the network is physically private
   (loopback / private Docker network)" in the README, and recommend a reverse proxy
   (Caddy/nginx) for legs A and B.
2. Consider refusing non-`https://` `LITELLM_URL` values unless an explicit
   `LITELLM_INSECURE=1` opt-out is set (fail-fast philosophy already used for the master
   key check).
3. Keep the proxy itself off the public internet; if the SPA must reach it publicly, put
   it behind the same reverse proxy with HSTS.

### SEC-03 (Medium) — No rate limiting or lockout anywhere

**Location:** `backend/src/invite_litellm/app.py:337` (`POST /invite/...`), `app.py:360` (`GET .../info`)

The backend has no rate limiting, no per-IP throttling, no account lockout, and no
failed-attempt logging. Two concrete exposures:

- **Invite-code brute force.** `GET /invite/{team_id}/{code}/info` is anonymous and
  side-effect-free — a perfect validation oracle. The keyspace is 62⁸ ≈ 2.2 × 10¹⁴
  (≈ 47.6 bits), so a full exhaustive search is impractical (~700 years at 10 k req/s),
  which is why this is Medium and not High — but nothing detects or slows an attacker
  hammering the endpoint, and the code is the *only* secret protecting the link.
- **Automated signup.** With one valid link, unlimited accounts and keys can be created
  at machine speed (each carrying the member budget); there is no CAPTCHA or velocity
  check. Whether this is a bug or the feature depends on how widely the admin shares the
  link — but the server offers no brake.

The same applies to leg B: the SPA's login form posts to the proxy's `/v2/login`, and the
app adds nothing on top (verify what brute-force protection your LiteLLM version applies
there; historically OSS has none — and the default `admin` account authenticates with the
master key, making it a high-value target on a public deployment).

**Recommendation:** add per-IP rate limiting on the two invite endpoints (e.g. `slowapi`
in-process, or better: at the reverse proxy where real client IPs survive — uvicorn here
does not even run with `--proxy-headers`, so in-process limits behind a proxy would
throttle the proxy's IP, not the client's). Log repeated code-validation failures per
team. Run the whole app behind a reverse proxy with `limit_req` on `/invite/` and a body
size cap (also fixes SEC-10).

### SEC-04 (Medium) — Race in the one-key-per-team guard

**Location:** `backend/src/invite_litellm/app.py:286-313` (`_user_team_key_exists`) → `app.py:349-356` (check, then member_add, then generate)

The "at most one key per user per team" invariant is enforced as check-then-act: list the
user's keys, then generate. Two concurrent redemptions for the same `user_id` (double
click, parallel tabs, scripted retries) can both pass the check and both reach
`/key/generate`, minting **two keys, each carrying the team's member budget** — i.e. the
guard that caps a member's spend at one member-budget can be bypassed to N × member
budget. Nothing downstream (LiteLLM, the team budget aside) enforces uniqueness.

The window is small but the endpoint is trivially parallelizable, and the failure mode is
exactly the budget-enforcement the app exists to provide.

**Recommendation:** make the flow idempotent for the (user, team) pair: e.g. serialize
redemptions per user with a process lock plus a post-generation re-check that deletes the
extra key if a second one exists (the delete permission is already back-filled); or tag
keys with `metadata.created_via = invite` + a deterministic `alias` and detect collisions
after generation. At minimum, document that the invariant is best-effort under concurrency.

### SEC-05 (Medium) — No email verification on invite signup

**Location:** `backend/src/invite_litellm/app.py:235-269` (`_create_user`)

The signup mode accepts any syntactically non-empty `email` string (`_parse_account`
checks only non-blankness — the SPA's format check is client-side only and the API is
directly callable) and creates the account immediately. There is no verification loop:
anyone holding an invite link can register **any email address**, including addresses
belonging to other people. Within a team context this enables identity squatting /
impersonation ("ada@company.com" registered by someone else), and pollutes the admin's
user list with accounts whose emails may collide with future legitimate signups (which
then hit 409 "already exists"). LiteLLM OSS has no built-in email verification, so the
backend can't just delegate.

**Recommendation:** at minimum, validate email syntax server-side (currently not even a
regex runs). Longer term: add an opt-in verification step (the backend could issue a
one-time token and only call `/user/new` after confirmation), or document loudly that
team membership ≈ "anyone the link reaches" and identity claims are unverified. Encourage
admins to regenerate invite codes after the intended cohort has joined.

### SEC-06 (Medium) — Unlimited-spend keys when no member budget is set

**Location:** `backend/src/invite_litellm/app.py:316-334` (`_create_team_key` — `max_budget` omitted when the team has none), `app.py:320` (`models: []` = inherit all models)

If a team is created without a member budget, `_member_budget` returns `None` and the
generated key is created **without any `max_budget`** — an unlimited-spend key. Combined
with `models: []` (= all models the team can access; README explicitly warns that
UI-created teams get all models) and, if the *team* also has no `max_budget`, nothing at
all caps the new key's spend. The invite page does disclose "created without a default
spend budget", so this is a documented behavior — but it inverts the app's stated purpose
("Invite links give a limited budget") precisely in the case where an admin skipped a
field, and the failure is silent for the admin (the member sees it, not them).

**Recommendation:** warn at team creation time when both budgets are empty (the create
modal already has both fields); or default the member budget to a small explicit value;
or refuse to generate an invite link for teams with no member budget unless the admin
confirms "unlimited". Optionally cap invite-issued keys with a conservative default
duration so an unbounded key is at least bounded in time (see SEC-08).

### SEC-07 (Medium) — No security headers, no CSP

**Location:** `backend/src/invite_litellm/app.py:88` (app construction; no header middleware anywhere)

The backend serves the SPA with no `Content-Security-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, or `Strict-Transport-Security`.
Consequences, in increasing order of concern:

- **Clickjacking:** the invite-accept and login pages can be framed; a transparent
  overlay can trick a signed-in visitor into clicking "Accept invite and create virtual
  key" for an attacker-chosen team (the attacker needs a valid invite link of their own).
- **MIME sniffing:** `X-Content-Type-Options: nosniff` absent on static serving.
- **XSS amplification:** the session (JWT **and** the virtual key inside it) lives in
  `localStorage` (SEC-08); a single XSS anywhere in the SPA exfiltrates a long-lived
  spending credential, and no CSP exists to limit script sources.
- **Referrer leak:** invite URLs contain the code in the path. Modern browsers default to
  `strict-origin-when-cross-origin` (path stripped), but no explicit `Referrer-Policy`
  is set, and outbound links exist on the invite page only after redemption — still, an
  explicit `same-origin` policy is one line.

**Recommendation:** add a small middleware setting, at minimum,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
`X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), and a CSP. The SPA uses inline
styles (antd) and Vite-hashed assets, so a workable CSP is roughly
`default-src 'self'; connect-src 'self' <litellm_origin>; style-src 'self' 'unsafe-inline'; img-src 'self' data:` — verify against the built bundle. HSTS once leg A is TLS-terminated.

### SEC-08 (Medium) — Long-lived bearer credentials in localStorage; keys never expire

**Location:** `frontend/src/providers/session.ts:67-85` (`loadSession`/`saveSession` on `localStorage`), `backend/src/invite_litellm/app.py:316-324` (`_create_team_key` sets no `duration`/`expires`)

Two compounding design facts:

1. The session (the `/v2/login` JWT, whose `key` claim **is** the user's virtual key) is
   persisted in `localStorage` under `litellm_session`. Any XSS (see SEC-07) or malicious
   browser extension steals a directly-spendable credential. There is no `httpOnly`
   cookie option in LiteLLM's session model, so this is partly forced by the proxy — but
   it raises the stakes for every other finding here.
2. Invite-issued keys are generated with **no expiry**: `duration`/`expires` is never
   set, so the default is "never expires". The only cap is the budget (when there is one
   — SEC-06). A key leaked once (pasted in a notebook, committed in a script, stolen via
   XSS) remains valid forever unless manually rotated.

**Recommendation:** let admins configure a default key duration for invite-issued keys
(e.g. 90 days) at team creation or globally; surface "expires" prominently in the keys
list (the column already exists); document the localStorage tradeoff and encourage
periodic regeneration (the UI's Regenerate flow exists and preserves budgets). For
higher-security deployments, mention `enable_jwt_auth`-based short sessions as a proxy-side option.

### SEC-09 (Medium) — Any leaked user key + any invite link = new keys in the victim's name

**Location:** `backend/src/invite_litellm/app.py:201-214` (`_user_id_from_key`), `app.py:343-345` (bearer mode)

In bearer mode the backend resolves the caller's identity as "whoever owns the presented
virtual key" (`GET /key/info?key=...` with the master key), then acts **as that user**:
adds them to the team and issues a new key. Possession of any of a user's keys is
therefore sufficient to enroll that user into any team for which the attacker holds an
invite link, and to mint additional keys in their name (spend attributed to the victim;
the one-key-per-team guard only blocks the same team). Virtual keys are exactly the kind
of secret that gets copied into scripts and CI variables, and invite links are shared in
team chats — the two halves of this attack travel through the same channels.

This is inherent to LiteLLM's bearer-key model (a key *is* the credential), so it is a
documented-risk finding rather than a bug — but the backend makes it frictionless: it
accepts *any* LiteLLM key (not just session keys), including admin keys.

**Recommendation:** document the trust equivalence "key = user" in the README. If a
cheap hardening is wanted: require the caller's key to pass `/key/info` **and** be
non-expired/non-blocked (currently only existence is checked — LiteLLM returns the info
regardless of block status), and pass the key to upstream as a header-adjacent parameter
if the API allows, rather than a query parameter that may be logged (SEC-14).

### SEC-10 (Low) — Unbounded request body on the redemption endpoint

**Location:** `backend/src/invite_litellm/app.py:347` (`await request.body()`), `app.py:217-232` (`_parse_account`)

`request.body()` reads the entire request into memory with no size cap; `_parse_account`
then `json.loads` it. Two failure modes: (a) a client with a valid invite code can POST a
multi-gigabyte body and balloon the process's memory (uvicorn/Starlette impose no limit);
(b) a body of deeply nested JSON (`[[[[...`) raises `RecursionError`, which is not a
`ValueError` — it escapes `_parse_account`'s handler and produces a 500 with a traceback
in the logs. Both require a valid code (validation runs first), hence Low.

**Recommendation:** reject bodies over ~64 KB before reading (Content-Length check), and
catch `RecursionError` alongside `ValueError`. A reverse-proxy `client_max_body_size`
(SEC-03) covers the unauthenticated case as defense in depth.

### SEC-11 (Low) — Half-created accounts when password setting fails

**Location:** `backend/src/invite_litellm/app.py:263-268` (password set after `/user/new` succeeds)

`_create_user` first creates the user (`/user/new`, no password field exists there), then
sets the password via `/user/update`. If the second call fails (proxy hiccup, transient
502), the account exists **with no usable password**: the invitee cannot sign in, and
retrying returns 409 "An account with this email already exists. Sign in with it
instead" — which is untrue and unrecoverable through this UI. The email is effectively
burned until an admin intervenes.

**Recommendation:** on password-set failure, best-effort delete the just-created user
(`/user/delete`) before returning the 502, or return a specific error and treat the next
duplicate-email signup for a user with no password as "resume and set the password".

### SEC-12 (Low) — No password policy

**Location:** `backend/src/invite_litellm/app.py:227-231` (only non-blankness), `frontend/src/pages/invite/index.tsx:407-450` (no length/complexity rule)

Both the backend and the signup form accept a 1-character password. Whatever LiteLLM's
own login path enforces (historically little in OSS), a weak password plus leg B's
`/v2/login` with no lockout (SEC-03) is a direct account-takeover path on public
deployments.

**Recommendation:** minimum length (≥ 10) plus a small blocklist check server-side in
`_parse_account`, mirrored in the form rules.

### SEC-13 (Low) — Upstream error strings passed through to clients

**Location:** `backend/src/invite_litellm/app.py:119-135` (`_error_message`), used in every 502 `detail`

Every upstream failure's LiteLLM-generated message is embedded verbatim in the FastAPI
`detail` shown in the SPA. LiteLLM admin-endpoint errors occasionally include internal
details (key hashes, user ids, path fragments) that are harmless individually but sketch
the internals to an anonymous caller probing `/invite/.../info`'s failure modes. The
duplicate-email detection (`"already exists" in message`) also depends on upstream
wording staying stable.

**Recommendation:** acceptable for a self-hosted tool; if hardening, log the full
upstream message with a correlation id and return a generic `detail` (keeping the 409
duplicate-email case, which is intentionally user-facing).

### SEC-14 (Low) — Invite codes and keys in URLs, logs, and history

**Location:** invite codes: `backend/src/invite_litellm/app.py:98-101` (code in URL path), uvicorn access log (full request line); caller key as query param: `app.py:202`

- The invite **code travels in the URL**, so it lands in: uvicorn's access log (enabled
  by default — `main()` runs plain `uvicorn.run`, and the container's CMD goes through
  it), any intermediate proxy's logs, and the invitee's browser history. Operators who
  ship access logs to an aggregator export invite codes with them.
- The signed-in redemption mode passes the caller's **virtual key as a query parameter**
  (`/key/info?key=sk-...`) to the proxy — query strings are the most-logged part of a
  request in typical proxy/observability setups (this is LiteLLM's API shape; the backend
  cannot change it, but should be aware).

**Recommendation:** run with access logs off (`--no-access-log`) or scrub `/invite/` in
log pipelines; note the query-param caveat in operator docs.

### SEC-15 (Low) — Anonymous information disclosure

**Location:** `backend/src/invite_litellm/app.py:138-159` (404 "Team not found" vs 403 "Invalid invite code"), `app.py:371-373` (`GET /config`)

- The distinct 404/403 responses let an anonymous caller distinguish "team exists" from
  "team doesn't" (and confirm valid `team_id`s) without knowing any code. Team ids are
  not secret by design (they appear in invite URLs), so this is a small leak; collapsing
  both to 403/404 uniformly is a one-line change if desired (the distinct codes do help
  legitimate invitees understand broken links).
- `GET /config` discloses the **internal LiteLLM URL** and the app version to anonymous
  visitors. The URL must be advertised to the browser for the SPA to work (by design),
  but this doubles as reconnaissance: an attacker learns exactly where to point
  `/v2/login` brute-force attempts (SEC-03) without touching the proxy.

**Recommendation:** document both as intended; if the proxy should stay unaddressable
from browsers, the architecture itself (leg B) must change (e.g. proxy everything through
the backend), which is out of scope for this report.

### SEC-16 (Low) — CI supply chain: actions pinned by tag, no dependency auditing

**Location:** `.github/workflows/docker.yml:21-53`

The workflow pins actions by major tag (`actions/checkout@v4`, `docker/build-push-action@v6`,
…) rather than commit SHA, and uses the default `GITHUB_TOKEN` with `packages: write`.
A tag-rewrite attack on any of these actions runs attacker code in CI with push access to
the published container image. No Dependabot/Renovate configuration exists for either the
Python (`backend/uv.lock`) or npm (`frontend/package-lock.json`, resolved with
`legacy-peer-deps`) dependency trees, and no lockfile audit (e.g. `pip-audit`,
`npm audit`) runs anywhere — CI only builds the image.

**Recommendation:** pin actions to commit SHAs; enable Dependabot (or Renovate) for both
ecosystems; optionally add a `pip-audit`/`npm audit --omit=dev` job. The workflow's
already-scoped permissions (`contents: read`, `packages: write`) are good — keep that.

### SEC-17 (Informational) — Invite redemption silently widens team permissions

**Location:** `backend/src/invite_litellm/app.py:173-191` (`_check_invite` back-fills `team_member_permissions`)

Anyone redeeming (or even just validating via `POST`, which runs `_check_invite`) an
invite for a team whose members lack key-management routes triggers
`/team/permissions_update`, granting **every member of that team**
`/key/generate` + `/key/delete`. This is necessary for the self-service flow (LiteLLM
blocks members from managing their own keys otherwise) and it is a union (never removes
permissions), but it means an admin's tighter configuration is silently widened the
moment a link is redeemed. An admin who deliberately withheld those permissions from a
team and still left an invite code active would notice only by diffing team config.

**Recommendation:** intentional and documented in the README ("Members are automatically
granted permission…") — keep, but consider logging the back-fill at WARNING when it
actually changes something, so operators see it happen.

### SEC-18 (Informational) — Modulo bias in invite code generation

**Location:** `frontend/src/utils/invite.ts:3-8` (`value % chars.length` on a `Uint32Array` from `crypto.getRandomValues`)

`2³² mod 62 = 4`, so code characters at indices 0–3 (`A`,`B`,`C`,`D`) occur one extra
time per 2³² draws — a bias of ~1.4 × 10⁻⁸, reducing the effective entropy of the 8-char
code by a negligible fraction of a bit out of ~47.6. `crypto.getRandomValues` is the
right primitive. No action needed; rejection sampling would remove the bias if the code
is ever touched.

### SEC-19 (Informational) — Non-constant-time invite code comparison

**Location:** `backend/src/invite_litellm/app.py:157` (`stored_code != invite_key`)

The invite-code comparison is not constant-time. A timing side channel over a network
JSON API (with FastAPI/uvicorn/HTTP jitter of microseconds-to-milliseconds against
per-character leaks of nanoseconds) is not practically exploitable. Listed for
completeness; `hmac.compare_digest` would be the drop-in fix if the code is ever touched.

## 4. What is done well

Genuine strengths observed during the review, worth preserving:

- **Fail-fast configuration:** the app refuses to start with a missing or rejected master
  key (verified against the proxy, any non-200 is fatal) instead of serving broken 503s —
  misconfiguration cannot hide (`app.py:41-76`, with subprocess integration tests).
- **Path traversal handled correctly:** `resolve()` + `is_relative_to` against a resolved
  static root; symlinks are resolved before the check; missing extension-bearing assets
  stay 404; and there is a regression test (`test_path_traversal_is_blocked`).
- **No CORS headers anywhere** — the API surface is same-origin by default (no permissive
  CORS middleware to misuse), and the JSON-content-type redemption POST forces a preflight
  from other origins.
- **CSRF is structurally absent:** no cookie-based auth anywhere; bearer tokens are
  explicitly attached by the SPA.
- **Secret handling in code:** the master key is used only in the `Authorization` header
  of upstream calls, never logged, never returned; generated keys are shown exactly once
  by design; `.dockerignore` keeps `.env` out of images.
- **No SSRF surface:** the upstream base URL is fixed configuration (never user input),
  and the shared `httpx.AsyncClient` does not follow redirects (`follow_redirects`
  defaults to `False`), so an upstream redirect cannot be abused.
- **Container hygiene:** multi-stage build, dedicated non-root UID 1000, runtime-only
  master key, minimal CI permissions (`contents: read`, `packages: write`).
- **Input handling:** all upstream responses are defensively type-narrowed before use;
  LiteLLM error strings are surfaced without ever reflecting unsanitized HTML (React
  escapes by default; no `dangerouslySetInnerHTML` anywhere in the SPA).
- **Invite codes** use the platform CSPRNG with an adequate 8-char/62-alphabet keyspace
  (~47.6 bits), fine against online guessing once rate limiting (SEC-03) exists.
- **Test suite** covers the security-relevant error paths: traversal, bad codes, unknown
  teams, invalid JSON, missing fields, and every upstream failure mode (36 tests).

## 5. Deployment hardening checklist

For anyone running this in production:

1. **Untrack `.env`** before putting any real key in it (SEC-01): `git rm --cached .env`
   and ignore it.
2. **TLS everywhere the network is untrusted** (SEC-02): terminate TLS at a reverse proxy
   for the app (leg A) and the proxy's browser-facing side (leg B); use `https://` for
   `LITELLM_URL` (leg C) or keep backend and proxy on a private network.
3. **Reverse proxy in front of the backend** providing: rate limiting on `/invite/`
   (SEC-03), a request-body cap (SEC-10), security headers / HSTS (SEC-07), and access-log
   scrubbing or `--no-access-log` (SEC-14). If rate limiting happens at the proxy, run
   uvicorn with `--proxy-headers` so limits see real client IPs.
4. **Don't expose the LiteLLM proxy publicly.** If the SPA must reach it, only via the
   same TLS reverse proxy; protect `/v2/login` (no app-side lockout exists — SEC-03) and
   change/harden the default `admin`/master-key UI credentials.
5. **Set budgets deliberately** (SEC-06): always configure a member budget (and ideally a
   team budget) on teams that get invite links; restrict `models` on teams rather than
   relying on the default "all models".
6. **Rotate invite links** after the intended cohort joins (codes have no expiry —
   SEC-08); treat them as bearer secrets in chat/email.
7. **Pin CI actions by SHA and enable dependency updates** (SEC-16).
8. Keep the backend container network-isolated: it holds the master key, i.e. full proxy
   admin power.

## 6. Prioritized remediation summary

| Priority | Item | Findings |
|---|---|---|
| P0 | Untrack `.env`, add `.gitignore` entry + `.env.example` | SEC-01 |
| P0 | Document/enforce TLS on legs B and C | SEC-02 |
| P1 | Rate limiting on `/invite/*` (proxy-level preferred) + failure logging | SEC-03 |
| P1 | Make one-key-per-team safe under concurrency (lock + post-check) | SEC-04 |
| P1 | Server-side email syntax + password length checks | SEC-05, SEC-12 |
| P1 | Security headers middleware (+ CSP) | SEC-07 |
| P2 | Warn/refuse on budget-less invite teams; optional default key duration | SEC-06, SEC-08 |
| P2 | Body-size cap + `RecursionError` handling; rollback of half-created users | SEC-10, SEC-11 |
| P2 | Blocked/expired-key check in bearer mode; document key=user equivalence | SEC-09 |
| P3 | CI hardening (SHA pinning, Dependabot, lockfile audits) | SEC-16 |
| P3 | Collapse 404/403 (optional), generic upstream errors, log scrubbing | SEC-13, SEC-14, SEC-15 |

## 7. Limitations of this review

- Static review only: no penetration testing, fuzzing, or live LiteLLM instance was
  exercised; runtime behavior of LiteLLM itself (v1.100.x per `frontend/AGENTS.md`)
  — including `/v2/login` brute-force protections and `/key/info` semantics for blocked
  keys — was taken from project documentation, not re-verified.
- No automated dependency vulnerability scan was run against `backend/uv.lock` or
  `frontend/package-lock.json`; dependency findings here are about the *absence* of
  scanning, not known CVEs.
- The stale root `Dockerfile` (paths moved to `backend/`) is an availability issue, not a
  security one, and is excluded — except that CI images built from it cannot pick up
  security fixes until fixed.

---

*This report was generated from a manual review at commit `6ff58fe` on 2026-11-19. Re-run
the analysis after remediation or significant changes to the redemption flow.*
