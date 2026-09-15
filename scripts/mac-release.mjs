import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { validateRelease, RELEASE_REPOSITORY } from '../shared/mac-release.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const build = Number(process.env.GITHUB_RUN_NUMBER);
const commit = process.env.GITHUB_SHA;
if (!Number.isSafeInteger(build) || build < 1 || !/^[a-f0-9]{40}$/.test(commit ?? '')) {
  throw new Error('GITHUB_RUN_NUMBER and GITHUB_SHA are required for release builds.');
}
const identity = { version: pkg.version, build, commit };
if (process.argv[2] === 'identity') {
  await writeFile(new URL('../mac/release.json', import.meta.url), JSON.stringify(identity, null, 2) + '\n');
} else if (process.argv[2] === 'manifest') {
  const filename = `Esquila-${pkg.version}-arm64.dmg`;
  const path = new URL(`../dist-mac/${filename}`, import.meta.url);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const manifest = validateRelease({ ...identity, schema: 1, platform: 'darwin', arch: 'arm64',
    sha256: hash.digest('hex'), size: (await stat(path)).size,
    publishedAt: process.env.RELEASE_PUBLISHED_AT,
    url: `https://github.com/${RELEASE_REPOSITORY}/releases/download/mac-${commit}/${filename}` });
  await writeFile(new URL('../dist-mac/mac-update.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
} else {
  throw new Error('Use identity or manifest.');
}
