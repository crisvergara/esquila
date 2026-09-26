import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const { Pool } = createRequire(new URL("../../cloud/package.json", import.meta.url))("pg");
import { createServer } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  jsonRequest,
  startNodeService,
  stopService,
  waitFor,
  waitForHealth,
} from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLOUD_PORT = Number(process.env.E2E_CLOUD_PORT ?? 4181);
const RANCH_PORT = Number(process.env.E2E_RANCH_PORT ?? 3181);
const cloudBase = `http://127.0.0.1:${CLOUD_PORT}`;
const ranchBase = `http://127.0.0.1:${RANCH_PORT}`;
const adminPassword = `e2e-admin-${crypto.randomUUID()}`;
const testDigits = String(Date.now() % 1_000_000).padStart(6, "0");
const primaryTag = `X${testDigits}`;

let tempRoot;
let ranchDir;
let cloudService;
let ranchService;
let serverToken;
let phoneToken;
let testDatabaseUrl;
let testSchema;
let schemaPool;

function startCloud() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must point to a disposable PostgreSQL database");
  }
  return startNodeService("cloud", path.join(ROOT, "cloud/server.js"), {
    cwd: path.join(ROOT, "cloud"),
    env: {
      PORT: String(CLOUD_PORT),
      DATABASE_URL: testDatabaseUrl,
      ADMIN_PASSWORD: adminPassword,
      PUBLIC_URL: cloudBase,
      NODE_ENV: "test",
    },
  });
}

function startRanch(directory) {
  return startNodeService("ranch", path.join(ROOT, "countserver.js"), {
    cwd: directory,
    env: {
      PORT: String(RANCH_PORT),
      CLOUD_SYNC_URL: cloudBase,
      CLOUD_SYNC_TOKEN: serverToken,
      CLOUD_APP_URL: cloudBase,
      CLOUD_SYNC_INTERVAL_MS: "100",
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      NODE_ENV: "test",
    },
  });
}

async function createDevice(name, role) {
  const { response, data } = await jsonRequest(`${cloudBase}/api/admin/devices`, {
    token: adminPassword,
    method: "POST",
    body: { name, role },
  });
  if (!response.ok) throw new Error(`Could not create ${role} device: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function ranchPost(route, body) {
  return jsonRequest(`${ranchBase}${route}`, { method: "POST", body });
}

function totalCount(counts) {
  return Object.values(counts).reduce((sum, station) => sum + station.counted, 0);
}

async function clickDigits(page, digits) {
  for (const digit of digits) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL must point to a disposable PostgreSQL database");
  // Each worker/retry gets a separate flock. Down-sync must never import another
  // test run's sheep into the fresh ranch database.
  testSchema = `esquila_e2e_${crypto.randomUUID().replaceAll('-', '')}`;
  schemaPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await schemaPool.query(`CREATE SCHEMA ${testSchema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-csearch_path=${testSchema}`);
  testDatabaseUrl = url.toString();
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "esquila-e2e-"));
  ranchDir = path.join(tempRoot, "ranch");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(ranchDir));

  cloudService = startCloud();
  await waitForHealth(cloudBase, cloudService);
  serverToken = (await createDevice("Ranch E2E", "server")).token;
  phoneToken = (await createDevice("Phone E2E", "phone")).token;
  await stopService(cloudService);
  cloudService = undefined;

  ranchService = startRanch(ranchDir);
  await waitForHealth(ranchBase, ranchService);
});

test.afterAll(async () => {
  await Promise.all([stopService(ranchService), stopService(cloudService)]);
  if (schemaPool) {
    if (testSchema) await schemaPool.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    await schemaPool.end();
  }
});

test("migrates a legacy ranch database once and backs it up", async () => {
  const legacyDir = path.join(tempRoot, "legacy");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(legacyDir));
  const legacyPath = path.join(legacyDir, "esquila");
  const legacy = new Database(legacyPath);
  legacy.exec(`
    CREATE TABLE counts (
      tag TEXT, station INTEGER, color TEXT, lactation TEXT, type TEXT,
      woolQuality TEXT, date TEXT, vaccinated INTEGER DEFAULT 0,
      vaccinationDate TEXT
    );
    INSERT INTO counts VALUES
      ('A12345', 1, 'yellow', 'OK', 'oveja', 'GOOD',
       '2026-01-01T12:00:00.000Z', 1, '2026-01-02T12:00:00.000Z');
  `);
  legacy.close();

  const legacyPort = RANCH_PORT + 1;
  const service = startNodeService("legacy-ranch", path.join(ROOT, "countserver.js"), {
    cwd: legacyDir,
    env: {
      PORT: String(legacyPort),
      CLOUD_SYNC_URL: "",
      CLOUD_SYNC_TOKEN: "",
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      NODE_ENV: "test",
    },
  });
  await waitForHealth(`http://127.0.0.1:${legacyPort}`, service);
  await stopService(service);

  const migrated = new Database(legacyPath, { readonly: true });
  expect(migrated.pragma("user_version", { simple: true })).toBe(4);
  expect(migrated.prepare("SELECT COUNT(*) AS n FROM counts").get().n).toBe(1);
  expect(migrated.prepare("SELECT COUNT(*) AS n FROM treatments").get().n).toBe(1);
  expect(migrated.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get().n).toBe(2);
  expect(migrated.prepare("SELECT occurred_on FROM treatments").get().occurred_on).toBe("2026-01-02");
  migrated.close();
  expect(readdirSync(legacyDir).some((name) => /^esquila-pre-v1-.*\.sqlite$/.test(name))).toBe(true);
});

test("completes ranch onboarding in the browser", async ({ page }) => {
  await page.goto(`${ranchBase}/setup`);
  await expect(page.getByText("Este equipo no controla el WiFi")).toBeVisible();
  await page.getByRole("button", { name: "Continuar →" }).click();

  const inputs = page.locator("#shearer-list input");
  for (let index = 0; index < await inputs.count(); index += 1) await inputs.nth(index).fill("");
  await page.getByRole("button", { name: "Guardar y continuar →" }).click();
  await expect(page.getByText("Escribe al menos un nombre.")).toBeVisible();

  await inputs.nth(0).fill("Ana");
  await inputs.nth(1).fill("Beto");
  await inputs.nth(2).fill("Carla");
  await page.getByRole("button", { name: "+ Agregar estación" }).click();
  await page.locator("#shearer-list input").nth(3).fill("Diego");
  await page.getByRole("button", { name: "Guardar y continuar →" }).click();
  await expect(page.getByText("Estaciones: Ana, Beto, Carla, Diego.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Comenzar" }).click();
  await expect(page).toHaveURL(/\/monitor\/?$/);
  for (const name of ["Ana", "Beto", "Carla", "Diego"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  expect(existsSync(path.join(ranchDir, ".onboarded"))).toBe(true);
});

test("tagger covers sheep, ram, bulk, live monitor, persistence, and ambiguous retries", async ({ browser }) => {
  const context = await browser.newContext();
  const monitor = await context.newPage();
  const tagger = await context.newPage();
  await monitor.goto(`${ranchBase}/monitor/`);
  await tagger.goto(`${ranchBase}/tagger/`);

  await tagger.getByRole("button", { name: "Ana", exact: true }).click();
  await tagger.getByRole("button", { name: "No Hay", exact: true }).click();
  await tagger.getByRole("button", { name: "X", exact: true }).click();
  await clickDigits(tagger, testDigits.slice(0, 4));
  await expect(tagger.getByRole("button", { name: "✔" })).toBeDisabled();
  await clickDigits(tagger, testDigits.slice(4, 5));
  await expect(tagger.getByRole("button", { name: "✔" })).toBeEnabled();
  await clickDigits(tagger, testDigits.slice(5));
  await expect(tagger.getByRole("button", { name: "1", exact: true })).toBeDisabled();
  await tagger.getByRole("button", { name: "✔" }).click();
  await tagger.getByRole("button", { name: "Excelente" }).click();
  await tagger.getByRole("button", { name: "No sé" }).click();
  await tagger.getByRole("button", { name: "OK", exact: true }).click();
  await expect(tagger.getByRole("heading", { name: "Conteo registrado" })).toBeVisible();
  await expect(monitor.getByText(primaryTag, { exact: true })).toBeVisible();
  await expect(tagger.getByText("Elija un color")).toBeVisible();
  await tagger.reload();
  await expect(tagger.getByText("Elija un color")).toBeVisible();

  await ranchPost("/mode", { mode: "carnero" });
  await expect(tagger.getByLabel('Modo de conteo')).toHaveText('Carneros');
  await expect(tagger.getByRole("button", { name: "Verde", exact: true })).toBeVisible();
  await tagger.getByRole("button", { name: "Verde", exact: true }).click();
  await tagger.getByRole("button", { name: "AC", exact: true }).click();
  await clickDigits(tagger, "98765");
  await tagger.getByRole("button", { name: "✔" }).click();
  await tagger.getByRole("button", { name: "OK", exact: true }).click();
  await expect(tagger.getByRole("heading", { name: "Conteo registrado" })).toBeVisible();
  await expect(monitor.getByText("AC98765", { exact: true })).toBeVisible();

  await ranchPost("/mode", { mode: "carnillero" });
  await expect(tagger.getByText("¿Cuantos cordilleros hay?")).toBeVisible();
  await tagger.getByRole("button", { name: "Cancela", exact: true }).click();
  await tagger.getByRole("button", { name: "Beto", exact: true }).click();
  await tagger.getByRole("button", { name: "3", exact: true }).click();
  await tagger.getByRole("button", { name: "✔" }).click();
  await tagger.getByRole("button", { name: "OK", exact: true }).click();
  await expect(tagger.getByRole("heading", { name: "Conteo registrado" })).toBeVisible();
  await expect(monitor.getByText("L0003", { exact: true })).toBeVisible();

  await ranchPost("/mode", { mode: "oveja" });
  await expect(tagger.getByText("Elija un color")).toBeVisible();
  await tagger.getByRole("button", { name: "Cambiar esquilador" }).click();
  await tagger.getByRole("button", { name: "Carla", exact: true }).click();
  await tagger.getByRole("button", { name: "Rosa", exact: true }).click();
  await tagger.getByRole("button", { name: "C", exact: true }).click();
  await clickDigits(tagger, "55555");
  await tagger.getByRole("button", { name: "✔" }).click();
  await tagger.getByRole("button", { name: "Bueno" }).click();
  await tagger.getByRole("button", { name: "OK", exact: true }).click();

  let swallowedResponse = false;
  const ambiguousFailure = async (route) => {
    if (!swallowedResponse && route.request().method() === "POST") {
      swallowedResponse = true;
      await route.fetch();
      await route.abort("failed");
    } else {
      await route.continue();
    }
  };
  await tagger.route(`${ranchBase}/count`, ambiguousFailure);
  await tagger.getByRole("button", { name: "OK", exact: true }).click();
  await expect(tagger.getByRole("heading", { name: "No se pudo guardar" })).toBeVisible();
  await tagger.unroute(`${ranchBase}/count`, ambiguousFailure);
  await tagger.getByRole("button", { name: "Reintentar" }).click();
  await expect(tagger.getByRole("heading", { name: "Conteo registrado" })).toBeVisible();

  const db = new Database(path.join(ranchDir, "esquila"), { readonly: true });
  expect(db.prepare("SELECT COUNT(*) AS n FROM counts WHERE tag = 'C55555'").get().n).toBe(1);
  db.close();
  await context.close();
});

test("ranch API rejects invalid data and keeps retries idempotent", async () => {
  const valid = {
    type: "oveja",
    station: 1,
    tag: "A24680",
    color: "yellow",
    woolQuality: "GOOD",
    lactation: "OK",
    submissionId: "valid-count-00000001",
  };
  const invalidCases = [
    ["missing fields", {}],
    ["station zero", { ...valid, station: 0 }],
    ["station beyond configured list", { ...valid, station: 5 }],
    ["fractional station", { ...valid, station: 1.5 }],
    ["too few digits", { ...valid, tag: "A1234" }],
    ["too many digits", { ...valid, tag: "A1234567" }],
    ["unknown prefix", { ...valid, tag: "Z12345" }],
    ["invalid mode color", { ...valid, color: "unconfigured-color" }],
    ["missing wool survey", { ...valid, woolQuality: undefined }],
    ["invalid wool survey", { ...valid, woolQuality: "PERFECT" }],
    ["missing lactation survey", { ...valid, lactation: undefined }],
    ["unknown sheep type", { ...valid, type: "goat" }],
    ["malformed submission id", { ...valid, submissionId: "short" }],
  ];
  for (const [name, body] of invalidCases) {
    const { response } = await ranchPost("/count", body);
    expect(response.status, name).toBe(400);
  }
  const malformed = await jsonRequest(`${ranchBase}/count`, { method: "POST", raw: "{" });
  expect(malformed.response.status).toBe(400);

  const before = totalCount((await jsonRequest(`${ranchBase}/count`)).data);
  const first = await ranchPost("/count", valid);
  const retry = await ranchPost("/count", valid);
  expect(first.response.status).toBe(200);
  expect(first.data.created).toBe(true);
  expect(retry.data.created).toBe(false);
  expect(totalCount((await jsonRequest(`${ranchBase}/count`)).data)).toBe(before + 1);

  for (const quantity of [0, -1, 1.5, "2x", 1001]) {
    const { response } = await ranchPost("/bulk", {
      station: 4,
      quantity,
      submissionId: `bad-bulk-${String(quantity).padEnd(16, "0")}`,
    });
    expect(response.status).toBe(400);
  }
  expect((await ranchPost("/bulk", { station: 0, quantity: 1 })).response.status).toBe(400);
  expect((await ranchPost("/mode", { mode: "unknown" })).response.status).toBe(400);

  const bulk = { station: 4, quantity: 1000, submissionId: "max-bulk-000000001" };
  const bulkBefore = totalCount((await jsonRequest(`${ranchBase}/count`)).data);
  const bulkFirst = await ranchPost("/bulk", bulk);
  const bulkRetry = await ranchPost("/bulk", bulk);
  expect(bulkFirst.response.status).toBe(200);
  expect(bulkFirst.data.created).toBe(true);
  expect(bulkRetry.data.created).toBe(false);
  expect(totalCount((await jsonRequest(`${ranchBase}/count`)).data)).toBe(bulkBefore + 1000);
});

test("ranch remains offline, then drains every row exactly once when cloud returns", async () => {
  const dbPath = path.join(ranchDir, "esquila");
  let db = new Database(dbPath, { readonly: true });
  const localRows = db.prepare(`
    SELECT id, tag, station, color, lactation, type, woolQuality, date, updated_at,
           deleted_at, origin
    FROM counts ORDER BY id
  `).all();
  const queuedBefore = db.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get().n;
  db.close();
  expect(localRows.length).toBeGreaterThanOrEqual(1007);
  expect(queuedBefore).toBe(localRows.length);

  cloudService = startCloud();
  await waitForHealth(cloudBase, cloudService);
  await waitFor(() => {
    const current = new Database(dbPath, { readonly: true });
    const count = current.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get().n;
    current.close();
    return count === 0;
  }, { timeoutMs: 45_000, description: "ranch outbox to drain" });

  const snapshot = (await jsonRequest(`${cloudBase}/api/snapshot`, { token: serverToken })).data;
  const remoteById = new Map(snapshot.shearing_events.map((row) => [row.id, row]));
  for (const local of localRows) {
    const remote = remoteById.get(local.id);
    expect(remote, `missing remote row ${local.id}`).toBeTruthy();
    expect({
      tag: remote.tag,
      station: remote.station,
      color: remote.color,
      lactation: remote.lactation,
      type: remote.type,
      woolQuality: remote.wool_quality,
      occurredAt: new Date(remote.occurred_at).toISOString(),
      updatedAt: new Date(remote.updated_at).toISOString(),
      origin: remote.origin,
    }).toEqual({
      tag: local.tag,
      station: local.station,
      color: local.color,
      lactation: local.lactation,
      type: local.type,
      woolQuality: local.woolQuality,
      occurredAt: new Date(local.date).toISOString(),
      updatedAt: new Date(local.updated_at).toISOString(),
      origin: local.origin,
    });
  }
  expect(new Set(localRows.map((row) => row.id)).size).toBe(localRows.length);
});

test("restart preserves lamb numbering and sync resumes", async () => {
  const dbPath = path.join(ranchDir, "esquila");
  let db = new Database(dbPath, { readonly: true });
  const before = db.prepare("SELECT MAX(CAST(substr(tag, 2) AS INTEGER)) AS n FROM counts WHERE tag LIKE 'L%'").get().n;
  db.close();

  await stopService(ranchService);
  ranchService = startRanch(ranchDir);
  await waitForHealth(ranchBase, ranchService);
  const result = await ranchPost("/bulk", { station: 1, quantity: 1, submissionId: "restart-bulk-000001" });
  expect(result.response.status).toBe(200);

  db = new Database(dbPath, { readonly: true });
  const after = db.prepare("SELECT MAX(CAST(substr(tag, 2) AS INTEGER)) AS n FROM counts WHERE tag LIKE 'L%'").get().n;
  const duplicateTags = db.prepare("SELECT tag FROM counts GROUP BY tag HAVING COUNT(*) > 1").all();
  db.close();
  expect(after).toBe(before + 1);
  expect(duplicateTags).toEqual([]);
  await waitFor(() => {
    const current = new Database(dbPath, { readonly: true });
    const count = current.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get().n;
    current.close();
    return count === 0;
  }, { description: "post-restart outbox to drain" });
});

test("record editor retries offline mutations across restart and reconciles edits and tombstones", async ({ page }) => {
  const editorPrefix = `A${testDigits.slice(0, 5)}`;
  const rows = async () => (await jsonRequest(`${ranchBase}/api/records?tag=${editorPrefix}`)).data.rows;
  const before = totalCount((await jsonRequest(`${ranchBase}/count`)).data);
  await page.goto(`${ranchBase}/records/`);
  await page.getByRole("button", { name: "Agregar registro" }).click();
  await page.getByLabel("Código", { exact: true }).fill(`${editorPrefix}0`);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Cambio guardado en el galpón.", { exact: false })).toBeVisible();
  const original = (await rows())[0];
  await waitFor(async () => {
    const snapshot = (await jsonRequest(`${cloudBase}/api/snapshot`, { token: serverToken })).data;
    return snapshot.shearing_events.some(r => r.id === original.id);
  }, { description: "editor addition to sync" });
  const stale = (await jsonRequest(`${cloudBase}/api/snapshot`, { token: serverToken })).data.shearing_events.find(r => r.id === original.id);
  await stopService(cloudService); cloudService = undefined;

  await page.getByLabel("Buscar código").fill(editorPrefix);
  await page.getByRole("row").filter({ hasText: `${editorPrefix}0` }).getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Código", { exact: true }).fill(`${editorPrefix}1`);
  await page.getByLabel("Estación", { exact: true }).selectOption("2");
  await page.getByLabel("Color", { exact: true }).selectOption("pink");
  await page.getByLabel("Calidad", { exact: true }).selectOption("EXCELLENT");
  await page.getByLabel("Lactante", { exact: true }).selectOption("dry");
  let lost = false;
  const loseResponse = async route => {
    if (!lost && route.request().method() === "POST") {
      lost = true; await route.fetch(); await route.abort("failed");
    } else await route.continue();
  };
  await page.route(`${ranchBase}/api/records`, loseResponse);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toBeVisible();
  const edited = (await rows())[0];
  expect(edited).toMatchObject({ id: original.id, tag: `${editorPrefix}1`, station: 2, color: "pink", woolQuality: "EXCELLENT", lactation: "dry", date: original.date, pending: 1 });
  expect(edited.updated_at > original.updated_at).toBe(true);

  await stopService(ranchService); ranchService = startRanch(ranchDir); await waitForHealth(ranchBase, ranchService);
  await page.unroute(`${ranchBase}/api/records`, loseResponse);
  await page.reload();
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByText("El cambio ya estaba guardado. No se duplicó.")).toBeVisible();
  expect((await rows())[0].updated_at).toBe(edited.updated_at);
  expect(totalCount((await jsonRequest(`${ranchBase}/count`)).data)).toBe(before + 1);

  // A stale editor and invalid fields cannot change either domain data or outbox.
  const staleEdit = await ranchPost("/api/records", { ...original, action: "edit", submissionId: crypto.randomUUID() });
  expect(staleEdit.response.status).toBe(409);
  for (const fields of [{ station: 0 }, { tag: "Z1" }, { color: "unknown" }, { woolQuality: "bad" }, { lactation: "bad" }]) {
    expect((await ranchPost("/api/records", { ...edited, ...fields, action: "edit", submissionId: crypto.randomUUID() })).response.status).toBe(400);
  }
  expect((await rows())[0]).toEqual(edited);

  // Add then delete a separate row while entirely disconnected.
  await page.getByRole("button", { name: "Agregar registro" }).click();
  await page.getByLabel("Código", { exact: true }).fill(`${editorPrefix}2`);
  lost = false; await page.route(`${ranchBase}/api/records`, loseResponse);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toBeVisible();
  await page.unroute(`${ranchBase}/api/records`, loseResponse);
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByText("El cambio ya estaba guardado. No se duplicó.")).toBeVisible();
  const added = (await rows()).find(r => r.tag === `${editorPrefix}2`);
  await page.getByLabel("Buscar código").fill(editorPrefix);
  await page.getByRole("row").filter({ hasText: `${editorPrefix}2` }).getByRole("button", { name: "Eliminar", exact: true }).click();
  lost = false; await page.route(`${ranchBase}/api/records`, loseResponse);
  await page.getByRole("button", { name: "Confirmar eliminación" }).click();
  await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toBeVisible();
  await page.unroute(`${ranchBase}/api/records`, loseResponse);
  await page.reload();
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByText("El cambio ya estaba guardado. No se duplicó.")).toBeVisible();
  expect((await rows()).map(r => r.id)).toEqual([edited.id]);
  expect(totalCount((await jsonRequest(`${ranchBase}/count`)).data)).toBe(before + 1);

  cloudService = startCloud(); await waitForHealth(cloudBase, cloudService);
  await waitFor(async () => (await rows())[0].pending === 0, { timeoutMs: 45_000, description: "offline edit to sync" });
  const snapshot = (await jsonRequest(`${cloudBase}/api/snapshot`, { token: serverToken })).data;
  expect(snapshot.shearing_events.find(r => r.id === edited.id)).toMatchObject({ tag: `${editorPrefix}1`, station: 2, color: "pink", wool_quality: "EXCELLENT", lactation: "dry" });
  expect(snapshot.shearing_events.some(r => r.id === added.id)).toBe(false);
  expect(snapshot.shearing_events.some(r => r.tag === `${editorPrefix}0`)).toBe(false);

  // Delete an already-synchronized record, then replay its old cloud payload.
  const deletion = { ...edited, action: "delete", submissionId: crypto.randomUUID() };
  expect((await ranchPost("/api/records", deletion)).response.status).toBe(200);
  expect((await ranchPost("/api/records", deletion)).data.duplicate).toBe(true);
  await waitFor(async () => !(await jsonRequest(`${cloudBase}/api/snapshot`, { token: serverToken })).data.shearing_events.some(r => r.id === edited.id));
  expect((await jsonRequest(`${cloudBase}/api/sync/push`, { method: "POST", token: serverToken, body: { batches: [{ table: "shearing_events", rows: [stale] }] } })).response.status).toBe(200);
  expect((await jsonRequest(`${cloudBase}/api/snapshot`, { token: serverToken })).data.shearing_events.some(r => r.id === edited.id)).toBe(false);
  expect(totalCount((await jsonRequest(`${ranchBase}/count`)).data)).toBe(before);
  const db = new Database(path.join(ranchDir, "esquila"), { readonly: true });
  expect(db.prepare("SELECT deleted_at FROM counts WHERE id = ?").get(added.id).deleted_at).toBeTruthy();
  expect(db.prepare("SELECT COUNT(*) AS n FROM record_mutations").get().n).toBe(5);
  db.close();
});

test("edits made during an ambiguous cloud push remain queued and reconcile", async () => {
  const directory = path.join(tempRoot, "inflight");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(directory));
  const isolatedBase = `http://127.0.0.1:${RANCH_PORT + 3}`;
  let first = true;
  let rowId;
  let proxyError;
  const proxy = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      const pushed = await jsonRequest(`${cloudBase}${req.url}`, { method: "POST", token: serverToken, raw });
      if (first && req.url === "/api/sync/push") {
        first = false;
        // The cloud has committed, but the barn has not received its receipt.
        const row = (await jsonRequest(`${isolatedBase}/api/records`)).data.rows[0];
        rowId = row.id;
        const edited = await jsonRequest(`${isolatedBase}/api/records`, { method: "POST", body: {
          ...row, action: "edit", tag: "B87654", submissionId: crypto.randomUUID(),
        } });
        expect(edited.response.status).toBe(200);
        res.destroy();
      } else {
        res.writeHead(pushed.response.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pushed.data));
      }
    } catch (error) { proxyError = error; res.destroy(); }
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const launch = () => startNodeService("inflight ranch", path.join(ROOT, "countserver.js"), {
    cwd: directory, env: { PORT: String(RANCH_PORT + 3), CLOUD_SYNC_URL: `http://127.0.0.1:${proxy.address().port}`,
      CLOUD_SYNC_TOKEN: serverToken, CLOUD_SYNC_INTERVAL_MS: "100", AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "" },
  });
  let service = launch();
  try {
    await waitForHealth(isolatedBase, service);
    expect((await jsonRequest(`${isolatedBase}/api/records`, { method: "POST", body: {
      action: "add", tag: "B87653", station: 1, color: "none", type: "oveja", woolQuality: "GOOD", lactation: "idk", submissionId: crypto.randomUUID(),
    } })).response.status).toBe(200);
    await waitFor(async () => {
      if (proxyError) throw proxyError;
      return rowId && (await jsonRequest(`${isolatedBase}/api/records`)).data.pending === 0;
    }, { description: "ambiguous push retry to drain" });
    const remote = (await jsonRequest(`${cloudBase}/api/snapshot`, { token: serverToken })).data.shearing_events.filter(r => r.id === rowId);
    expect(remote).toHaveLength(1);
    expect(remote[0].tag).toBe("B87654");
    const manual = await jsonRequest(`${isolatedBase}/api/records`, { method: "POST", body: {
      action: "add", tag: "L5000", station: 1, color: "none", type: "borrega", woolQuality: "IDK", lactation: "idk", submissionId: crypto.randomUUID(),
    } });
    expect(manual.response.status).toBe(200);
    const lamb = (await jsonRequest(`${isolatedBase}/api/records?tag=L5000`)).data.rows[0];
    expect((await jsonRequest(`${isolatedBase}/api/records`, { method: "POST", body: {
      ...lamb, action: "edit", tag: "L4000", submissionId: crypto.randomUUID(),
    } })).response.status).toBe(200);
    await stopService(service); service = launch(); await waitForHealth(isolatedBase, service);
    expect((await jsonRequest(`${isolatedBase}/bulk`, { method: "POST", body: { station: 1, quantity: 1, submissionId: crypto.randomUUID() } })).response.status).toBe(200);
    expect((await jsonRequest(`${isolatedBase}/api/records?tag=L5001`)).data.rows).toHaveLength(1);
  } finally {
    await stopService(service);
    await new Promise(resolve => proxy.close(resolve));
  }
});

test("cloud enforces auth, roles, rollback, admin CSRF, and last-write-wins", async ({ page, request }) => {
  const status = async (options) => (await jsonRequest(`${cloudBase}${options.path}`, options)).response.status;
  expect(await status({ path: "/api/snapshot" })).toBe(401);
  expect(await status({ path: "/api/snapshot", token: "bad" })).toBe(401);
  expect(await status({ path: "/api/sync/push", token: serverToken, method: "POST", body: {} })).toBe(400);
  expect(await status({ path: "/api/sync/push", token: serverToken, method: "POST", body: { batches: [{ table: "unknown", rows: [] }] } })).toBe(400);
  expect(await status({ path: "/api/sync/push", token: serverToken, method: "POST", raw: "{" })).toBe(400);
  expect(await status({ path: "/api/sync/push", token: phoneToken, method: "POST", body: { batches: [{ table: "shearing_events", rows: [] }] } })).toBe(403);

  const rollbackId = crypto.randomUUID();
  const failedTransaction = await jsonRequest(`${cloudBase}/api/sync/push`, {
    token: serverToken,
    method: "POST",
    body: { batches: [
      { table: "shearing_events", rows: [{ id: rollbackId, tag: "ROLLBACK", occurred_at: "2026-09-13T12:00:00Z", updated_at: "2026-09-13T12:00:00Z" }] },
      { table: "treatments", rows: [{ id: crypto.randomUUID(), tag: "ROLLBACK", type: "vaccination", medication: "Bad", occurred_on: "not-a-date", recorded_at: "2026-09-13T12:00:00Z", updated_at: "2026-09-13T12:00:00Z" }] },
    ] },
  });
  expect(failedTransaction.response.status).toBe(400);
  const afterRollback = (await jsonRequest(`${cloudBase}/api/snapshot`, { token: serverToken })).data;
  expect(afterRollback.shearing_events.some((row) => row.id === rollbackId)).toBe(false);

  const lwwId = crypto.randomUUID();
  const treatment = (medication, updatedAt) => ({
    id: lwwId,
    tag: "LWW-E2E",
    type: "vaccination",
    medication,
    dose: "1 ml",
    occurred_on: "2026-09-13",
    recorded_at: "2026-09-13T12:00:00Z",
    updated_at: updatedAt,
  });
  for (const row of [
    treatment("Initial", "2026-09-13T12:00:00Z"),
    treatment("Same timestamp", "2026-09-13T12:00:00Z"),
    treatment("Stale", "2026-09-12T12:00:00Z"),
    treatment("Newest", "2026-09-14T12:00:00Z"),
  ]) {
    const pushed = await jsonRequest(`${cloudBase}/api/sync/push`, {
      token: phoneToken,
      method: "POST",
      body: { batches: [{ table: "treatments", rows: [row] }] },
    });
    expect(pushed.response.status).toBe(200);
  }
  const lwwSnapshot = (await jsonRequest(`${cloudBase}/api/snapshot`, { token: phoneToken })).data;
  expect(lwwSnapshot.treatments.find((row) => row.id === lwwId).medication).toBe("Newest");

  await page.goto(`${cloudBase}/admin`);
  await expect(page.getByLabel("Contraseña de administración")).toBeVisible();
  await page.getByLabel("Contraseña de administración").fill(adminPassword);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Esquila — Dispositivos" })).toBeVisible();

  expect((await request.post(`${cloudBase}/api/admin/login`, { data: { password: adminPassword } })).status()).toBe(200);
  expect((await request.post(`${cloudBase}/api/admin/devices`, { data: { name: "CSRF", role: "phone" } })).status()).toBe(403);
  const enrolled = await request.post(`${cloudBase}/api/admin/devices`, {
    headers: { Origin: cloudBase },
    data: { name: "Revocation E2E", role: "phone" },
  });
  expect(enrolled.status()).toBe(200);
  const device = await enrolled.json();
  expect((await jsonRequest(`${cloudBase}/api/snapshot`, { token: device.token })).response.status).toBe(200);
  expect((await request.delete(`${cloudBase}/api/admin/devices/${device.id}`, { headers: { Origin: cloudBase } })).status()).toBe(200);
  expect((await jsonRequest(`${cloudBase}/api/snapshot`, { token: device.token })).response.status).toBe(401);
});

test("cloud admin manages shearing offline, retries lost receipts, and reconciles both conflict directions", async ({ page, request }) => {
  const admin = (method, route, body) => jsonRequest(`${cloudBase}${route}`, { method, token: adminPassword, body });
  const listing = async tag => (await admin('GET', `/api/admin/shearing?day=&tag=${tag}`)).data.rows;
  await waitFor(async () => (await admin('GET', '/api/admin/ranch')).data.servers[0]?.information?.shearers[0].name === 'Ana');
  const ranchState = (await admin('GET', '/api/admin/ranch')).data;
  expect(ranchState.servers[0].information).toMatchObject({ platform: process.platform, pending: 0 });
  const totals = (await admin('GET', `/api/admin/shearing?day=${ranchState.day}`)).data.totals;
  expect(totals.reduce((sum, row) => sum + row.count, 0)).toBe(totalCount((await jsonRequest(`${ranchBase}/count`)).data));
  for (const route of ['/api/admin/ranch', '/api/admin/shearing']) {
    expect((await jsonRequest(`${cloudBase}${route}`)).response.status).toBe(401);
    expect((await jsonRequest(`${cloudBase}${route}`, { token: phoneToken })).response.status).toBe(401);
  }
  expect((await jsonRequest(`${cloudBase}/api/sync/ranch`, { method: 'POST', token: phoneToken, body: {} })).response.status).toBe(403);
  await request.post(`${cloudBase}/api/admin/login`, { data: { password: adminPassword } });
  expect((await request.post(`${cloudBase}/api/admin/shearing`, { data: {} })).status()).toBe(403);

  await stopService(ranchService); ranchService = undefined;
  await page.goto(`${cloudBase}/admin`);
  await page.getByLabel('Contraseña de administración').fill(adminPassword);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('table', { name: 'Monitor por esquilador' })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar registro', exact: true }).click();
  await page.locator('#record-tag').fill('A99881');
  await page.locator('#record-station').selectOption('2');
  let lostReceipt;
  await page.route('**/api/admin/shearing', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); lostReceipt = await response.json(); await route.abort('failed');
  });
  await page.locator('#record-save').click();
  await expect(page.locator('#editor-error')).not.toBeEmpty();
  expect(lostReceipt.ok).toBe(true);
  await page.unroute('**/api/admin/shearing');
  await page.reload();
  await page.getByRole('button', { name: 'Reintentar mismo cambio' }).click();
  await expect(page.locator('#ranch-result')).toContainText('Guardado en la nube');
  expect(await listing('A99881')).toHaveLength(1);
  await page.locator('#ranch-tag').fill('A99881');
  await page.getByRole('button', { name: 'Buscar / Actualizar' }).click();
  await expect(page.locator('#ranch-rows tr')).toHaveCount(1);
  await expect(page.locator('#ranch-rows')).toContainText('Pendiente en galpón');
  const old = (await listing('A99881'))[0];
  await page.locator('#ranch-rows').getByRole('button', { name: 'Editar', exact: true }).click();
  await page.locator('#record-tag').fill('A99882');
  await page.locator('#record-station').selectOption('3');
  await page.locator('#record-save').click();
  await expect(page.locator('#ranch-editor')).not.toBeVisible();
  expect((await admin('POST', '/api/admin/shearing', { ...old, action: 'edit', submissionId: crypto.randomUUID() })).response.status).toBe(409);
  expect((await listing('A99882'))[0].occurred_at).toBe(old.occurred_at);
  const addIntent = { action: 'add', tag: 'A99883', station: 1, type: 'oveja', color: 'none', woolQuality: 'GOOD', lactation: 'idk', submissionId: crypto.randomUUID() };
  const [tombstone, repeated] = await Promise.all([admin('POST', '/api/admin/shearing', addIntent), admin('POST', '/api/admin/shearing', addIntent)]);
  expect(repeated.response.status).toBe(200);
  expect(repeated.data.id).toBe(tombstone.data.id);
  expect([tombstone.data.duplicate, repeated.data.duplicate].sort()).toEqual([false, true]);
  expect((await admin('POST', '/api/admin/shearing', { ...addIntent, tag: 'A11223' })).response.status).toBe(409);
  expect(tombstone.response.status).toBe(200);
  await page.locator('#ranch-tag').fill('A99883');
  await page.getByRole('button', { name: 'Buscar / Actualizar' }).click();
  await expect(page.locator('#ranch-rows')).toContainText('A99883');
  await page.locator('#ranch-rows').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar eliminación' }).click();
  await expect(page.locator('#ranch-editor')).not.toBeVisible();
  expect(await listing('A99883')).toHaveLength(0);
  const history = (await admin('GET', `/api/admin/shearing/${tombstone.data.id}/history`)).data;
  expect(history).toHaveLength(2); expect(history[0].after_row.deleted_at).toBeTruthy();
  await page.locator('#ranch-deleted').check();
  await page.getByRole('button', { name: 'Buscar / Actualizar' }).click();
  await expect(page.locator('#ranch-rows')).toContainText('Eliminado');
  await page.locator('#ranch-rows').getByRole('button', { name: 'Historial' }).click();
  await expect(page.locator('#history-rows')).toContainText('A99883');
  await page.getByRole('button', { name: 'Cerrar historial' }).click();
  const invalid = await admin('POST', '/api/admin/shearing', { action: 'add', tag: 'A12', station: 1, type: 'oveja', submissionId: crypto.randomUUID() });
  expect(invalid.response.status).toBe(400);

  ranchService = startRanch(ranchDir); await waitForHealth(ranchBase, ranchService);
  await waitFor(async () => (await jsonRequest(`${ranchBase}/api/records?tag=A99882`)).data.rows.length === 1);
  const db = new Database(path.join(ranchDir, 'esquila'), { readonly: true });
  expect(db.prepare('SELECT deleted_at FROM counts WHERE id=?').get(tombstone.data.id).deleted_at).toBeTruthy();
  expect(db.prepare('SELECT count(*) AS n FROM sync_outbox').get().n).toBe(0);
  await waitFor(async () => BigInt((await admin('GET', '/api/admin/ranch')).data.servers[0].applied_revision) >= BigInt(history[0].after_row.revision));

  // While cloud is down, two ranch corrections are durable. An admin later edits
  // one of them; the other retains its newer local value when the older cloud page arrives.
  const local = (await jsonRequest(`${ranchBase}/api/records?tag=A99882`)).data.rows[0];
  // Freeze the barn with a saved copy, make a remote correction, then edit the
  // same saved copy locally while cloud is unavailable. The local timestamp wins.
  const second = await ranchPost('/api/records', { action: 'add', tag: 'A99887', station: 2, type: 'oveja', color: 'none', woolQuality: 'GOOD', lactation: 'idk', submissionId: crypto.randomUUID() });
  expect(second.response.status).toBe(200);
  await waitFor(async () => (await listing('A99887')).length === 1);
  await stopService(ranchService); ranchService = undefined;
  expect((await admin('POST', '/api/admin/shearing', { ...(await listing('A99887'))[0], action: 'edit', tag: 'A99888', submissionId: crypto.randomUUID() })).response.status).toBe(200);
  await stopService(cloudService); cloudService = undefined;
  ranchService = startRanch(ranchDir); await waitForHealth(ranchBase, ranchService);
  const savedSecond = (await jsonRequest(`${ranchBase}/api/records?tag=A99887`)).data.rows[0];
  expect((await ranchPost('/api/records', { ...savedSecond, action: 'edit', tag: 'A99889', submissionId: crypto.randomUUID() })).response.status).toBe(200);
  const localEdit = await ranchPost('/api/records', { ...local, action: 'edit', tag: 'A99884', submissionId: crypto.randomUUID() });
  expect(localEdit.response.status).toBe(200);
  const localAdd = await ranchPost('/api/records', { action: 'add', tag: 'A99885', station: 2, type: 'oveja', color: 'none', woolQuality: 'GOOD', lactation: 'idk', submissionId: crypto.randomUUID() });
  expect(localAdd.response.status).toBe(200);
  await stopService(ranchService); ranchService = undefined;
  cloudService = startCloud(); await waitForHealth(cloudBase, cloudService);
  const newer = await admin('POST', '/api/admin/shearing', { ...(await listing('A99882'))[0], action: 'edit', tag: 'A99886', submissionId: crypto.randomUUID() });
  expect(newer.response.status).toBe(200);
  ranchService = startRanch(ranchDir); await waitForHealth(ranchBase, ranchService);
  await waitFor(async () => (await jsonRequest(`${ranchBase}/api/records?tag=A99886`)).data.rows.length === 1 && (await listing('A99885')).length === 1 && (await listing('A99889')).length === 1);
  const conflicts = (await admin('GET', `/api/admin/shearing/${local.id}/history`)).data;
  expect(conflicts.some(h => h.source === 'stale-push' && h.after_row.tag === 'A99884' && h.before_row.tag === 'A99886')).toBe(true);
  expect(db.prepare('SELECT tag FROM counts WHERE id=?').get(local.id).tag).toBe('A99886');
  const secondHistory = (await admin('GET', `/api/admin/shearing/${second.data.id}/history`)).data;
  expect(secondHistory.some(h => h.before_row?.tag === 'A99888' && h.after_row.tag === 'A99889')).toBe(true);
  expect(db.prepare('SELECT tag FROM counts WHERE id=?').get(second.data.id).tag).toBe('A99889');
  const cursor = db.prepare('SELECT cursor FROM ranch_sync_state').get().cursor;
  expect(BigInt(cursor)).toBeGreaterThan(500n);
  await stopService(ranchService); ranchService = startRanch(ranchDir); await waitForHealth(ranchBase, ranchService);
  expect(db.prepare('SELECT cursor FROM ranch_sync_state').get().cursor).toBe(cursor);
  expect(db.prepare('SELECT count(*) AS n FROM sync_outbox').get().n).toBe(0);
  db.close();
});

test("vaccination PWA survives offline reload and syncs directly to cloud", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  await page.goto(`${cloudBase}/#token=${phoneToken}&name=Phone%20E2E`);
  await page.getByPlaceholder("Filtrar por código...").fill(primaryTag);
  await expect(page.getByRole("row", { name: new RegExp(primaryTag) })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Estación" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sincronizado" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

  await page.getByRole("row", { name: new RegExp(primaryTag) }).click();
  await page.getByRole("button", { name: "Ver Detalle" }).click();
  await expect(page.getByText("Estación 1", { exact: false })).toBeVisible();

  await stopService(cloudService);
  cloudService = undefined;
  await page.getByRole("button", { name: "+ Manual" }).click();
  await page.getByPlaceholder("Nombre del medicamento...").fill("Clostridial E2E");
  await page.getByPlaceholder("Dosis (ej. 2ml, 1 pastilla)...").fill("2 ml");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Clostridial E2E", { exact: false })).toBeVisible();
  await expect(page.getByText("pendiente", { exact: true })).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Filtrar por código...").fill(primaryTag);
  await page.getByRole("row", { name: new RegExp(primaryTag) }).click();
  await page.getByRole("button", { name: "Ver Detalle" }).click();
  await expect(page.getByText("Clostridial E2E", { exact: false })).toBeVisible();
  await expect(page.getByText("pendiente", { exact: true })).toBeVisible();

  cloudService = startCloud();
  await waitForHealth(cloudBase, cloudService);
  await page.getByRole("button", { name: /por sincronizar|Sin conexión/ }).click();
  await expect(page.getByRole("button", { name: "Sincronizado" })).toBeVisible({ timeout: 20_000 });

  const snapshot = (await jsonRequest(`${cloudBase}/api/snapshot`, { token: phoneToken })).data;
  const matching = snapshot.treatments.filter((row) => row.tag === primaryTag && row.medication === "Clostridial E2E");
  expect(matching).toHaveLength(1);
  expect(matching[0]).toMatchObject({ dose: "2 ml", origin: "Phone E2E" });

  const ranch = new Database(path.join(ranchDir, "esquila"), { readonly: true });
  expect(ranch.prepare("SELECT COUNT(*) AS n FROM treatments").get().n).toBe(0);
  expect(ranch.prepare("SELECT COUNT(*) AS n FROM sync_outbox").get().n).toBe(0);
  ranch.close();
  await context.close();
});
