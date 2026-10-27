---
name: update-mirror
description: >-
  Refresh this repo's pinned Agent Mirror to current npm dist-tags.latest,
  pin the Windows DeepSeek Harness desktop installer as an asset, rebuild dist/,
  and package the runtime image with Dockerfile.prebuilt. Use when the user
  asks to 更新最新版, 追 latest, 构建缓存, 构建镜像, 打包镜像, or /update-mirror.
when-to-use: >-
  更新最新版, 把 desktop 放进 asset, 构建镜像缓存, 打包 agent-mirror 镜像, /update-mirror
compatibility: Requires outbound network, Node >=24, Docker, and at least 15 GB free disk. Repo-local only.
---

# Update and package Agent Mirror

This skill applies only inside the `agentMirror` repository. Do not copy it to `~/.grok/skills/`. Follow `AGENTS.md`. Do not commit, export a tar, start or replace a container, or delete old tool versions unless the user asks.

`npm run add-latest` only tracks Codex and DSH, and it rolls `mirror.yaml` back if its build fails. A full refresh edits `mirror.yaml` once, then runs `npm run build:mirror`. Do not run `add-latest` after that edit.

## What to update

Re-fetch every version in this run. Do not reuse versions from an earlier session.

Append these npm `dist-tags.latest` values and set each `defaultVersion` to the new one. Keep every existing version.

| Config | Registry package | Tag |
| --- | --- | --- |
| `tools.claude` | `@anthropic-ai/claude-code` | `latest`, not `stable` |
| `tools.codex` | `@openai/codex` | `latest` |
| `tools.dsh` | `@deepseek-ai/dsh` | `latest` |
| `npmPackages` `npm` | `npm` | `latest` |

Ignore `next`, `alpha`, `beta`, and `canary`. For DSH, `next` is the newer prerelease channel (`rc` publishes there). It is not the desktop installer and not the version this mirror installs by default.

Leave `node.version` and the Git for Windows asset unchanged unless the user names them.

Refresh the single Windows desktop asset in place. Do not keep old desktop installers, and do not add macOS unless the user asks.

1. Read `https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml`.
2. Use its `version`, absolute `url`, `sha512`, and `size`. Refuse the floating `dsh-latest-windows-x64.exe` URL.
3. Download that exact exe. Require the file size and SHA-512 to match the feed, then compute SHA-256.
4. Replace the `dsh-desktop-windows` asset. The filename must be `deepseek-harness-<version>-win-x64.exe`. Description stays `DeepSeek Harness 桌面版（Windows x64）`.
5. Expect the desktop version to differ from npm `latest`. Record both. Do not force them to match.

Preserve YAML comments. Run `node src/build.ts validate` before the cache build. Snapshot `mirror.yaml` first.

## Cache

Check free disk and that `.mirror-work/building` is absent. Delete that lock only when its PID is dead.

Run `npm run build:mirror`. It needs the network. A config change re-resolves every root, then republishes the registry. `approvedScripts` is not part of `configHash`.

If the build stops for unapproved lifecycle scripts:

1. Keep the edited `mirror.yaml`.
2. Read `.mirror-work/script-audit.json` and the files under each unapproved `inspection` directory.
3. Show the user the package, script command, and script body. Say whether those bytes match an already approved version.
4. Stop. Add `'name@version': <tarball sha256>` only after the user explicitly approves. Never copy an old digest onto a new tarball.
5. Run `npm run build:mirror` again. Do not run `add-latest`.

For any other build failure, restore the snapshot and report the error. Do not claim `dist/` is current.

After success:

1. Copy `dist/mirror-lock.json` over `mirror-lock.json`.
2. Check `dist/public/catalog.json` defaults, `claude-code-releases/latest`, and the desktop file size and SHA-256.
3. Run `npm test`. Do not package the image if tests fail.

## Image

Package only the reviewed `dist/` snapshot:

```bash
TAG=$(date +%Y%m%d)
docker build -f Dockerfile.prebuilt -t "agent-mirror:$TAG" .
```

Use `Dockerfile.prebuilt`, not `Dockerfile`. If `agent-mirror:$TAG` already exists, ask before replacing that tag.

Verify without starting the server:

```bash
docker run --rm --entrypoint node "agent-mirror:$TAG" -e '<read /opt/mirror/public/catalog.json and the desktop exe>'
```

Confirm the new defaults and `dsh-desktop-windows`. Report the tag, image ID, and size.

Do not run `scripts/export.sh`, `docker compose up`, or replace a running container unless the user asks. Export refuses to overwrite an existing archive:

```bash
bash scripts/export.sh "agent-mirror:$TAG" "releases/agent-mirror-$TAG.tar"
```

The image is not an intranet release until it is exported, loaded, and the container is replaced. Say that when you finish.
