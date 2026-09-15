import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateRelease, RELEASE_REPOSITORY } from '../shared/mac-release.js';
import { verifyInstaller } from '../mac/updater.js';

const directory = process.argv[2] || 'release-assets';
const manifest = validateRelease(JSON.parse(await readFile(path.join(directory, 'mac-update.json'), 'utf8')));
if (manifest.commit !== process.env.GITHUB_SHA || manifest.build !== Number(process.env.GITHUB_RUN_NUMBER)) {
  throw new Error('Release identity does not match this workflow.');
}
const filename = `Esquila-${manifest.version}-arm64.dmg`;
await verifyInstaller(path.join(directory, filename), manifest);
const tag = `mac-${manifest.commit}`;
const gh = args => execFileSync('gh', [...args, '--repo', RELEASE_REPOSITORY], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let existing;
try {
  existing = JSON.parse(gh(['release', 'view', tag, '--json', 'isDraft']));
} catch (error) {
  // Only a missing release permits creation; auth/network errors must fail closed.
  if (!String(error.stderr).includes('release not found')) throw error;
}
let advertised = manifest;
if (existing && !existing.isDraft) {
  // Published releases are immutable. Reruns reuse their original installer/hash,
  // even if rebuilding the same commit produces different DMG bytes.
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'esquila-release-'));
  try {
    gh(['release', 'download', tag, '--pattern', 'mac-update.json', '--pattern', filename, '--dir', temporary]);
    advertised = validateRelease(JSON.parse(await readFile(path.join(temporary, 'mac-update.json'), 'utf8')));
    if (advertised.commit !== manifest.commit || advertised.build !== manifest.build || advertised.version !== manifest.version) {
      throw new Error('Existing release belongs to a different build.');
    }
    await verifyInstaller(path.join(temporary, filename), advertised);
  } finally { await rm(temporary, { recursive: true, force: true }); }
} else {
  if (!existing) {
    gh(['release', 'create', tag, '--target', manifest.commit, '--draft', '--latest=false',
      '--title', `Esquila ${manifest.version} (build ${manifest.build})`,
      '--notes', 'Instalador Apple Silicon verificado. Cierra Esquila entre jornadas, abre el DMG y reemplaza la aplicación en Aplicaciones. Los datos se conservan.']);
  }
  gh(['release', 'upload', tag, path.join(directory, filename),
    path.join(directory, `Esquila-${manifest.version}-arm64.zip`), path.join(directory, 'mac-update.json'), '--clobber']);
  gh(['release', 'edit', tag, '--draft=false', '--latest=false']);
}
await writeFile('cloud/mac-update.json', JSON.stringify(advertised, null, 2) + '\n');
console.log(`Published verified installer and prepared update feed for build ${advertised.build}.`);
