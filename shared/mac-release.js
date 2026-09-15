// Public update contract shared by CI, the cloud feed, and the Mac shell.
export const UPDATE_FEED_URL = 'https://esquila-cloud.fly.dev/api/updates/mac';
export const RELEASE_REPOSITORY = 'crisvergara/esquila';
export const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;

export function validateRelease(value) {
  if (!value || value.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(value.version) ||
      !Number.isSafeInteger(value.build) || value.build < 1 ||
      !/^[a-f0-9]{40}$/.test(value.commit) || value.platform !== 'darwin' || value.arch !== 'arm64' ||
      !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) ||
      value.size < 1 || value.size > MAX_INSTALLER_BYTES || !Number.isFinite(Date.parse(value.publishedAt))) {
    throw new Error('Los datos de actualización no son válidos.');
  }
  const expected = `https://github.com/${RELEASE_REPOSITORY}/releases/download/mac-${value.commit}/Esquila-${value.version}-arm64.dmg`;
  if (value.url !== expected) throw new Error('La dirección del instalador no es válida.');
  return { schema: 1, version: value.version, build: value.build, commit: value.commit,
    platform: 'darwin', arch: 'arm64', sha256: value.sha256, size: value.size,
    publishedAt: value.publishedAt, url: value.url };
}

export function isNewerRelease(release, installed) {
  // The CI run number advances even when package.json keeps the same version.
  // Never offer an older build after a cloud rollback.
  const remote = release.version.split('.').map(Number);
  const local = installed.version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (remote[i] < local[i]) return false;
    if (remote[i] > local[i]) break;
  }
  return release.build > installed.build;
}
