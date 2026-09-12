import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const publicDir = resolve(process.env.MIRROR_OUT ?? 'dist', 'public');
const catalogFile = resolve(publicDir, 'catalog.json');
const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
if (process.argv.length < 3) throw Error('Usage: node src/record-validation.ts reports/smoke-*.json');
for (const file of process.argv.slice(2)) {
  const report = JSON.parse(await readFile(file, 'utf8'));
  if (report.build !== catalog.builtAt || report.status !== 'pass' || !catalog.platforms.includes(report.platform)) throw Error(`Report is failed or belongs to another build: ${file}`);
  const expected = Object.entries(catalog.tools).flatMap(([tool, value]: [string, any]) => value.versions.map((version: string) => `${tool}@${version}`));
  if (!expected.every(key => report.results.some((r: any) => `${r.tool}@${r.version}` === key && r.install === 'pass' && r.launch === 'pass'))) throw Error(`Incomplete test report: ${file}`);
  const expectedPackages = (catalog.npmPackages ?? []).map((entry: any) => ['npm-package', entry])
    .flatMap(([kind, entry]: [string, any]) => entry.versions.map((version: string) => `${kind}:${entry.name}@${version}`));
  if (!expectedPackages.every((key: string) => report.packageResults?.some((r: any) => `${r.kind}:${r.name}@${r.version}` === key && r.install === 'pass'))) throw Error(`Incomplete extra package test report: ${file}`);
  for (const [tool, info] of Object.entries(catalog.tools) as [string, any][]) if (info.versions.length > 1 && ![info.versions[0], info.versions.at(-1)].every(version => report.transitions?.some((t: any) => t.tool === tool && t.version === version && t.status === 'pass'))) throw Error(`Missing upgrade/downgrade evidence: ${file}`);
  const npmMajor = Number(String(report.npm).split('.')[0]) || 'unknown';
  const reportPath = `/reports/${report.platform}-npm${npmMajor}.json`;
  catalog.verifications ??= [];
  catalog.verifications = catalog.verifications.filter((v: any) => !(v.platform === report.platform && v.npm === report.npm));
  catalog.verifications.push({ platform: report.platform, at: report.at, environment: report.environment, node: report.node, npm: report.npm, reportPath, status: 'offline-install-and-launch-passed', interactiveAuthentication: report.interactiveAuthentication, modelCalls: report.modelCalls });
  for (const n of catalog.natives) if (n.platform === report.platform && report.results.some((r: any) => r.tool === 'claude' && r.version === n.version && r.nativeDownload === 'pass')) n.status = 'offline-install-and-launch-passed';
  await mkdir(resolve(publicDir, 'reports'), { recursive: true });
  await copyFile(file, resolve(publicDir, `.${reportPath}`));
}
await writeFile(catalogFile, JSON.stringify(catalog, null, 2));
console.log('Validation evidence attached. Repackage dist with Dockerfile.prebuilt.');
