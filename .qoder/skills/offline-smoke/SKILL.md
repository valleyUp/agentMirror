---
name: offline-smoke
description: Full offline acceptance loop for the mirror image — build the prebuilt Docker image, run the network-isolated smoke test, optionally record the passing report into the catalog and repackage. Use after changes to installers, runtime, site, or mirror contents.
disable-model-invocation: true
---

Run the end-to-end offline verification loop. Requires Docker, x64, and a freshly built `dist/` (from `npm run build:mirror`).

$ARGUMENTS may specify an image tag; default to today's date (`date +%Y%m%d`).

## Steps

1. Verify `dist/` exists and is current. If not, ask the user whether to run `npm run build:mirror` first (needs internet + ≥15 GB disk).
2. Build the image from the reviewed local snapshot:
   ```bash
   docker build -f Dockerfile.prebuilt -t agent-mirror:<tag> .
   ```
3. Run the offline acceptance test (creates an `--internal` Docker network, runs `npm run smoke` inside it with `MIRROR_NETWORK_ISOLATED=1`, writes JSON reports to `reports/`):
   ```bash
   bash scripts/test-offline.sh agent-mirror:<tag>
   ```
4. Report pass/fail per check from the `reports/smoke-*.json` output. On failure, stop and diagnose — do not proceed to recording.
5. Only if the user wants the passing report published in the image catalog:
   ```bash
   node src/record-validation.ts reports/smoke-<...>.json
   ```
   The report's `build` field must equal the current `dist/public/catalog.json` `builtAt`, or it is rejected — record against the same `dist/` that was tested.
6. After recording, the image is stale; repackage:
   ```bash
   docker build -f Dockerfile.prebuilt -t agent-mirror:<tag> .
   ```
7. Summarize: image tag, smoke results, whether validation was recorded, and remind that exporting for the intranet is `bash scripts/export.sh agent-mirror:<tag> <archive.tar>` (refuses to overwrite).
