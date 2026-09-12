import { readFile, writeFile } from 'node:fs/promises';
import { applyLatest, isNpmTool, NPM_TOOLS, planLatest, runMirrorBuild, type NpmTool } from './tool-versions.ts';

function usage() {
  return 'Usage: node src/add-latest.ts [--tool codex|dsh]... [--config FILE] [--dry-run] [--config-only]';
}

async function main() {
  const args = process.argv.slice(2);
  const tools: NpmTool[] = [];
  let configPath = process.env.MIRROR_CONFIG ?? 'mirror.yaml';
  let dryRun = false;
  let configOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--config-only') configOnly = true;
    else if (arg === '--config') {
      const value = args[++i];
      if (!value) throw Error(usage());
      configPath = value;
    } else if (arg === '--tool') {
      const value = args[++i];
      if (!value || !isNpmTool(value)) throw Error(usage());
      if (!tools.includes(value)) tools.push(value);
    } else throw Error(usage());
  }
  const selected = tools.length ? tools : [...NPM_TOOLS];
  const plans = await planLatest(configPath, selected);
  for (const plan of plans) {
    const status = plan.added ? `add ${plan.latest}` : `already has ${plan.latest}`;
    const def = plan.defaultChanged || plan.added ? `; default ${plan.defaultVersion} -> ${plan.latest}` : '';
    console.log(`${plan.tool} (${plan.package}): ${status}${def}; keep ${plan.previous.join(', ') || '(none)'}`);
  }
  const snapshot = await readFile(configPath, 'utf8');
  const { written, changed } = await applyLatest(configPath, plans, dryRun);
  if (!changed.length) {
    console.log('No configuration change.');
    return;
  }
  if (dryRun) {
    console.log('Dry run: configuration and cache were not changed. Old versions are never removed by this command.');
    return;
  }
  if (!written) return;
  console.log(`Updated ${configPath}. Old versions were kept.`);
  if (configOnly) {
    console.log('Config only: run npm run build:mirror to download the new versions into the cache.');
    return;
  }
  console.log('Building mirror cache for the new versions…');
  try {
    await runMirrorBuild(configPath);
  } catch (error) {
    await writeFile(configPath, snapshot);
    console.error(`Build failed; restored ${configPath}.`);
    throw error;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
