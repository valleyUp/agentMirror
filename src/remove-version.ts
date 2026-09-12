import { readFile, writeFile } from 'node:fs/promises';
import { applyRemoval, isNpmTool, runMirrorBuild } from './tool-versions.ts';

function usage() {
  return 'Usage: node src/remove-version.ts <codex|dsh> <version> [version...] [--default VERSION] [--config FILE] [--dry-run] [--config-only]';
}

async function main() {
  const args = process.argv.slice(2);
  let configPath = process.env.MIRROR_CONFIG ?? 'mirror.yaml';
  let dryRun = false;
  let configOnly = false;
  let nextDefault: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--config-only') configOnly = true;
    else if (arg === '--config') {
      const value = args[++i];
      if (!value) throw Error(usage());
      configPath = value;
    } else if (arg === '--default') {
      const value = args[++i];
      if (!value) throw Error(usage());
      nextDefault = value;
    } else if (arg.startsWith('-')) throw Error(usage());
    else positional.push(arg);
  }
  const [tool, ...versions] = positional;
  if (!tool || !isNpmTool(tool) || !versions.length) throw Error(usage());
  const snapshot = await readFile(configPath, 'utf8');
  const result = await applyRemoval(configPath, tool, versions, nextDefault, dryRun);
  console.log(`${tool}: remove ${versions.join(', ')}; remaining ${result.remaining.join(', ')}; default ${result.defaultVersion}`);
  if (dryRun) {
    console.log('Dry run: configuration and cache were not changed.');
    return;
  }
  if (!result.written) return;
  console.log(`Updated ${configPath}.`);
  if (configOnly) {
    console.log('Config only: run npm run build:mirror to drop removed versions from the cache.');
    return;
  }
  console.log('Rebuilding mirror cache without the removed versions…');
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
