// Imported only by the isolated offline QR/browser regression server.
// Deny external sockets before DNS or HTTP can reach any real service.
import net from 'node:net';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const input = Array.isArray(args[0]) ? args[0] : args;
  const options = input[0];
  const host = typeof options === 'object' ? options.host : typeof input[1] === 'string' ? input[1] : undefined;
  if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw Object.assign(new Error('Internet blocked by offline test'), { code: 'ENETUNREACH' });
  }
  return connect.apply(this, args);
};
os.networkInterfaces = () => ({
  en0: [{ address: '192.168.88.22', family: 'IPv4', internal: false }],
  en7: [{ address: '192.168.99.22', family: 'IPv4', internal: false }],
});
os.hostname = () => 'offline-barn';
syncBuiltinESMExports();
