import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDump } from './dump.mjs';
import { mappingTemplate } from './mapping.mjs';
import { mappingWorkbench, workbenchMarkdown } from './workbench.mjs';

const [, , file, mappingFile] = process.argv;
if (!file || process.argv.length > 4) throw new Error('Usage: prepare-workbench.mjs <snapshot.sql.gz> [mapping.json]');
const dump = await readDump(file);
const mapping = mappingFile ? JSON.parse(await readFile(mappingFile, 'utf8')) : mappingTemplate(dump);
const packet = mappingWorkbench(dump, mapping);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const relative = `.local/t12/workbench-${dump.sourceSha256.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
const directory = path.join(project, relative);
await mkdir(directory, { recursive: true });
for (const [filename, value] of [['mapping.json', JSON.stringify(mapping, null, 2)], ['queue.json', JSON.stringify(packet, null, 2)], ['README.md', workbenchMarkdown(packet)]]) {
  await writeFile(path.join(directory, filename), value, { flag: 'wx', mode: 0o600 });
}
console.log(JSON.stringify({ directory: relative, ...packet.summary }));
