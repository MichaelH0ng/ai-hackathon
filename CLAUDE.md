# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

NorthStar: a beginner-friendly personal finance app (React + Vite frontend, Express API, Plaid for bank data, Claude for the "Polaris" assistant and photo price scanning). Brand and tone rules live in `BRAND_GUIDELINES.md`. `PLAID_PLAN.md` is the durable state of the Plaid integration (checklist, acceptance rounds, open human tasks).

## Commands

```bash
npm run dev          # web (Vite :5173) + API (tsx watch, :8787) + optional local voice service, via concurrently
npm run dev:phone    # same, but Vite is exposed on the LAN
npm run build        # tsc -b && vite build
npm test             # vitest run (all tests)
npx vitest run server/plaid.test.ts            # one test file
npx vitest run -t "name of test"               # one test by name
npm run lint         # oxlint
```

Vite proxies `/api` to `127.0.0.1:8787` (IPv4 on purpose; the API listens on IPv4 loopback only). Copy `.env.example` to `.env` for keys. The app works without any keys: typed prices and sample data need none, and Plaid sandbox only needs `PLAID_CLIENT_ID` + `PLAID_SANDBOX_SECRET`.

## Architecture

**Two halves sharing one `src/lib`.** `src/` is the React app. `server/` is a single Express app that imports pure logic from `src/lib` (for example `money.ts`, `safeToSpendExplain.ts`, `safeToSpend.ts`) so the browser and server compute the same numbers. Keep those `src/lib` modules free of browser-only APIs.

**One Express app, two runtimes.** `server/index.ts` exports the app. Locally `npm run dev` listens on 8787. On Vercel, `api/index.ts` re-exports it and `vercel.json` rewrites every `/api/*` to it. Code branches on `process.env.VERCEL` (for example the local-only Host-header check that blocks DNS rebinding, and the data directory moving to `/tmp`).

**Plaid lives in `server/plaid.ts`** (router mounted in `index.ts`):
- Every Plaid call is server-side. Access tokens never reach the browser.
- Connections and sync state persist as JSON in `server/data/` (git-ignored, separate `-production` files). `NORTHSTAR_DATA_DIR` redirects this, so use it for tests or sandbox runs to avoid touching real saved connections.
- `syncStore.ts` keeps the transaction sync cursor and full transaction list per connection; nothing is saved until the last page arrives. `transactionArchive.ts` holds older history. Per-connection results are cached about ten minutes, and rate-limit errors keep the last good data instead of blanking the UI.
- `sandboxStudent.ts` defines the fake "test student bank" persona.
- Single local user only. There is no auth or per-user token storage, so it is not safe to deploy as multi-user yet.
- Before changing Plaid-touching code, use the Plaid MCP `build_guidance`, and re-run `build_check_acceptance` before calling the change working (see `PLAID_PLAN.md`).

**Claude calls (all in `server/index.ts`, key stays server-side):** `/api/scan` (image to item and price), `/api/financial-chat` (Polaris, routes between Haiku and Sonnet via `needsSonnet`, with data helpers in `assistantData.ts`), `/api/safe-to-spend/explain`, `/api/savings-plan` (plan logic in `savingsPlan.ts`). Model answers are checked against computed facts (`sentenceMatchesFacts`) with template fallbacks, so deterministic numbers come from code, not the model.

**Frontend state.** There is no router or state library. `App.tsx` holds a `Screen` union plus a dashboard tab, synced with the URL hash (`pageHashes`). User data (goals, wage, history) is in localStorage via `src/lib/storage.ts`. Bank data comes from the `useBank` hook, which calls the server. Money views use `src/lib/money.ts` (net worth, cash flow, transfer detection, bills). Savings and goal math is in `src/lib/finance.ts`, `goalPath.ts`, `envelopes.ts`, `planning.ts`.

**Optional local voice.** `voice/server.py` (OpenVoice + MeloTTS on `127.0.0.1:8790`) is started by `scripts/voice.mjs` only if the Python env and model files exist; otherwise the app silently falls back to a browser voice. Setup is in `voice/README.md`. `voice/vendor`, samples, and speaker files are git-ignored and treated as sensitive.

## Gotchas

- `server/data/`, `.env*` (except `.env.example`), and voice assets are git-ignored on purpose. Never commit them.
- README says the assistant in `src/lib/moneyAssistant.ts` is on-device, but the live Polaris chat goes through `/api/financial-chat` and sends dashboard context to Claude. Treat privacy wording in the UI and docs accordingly (`src/lib/privacy.ts` handles the "hide amounts" toggle).
- `dist/` is build output and `pitch-deck*` files are presentation material, not app code.
