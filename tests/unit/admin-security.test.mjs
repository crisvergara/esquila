import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, normalizeEmail, passwordError, linkCipher, publicOrigin, equalSecret } from '../../cloud/admin-security.js';
import { createAdminMail } from '../../cloud/admin-mail.js';
test('admin passwords are salted and verified with bounded scrypt parameters', async () => {
  const password = 'Four sheep cross the green pasture!';
  const a = await hashPassword(password), b = await hashPassword(password);
  assert.notEqual(a,b); assert.ok(a.startsWith('scrypt:32768:8:3:'));
  assert.equal(await verifyPassword(password,a),true);
  assert.equal(await verifyPassword(password+'x',a),false);
  assert.equal(await verifyPassword(password,undefined),false);
  assert.equal(await verifyPassword(password,'scrypt:99999999:8:3:x:y'),false);
  assert.ok(passwordError('short')); assert.ok(passwordError('aaaaaaaaaaaaaaaa'));
  assert.ok(passwordError('Good passphrase\nwith control'));
  assert.equal(passwordError('Una frase con ovejas y ñandúes'),null);
  assert.equal(equalSecret('', ''),false);
});
test('email links have a trusted HTTPS origin and authenticated encrypted payload', () => {
  assert.equal(normalizeEmail(' Owner@Example.Test '),'owner@example.test');
  for (const input of ['a@b.test\r\nBcc:x@y.test','Name <x@y.test>','a..b@y.test',{},null]) assert.equal(normalizeEmail(input),null);
  assert.equal(publicOrigin('https://example.test/'),'https://example.test');
  for (const url of ['http://example.test','https://user:pass@example.test','https://example.test/path','https://example.test/#x']) assert.throws(()=>publicOrigin(url));
  assert.equal(publicOrigin('http://127.0.0.1:4195',true),'http://127.0.0.1:4195');
  const cipher=linkCipher(crypto.randomBytes(32).toString('base64'));
  const data={token:'private link',to:'owner@example.test'};
  const a=cipher.encrypt(data),b=cipher.encrypt(data);
  assert.notEqual(a,b); assert.ok(!a.includes(data.token)); assert.deepEqual(cipher.decrypt(a),data);
  const corrupt=Buffer.from(a,'base64'); corrupt[30]^=1;
  assert.throws(()=>cipher.decrypt(corrupt.toString('base64')));
  assert.throws(()=>linkCipher('weak-key'));
});
test('absent or broken SMTP disables email without taking cloud synchronization offline', () => {
  for (const env of [{}, {ADMIN_SMTP_HOST:'mail.example.test'}, {PUBLIC_URL:'http://evil.test',ADMIN_MAIL_FROM:'owner@example.test',ADMIN_LINK_KEY:'bad'}]) {
    const mail=createAdminMail({},env); assert.equal(mail.enabled,false); assert.throws(()=>mail.require(),{status:503});
  }
});

test('SMTP setup accepts encoded credentials without leaking or silently decoding invalid values', () => {
  const env={PUBLIC_URL:'https://example.test',ADMIN_MAIL_FROM:'mail@example.test',ADMIN_SMTP_HOST:'smtp.example.test',ADMIN_SMTP_PORT:'587',ADMIN_LINK_KEY:crypto.randomBytes(32).toString('base64'),ADMIN_SMTP_USER_B64:Buffer.from('test-user').toString('base64'),ADMIN_SMTP_PASSWORD_B64:Buffer.from('fake-password-with-"quotes"-and-#').toString('base64')};
  assert.equal(createAdminMail({},env).enabled,true);
  assert.equal(createAdminMail({},{...env,ADMIN_SMTP_PASSWORD_B64:'not base64!'}).enabled,false);
});
