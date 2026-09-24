# AGENTS.md

## Project Overview

Frontend admin panel built with [Refine](https://refine.dev) v5 — a React framework for CRUD apps. Scaffolded from `create-refine-app` (single initial commit). Stack: React 19, TypeScript, Vite 6, Ant Design 5, React Router 7, Refine DevTools.

Despite living under a `Python/` directory and being named "invite-litellm", this repo is pure TypeScript/React — no Python code. Both the **auth** and **data** providers talk to a real LiteLLM proxy (default `http://localhost:4000`). No Python-backend features (invite redemption, `/config`) are wired yet — by design.

## Commands

```bash
npm run dev      # dev server (wraps `refine dev`)
npm run build    # typecheck (tsc, noEmit) THEN vite build via `refine build` → dist/
npm run start    # serve production build
npx tsc --noEmit # typecheck only (the same gate that runs first in `npm run build`)
npx eslint .     # lint (see gotcha below — there is NO `lint` script in package.json)
```

- No test framework is configured. There are no tests and no test runner.
- **Never start the dev server yourself** (`npm run dev`) — the user keeps one running. Typecheck with `npx tsc --noEmit` instead of smoke-testing in a browser.
- `.npmrc` sets `legacy-peer-deps=true` — use npm; dependency resolution expects it.

## Architecture

Standard Refine composition, all wired in `src/App.tsx`:

```
BrowserRouter → RefineKbarProvider → ColorModeContextProvider → AntdApp → DevtoolsProvider → <Refine>
```

- `src/providers/data.ts` — **LiteLLM data provider** mapping Refine resources to proxy endpoints: `keys` (`/key/list|info|generate|update|delete`, id = `token` hash), `teams` (`/team/list|info|new|update|delete`, id = `team_id`), `users` (`/user/list|info|new|update|delete`, id = `user_id`), `models` (**read-only**, `/model/info`, id = `model_name`; create/update/delete throw). Pagination: keys use `page`+`size` (size hard-capped at 100), users `page`+`page_size` (cap 100) — both server-side with `total_count`/`total`; teams and models return the whole list in one call (sort/filter applied client-side via `applyClientSide`). Sorters map to `sort_by`/`sort_order` (keys, users); `eq` filters map to server params (`KEY_LIST_FILTERS`/`USER_LIST_FILTERS`, e.g. `team_id`, `user_id`, `status` for keys; `role`, `team`, `user_email` for users). Response unwrapping: `/key/info` → `info`, `/team/info` → `team_info`, `/user/info` → `user_info`. `deleteOne(keys)` tolerates 404 "No keys found" as success (retry-safety for the delete→create regeneration flow). `custom()` is a passthrough to `litellmRequest`. Response shapes verified against live proxy v1.100.x — the OpenAPI spec leaves most of them untyped; `../frontend/AGENTS.md` documents the field-level semantics.
- `src/providers/litellm.ts` — thin API client: `litellmRequest(path, {method, query, body})` fetches with `Authorization: Bearer <session api_key>` (JWT `key` claim from `session.ts`; no session → 401). Errors throw `LiteLLMError` (implements Refine's `HttpError` interface: `message` + `statusCode`) with the message extracted from all three LiteLLM error shapes; network failure → statusCode 0. A 401 reaching the app triggers `authProvider.onError` → logout.
- `src/providers/session.ts` — session/JWT utilities shared by auth + data providers: `decodeJwtPayload`, `sessionFromToken`, `loadSession`, `saveSession`, `clearSession`, `extractErrorMessage`, and `TOKEN_KEY` (`litellm_session`).
- `src/providers/auth.ts` — **real LiteLLM auth**: `login` POSTs `{username, password}` to `POST {API_URL}/v2/login` (endpoint hidden from the proxy's OpenAPI spec; default admin is `admin` + master key). Success returns a session JWT that is **decoded client-side, never verified** (`decodeJwtPayload`); the JWT's `key` claim is the virtual key used as `Authorization: Bearer` for API calls (the JWT itself is NOT accepted as Bearer unless the proxy enables `enable_jwt_auth`). Sessions persist as `{token}` JSON under the `litellm_session` localStorage key (`TOKEN_KEY`) — same shape/key as the Alpine frontend in `../frontend/`, so sessions are interchangeable. `check` re-derives the session on every call and rejects missing/malformed/**expired** (`exp`) tokens; `getIdentity`/`getPermissions` return the JWT claims (`user_id`, `user_email`, `user_role`); `onError` logs out on any 401 (LiteLLM invalidates session keys unpredictably, e.g. after key-management calls). Error bodies are parsed with `extractErrorMessage`, which handles all three LiteLLM shapes: `{"error": {"message"}}`, `{"detail": "..."}`, `{"detail": {"error": "..."}}`.
- `src/providers/constants.ts` — `API_URL` (LiteLLM proxy URL; reads `VITE_API_URL` env with fallback `http://localhost:4000`, trailing slashes stripped). The session storage key `TOKEN_KEY` lives in `session.ts`.
- `src/contexts/color-mode/` — custom light/dark mode context, persisted to localStorage key `colorMode`, wraps antd `ConfigProvider` with `RefineThemes.Blue`.
- `src/components/` — shared components, re-exported through `src/components/index.ts`.
- `src/pages/` — one folder per page (`login/`, `register/`, `forgotPassword/`), each an `index.tsx` wrapping Refine's `<AuthPage type="...">`.

**Routing (full app shell)**: authenticated routes render inside `<ThemedLayout Header={Header} Sider={ThemedSider}>` (sidebar driven by the four `resources` in `<Refine>`: keys, teams, users, models — each with `list` route only). Routes: `/keys`, `/teams`, `/users`, `/models` (list pages), `/profile`; `/` redirects to `/keys` (successful login also redirects there); `/login` bounces signed-in users to `keys`; `*` renders `ErrorComponent` behind `CatchAllNavigate`. The `Register`/`ForgotPassword` page files exist but are unrouted and unused (LiteLLM OSS has no direct signup/password-reset — signup happens via invite links).

**`src/pages/login/index.tsx` is a custom login page** (antd `Form` + `useLogin`), not `<AuthPage type="login">`: the bundled AuthPage hardcodes an email field with email-format validation, but LiteLLM usernames (e.g. `admin`, or DB users' emails) need a plain **username** field with no email-validity check. It sends `{username, password}` straight to `authProvider.login`; login errors surface as antd notifications via `useNotificationProvider`.

**List pages** (`src/pages/{keys,teams,users,models}/list.tsx`) use `useTable` from `@refinedev/antd`. Keys and users use server-side pagination (the data provider maps it); teams and models set `pagination: { mode: "client" }` since their endpoints return full lists. Keys columns mirror the Alpine app (name = `key_alias ?? key_name`, owner, team, spend/budget USD, expires (`DateField`, null = Never), blocked tag, models stub + per-row `DeleteButton`). Models columns show per-Mtok pricing from `model_info.*_cost_per_token` × 1e6. Note: `/team/list` returns only `{team_id, team_alias}` (no budgets/spend) and is **admin-only** — internal-user sessions get a 400 error notification there; same for `/user/list` style admin data depending on role. The team table enrichment (budgets, spend, invite code via `/team/info`) is NOT ported yet.

## Conventions

- Feature-folder structure: every component/page/context is its own directory with `index.tsx`; shared components get an `index.ts` barrel re-export.
- React Router v7 import style: `from "react-router"` (not `react-router-dom`).
- Named exports for components (e.g. `export const Header = ...`), `export default App` only in `App.tsx`.
- Components are function declarations/arrow constants, not `React.FC` (exception: `Header` uses `React.FC<Props>`).
- Styles are inline `React.CSSProperties` objects + antd design tokens (`theme.useToken()`), not CSS files. The only global CSS import is `@refinedev/antd/dist/reset.css` in `App.tsx`.
- `strict: true` TypeScript; `tsconfig.json` covers `src/` (with `noUnusedLocals: false`), `tsconfig.node.json` covers `vite.config.ts`.

## Gotchas

- **`.env` now works but defaults are fine**: `src/providers/constants.ts` reads `VITE_API_URL` (fallback `http://localhost:4000`, the LiteLLM proxy) — override the proxy URL there. `.env` is gitignored.
- **ESLint is clean** (the scaffold's old unused-import errors were resolved by wiring the routes; only a benign `react-refresh/only-export-components` warning remains in `color-mode/index.tsx`).
- **Build gate order**: `npm run build` runs `tsc` first — type errors fail the build before Vite ever runs.
- Refine `projectId` (`11BTWd-s7WeyS-LOfTLO`) is duplicated in `package.json` (`refine` field) and `App.tsx` (`options.projectId`); it ties the app to Refine DevTools/telemetry.
- Docker image uses `refinedev/node:18` and serves `dist/` with the `serve` package as a non-root `refine` user; build context expects `package-lock.json` present (`npm ci`).
