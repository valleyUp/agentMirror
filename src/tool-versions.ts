import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isSeq, parseDocument, type Document, type YAMLSeq } from 'yaml';
import semver from 'semver';
import { PACKAGES, readConfig, type Tool } from './config.ts';
import { json } from './io.ts';

export const NPM_TOOLS = ['codex', 'dsh'] as const;
export type NpmTool = (typeof NPM_TOOLS)[number];
export type JsonGet = (url: string) => Promise<any>;

const exact = (v: unknown): v is string => typeof v === 'string' && semver.valid(v) === v;

export function isNpmTool(value: string): value is NpmTool {
  return (NPM_TOOLS as readonly string[]).includes(value);
}

function sortVersions(versions: string[]) {
  return [...versions].sort((a, b) => semver.compare(a, b) || a.localeCompare(b));
}

function newest(versions: string[]) {
  return sortVersions(versions).at(-1)!;
}

function packumentUrl(registry: string, name: string) {
  return `${registry.replace(/\/$/, '')}/${name.replace('/', '%2f')}`;
}

export async function fetchLatest(name: string, registry: string, getJson: JsonGet = json): Promise<string> {
  const packument = await getJson(packumentUrl(registry, name));
  const latest = packument?.['dist-tags']?.latest;
  if (!exact(latest)) throw Error(`${name}: registry latest is not an exact version (${latest})`);
  if (!packument.versions?.[latest]) throw Error(`${name}: dist-tag latest ${latest} is missing from the packument versions list`);
  return latest;
}

function loadDocument(text: string) {
  const doc = parseDocument(text);
  if (doc.errors.length) throw Error(doc.errors.map(e => e.message).join('\n'));
  return doc;
}

function versionSeq(doc: Document, tool: Tool): YAMLSeq {
  const seq = doc.getIn(['tools', tool, 'versions']);
  if (!isSeq(seq)) throw Error(`tools.${tool}.versions must be a sequence`);
  return seq;
}

function listedVersions(seq: YAMLSeq): string[] {
  return seq.toJSON() as string[];
}

function replaceVersions(doc: Document, seq: YAMLSeq, versions: string[]) {
  seq.items.length = 0;
  for (const version of versions) seq.add(doc.createNode(version));
}

async function writeDocument(path: string, doc: Document) {
  const text = String(doc);
  await writeFile(path, text.endsWith('\n') ? text : `${text}\n`);
  await readConfig(path);
}

export interface LatestPlan {
  tool: NpmTool;
  package: string;
  latest: string;
  previous: string[];
  defaultVersion: string;
  added: boolean;
  defaultChanged: boolean;
}

export async function planLatest(configPath: string, tools: NpmTool[], getJson: JsonGet = json): Promise<LatestPlan[]> {
  const config = await readConfig(configPath);
  const plans: LatestPlan[] = [];
  for (const tool of tools) {
    const previous = [...config.tools[tool].versions];
    const latest = await fetchLatest(PACKAGES[tool], config.registry, getJson);
    const added = !previous.includes(latest);
    const defaultChanged = config.tools[tool].defaultVersion !== latest;
    plans.push({
      tool, package: PACKAGES[tool], latest, previous,
      defaultVersion: config.tools[tool].defaultVersion,
      added, defaultChanged,
    });
  }
  return plans;
}

export async function applyLatest(configPath: string, plans: LatestPlan[], dryRun = false) {
  const changed = plans.filter(p => p.added || p.defaultChanged);
  if (!changed.length || dryRun) return { written: false as const, changed };
  const doc = loadDocument(await readFile(configPath, 'utf8'));
  for (const plan of changed) {
    const seq = versionSeq(doc, plan.tool);
    const versions = sortVersions([...new Set([...listedVersions(seq), plan.latest])]);
    replaceVersions(doc, seq, versions);
    doc.setIn(['tools', plan.tool, 'defaultVersion'], plan.latest);
  }
  await writeDocument(configPath, doc);
  return { written: true as const, changed };
}

export async function applyRemoval(configPath: string, tool: NpmTool, versions: string[], nextDefault?: string, dryRun = false) {
  if (!versions.length) throw Error('Specify at least one version to remove');
  const config = await readConfig(configPath);
  const current = [...config.tools[tool].versions];
  const missing = versions.filter(v => !current.includes(v));
  if (missing.length) throw Error(`${tool} does not include ${missing.join(', ')}`);
  const remaining = current.filter(v => !versions.includes(v));
  if (!remaining.length) throw Error(`Refusing to remove the last ${tool} version`);
  const defaultVersion = nextDefault ?? (remaining.includes(config.tools[tool].defaultVersion) ? config.tools[tool].defaultVersion : newest(remaining));
  if (!remaining.includes(defaultVersion)) throw Error(`defaultVersion ${defaultVersion} is not in the remaining ${tool} versions`);
  if (dryRun) return { written: false as const, remaining, defaultVersion };
  const doc = loadDocument(await readFile(configPath, 'utf8'));
  replaceVersions(doc, versionSeq(doc, tool), sortVersions(remaining));
  doc.setIn(['tools', tool, 'defaultVersion'], defaultVersion);
  await writeDocument(configPath, doc);
  return { written: true as const, remaining, defaultVersion };
}

export function runMirrorBuild(configPath: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['src/build.ts', 'build'], {
      stdio: 'inherit',
      env: { ...process.env, MIRROR_CONFIG: configPath },
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error(`mirror build exited ${code}`)));
  });
}
