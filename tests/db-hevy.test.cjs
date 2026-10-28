const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

const context = vm.createContext({ DEFAULT_STATE: { settings: {}, days: [] } });
vm.runInContext(fs.readFileSync("js/db.js", "utf8"), context);

test("SQLite log schema migrates old databases and round-trips Hevy source IDs", () => {
  const schemaCalls = [];
  const freshDb = { run: sql => schemaCalls.push(sql) };
  context.createSchema(freshDb);
  assert.ok(schemaCalls.some(sql => /hevy_source_key TEXT UNIQUE/.test(sql)));

  const migrations = [];
  const oldDb = {
    exec: sql => sql === "PRAGMA table_info(log)" ? [{ values: [[0, "id"], [1, "ex_id"], [2, "date"]] }] : [],
    run: sql => migrations.push(sql),
  };
  context.ensureHevyLogSourceColumn(oldDb);
  assert.ok(migrations.some(sql => /ALTER TABLE log ADD COLUMN hevy_source_key TEXT/.test(sql)));
  assert.ok(migrations.some(sql => /UNIQUE INDEX.*hevy_source_key/.test(sql)));

  const sourceKey = "hevy:acct:workout:bench:0:1";
  const readDb = { exec: sql => sql.includes("hevy_source_key FROM log")
    ? [{ values: [[11, "2026-10-20T12:00:00.000Z", 100, 3, 8, 110, null, 1, sourceKey]] }]
    : [] };
  const loaded = context.readStateFromDb(readDb);
  assert.equal(loaded.log[0].hevySourceKey, sourceKey);

  const writes = [];
  const state = {
    unit: "kg", nextId: 12, nextDayId: 2, settings: {}, cycleLength: 6,
    exercises: [], days: [], templates: {}, rpeSchedule: { defaults: {}, overrides: {} },
    repProgression: { defaults: {}, overrides: {} }, exerciseRepRanges: {},
    log: [{ exId: 11, date: "2026-10-20T12:00:00.000Z", weight: 100, reps: 3, rpe: 8, e1rm: 110, targetRpe: null, day: 1, hevySourceKey: sourceKey }],
  };
  context.writeStateToDb({ run: (...args) => writes.push(args) }, state);
  const inserted = writes.find(([sql]) => sql.includes("INSERT INTO log"));
  assert.match(inserted[0], /hevy_source_key/);
  assert.equal(inserted[1][8], sourceKey);
});
