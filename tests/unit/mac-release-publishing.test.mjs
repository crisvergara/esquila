import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bytes = Buffer.from('CI installer fixture');
const manifest = { schema: 1, version: '0.1.4', build: 20, commit: 'a'.repeat(40),
  platform: 'darwin', arch: 'arm64', size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), publishedAt: '2026-09-14T12:00:00Z',
  url: `https://github.com/crisvergara/esquila/releases/download/mac-${'a'.repeat(40)}/Esquila-0.1.4-arm64.dmg` };

async function setup(t, scenario) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'esquila-publishing-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'cloud'));
  await mkdir(path.join(directory, 'assets'));
  await mkdir(path.join(directory, 'remote'));
  for (const subdir of ['assets', 'remote']) {
    await writeFile(path.join(directory, subdir, 'mac-update.json'), JSON.stringify(manifest));
    await writeFile(path.join(directory, subdir, 'Esquila-0.1.4-arm64.dmg'), bytes);
    await writeFile(path.join(directory, subdir, 'Esquila-0.1.4-arm64.zip'), 'fixture zip');
  }
  await writeFile(path.join(directory, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args[1] === 'view') {
  if (process.env.SCENARIO === 'auth') { process.stderr.write('authentication failed'); process.exit(1); }
  if (process.env.SCENARIO === 'new') { process.stderr.write('release not found'); process.exit(1); }
  process.stdout.write(JSON.stringify({ isDraft: process.env.SCENARIO === 'draft' }));
}
if (args[1] === 'download') {
  const destination = args[args.indexOf('--dir') + 1];
  for (const file of fs.readdirSync('remote')) fs.copyFileSync(path.join('remote', file), path.join(destination, file));
}
`, { mode: 0o700 });
  const run = () => execFileSync(process.execPath, [path.join(root, 'scripts/publish-mac-release.mjs'), 'assets'], {
    cwd: directory, env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, GITHUB_SHA: manifest.commit, GITHUB_RUN_NUMBER: '20', SCENARIO: scenario },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { directory, run, calls: async () => (await readFile(path.join(directory, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse) };
}

test('publication validates the installer and publishes a draft before advertising metadata', async t => {
  const fixture = await setup(t, 'new');
  fixture.run();
  assert.deepEqual((await fixture.calls()).map(c => c[1]), ['view', 'create', 'upload', 'edit']);
  assert.deepEqual(JSON.parse(await readFile(path.join(fixture.directory, 'cloud/mac-update.json'))), manifest);
});

test('publication rerun reuses immutable published bytes and their original checksum', async t => {
  const fixture = await setup(t, 'published');
  const original = { ...manifest, size: 8, sha256: createHash('sha256').update('original').digest('hex') };
  await writeFile(path.join(fixture.directory, 'remote/mac-update.json'), JSON.stringify(original));
  await writeFile(path.join(fixture.directory, 'remote/Esquila-0.1.4-arm64.dmg'), 'original');
  fixture.run();
  assert.deepEqual((await fixture.calls()).map(c => c[1]), ['view', 'download']);
  assert.deepEqual(JSON.parse(await readFile(path.join(fixture.directory, 'cloud/mac-update.json'))), original);
});

test('publication refuses auth errors and corrupted assets without advertising an update', async t => {
  const auth = await setup(t, 'auth');
  assert.throws(auth.run);
  assert.deepEqual((await auth.calls()).map(c => c[1]), ['view']);
  const corrupt = await setup(t, 'new');
  await writeFile(path.join(corrupt.directory, 'assets/Esquila-0.1.4-arm64.dmg'), 'bad');
  assert.throws(corrupt.run);
  await assert.rejects(() => readFile(path.join(corrupt.directory, 'cloud/mac-update.json')));
});

test('CI identity and manifest carry the same build and exact installer hash', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'esquila-identity-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['scripts', 'shared', 'mac', 'dist-mac']) await mkdir(path.join(directory, name));
  await cp(path.join(root, 'scripts/mac-release.mjs'), path.join(directory, 'scripts/mac-release.mjs'));
  await cp(path.join(root, 'shared/mac-release.js'), path.join(directory, 'shared/mac-release.js'));
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ type: 'module', version: '0.1.4' }));
  await writeFile(path.join(directory, 'dist-mac/Esquila-0.1.4-arm64.dmg'), bytes);
  for (const command of ['identity', 'manifest']) {
    execFileSync(process.execPath, [path.join(directory, 'scripts/mac-release.mjs'), command], { env: {
      ...process.env, GITHUB_SHA: manifest.commit, GITHUB_RUN_NUMBER: '20', RELEASE_PUBLISHED_AT: manifest.publishedAt,
    } });
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'mac/release.json'))), { version: '0.1.4', build: 20, commit: manifest.commit });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'dist-mac/mac-update.json'))), manifest);
});

test('signed publication validates ZIP bytes and preserves signed metadata on retry', async t => {
  for (const scenario of ['new', 'published']) {
    const fixture = await setup(t, scenario);
    const signed = { ...manifest, automatic: { url: manifest.url.replace('.dmg', '.zip'), size: 11,
      sha256: createHash('sha256').update('fixture zip').digest('hex'), teamId: 'ABCDEFGHIJ' } };
    for (const subdir of ['assets', 'remote']) await writeFile(path.join(fixture.directory, subdir, 'mac-update.json'), JSON.stringify(signed));
    fixture.run();
    assert.deepEqual(JSON.parse(await readFile(path.join(fixture.directory, 'cloud/mac-update.json'))), signed);
    await writeFile(path.join(fixture.directory, 'assets/Esquila-0.1.4-arm64.zip'), 'corrupt');
    assert.throws(fixture.run);
  }
});
