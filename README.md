# cockpit

Read-only dashboard of the home server (boxes, repos, sites). Plain HTML/CSS/JS in `public/`, no build.

## Where it runs

Only on the home server, tailnet only: <https://homeserver.tailedf987.ts.net:8445>. The host serves
`public/` of `main` and the real `status.json` from that one origin, so the page reads `./status.json`.
A merge to `main` is live within a minute. There is no Coolify deploy, no public domain and no public port.

## Develop and test

- Dev server: `cd public && python3 -m http.server 8090 --bind 0.0.0.0` (serves the fake sample `status.json`;
  add `?now=<ISO>` to pin the clock)
- Tests: `npm ci && CHROMIUM_PATH=/usr/bin/chromium npm test`

CI builds the `Dockerfile` image (nginx with CSP) and tests it with axe and Lighthouse. The image is a test
vehicle only; it is not deployed. `docker-compose.yml` keeps its hardened settings for that image.
