# cockpit

## Purpose
Static dashboard of the home server (boxes, repos, sites). Tailnet only: http://cockpit.seitenschwung.com.
Brief and schema: `~/inbox/BRIEF.md`, `~/inbox/SCHEMA.md` (status.json schema 1). Runs on the VPS (tailnet only), `ports: 127.0.0.1:8090:8080`. CSP in nginx.conf forbids inline JS/CSS. Don't deviate from the
schema; a missing field goes into the PR text, the owner extends the collector.

## Stack
Plain HTML/CSS/JS in `public/`, no build, no external fonts/CDNs. UI text is German.

## Commands
- Dev server: `cd public && python3 -m http.server 8090 --bind 0.0.0.0`
- `?now=<ISO>` pins the clock (sample data is old, otherwise it shows "Sammler hängt").
- No npm, no tests; CI builds the Dockerfile and crawls `/` (axe, Lighthouse).

## Layout
- `public/index.html`, `style.css`, `app.js`: the UI; fetches `DATA_URL` (top of app.js) every 15 s: `./status.json` on localhost/CI, else the home server's URL (CORS, no credentials).
- `public/status.json`: fake sample data (copy of `~/inbox/status.sample.json`). Never commit real data.
- `Dockerfile`, `nginx.conf`: template for CI only; production serves `public/` directly.

## Conventions
- Read-only: no buttons that trigger anything, only links (new tab).
- Render with `textContent`/DOM, never innerHTML. Dark and light via `prefers-color-scheme`.
- Phases: 1 skeleton + states, 2 design polish; each its own PR with label `manual-review`.

## CI and deploy contract
See the Dockerfile header: port 8080, `/healthz`, `/version.txt`, non-root. Keep CrowdSec labels in
`docker-compose.yml`. `main` deploys after green CI.
