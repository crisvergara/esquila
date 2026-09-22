// electron-builder v26 configuration. PRs/local builds never use Apple secrets.
const production = process.env.ESQUILA_SIGNED_RELEASE === '1';
if (production) {
  for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    if (!process.env[name]) throw new Error(`Missing release credential: ${name}`);
  }
  if (!/^[A-Z0-9]{10}$/.test(process.env.APPLE_TEAM_ID)) throw new Error('Invalid Apple team ID');
}
module.exports = {
  extends: null,
  ...require('../package.json').build,
  afterPack: 'scripts/mac-after-pack.cjs',
  forceCodeSigning: production,
  buildVersion: process.env.GITHUB_RUN_NUMBER,
  mac: {
    ...require('../package.json').build.mac,
    identity: production ? undefined : '-',
    hardenedRuntime: production,
    entitlements: 'mac/entitlements.plist',
    entitlementsInherit: 'mac/entitlements.plist',
    notarize: production,
  },
};
