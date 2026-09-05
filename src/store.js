// The persistence layer: one JSON file per channel, committed back by the
// GitHub Action. No database, no server, nothing to pay for.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJson(path, fallback) {
  try {
    return { data: JSON.parse(await readFile(path, 'utf8')), existed: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { data: fallback, existed: false };
  }
}

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}
