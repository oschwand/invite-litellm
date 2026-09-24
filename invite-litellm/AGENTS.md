# AGENTS.md

## Project Overview

Frontend admin panel built with [Refine](https://refine.dev) v5 — a React framework for CRUD apps. Scaffolded from `create-refine-app` (single initial commit). Stack: React 19, TypeScript, Vite 6, Ant Design 5, React Router 7, Refine DevTools.

Despite living under a `Python/` directory and being named "invite-litellm", this repo is pure TypeScript/React — no Python code. The **auth** provider talks to a real LiteLLM proxy (default `http://localhost:4000`). The data provider (`src/providers/data.ts`) still uses the scaffold's `createSimpleRestDataProvider` — it shares the same `API_URL` (LiteLLM) but is unused (no resources routed); expect it to be replaced by a LiteLLM-specific provider later. No Python-backend features (invite redemption, `/config`) are wired yet — by design.

## Commands

```bash
npm run dev      # dev server (wraps `refine dev`)
npm run build    # typecheck (tsc, noEmit) THEN vite build via `refine build` → dist/
npm run start    # serve production build
npx tsc --noEmit # typecheck only (the same gate that runs first in `npm run build`)
npx eslint .     # lint (see gotcha below — there is NO `lint` script in package.json)
```

- No test framework is configured. There are no tests and no test runner.
- `.npmrc` sets `legacy-peer-deps=true` — use npm; dependency resolution expects it.

## Architecture

Standard Refine composition, all wired in `src/App.tsx`:

```
BrowserRouter → RefineKbarProvider → ColorModeContextProvider → AntdApp → DevtoolsProvider → <Refine>
```

- `src/providers/data.ts` — REST data provider via `createSimpleRestDataProvider({ apiURL })`. Also exports `kyInstance` (the underlying ky fetch client) for custom/non-CRUD requests.
- `src/providers/auth.ts` — **real LiteLLM auth**: `login` POSTs `{username, password}` to `POST {API_URL}/v2/login` (endpoint hidden from the proxy's OpenAPI spec; default admin is `admin` + master key). Success returns a session JWT that is **decoded client-side, never verified** (`decodeJwtPayload`); the JWT's `key` claim is the virtual key used as `Authorization: Bearer` for API calls (the JWT itself is NOT accepted as Bearer unless the proxy enables `enable_jwt_auth`). Sessions persist as `{token}` JSON under the `litellm_session` localStorage key (`TOKEN_KEY`) — same shape/key as the Alpine frontend in `../frontend/`, so sessions are interchangeable. `check` re-derives the session on every call and rejects missing/malformed/**expired** (`exp`) tokens; `getIdentity`/`getPermissions` return the JWT claims (`user_id`, `user_email`, `user_role`); `onError` logs out on any 401 (LiteLLM invalidates session keys unpredictably, e.g. after key-management calls). Error bodies are parsed with `extractErrorMessage`, which handles all three LiteLLM shapes: `{"error": {"message"}}`, `{"detail": "..."}`, `{"detail": {"error": "..."}}`.
- `src/providers/constants.ts` — `API_URL` (LiteLLM proxy URL; reads `VITE_API_URL` env with fallback `http://localhost:4000`, trailing slashes stripped) and `TOKEN_KEY` (`litellm_session`).
- `src/contexts/color-mode/` — custom light/dark mode context, persisted to localStorage key `colorMode`, wraps antd `ConfigProvider` with `RefineThemes.Blue`.
- `src/components/` — shared components, re-exported through `src/components/index.ts`.
- `src/pages/` — one folder per page (`login/`, `register/`, `forgotPassword/`), each an `index.tsx` wrapping Refine's `<AuthPage type="...">`.

**Routing is minimal on purpose**: `App.tsx` renders `<WelcomePage />` at `/` (public) and `/login` (the custom login page wrapped in `<Authenticated fallback={<Login />}><NavigateToResource /></Authenticated>` so signed-in users bounce away). The layout pieces (`Header`, `ThemedLayout`, `Authenticated`, `CatchAllNavigate`, `ErrorComponent`) and auth pages (`Register`, `ForgotPassword`) are imported but NOT routed yet — they are the scaffold's building blocks for wiring up authenticated resource routes. See the ESLint gotcha below.

**`src/pages/login/index.tsx` is a custom login page** (antd `Form` + `useLogin`), not `<AuthPage type="login">`: the bundled AuthPage hardcodes an email field with email-format validation, but LiteLLM usernames (e.g. `admin`, or DB users' emails) need a plain **username** field with no email-validity check. It sends `{username, password}` straight to `authProvider.login`; login errors surface as antd notifications via `useNotificationProvider`.

## Conventions

- Feature-folder structure: every component/page/context is its own directory with `index.tsx`; shared components get an `index.ts` barrel re-export.
- React Router v7 import style: `from "react-router"` (not `react-router-dom`).
- Named exports for components (e.g. `export const Header = ...`), `export default App` only in `App.tsx`.
- Components are function declarations/arrow constants, not `React.FC` (exception: `Header` uses `React.FC<Props>`).
- Styles are inline `React.CSSProperties` objects + antd design tokens (`theme.useToken()`), not CSS files. The only global CSS import is `@refinedev/antd/dist/reset.css` in `App.tsx`.
- `strict: true` TypeScript; `tsconfig.json` covers `src/` (with `noUnusedLocals: false`), `tsconfig.node.json` covers `vite.config.ts`.

## Gotchas

- **`.env` now works but defaults are fine**: `src/providers/constants.ts` reads `VITE_API_URL` (fallback `http://localhost:4000`, the LiteLLM proxy) — override the proxy URL there. `.env` is gitignored.
- **ESLint currently fails (pre-existing)**: `npx eslint .` reports 12 `no-unused-vars` errors in `src/App.tsx` (the scaffold's unrouted imports listed above) plus one `react-refresh/only-export-components` warning in `color-mode/index.tsx`. `npm run build` still passes because `tsc` has `noUnusedLocals: false`. Don't be surprised by a red lint run; wiring up the routes or removing the imports resolves most of it.
- **Build gate order**: `npm run build` runs `tsc` first — type errors fail the build before Vite ever runs.
- Refine `projectId` (`11BTWd-s7WeyS-LOfTLO`) is duplicated in `package.json` (`refine` field) and `App.tsx` (`options.projectId`); it ties the app to Refine DevTools/telemetry.
- Docker image uses `refinedev/node:18` and serves `dist/` with the `serve` package as a non-root `refine` user; build context expects `package-lock.json` present (`npm ci`).
