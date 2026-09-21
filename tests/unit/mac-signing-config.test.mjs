import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const config = new URL('../../scripts/mac-builder.cjs', import.meta.url).pathname;
function readConfig(env) {
  return JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require(process.argv[1])))', config], {
    env: { ...process.env, CSC_LINK: '', CSC_KEY_PASSWORD: '', APPLE_ID: '', APPLE_APP_SPECIFIC_PASSWORD: '', APPLE_TEAM_ID: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}
test('local/PR packaging is ad-hoc; production fails closed and enables notarization', () => {
  const local = readConfig({ ESQUILA_SIGNED_RELEASE: '0' });
  assert.equal(local.mac.identity, '-');
  assert.equal(local.mac.notarize, false);
  assert.throws(() => readConfig({ ESQUILA_SIGNED_RELEASE: '1' }));
  const release = readConfig({ ESQUILA_SIGNED_RELEASE: '1', CSC_LINK: 'fixture', CSC_KEY_PASSWORD: 'fixture',
    APPLE_ID: 'fixture@example.invalid', APPLE_APP_SPECIFIC_PASSWORD: 'fixture', APPLE_TEAM_ID: 'ABCDEFGHIJ', GITHUB_RUN_NUMBER: '25' });
  assert.equal(release.mac.identity, undefined);
  assert.equal(release.forceCodeSigning, true);
  assert.equal(release.mac.hardenedRuntime, true);
  assert.equal(release.mac.notarize, true);
  assert.equal(release.buildVersion, '25');
  assert.equal(release.mac.extendInfo.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
});
