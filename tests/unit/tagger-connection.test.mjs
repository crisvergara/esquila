import test from 'node:test';
import assert from 'node:assert/strict';
import { taggerConnectionInfo } from '../../shared/tagger-connection.js';
const ip = (address, fields = {}) => ({ address, family: 'IPv4', internal: false, ...fields });
test('QR chooses LAN instead of VPN and includes alternative physical interfaces', () => {
  const info = taggerConnectionInfo({ utun0: [ip('100.64.0.1')], en7: [ip('192.168.2.4')], en0: [ip('192.168.1.4')] }, 'barn.local', 3001);
  assert.equal(info.url, 'http://192.168.1.4:3001/tagger/');
  assert.equal(info.mobileMonitorUrl, 'http://192.168.1.4:3001/mobilemonitor/');
  assert.equal(info.friendlyMobileMonitorUrl, 'http://barn.local:3001/mobilemonitor/');
  assert.equal(info.addresses.length, 2);
  assert.equal(info.friendlyUrl, 'http://barn.local:3001/tagger/');
});
test('VPN, loopback, link-local, and IPv6-only networks never yield an unusable QR', () => {
  const info = taggerConnectionInfo({ utun0: [ip('10.1.2.3')], lo0: [ip('127.0.0.1', { internal: true })], en0: [ip('169.254.1.2'), ip('fe80::1', { family: 'IPv6' })] }, 'barn', 3001);
  assert.equal(info.url, null); assert.equal(info.friendlyUrl, null);
  assert.equal(info.mobileMonitorUrl, null); assert.equal(info.friendlyMobileMonitorUrl, null);
  assert.deepEqual(info.addresses, []);
});
test('connection snapshots follow address changes without process restart', () => {
  const interfaces = { wlan0: [ip('192.168.1.4')] };
  assert.equal(taggerConnectionInfo(interfaces, 'barn', 3181).url, 'http://192.168.1.4:3181/tagger/');
  interfaces.wlan0 = [ip('192.168.5.9')];
  assert.equal(taggerConnectionInfo(interfaces, 'barn', 3181).url, 'http://192.168.5.9:3181/tagger/');
});

test('both QR targets follow the selected physical network and ignore unknown addresses', () => {
  const interfaces = { en0: [ip('192.168.1.4')], en7: [ip('10.0.0.3')] };
  const info = taggerConnectionInfo(interfaces, 'barn', 3001, '10.0.0.3');
  assert.equal(info.url, 'http://10.0.0.3:3001/tagger/');
  assert.equal(info.mobileMonitorUrl, 'http://10.0.0.3:3001/mobilemonitor/');
  assert.equal(taggerConnectionInfo(interfaces, 'barn', 3001, 'evil.example').mobileMonitorUrl, 'http://192.168.1.4:3001/mobilemonitor/');
});
