import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const parameters = { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
let hashing = 0;
export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export const equalSecret = (a, b) => typeof a === 'string' && typeof b === 'string' && Boolean(a && b) &&
  crypto.timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) || email.includes('..')) return null;
  const [local, domain] = email.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || domain.split('.').some(label => label.length > 63 || label.startsWith('-') || label.endsWith('-'))) return null;
  return email;
}
export function passwordError(value) {
  if (typeof value !== 'string' || [...value].length < 15 || [...value].length > 128 || /\p{Cc}/u.test(value)) return 'Usa una contraseña o frase de 15 a 128 caracteres, sin caracteres de control.';
  if (new Set(value).size < 5 || /^(password|contrase[nñ]a|1234567890|qwerty)/i.test(value)) return 'Elige una frase menos predecible.';
  return null;
}
async function derive(password, salt) {
  // Bound memory use on the 256 MiB cloud machine. No unbounded hashing queue.
  if (hashing >= 2) fail(503, 'Servicio ocupado. Reintenta en unos segundos.');
  hashing++;
  try { return await scrypt(password, salt, 64, parameters); }
  finally { hashing--; }
}
export async function hashPassword(password) {
  const error = passwordError(password); if (error) fail(400, error);
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:32768:8:3:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split(':') : [];
  const valid = parts.length === 6 && parts.slice(0, 4).join(':') === 'scrypt:32768:8:3' && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  const bounded = typeof password === 'string' && password.length <= 256 ? password : '';
  const derived = await derive(bounded, valid ? parts[4] : '00000000000000000000000000000000');
  const expected = valid ? Buffer.from(parts[5], 'hex') : Buffer.alloc(64);
  return crypto.timingSafeEqual(derived, expected) && valid && bounded === password;
}
export function publicOrigin(value, test = false) {
  let url; try { url = new URL(value); } catch { throw new Error('PUBLIC_URL must be an explicit HTTPS origin'); }
  if ((url.protocol !== 'https:' && !(test && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('PUBLIC_URL must be an explicit HTTPS origin');
  return url.origin;
}
export function linkCipher(encodedKey) {
  const key = Buffer.from(encodedKey || '', 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error('ADMIN_LINK_KEY must contain 32 random bytes encoded as base64');
  return {
    encrypt(data) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from('esquila-admin-mail-v1'));
      const bytes = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
    },
    decrypt(encoded) {
      const bytes = Buffer.from(encoded, 'base64'), decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from('esquila-admin-mail-v1')); decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    },
  };
}
