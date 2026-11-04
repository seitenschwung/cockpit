# cockpit

## Purpose
Static dashboard of the home server (boxes, repos, sites). Tailnet only: https://homeserver.tailedf987.ts.net:8445.
Brief and schema: `~/inbox/BRIEF.md`, `~/inbox/SCHEMA.md` (status.json schema 1). Runs only on the home server: it serves `public/` of `main` and the real `status.json` from one origin (a merge to `main` is live within a minute). No Coolify, no domain, no Traefik label, no public port. CSP in nginx.conf forbids inline JS/CSS. Don't deviate from the
schema; a missing field goes into the PR text, the owner extends the collector.

## Stack
Plain HTML/CSS/JS in `public/`, no build, no external fonts/CDNs. UI text is German.

## Commands
- Dev server: `cd public && python3 -m http.server 8090 --bind 0.0.0.0`
- `?now=<ISO>` pins the clock (sample data is old, otherwise it shows "Sammler hängt").
- Tests: `npm ci && CHROMIUM_PATH=/usr/bin/chromium npm test` (Playwright, `tests/states.spec.mjs`, mocks status.json). CI also builds the Dockerfile and crawls `/` (axe, Lighthouse).

## Layout
- `public/index.html`, `style.css`, `app.js` (state, cards, `ui` object synced to URL hash, pages via `ui.pg`), `charts.js` (token/resource/egress charts, filters, table view): the UI; fetches `DATA_URL` (top of app.js) every 15 s: always `./status.json` (same origin).
- `public/activity.js`: Aktivität page (host/box curves as inline SVG, disks, deploys, sites, costs). Loaded before app.js on purpose (app.js renders at once; a late script races).
- `public/detail.js`: project detail page (`pg=project&p=<name>`), reuses `projectRows`, `boxStats`, `prList` from app.js.
- `public/status.json`: fake sample data (copy of `~/inbox/status.sample.json`). Never commit real data.
- `Dockerfile`, `nginx.conf`: the image CI builds and tests (not deployed).

## Conventions
- Layout: sidebar nav (`#nav`, `data-pg`) switches `.page[data-page]` sections: overview, projects, prs, stats, activity, system. Route is `pg=` in the URL hash.
- Self-check: only the card whose `site.url` origin == `location.origin` is probed in the browser (`./healthz`, `./version.txt`, `selfCheck()` in app.js). Never probe other sites. `site.checked === false` is shown as "nicht vom Home-Server prüfbar", not as down.
- Theme (`data-theme`) and density (`data-density`) are device prefs in localStorage; tab title shows `(n)` needs-attention count, favicon colour = overall level.
- Read-only: no buttons that trigger anything, only links (new tab).
- Render with `textContent`/DOM, never innerHTML. Dark and light via `prefers-color-scheme`.
- Phases: 1 skeleton + states, 2 design polish; each its own PR with label `manual-review`.

## CI contract
See the Dockerfile header: port 8080, `/healthz`, `/version.txt`, non-root. Keep CrowdSec labels in
`docker-compose.yml`. Coolify no longer deploys; the home server serves `main` directly. Don't set `DEPLOY` for this repo.
