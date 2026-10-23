# Project template

Starting point for new projects made with `dev <name>` (claude-dev kit). It brings:

- `CLAUDE.md`: a skeleton the box fills in during its first session
- a working demo site (`public/`, `Dockerfile`, `nginx.conf`) that meets the deploy contract, so CI
  is green from the first commit. Replace it with the real project.
- `.github/workflows/ci.yml`: a thin caller. The pipeline itself (checks, hardened Docker test,
  browser tests, deploy to Coolify after green CI on `main`) is `pipeline.yml` in this repository,
  shared by all projects as `seitenschwung/template/.github/workflows/pipeline.yml@v1`
- `docker-compose.yml`: what Coolify runs (the image tested by CI), with the CrowdSec labels and log rotation
- `.gitignore`, `.dockerignore`, a PR template

## Changing the shared pipeline (owner)

Projects follow the moving tag `v1`. After a tested change to `pipeline.yml` on `main`, move it:
`git tag -f v1 && git push -f origin v1`. A breaking change gets `v2`; projects switch by editing
the `uses:` line in their `ci.yml`. Test changes on a branch by pointing this repository's own
`ci.yml` at that branch (`...pipeline.yml@<branch>`), and set it back to `@v1` before merging.
This repository's CI runs the demo through the pipeline, so a green run is the template's self-test.

Replace this README with one about the project.

## Setting up the deploy

`dev <name>` does this for a new project: it sets the repository variable `DEPLOY=auto` and starts
the first CI run. On `main` the pipeline then creates a Coolify project and app named like the
repository (domain `https://<name>.seitenschwung.com`, service `web` on port 8080), sets `IMAGE`,
deploys the tested image and checks `/version.txt` and `/healthz`. The box only has to push.

Once for the organisation (owner):
- organisation secrets `COOLIFY_TOKEN` (API token with read, write and deploy), `TS_OAUTH_CLIENT_ID`,
  `TS_OAUTH_SECRET` (Tailscale OAuth client with tag `tag:ci`); organisation variable `COOLIFY_URL`
- optional organisation variables `BASE_DOMAIN` (default `seitenschwung.com`) and `COOLIFY_SERVER_UUID`
  (needed only if Coolify has more than one server)
- a wildcard DNS record `*.<BASE_DOMAIN>` pointing at the server

Per project, optional repository variables: `DEPLOY=off` (or unset) for no deploy at all,
`BROWSER_TESTS=off` for a project without a web UI. Repositories must be public, because Coolify
clones them without credentials. Older projects with a hand-made Coolify app keep working with the
repository variables `COOLIFY_APP_UUID` and `APP_URL`. This template and the other blueprints do
not set `DEPLOY`, so they never create an app.

The deploy steps live in the workflow on purpose: the bot that writes the code can't change
workflow files, so it can't change what runs with the deploy secrets.
