/* ---------- SQLite Storage Layer ---------- */
// Uses sql.js (SQLite compiled to WASM) loaded from CDN.
// The database binary is serialized as base64 in localStorage under DB_STORE_KEY.
// The in-memory `state` object remains the working copy; persist() writes here.

const DB_STORE_KEY = 'lifttracker_v1_sqlite';

function createSchema(db) {
  db.run(`CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS exercises (
    id   INTEGER PRIMARY KEY,
    name TEXT,
    cat  TEXT,
    tm   REAL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS days (
    id   INTEGER PRIMARY KEY,
    name TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS templates (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id  INTEGER,
    ex_id   INTEGER,
    reps    INTEGER,
    rpe     REAL,
    sets    INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS rpe_defaults (
    body_part TEXT PRIMARY KEY,
    rpe       REAL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS rpe_overrides (
    schedule_key TEXT PRIMARY KEY,
    rpe          REAL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS rep_defaults (
    body_part TEXT PRIMARY KEY,
    pct       REAL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS rep_overrides (
    schedule_key TEXT PRIMARY KEY,
    pct          REAL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS exercise_rep_ranges (
    ex_id     INTEGER PRIMARY KEY,
    min_reps  INTEGER,
    max_reps  INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ex_id      INTEGER,
    date       TEXT,
    weight     REAL,
    reps       INTEGER,
    rpe        REAL,
    e1rm       REAL,
    target_rpe REAL,
    day        TEXT
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_log_ex_id ON log(ex_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_log_date  ON log(date)`);
}

function writeStateToDb(db, s) {
  db.run('DELETE FROM meta');
  db.run('DELETE FROM exercises');
  db.run('DELETE FROM days');
  db.run('DELETE FROM templates');
  db.run('DELETE FROM rpe_defaults');
  db.run('DELETE FROM rpe_overrides');
  db.run('DELETE FROM rep_defaults');
  db.run('DELETE FROM rep_overrides');
  db.run('DELETE FROM exercise_rep_ranges');
  db.run('DELETE FROM log');

  // meta
  db.run('INSERT INTO meta VALUES (?,?)', ['unit',        s.unit]);
  db.run('INSERT INTO meta VALUES (?,?)', ['nextId',      String(s.nextId)]);
  db.run('INSERT INTO meta VALUES (?,?)', ['nextDayId',   String(s.nextDayId)]);
  db.run('INSERT INTO meta VALUES (?,?)', ['settings',    JSON.stringify(s.settings)]);
  db.run('INSERT INTO meta VALUES (?,?)', ['cycleLength', String(s.cycleLength || 6)]);

  for (const ex of s.exercises) {
    db.run('INSERT INTO exercises VALUES (?,?,?,?)', [ex.id, ex.name, ex.cat, ex.tm]);
  }

  for (const day of s.days) {
    db.run('INSERT INTO days VALUES (?,?)', [day.id, day.name]);
  }

  for (const [dayId, items] of Object.entries(s.templates)) {
    for (const item of items) {
      db.run(
        'INSERT INTO templates (day_id,ex_id,reps,rpe,sets) VALUES (?,?,?,?,?)',
        [Number(dayId), item.exId, item.reps, item.rpe, item.sets]
      );
    }
  }

  for (const [bp, rpe] of Object.entries(s.rpeSchedule.defaults)) {
    db.run('INSERT INTO rpe_defaults VALUES (?,?)', [bp, rpe]);
  }
  for (const [key, rpe] of Object.entries(s.rpeSchedule.overrides)) {
    db.run('INSERT INTO rpe_overrides VALUES (?,?)', [key, rpe]);
  }

  for (const [bp, pct] of Object.entries(s.repProgression.defaults)) {
    db.run('INSERT INTO rep_defaults VALUES (?,?)', [bp, pct]);
  }
  for (const [key, pct] of Object.entries(s.repProgression.overrides)) {
    db.run('INSERT INTO rep_overrides VALUES (?,?)', [key, pct]);
  }

  for (const [exId, range] of Object.entries(s.exerciseRepRanges)) {
    db.run('INSERT INTO exercise_rep_ranges VALUES (?,?,?)', [Number(exId), range.min, range.max]);
  }

  for (const entry of s.log) {
    db.run(
      'INSERT INTO log (ex_id,date,weight,reps,rpe,e1rm,target_rpe,day) VALUES (?,?,?,?,?,?,?,?)',
      [
        entry.exId, entry.date, entry.weight, entry.reps, entry.rpe, entry.e1rm,
        entry.targetRpe != null ? entry.targetRpe : null,
        entry.day      != null ? String(entry.day) : null
      ]
    );
  }
}

function readStateFromDb(db) {
  const s = {};

  // meta
  const metaRes = db.exec('SELECT key, value FROM meta');
  const meta = {};
  if (metaRes.length) {
    for (const row of metaRes[0].values) meta[row[0]] = row[1];
  }
  s.unit        = meta.unit        || 'lb';
  s.nextId      = Number(meta.nextId      || 1);
  s.nextDayId   = Number(meta.nextDayId   || 4);
  s.cycleLength = Number(meta.cycleLength || 6);
  s.settings    = meta.settings
    ? JSON.parse(meta.settings)
    : JSON.parse(JSON.stringify(DEFAULT_STATE.settings));

  // exercises
  const exRes = db.exec('SELECT id, name, cat, tm FROM exercises ORDER BY id');
  s.exercises = exRes.length
    ? exRes[0].values.map(r => ({ id: r[0], name: r[1], cat: r[2], tm: r[3] }))
    : [];

  // days
  const dayRes = db.exec('SELECT id, name FROM days ORDER BY id');
  s.days = dayRes.length
    ? dayRes[0].values.map(r => ({ id: r[0], name: r[1] }))
    : JSON.parse(JSON.stringify(DEFAULT_STATE.days));

  // templates
  s.templates = {};
  for (const day of s.days) s.templates[String(day.id)] = [];
  const tmplRes = db.exec('SELECT day_id, ex_id, reps, rpe, sets FROM templates ORDER BY id');
  if (tmplRes.length) {
    for (const r of tmplRes[0].values) {
      const key = String(r[0]);
      if (!s.templates[key]) s.templates[key] = [];
      s.templates[key].push({ exId: r[1], reps: r[2], rpe: r[3], sets: r[4] });
    }
  }

  // rpeSchedule
  s.rpeSchedule = { defaults: {}, overrides: {} };
  const rpeDefRes = db.exec('SELECT body_part, rpe FROM rpe_defaults');
  if (rpeDefRes.length) {
    for (const r of rpeDefRes[0].values) s.rpeSchedule.defaults[r[0]] = r[1];
  }
  const rpeOvRes = db.exec('SELECT schedule_key, rpe FROM rpe_overrides');
  if (rpeOvRes.length) {
    for (const r of rpeOvRes[0].values) s.rpeSchedule.overrides[r[0]] = r[1];
  }

  // repProgression
  s.repProgression = { defaults: {}, overrides: {} };
  const repDefRes = db.exec('SELECT body_part, pct FROM rep_defaults');
  if (repDefRes.length) {
    for (const r of repDefRes[0].values) s.repProgression.defaults[r[0]] = r[1];
  }
  const repOvRes = db.exec('SELECT schedule_key, pct FROM rep_overrides');
  if (repOvRes.length) {
    for (const r of repOvRes[0].values) s.repProgression.overrides[r[0]] = r[1];
  }

  // exercise_rep_ranges
  s.exerciseRepRanges = {};
  const errRes = db.exec('SELECT ex_id, min_reps, max_reps FROM exercise_rep_ranges');
  if (errRes.length) {
    for (const r of errRes[0].values) {
      s.exerciseRepRanges[r[0]] = { min: r[1], max: r[2] };
    }
  }

  // log
  const logRes = db.exec(
    'SELECT ex_id, date, weight, reps, rpe, e1rm, target_rpe, day FROM log ORDER BY date, id'
  );
  s.log = logRes.length
    ? logRes[0].values.map(r => ({
        exId:      r[0],
        date:      r[1],
        weight:    r[2],
        reps:      r[3],
        rpe:       r[4],
        e1rm:      r[5],
        targetRpe: r[6],
        day:       r[7]
      }))
    : [];

  return s;
}

// Serialize the SQLite database binary as base64 to localStorage.
function _serializeDb(db) {
  const binary = db.export();
  let base64 = '';
  const chunkSize = 8192;
  for (let i = 0; i < binary.length; i += chunkSize) {
    base64 += String.fromCharCode.apply(null, binary.subarray(i, i + chunkSize));
  }
  localStorage.setItem(DB_STORE_KEY, btoa(base64));
}

// Write state to SQLite and persist the DB binary to localStorage.
function persistToSQLite(db, s) {
  writeStateToDb(db, s);
  _serializeDb(db);
}

// Apply backwards-compatibility guards to a state object (mutates in place).
function applyCompatGuards(s) {
  if (!s.rpeSchedule) {
    s.rpeSchedule = JSON.parse(JSON.stringify(DEFAULT_STATE.rpeSchedule));
  }
  if (!s.repProgression) {
    s.repProgression = JSON.parse(JSON.stringify(DEFAULT_STATE.repProgression));
  }
  if (!s.exerciseRepRanges) {
    s.exerciseRepRanges = {};
  }
  if (s.days && (s.nextDayId === undefined || s.nextDayId === null)) {
    s.nextDayId = s.days.length;
  }
}

// Pure migration of old fixed-key template format → custom days format.
// Operates on the state object parameter; no globals, no persist() side-effects.
function migrateLegacyState(s) {
  if (s.days) return; // already on modern format

  const oldKeys = Object.keys(s.templates || {});
  const nameToId = {};
  s.days = oldKeys.map((name, i) => { nameToId[name] = i; return { id: i, name }; });
  s.nextDayId = oldKeys.length;

  // Re-key templates by numeric ID
  const newTemplates = {};
  oldKeys.forEach(name => { newTemplates[String(nameToId[name])] = s.templates[name]; });
  s.templates = newTemplates;

  // Build section → dayIds map for override key migration
  const sectionToDayIds = {};
  oldKeys.forEach(name => {
    const section = name.split('-')[0];
    if (!sectionToDayIds[section]) sectionToDayIds[section] = [];
    sectionToDayIds[section].push(nameToId[name]);
  });

  function migrateOverrides(overrides) {
    const next = {};
    Object.keys(overrides).forEach(key => {
      const parts = key.split('-');
      const week = parts[0], section = parts[1], bodyPart = parts.slice(2).join('-');
      (sectionToDayIds[section] || []).forEach(dayId => {
        next[`${week}-${dayId}-${bodyPart}`] = overrides[key];
      });
    });
    return next;
  }

  if (s.rpeSchedule)    s.rpeSchedule.overrides    = migrateOverrides(s.rpeSchedule.overrides    || {});
  if (s.repProgression) s.repProgression.overrides  = migrateOverrides(s.repProgression.overrides || {});

  // Migrate log day references from name strings to numeric IDs
  (s.log || []).forEach(entry => {
    if (entry.day == null || typeof entry.day === 'number') return;
    const dayStr = String(entry.day);
    if (nameToId[dayStr] !== undefined) { entry.day = nameToId[dayStr]; return; }
    const dParts = dayStr.split('-');
    if (dParts.length === 3) {
      const section = dParts[1];
      const split   = dParts[2].charAt(0).toUpperCase() + dParts[2].slice(1);
      const oldKey  = `${section}-${split}`;
      if (nameToId[oldKey] !== undefined) entry.day = nameToId[oldKey];
    }
  });
}

async function initDatabase() {
  const SQL = await initSqlJs({
    locateFile: file =>
      `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
  });

  const saved = localStorage.getItem(DB_STORE_KEY);

  if (saved) {
    // Restore existing SQLite DB from base64
    const binaryStr = atob(saved);
    const binary    = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) binary[i] = binaryStr.charCodeAt(i);
    const db          = new SQL.Database(binary);
    const loadedState = readStateFromDb(db);
    applyCompatGuards(loadedState);
    return { db, loadedState };
  }

  // First run: create schema and migrate from old JSON if present
  const db = new SQL.Database();
  createSchema(db);

  let sourceState;
  const oldJson = localStorage.getItem(STORE_KEY);
  if (oldJson) {
    try { sourceState = JSON.parse(oldJson); }
    catch (_) { sourceState = JSON.parse(JSON.stringify(DEFAULT_STATE)); }
  } else {
    sourceState = JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  migrateLegacyState(sourceState);
  applyCompatGuards(sourceState);
  writeStateToDb(db, sourceState);
  _serializeDb(db);

  return { db, loadedState: sourceState };
}
