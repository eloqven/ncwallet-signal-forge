# Repository Guidelines

## Project Structure & Module Organization

This repository is a local NC Wallet research workspace. The main dashboard lives in `index.html`; the primary local server is `server.js` on `127.0.0.1:4173`. Sidecars are split by responsibility: `gatherer-sidecar/` for browser-driven wallet gathering, `todo-runner-sidecar/` for queued automation, and `ml-sidecar/` for feature previews and future model work. `static-data/` is a read-only archive viewer. `apps/corridor-forge/` contains the 30-minute signal corridor lab. Screenshots and visual proof live under `docs/screenshots/`.

## Build, Test, and Development Commands

Install and verify from the repository root:

```powershell
npm ci
npm test
```

Run services directly with Node during development:

```powershell
node server.js
node gatherer-sidecar/server.js
node todo-runner-sidecar/server.js
node ml-sidecar/server.js
```

Use focused syntax checks while iterating:

```powershell
npm run check:syntax
```

Sidecar package folders also support `npm start` from inside their directory.

## Coding Style & Naming Conventions

Use plain JavaScript and built-in Node modules unless an existing package boundary requires otherwise. Follow the current style: two-space indentation in JSON and SQL, semicolons in server files, descriptive camelCase function names, and uppercase constants for fixed ports, paths, and external URLs. Keep local data names explicit, for example `walletPageViews`, `signalViews`, and `modelDeltaAudits`.

## Testing Guidelines

The root smoke suite starts each service on temporary localhost ports and checks its health endpoint. Run `npm test` before opening a pull request. For browser automation changes, also test manually against an authenticated Chromium session exposed at `http://127.0.0.1:9222/json/list`.

## Commit & Pull Request Guidelines

The visible history uses short imperative commit messages, for example `Add fit balance labeling workflow`. Keep commits focused and describe the behavior changed. Pull requests should include a concise summary, affected files or services, manual verification steps, screenshots for UI/report changes, and any known limitations involving local wallet state or missing runtime data.

## Security & Configuration Tips

Do not commit `data/surf-db.json`, exports, logs, credentials, or wallet-derived personal data. Keep browser debugging bound to localhost. Treat all wallet sync output as sensitive local research data.
