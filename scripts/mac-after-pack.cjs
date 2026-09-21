const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  // electron-builder v26 overwrites extendInfo's ATS flag while creating the
  // bundle. Narrow it after packing, before signing; retain loopback exceptions.
  const plist = path.join(context.appOutDir, 'Esquila.app', 'Contents', 'Info.plist');
  execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :NSAppTransportSecurity:NSAllowsArbitraryLoads false', plist]);
};
