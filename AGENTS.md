# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

## Project

Agent Mirror: a pinned, offline, read-only snapshot of coding-agent CLIs (Claude Code, Codex, DeepSeek Harness) plus Node/Git installers, served from one Docker image (nginx + Verdaccio) on an intranet host. Core invariant: exact versions only — never `^`, ranges, or `latest`; the image never self-updates.

## Commands

- Setup: `mise trust && mise install && mise run install` (= `npm ci --ignore-scripts --no-audit --no-fund` — always `--ignore-scripts`, never plain `npm install`)
- Checks: `npm run check` (tsc --noEmit), `npm test`, `npm run validate`
- Single test file: `node --test test/<name>.test.ts` — TypeScript runs directly, there is no compile step
- `npm run build:mirror` needs open internet + ≥15 GB free disk; run only when the user explicitly asks. After a successful build, copy `dist/mirror-lock.json` over `mirror-lock.json` and commit both.

## Code constraints

- `erasableSyntaxOnly` is on (Node 24 type-stripping): no enums, namespaces, or parameter properties; imports use explicit `.ts` extensions and `node:` prefixes.
- All dependencies are exact-pinned, including npm itself (11.12.1): the resolver invokes `node_modules/npm/bin/npm-cli.js` via `process.execPath`, not the ambient npm.
- Two independent Node versions: builder toolchain (`mise.toml` + both Dockerfiles — change together, then `mise lock`) vs. the Node distributed to clients (`mirror.yaml` `node.version`).
- User-facing text (README, `web/`, `installers/`, `docs/`) is Chinese; code identifiers, comments, and commit messages are English.
- Commits: Conventional Commits (`fix:` / `feat:` / `chore:`).

## Config files

- `mirror.yaml` is the only hand-maintained resource config. `mirror-lock.json` (~6 MB) is generated — never edit it by hand, only via rebuild + copy from `dist/`.
- `npm run add-latest` tracks codex/dsh only and rolls `mirror.yaml` back if the build fails; it never removes versions (use `npm run remove-version`).
- `.mirror-work/building` is a concurrency lock holding a PID; delete it only if that process is dead.

## Lifecycle-script approval

Packages with unapproved preinstall/install/postinstall scripts fail the build. Approval flow: read `.mirror-work/script-audit.json` (fields: `package`, `scripts`, `sha256`, `inspection` dir, `approved`), show the user the actual script contents, and only after explicit confirmation add `'name@version': <tarball sha256>` to `mirror.yaml` `approvedScripts`. Never approve without confirmation. Background in `docs/SCRIPT-REVIEW.md`.

## Gotchas

- Smoke tests (`npm run smoke`) require `MIRROR_NETWORK_ISOLATED=1`, x64, and actively probe that registry.npmjs.org / downloads.claude.ai are unreachable; they refuse the system `/tmp` as HOME.
- The install page must not expose validation/test content — `test/site.test.ts` asserts forbidden strings (`验收`, `测试报告`, `npm 11`, `install-tool`).
- `compose.yaml` uses `pull_policy: never` — `docker load` the image locally before `docker compose up`.
- `scripts/export.sh` refuses to overwrite an existing archive.
