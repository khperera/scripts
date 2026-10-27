const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

const source = fs.readFileSync("js/hevy.js", "utf8");

function context(extra = {}) {
  const values = new Map();
  const elements = new Map();
  const getElement = (selector) => {
    const id = selector.replace(/^#/, "");
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", checked: true, hidden: false, disabled: false,
      dataset: {}, appendChild() {}, replaceChildren() {}, querySelectorAll() { return []; },
    });
    return elements.get(id);
  };
  const ctx = {
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key),
    },
    window: {},
    document: { createElement: () => ({ appendChild() {}, append() {}, replaceChildren() {} }) },
    Option: function (text, value) { return { text, value }; },
    $: getElement,
    state: {
      days: [{ id: 1, name: "Upper 1" }, { id: 2, name: "Upper 2" }],
      templates: { 1: [{ exId: 11, sets: 4 }], 2: [{ exId: 11, sets: 3 }] },
      exercises: [{ id: 11, name: "Bench Press", cat: "CHEST", tm: 100 }],
      unit: "kg", settings: { minJump: 2.5 },
    },
    getRPEForExercise: () => 8,
    calculateTargetReps: () => 5,
    prescribeLoad: (_tm, reps) => reps === 13 ? 60 : 80,
    setTimeout, clearTimeout, console,
    ...extra,
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ctx, values, getElement };
}

test("routine merge changes only the mapped exercise's normal sets and preserves special fields", () => {
  const h = context();
  const result = vm.runInContext(`(() => {
    const plan = { routine: { title: "Day", notes: "routine note", exercises: [
      { exercise_template_id: "bench", superset_id: "A", rest_seconds: 90, notes: "keep", sets: [
        { type: "warmup", weight_kg: 20, reps: 5, custom_metric: {x: 1} },
        { type: "normal", weight_kg: 50, reps: 5, custom_metric: {x: 2} },
        { type: "normal", weight_kg: 40, reps: 13, custom_metric: {x: 3} },
        { type: "normal", weight_kg: 30, reps: 15, custom_metric: {x: 4} },
        { type: "normal", weight_kg: 25, reps: 12, custom_metric: {x: 5} },
        { type: "drop", weight_kg: 15, reps: 20, custom_metric: {x: 6} },
      ]}, { exercise_template_id: "other", sets: [{type:"normal", weight_kg:10, reps:10}] }
    ]}, assignments: { 0: { desired: [
      { weight_kg: 80, reps: 5 }, { weight_kg: 60, reps: 5 },
      { weight_kg: 60, reps: 5 }, { weight_kg: 60, reps: 5 }
    ]} } };
    return hevyMergeRoutine(plan);
  })()`, h.ctx);
  const exercise = result.exercises[0];
  assert.deepEqual(Array.from(exercise.sets, s => [s.type, s.weight_kg, s.reps]), [
    ["warmup", 20, 5], ["normal", 80, 5], ["normal", 60, 5],
    ["normal", 60, 5], ["normal", 60, 5], ["drop", 15, 20],
  ]);
  assert.equal(JSON.stringify(exercise.sets[0].custom_metric), '{"x":1}');
  assert.equal(JSON.stringify(exercise.sets[1].custom_metric), '{"x":2}');
  assert.equal(exercise.superset_id, "A");
  assert.equal(result.exercises[1].sets[0].weight_kg, 10);
  assert.equal(result.notes, "routine note");
});

test("setup validation gates all writes until every active exercise, day, and occurrence is mapped", () => {
  const h = context();
  const profile = {
    accountId: "acct", exerciseMap: {}, dayRoutines: {}, dayOccurrences: {},
  };
  vm.runInContext(`hevyRuntimeRoutines = {
    a: {id:"a", title:"Upper A", exercises:[{exercise_template_id:"bench"}]},
    b: {id:"b", title:"Upper B", exercises:[{exercise_template_id:"bench"}]}
  }`, h.ctx);
  h.ctx.profileUnderTest = profile;
  let errors = vm.runInContext("hevyValidateSetup(profileUnderTest)", h.ctx);
  assert.ok(errors.some(error => error.includes("Map Bench Press")));
  assert.ok(errors.some(error => error.includes("Map Upper 1")));
  profile.exerciseMap[11] = "bench";
  profile.dayRoutines = { 1: "a", 2: "b" };
  profile.dayOccurrences = { 1: { 0: 0 }, 2: { 0: 0 } };
  errors = vm.runInContext("hevyValidateSetup(profileUnderTest)", h.ctx);
  assert.deepEqual(Array.from(errors), []);
  profile.dayRoutines[2] = "a";
  errors = vm.runInContext("hevyValidateSetup(profileUnderTest)", h.ctx);
  assert.ok(errors.some(error => error.includes("assigned to multiple days")));
});

test("Android requests use the session key in native HTTP and never call companion fetch", async () => {
  const calls = [];
  const h = context({
    window: { Capacitor: {
      getPlatform: () => "android",
      isPluginAvailable: name => name === "CapacitorHttp",
      Plugins: { CapacitorHttp: { request: async request => { calls.push(request); return { status: 200, data: { user: { id: "acct" } } }; } } },
    } },
    fetch: async () => { throw new Error("companion should not be used on Android"); },
  });
  vm.runInContext('hevyRuntimeKey = "session-secret"', h.ctx);
  const data = await vm.runInContext('hevyRequest("/api/hevy/user/info")', h.ctx);
  assert.equal(data.user.id, "acct");
  assert.equal(calls[0].url, "https://api.hevyapp.com/v1/user/info");
  assert.equal(calls[0].headers["api-key"], "session-secret");
  assert.equal(h.values.size, 0);
});

test("workout import computes e1RM with RPE 10 fallback and leaves training max unchanged", async () => {
  const h = context({
    state: { unit: "kg", exercises: [{ id: 11, tm: 85 }] },
    fetch: async (url) => ({ ok: true, status: 200, json: async () => ({
      workouts: [{ id: "uuid-workout", title: "Session", start_time: "2026-02-01", exercises: [
        { exercise_template_id: "bench", sets: [{ weight_kg: 97, reps: 2 }] },
      ] }],
    }) }),
  });
  vm.runInContext(fs.readFileSync("js/calculations.js", "utf8"), h.ctx);
  await vm.runInContext("hevyImport()", h.ctx);
  const expected = vm.runInContext("calculateE1RM(97, 2, 10).toFixed(1)", h.ctx);
  const output = h.getElement("#hevyResults").textContent;
  assert.ok(output.includes(`${expected} kg`));
  assert.match(output, /@ RPE 10/);
  assert.match(output, /97\.0 kg × 2/);
  assert.match(output, /Session/);
  assert.equal(h.ctx.state.exercises[0].tm, 85);
});

test("batch preview preflights every routine before writing, then repeat sync is a no-op", async () => {
  const remote = {
    a: { id: "a", title: "Upper A", exercises: [{ exercise_template_id: "bench", rest_seconds: 90, sets: Array.from({length:4}, (_,i) => ({type:"normal",weight_kg:30,reps:8})) }] },
    b: { id: "b", title: "Upper B", exercises: [{ exercise_template_id: "bench", rest_seconds: 60, sets: Array.from({length:3}, (_,i) => ({type:"normal",weight_kg:25,reps:10})) }] },
  };
  let puts = 0;
  const h = context({
    fetch: async (url, options = {}) => {
      const id = url.includes("/routines/a") ? "a" : "b";
      if (options.method === "PUT") {
        puts++;
        remote[id] = JSON.parse(options.body).routine;
        return { ok: true, status: 200, json: async () => ({ routine: remote[id] }) };
      }
      return { ok: true, status: 200, json: async () => ({ routine: structuredClone(remote[id]) }) };
    },
  });
  const profile = {
    accountId: "acct", exerciseMap: { 11: "bench" },
    dayRoutines: { 1: "a", 2: "b" }, dayOccurrences: { 1: { 0: 0 }, 2: { 0: 0 } },
    routineSnapshots: {}, enabled: false, autoSync: true,
  };
  h.values.set("lifttracker_hevy_setup_v2", JSON.stringify({ activeAccount: "acct", profiles: { acct: profile } }));
  vm.runInContext('hevyRuntimeAccount = "acct"; hevyRuntimeRoutines = {a:{id:"a",title:"Upper A",exercises:[{exercise_template_id:"bench"}]},b:{id:"b",title:"Upper B",exercises:[{exercise_template_id:"bench"}]}}', h.ctx);
  h.getElement("#week").value = "1";

  await vm.runInContext("hevyReviewAllRoutines()", h.ctx);
  remote.b.notes = "External edit after review";
  await assert.rejects(vm.runInContext("hevyApplyPreview(true)", h.ctx), /changed after preview/);
  assert.equal(puts, 0, "all routines are preflighted before the first write");

  delete remote.b.notes;
  await vm.runInContext("hevyReviewAllRoutines()", h.ctx);
  const first = await vm.runInContext("hevyApplyPreview(true)", h.ctx);
  assert.equal(first.count, 2);
  assert.equal(puts, 2);
  await vm.runInContext("hevyReviewAllRoutines()", h.ctx);
  const second = await vm.runInContext("hevyApplyPreview(false)", h.ctx);
  assert.equal(second.changedCount, 0);
  assert.equal(puts, 2);
});

test("editing prescribed values after review requires a new preview", async () => {
  const h = context({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ routine: { id: "a", title: "A", exercises: [{ exercise_template_id: "bench", sets: [] }] } }) }) });
  h.ctx.prescribeLoad = (tm, reps) => reps === 13 ? 60 : tm * 0.8;
  const profile = { accountId: "acct", exerciseMap: { 11: "bench" }, dayRoutines: { 1: "a", 2: "b" }, dayOccurrences: { 1: { 0: 0 }, 2: { 0: 0 } }, routineSnapshots: {} };
  h.values.set("lifttracker_hevy_setup_v2", JSON.stringify({ activeAccount: "acct", profiles: { acct: profile } }));
  vm.runInContext('hevyRuntimeAccount = "acct"; hevyRuntimeRoutines = {a:{id:"a",title:"A",exercises:[{exercise_template_id:"bench"}]},b:{id:"b",title:"B",exercises:[{exercise_template_id:"bench"}]}}', h.ctx);
  h.getElement("#week").value = "1";
  await vm.runInContext("hevyReviewAllRoutines()", h.ctx);
  h.ctx.state.exercises[0].tm = 110;
  await assert.rejects(vm.runInContext("hevyApplyPreview(true)", h.ctx), /plan or mappings changed after preview/);
});

test("Android key entry validates directly, connects without companion storage, and forget clears session", async () => {
  const calls = [];
  const h = context({
    window: { Capacitor: {
      getPlatform: () => "android", isPluginAvailable: () => true,
      Plugins: { CapacitorHttp: { request: async request => {
        calls.push(request);
        if (request.url.endsWith("/user/info")) return { status: 200, data: { user: { id: "acct", name: "Test" } } };
        if (request.url.includes("/routines?")) return { status: 200, data: { routines: [] } };
        if (request.url.includes("/exercise_templates?")) return { status: 200, data: { exercise_templates: [] } };
        if (request.url.includes("/routine_folders?")) return { status: 200, data: { routine_folders: [] } };
        throw new Error("Unexpected request " + request.url);
      } } },
    } },
    fetch: async () => { throw new Error("No companion calls expected"); },
  });
  await vm.runInContext("initHevy()", h.ctx);
  h.getElement("#hevyApiKey").value = "private-key-value";
  await vm.runInContext("$('#hevySaveKey').onclick()", h.ctx);
  assert.equal(h.getElement("#hevyApiKey").value, "");
  assert.ok(calls.length >= 5);
  assert.ok(calls.every(call => call.headers["api-key"] === "private-key-value"));
  assert.equal([...h.values.values()].some(value => String(value).includes("private-key-value")), false);
  await vm.runInContext("$('#hevyForgetKey').onclick()", h.ctx);
  assert.equal(vm.runInContext("hevyRuntimeKey", h.ctx), "");
});
