---
name: approve-script
description: Review and approve package lifecycle scripts for the mirror. Use when a mirror build fails with "Review lifecycle scripts ... unapproved", or when the user asks to approve a package's install scripts.
---

Approve unapproved lifecycle scripts so a mirror build can proceed. Approval ALWAYS requires explicit user confirmation — never add a SHA-256 to `mirror.yaml` on your own judgment.

## Steps

1. Read `.mirror-work/script-audit.json`. Entries with `"approved": false` are the pending ones. If the file is missing or stale, ask the user to re-run the failing build first (it regenerates the audit).
2. For each pending package, read the actual script contents from its `inspection` directory (the unpacked tarball; check `package.json` `scripts.preinstall`/`install`/`postinstall` and any files they reference). A `binding.gyp` implies an implicit `node-gyp rebuild`.
3. Present to the user, per package:
   - `package` name and version
   - what each lifecycle script does (quote the relevant lines)
   - your risk assessment (network access, filesystem writes outside the package, binary downloads, etc.)
   - the `sha256` that would be recorded
4. STOP and wait for the user's explicit confirmation naming the exact packages to approve. Silence or partial approval means only the confirmed packages proceed.
5. For each confirmed package, add one entry to `approvedScripts` in `mirror.yaml`, matching the existing style (single-quoted key, 64-hex value, alphabetical order):
   ```yaml
   'name@version': <sha256 from the audit file>
   ```
6. Re-run the previously failing command (usually `npm run build:mirror`). Note: `approvedScripts` is not part of `configHash`, so the existing `mirror-lock.json` stays valid.
7. If the build succeeds, remind the user to copy `dist/mirror-lock.json` over `mirror-lock.json` when tool versions also changed, and consider a note in `docs/SCRIPT-REVIEW.md` describing what the approved script does.

$ARGUMENTS may name specific packages to focus on; ignore it if empty.
