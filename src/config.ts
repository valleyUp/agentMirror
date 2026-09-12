import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import semver from 'semver';

export const PACKAGES = {
  claude: '@anthropic-ai/claude-code', codex: '@openai/codex', dsh: '@deepseek-ai/dsh',
} as const;
export type Tool = keyof typeof PACKAGES;
export const PLATFORMS = {
  'win32-x64': { os: 'win32', cpu: 'x64', libc: undefined },
  'linux-x64': { os: 'linux', cpu: 'x64', libc: 'glibc' },
  'linux-x64-musl': { os: 'linux', cpu: 'x64', libc: 'musl' },
} as const;
export type Platform = keyof typeof PLATFORMS;
export interface ExtraPackageConfig {
  name: string;
  versions: string[];
  defaultVersion: string;
  description: string;
}
export interface Config {
  schemaVersion: 1;
  site: { title: string };
  registry: string;
  platforms: Platform[];
  tools: Record<Tool, { versions: string[]; defaultVersion: string }>;
  npmPackages: ExtraPackageConfig[];
  node: { version: string };
  assets: { id: string; version: string; filename: string; url: string; sha256: string; description: string }[];
  // Hash of the exact install script, reviewed before allowing client execution.
  approvedScripts: Record<string, string>;
}
function exact(v: unknown): v is string {
  return typeof v === 'string' && semver.valid(v) === v;
}
function validatePackageList(value: unknown, field: string, seen: Set<string>): asserts value is ExtraPackageConfig[] {
  if (!Array.isArray(value)) throw Error(`${field} must be an array`);
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(item.name)) throw Error(`${field}: invalid package name`);
    if (seen.has(item.name)) throw Error(`${field}: duplicate package ${item.name}`);
    seen.add(item.name);
    if (!Array.isArray(item.versions) || !item.versions.length || !item.versions.every(exact)) throw Error(`${field} ${item.name}: exact versions required`);
    if (new Set(item.versions).size !== item.versions.length) throw Error(`${field} ${item.name}: duplicate versions`);
    if (!item.versions.includes(item.defaultVersion)) throw Error(`${field} ${item.name}: defaultVersion must be included`);
    if (typeof item.description !== 'string' || !item.description.trim()) throw Error(`${field} ${item.name}: description required`);
  }
}
export function validateConfig(c: any): asserts c is Config {
  if (c?.schemaVersion !== 1) throw Error('schemaVersion must be 1');
  if (!c.site?.title || typeof c.site.title !== 'string') throw Error('site.title required');
  if (!Array.isArray(c.platforms) || !c.platforms.length || c.platforms.some((p: string) => !(p in PLATFORMS))) throw Error('Invalid platforms');
  if (new Set(c.platforms).size !== c.platforms.length) throw Error('Duplicate platforms');
  if (!exact(c.node?.version)) throw Error('node.version must be exact');
  for (const name of Object.keys(PACKAGES)) {
    const t = c.tools?.[name];
    if (!Array.isArray(t?.versions) || !t.versions.length || !t.versions.every(exact)) throw Error(`${name}: exact versions required`);
    if (new Set(t.versions).size !== t.versions.length) throw Error(`${name}: duplicate versions`);
    if (!t.versions.includes(t.defaultVersion)) throw Error(`${name}: defaultVersion must be included`);
  }
  if (Object.keys(c.tools).some(k => !(k in PACKAGES))) throw Error('Unknown tool');
  const packageNames = new Set(Object.values(PACKAGES));
  validatePackageList(c.npmPackages, 'npmPackages', packageNames);
  const registry = new URL(c.registry);
  if (registry.protocol !== 'https:' || registry.username || registry.password) throw Error('registry must use HTTPS without credentials');
  if (!Array.isArray(c.assets)) throw Error('assets must be an array');
  const names = new Set();
  const ids = new Set();
  for (const a of c.assets) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(a.filename) || names.has(a.filename)) throw Error('Invalid/duplicate asset filename');
    names.add(a.filename);
    if (typeof a.id !== 'string' || !/^[a-z0-9-]+$/.test(a.id) || ids.has(a.id) || typeof a.version !== 'string' || !a.version || typeof a.description !== 'string') throw Error('Asset needs unique id, version and description');
    ids.add(a.id);
    if (a.filename.startsWith(`node-v${c.node.version}-`)) throw Error('Asset filename collides with managed Node downloads');
    if (!/^[a-f0-9]{64}$/.test(a.sha256)) throw Error(`Asset ${a.filename} needs SHA-256`);
    const url = new URL(a.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('Asset must use HTTPS without credentials');
  }
  if (!c.approvedScripts || typeof c.approvedScripts !== 'object') throw Error('approvedScripts required');
  for (const digest of Object.values(c.approvedScripts)) if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid script approval digest');
}
export async function readConfig(file: string): Promise<Config> {
  const c = parse(await readFile(file, 'utf8')); validateConfig(c); return c;
}
export function supports(list: string[] | undefined, value: string | undefined): boolean {
  if (!list?.length || !value) return true;
  if (list.includes(`!${value}`)) return false;
  const positive = list.filter(x => !x.startsWith('!'));
  return !positive.length || positive.includes(value) || positive.includes('any');
}
export function platformMatches(meta: any, p: Platform): boolean {
  const target = PLATFORMS[p];
  return supports(meta.os, target.os) && supports(meta.cpu, target.cpu) && supports(meta.libc, target.libc);
}
