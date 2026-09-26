import { validateConfiguration, validateManifest } from './ranch-configuration.js';

export function createLocalConfiguration(db, scope, fallback) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS ranch_configuration (
      scope TEXT NOT NULL, revision INTEGER NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY(scope, revision)
    );`);
    if (db.pragma('user_version', { simple: true }) < 4) db.pragma('user_version = 4');
  })();
  const latest = () => db.prepare('SELECT manifest FROM ranch_configuration WHERE scope=? ORDER BY revision DESC LIMIT 1').get(scope);
  let current = latest();
  current = current ? JSON.parse(current.manifest) : { revision: 0, configuration: validateConfiguration(fallback) };
  const apply = db.transaction(value => {
    const next = validateManifest(value);
    if (current.deviceId && next.deviceId !== current.deviceId) throw new Error('El manifiesto pertenece a otro galpón.');
    if (next.revision < current.revision) throw new Error('La nube ofrece una configuración anterior; conserva la copia local.');
    if (next.revision === current.revision) {
      if (JSON.stringify(next) !== JSON.stringify(current)) throw new Error('La misma revisión tiene contenido diferente.');
      return false;
    }
    db.prepare('INSERT OR IGNORE INTO ranch_configuration VALUES(?,?,?)').run(scope, current.revision, JSON.stringify(current));
    db.prepare('INSERT INTO ranch_configuration VALUES(?,?,?)').run(scope, next.revision, JSON.stringify(next));
    return next;
  });
  return {
    current: () => current,
    apply(value) { const next = apply(value); if (next) current = next; return Boolean(next); },
    forRevision(revision) {
      if (revision === undefined || revision === current.revision) return current.configuration;
      if (!Number.isSafeInteger(revision) || revision < 0) return null;
      const row = db.prepare('SELECT manifest FROM ranch_configuration WHERE scope=? AND revision=?').get(scope, revision);
      return row ? JSON.parse(row.manifest).configuration : null;
    },
    updateLocal(shearers) {
      if (current.revision) throw new Error('Edita los esquiladores desde la administración remota.');
      const next = { ...current, configuration: validateConfiguration({ ...current.configuration, shearers }) };
      db.prepare('INSERT OR REPLACE INTO ranch_configuration VALUES(?,?,?)').run(scope, 0, JSON.stringify(next));
      current = next;
    },
  };
}
