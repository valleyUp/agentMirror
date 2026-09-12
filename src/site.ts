import { cp, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export async function generateSite(out: string) {
  await cp(resolve('web'), out, { recursive: true });
  let html = await readFile(resolve(out, 'index.html'), 'utf8');
  const keep = new Set<string>();
  for (const [filename, attribute] of [['app.js', 'src'], ['style.css', 'href']] as const) {
    const content = await readFile(resolve(out, filename));
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const versioned = filename.replace('.', `.${hash}.`);
    keep.add(versioned);
    await writeFile(resolve(out, versioned), content);
    const next = html.replace(`${attribute}="${filename}"`, `${attribute}="${versioned}"`);
    if (next === html) throw Error(`index.html missing ${attribute}="${filename}"`);
    html = next;
  }
  for (const name of await readdir(out)) {
    if (/^(app|style)\.[0-9a-f]{16}\.(js|css)$/.test(name) && !keep.has(name)) await unlink(resolve(out, name));
  }
  await writeFile(resolve(out, 'index.html'), html);
  await writeFile(resolve(out, 'runtime.json'), JSON.stringify({ publicUrl: '' }));
}
