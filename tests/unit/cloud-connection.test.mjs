import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cloudNetworkError } from '../../mac/cloud-errors.js';
import { diagnoseRanchConnection, fetchRanchIdentity, fetchRanchManifest } from '../../mac/ranch-connection.js';
import { translateError } from '../../shared/i18n.js';
import { shearingModes } from '../../shared/shearing-validation.js';

const origin = 'https://cloud.example.test', token = 'disposable-test-token';
const deviceId = '01999999-9999-7999-8999-999999999999';
const manifest = { deviceId, revision: 1, updatedAt: '2026-10-12T00:00:00Z', configuration: {
  schemaVersion: 1, name: 'Test barn', shearers: [{ name: 'Test station' }], modes: shearingModes,
} };

test('connection failures report fixed, translated categories without leaking fetch data', () => {
  const privateText = 'never-display-this-token-or-response';
  for (const [cause, expected] of [
    [{ code: 'ENOTFOUND' }, 'DNS'], [{ code: 'EAI_AGAIN' }, 'DNS'],
    [{ code: 'CERT_HAS_EXPIRED' }, 'TLS'], [{ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, 'TLS'],
    [{ name: 'TimeoutError' }, 'TIMEOUT'], [{ code: 'UND_ERR_CONNECT_TIMEOUT' }, 'TIMEOUT'],
    [{ code: 'ECONNREFUSED' }, 'REFUSED'], [{ code: 'ENETUNREACH' }, 'UNREACHABLE'],
    [{ code: 'ECONNRESET' }, 'INTERRUPTED'], [{ code: 'UND_ERR_SOCKET' }, 'INTERRUPTED'],
    [{ message: 'unexpected redirect' }, 'REDIRECT'], [{ code: privateText }, 'NETWORK'],
  ]) {
    const error = new TypeError(privateText, { cause: { message: privateText, ...cause } });
    const safe = cloudNetworkError(error);
    assert.match(safe.message, new RegExp(`\\[CLOUD_${expected}\\]`));
    assert.ok(!safe.message.includes(privateText)); assert.equal(safe.cause, undefined);
    const english = translateError('en', `Error invoking remote method 'settings:preview': Error: ${safe.message}`);
    assert.notEqual(english, safe.message); assert.match(english, new RegExp(`CLOUD_${expected}`));
  }
  const aggregate = new AggregateError([{ code: 'ENETUNREACH' }, { code: 'ETIMEDOUT' }]);
  aggregate.cause = aggregate;
  assert.match(cloudNetworkError(new TypeError('fetch failed', { cause: aggregate })).message, /CLOUD_TIMEOUT/);
});

test('invisible or non-header token characters fail before network access, not as a network outage', async () => {
  for (const bad of ['fixture\u200btoken', 'fixture token', 'fixture\ttoken', 'Bearer fixture-token', 'fixture🙂']) {
    for (const fn of [fetchRanchIdentity, fetchRanchManifest]) {
      await assert.rejects(fn(origin, bad, () => assert.fail('Invalid token sent')), /TOKEN_FORMAT/);
    }
  }
});

test('diagnostics separate public health, authorization and manifest failures without applying configuration', async () => {
  for (const scenario of ['ok', 'unauthorized', 'unpublished', 'malformed', 'body-timeout', 'health-failure', 'offline']) {
    const requests = [];
    const result = await diagnoseRanchConnection(origin, token, async (url, options) => {
      const route = new URL(url).pathname; requests.push(route);
      assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.method, undefined); assert.equal(options.body, undefined);
      assert.equal(options.headers.Authorization, route === '/healthz' ? undefined : `Bearer ${token}`);
      if (scenario === 'offline') throw new TypeError('private network message', { cause: { code: 'ENOTFOUND' } });
      if (route === '/healthz') return scenario === 'health-failure' ? new Response('private', { status: 502 }) : Response.json({ ok: true });
      if (route === '/api/server/identity') return scenario === 'unauthorized' ? new Response('private', { status: 401 }) : Response.json({ deviceId });
      assert.equal(route, '/api/server/configuration');
      if (scenario === 'unpublished') return new Response('private', { status: 409 });
      if (scenario === 'malformed') return new Response('private invalid body');
      if (scenario === 'body-timeout') return new Response(new ReadableStream({ start(controller) { controller.error(new DOMException('private', 'TimeoutError')); } }));
      return Response.json(manifest);
    });
    assert.deepEqual(result.map(r => r.step), ['health', 'identity', 'configuration']);
    assert.ok(!JSON.stringify(result).includes(token)); assert.ok(!JSON.stringify(result).includes('private'));
    assert.ok(!JSON.stringify(result).includes(deviceId)); assert.ok(!JSON.stringify(result).includes('Test barn'));
    if (['unauthorized', 'offline'].includes(scenario)) {
      assert.equal(result[1].ok, false); assert.equal(result[2].skipped, true);
      assert.ok(!requests.includes('/api/server/configuration'));
    } else {
      assert.equal(result[1].ok, true);
      assert.equal(result[2].ok, ['ok', 'health-failure'].includes(scenario));
    }
    if (scenario === 'body-timeout') assert.match(result[2].message, /CLOUD_TIMEOUT/);
    if (scenario === 'health-failure') assert.match(result[0].message, /HTTP 502/);
    if (scenario === 'unpublished') assert.match(result[2].message, /Primero publica/);
    if (scenario === 'unauthorized') assert.match(result[1].message, /token no corresponde/);
  }
});

test('real fetch rejects redirects before sending credentials and diagnoses interrupted response bodies', async () => {
  let redirected = false;
  const server = createServer((req, res) => {
    if (req.url === '/api/server/identity') { res.writeHead(302, { Location: '/redirect-target' }); res.end(); }
    else if (req.url === '/redirect-target') { redirected = true; res.end('unexpected'); }
    else { res.writeHead(200); res.flushHeaders(); /* Simulate a stalled body. */ }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(fetchRanchIdentity(base, token), /CLOUD_REDIRECT/);
    assert.equal(redirected, false);
    await assert.rejects(fetchRanchManifest(base, token, (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(100) })), /CLOUD_TIMEOUT/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
