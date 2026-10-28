const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

const source = fs.readFileSync("js/data-io.js", "utf8");

function createContext({ saveBackup = async () => ({ saved: true }) } = {}) {
  const alerts = [];
  const writes = [];
  const ctx = {
    window: { Capacitor: { getPlatform: () => "android", Plugins: {
      BackupExport: { saveBackup: async payload => { writes.push(payload); return saveBackup(payload); } },
      Filesystem: { writeFile: () => { throw new Error("must not write app-private storage"); } },
    } } },
    state: { value: 1 },
    hevyMappingBackup: () => ({ version: 1 }),
    Blob,
    Date: class extends Date { toISOString() { return "2026-10-27T00:00:00.000Z"; } },
    alert: message => alerts.push(message),
    navigator: {},
    document: {},
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ctx, alerts, writes };
}

test("Android export sends the normal JSON backup to the system save picker", async () => {
  const h = createContext();
  await vm.runInContext("exportData()", h.ctx);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].filename, "lifttracker-2026-10-27.json");
  assert.deepEqual(JSON.parse(h.writes[0].content), { value: 1, hevyMappings: { version: 1 } });
  assert.match(h.alerts[0], /Choose Downloads in the Android save dialog/);
});

test("Android save cancellation is quiet and write failure is reported without a false success", async () => {
  const cancelled = createContext({ saveBackup: async () => ({ cancelled: true }) });
  await vm.runInContext("exportData()", cancelled.ctx);
  assert.deepEqual(cancelled.alerts, []);

  const failed = createContext({ saveBackup: async () => { throw new Error("write denied"); } });
  await vm.runInContext("exportData()", failed.ctx);
  assert.deepEqual(failed.alerts, ["Export failed: write denied"]);
});

test("Android export fails clearly if the native save plugin is missing", async () => {
  const h = createContext();
  delete h.ctx.window.Capacitor.Plugins.BackupExport;
  await vm.runInContext("exportData()", h.ctx);
  assert.match(h.alerts[0], /Export is unavailable in this app build/);
  assert.equal(h.writes.length, 0);
});
