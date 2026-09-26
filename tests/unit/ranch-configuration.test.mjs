import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { shearingModes, validateShearingFields } from '../../shared/shearing-validation.js';
import { validateConfiguration, retainRetiredConfiguration, activeModes, monitorStations } from '../../shared/ranch-configuration.js';
import { createLocalConfiguration } from '../../shared/local-configuration.js';
import { cloudOrigin, ranchAdminUrl, fetchRanchManifest } from '../../mac/ranch-connection.js';

const seed = () => validateConfiguration({ schemaVersion: 1, name: 'Galpón de prueba', shearers: [{ name: 'Ana' }, { name: 'Luis' }], modes: structuredClone(shearingModes) });
const envelope = (revision, configuration = seed()) => ({ deviceId: '01999999-9999-7999-8999-999999999999', revision, updatedAt: '2026-09-22T12:00:00.000Z', configuration });

test('manifest validation bounds every configurable field and preserves fixed counting semantics', () => {
  for (const mutate of [c => { c.schemaVersion = 2; }, c => { c.shearers = []; }, c => { c.shearers = Array(25).fill({ name: 'A' }); },
    c => c.shearers.forEach(s => { s.active = false; }), c => { c.modes[0].type = 'unknown'; }, c => { c.modes[0].bulk = true; },
    c => { c.modes[0].tagSchema.colors[0].color = 'url(https://example.com)'; }, c => { c.modes[0].tagSchema.colors[0].active = 'false'; },
    c => c.modes[0].tagSchema.colors.push(c.modes[0].tagSchema.colors[0]), c => { c.modes[0].tagSchema.textSchema[1].max = 100; },
    c => { c.modes[0].surveySchema[0].field = 'sql'; }]) {
    const c = seed(); mutate(c); assert.throws(() => validateConfiguration(c));
  }
  for (const mode of seed().modes.filter(m => m.tagSchema)) {
    assert.ok(mode.tagSchema.colors.some(c => c.value === 'green'));
    assert.ok(mode.tagSchema.colors.some(c => c.value === 'black'));
    assert.ok(mode.tagSchema.colors.some(c => c.value === 'none'));
  }
});

test('retired identifiers remain readable and editable without enabling new uses', () => {
  const before = seed(), next = seed();
  next.shearers.pop();
  next.modes[0].tagSchema.colors = next.modes[0].tagSchema.colors.filter(c => c.value !== 'green');
  const config = retainRetiredConfiguration(next, before);
  assert.equal(config.shearers[1].active, false);
  assert.equal(config.modes[0].tagSchema.colors.find(c => c.value === 'green').active, false);
  assert.ok(!activeModes(config.modes)[0].tagSchema.colors.some(c => c.value === 'green'));
  const old = { station: 2, type: 'oveja', tag: 'A12345', color: 'green', woolQuality: 'GOOD', lactation: 'OK' };
  assert.equal(validateShearingFields({ ...old, tag: 'A54321' }, 2, config.modes, old, config.shearers), null);
  assert.ok(validateShearingFields(old, 2, config.modes, null, config.shearers));
  assert.deepEqual(monitorStations(config.shearers, { 2: { counted: 1 }, 8: { counted: 2 } }).map(s => s.station), [1, 2, 8]);
  assert.deepEqual(monitorStations(config.shearers, { 2: { counted: 0 } }).map(s => s.station), [1]);
});

test('configuration revisions commit durably, retain in-progress forms, reject malformed/replayed rollbacks, and isolate credentials', () => {
  const db = new Database(':memory:');
  const cache = createLocalConfiguration(db, 'server-a', seed());
  assert.equal(cache.current().revision, 0);
  cache.apply(envelope(1));
  const revised = seed(); revised.modes[0].tagSchema.colors.find(c => c.value === 'green').active = false;
  cache.apply(envelope(2, revised));
  assert.equal(cache.forRevision(1).modes[0].tagSchema.colors.find(c => c.value === 'green').active, true);
  assert.equal(cache.forRevision(0).shearers[0].name, 'Ana');
  assert.equal(cache.forRevision(50), null);
  assert.equal(cache.apply(envelope(2, revised)), false);
  assert.throws(() => cache.apply(envelope(1)));
  assert.throws(() => cache.apply(envelope(2)));
  assert.throws(() => cache.apply(envelope(3, { ...seed(), schemaVersion: 2 })));
  assert.throws(() => cache.apply({ ...envelope(3), deviceId: '01999999-9999-7999-8999-999999999998' }));
  assert.equal(createLocalConfiguration(db, 'server-a', seed()).current().revision, 2);
  assert.equal(createLocalConfiguration(db, 'server-b', seed()).current().revision, 0);
  assert.throws(() => cache.updateLocal([{ name: 'Other' }]));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ranch_configuration').get().n, 3);
  db.close();
});

test('onboarding validates the cloud origin and role, bounds downloads, and builds credential-free ranch links', async () => {
  for (const bad of ['http://cloud.example', 'https://a:b@cloud.example', 'file:///tmp/config', 'https://cloud.example/path', 'https://cloud.example/?token=secret']) assert.throws(() => cloudOrigin(bad));
  assert.equal(cloudOrigin('https://cloud.example/'), 'https://cloud.example');
  assert.equal(ranchAdminUrl('https://cloud.example', envelope(1).deviceId), `https://cloud.example/admin?server=${envelope(1).deviceId}#configuration`);
  let calls = 0;
  const result = await fetchRanchManifest('https://cloud.example', 'fixture-token', async (url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    assert.equal(url, 'https://cloud.example/api/server/configuration');
    return Response.json(envelope(1));
  });
  assert.equal(result.revision, 1); assert.equal(calls, 1);
  for (const status of [401, 403, 409, 500]) await assert.rejects(fetchRanchManifest('https://cloud.example', 'fixture-token', async () => new Response('', { status })));
  await assert.rejects(fetchRanchManifest('https://cloud.example', 'fixture-token', async () => new Response('x'.repeat(100000))));
  await assert.rejects(fetchRanchManifest('https://cloud.example', 'fixture-token', async () => { throw new Error('offline'); }), /Revisa internet/);
});
