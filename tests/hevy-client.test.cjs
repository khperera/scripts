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
      dataset: {}, appendChild() {}, replaceChildren() {}, querySelectorAll() { return []; }, scrollIntoView() {},
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
    document: { createElement: () => ({ dataset: {}, appendChild() {}, append() {}, replaceChildren() {}, querySelector() { return null; } }) },
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

test("closest exercise matching handles word order and gym abbreviations without matching unrelated lifts", () => {
  const h = context();
  h.ctx.matchTemplates = [
    { id: "unrelated", title: "Leg Press" },
    { id: "catalog", title: "Bench Press (Barbell)" },
    { id: "used", title: "Barbell Bench Press" },
  ];
  h.ctx.usedMatches = new Set(["used"]);
  const reordered = vm.runInContext("hevyClosestExerciseMatch('Bench Press Barbell', matchTemplates)", h.ctx);
  const abbreviation = vm.runInContext("hevyClosestExerciseMatch('DB RDL', [{id:'rdl',title:'Dumbbell Romanian Deadlift'}])", h.ctx);
  const unrelated = vm.runInContext("hevyClosestExerciseMatch('Bench Press', [{id:'leg',title:'Leg Press'}])", h.ctx);
  const typo = vm.runInContext("hevyExerciseNameSimilarity('Barbel Bench Press','Barbell Bench Press')", h.ctx);
  const usedPriority = vm.runInContext("hevyClosestExerciseMatch('Bench Press', matchTemplates, usedMatches)", h.ctx);
  assert.equal(reordered.template.id, "catalog");
  assert.equal(reordered.score, 1);
  assert.equal(abbreviation.template.id, "rdl");
  assert.equal(unrelated, null);
  assert.ok(typo > 0.65);
  assert.equal(usedPriority.template.id, "used");
});

test("suggested exercise is preselected but remains unconfirmed until saved by the user", () => {
  const h = context();
  const container = h.getElement("#hevyExerciseMappings");
  container.children = [];
  container.replaceChildren = function (...children) { this.children = children; };
  container.appendChild = function (child) { this.children.push(child); };
  h.ctx.document.createElement = tag => ({
    tag, children: [], dataset: {}, className: "", textContent: "",
    appendChild(child) { this.children.push(child); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  });
  h.values.set("lifttracker_hevy_setup_v2", JSON.stringify({
    activeAccount: "acct",
    profiles: { acct: { accountId: "acct", exerciseMap: {}, dayRoutines: {}, dayOccurrences: {} } },
  }));
  vm.runInContext('hevyRuntimeTemplates = [{id:"bench",title:"Bench Press (Barbell)"},{id:"confirmed",title:"Smith Machine Bench Press"}]', h.ctx);
  vm.runInContext("renderHevyExerciseMappings()", h.ctx);
  const row = container.children[0];
  const hint = row.children.find(child => child.tag === "div");
  const select = row.children.find(child => child.tag === "select");
  assert.equal(select.value, "bench");
  assert.match(hint.textContent, /Closest name match selected/);
  const profile = JSON.parse(h.values.get("lifttracker_hevy_setup_v2")).profiles.acct;
  assert.deepEqual(profile.exerciseMap, {});
  assert.ok(vm.runInContext("hevyValidateSetup(hevyMeta())", h.ctx).some(error => error.includes("Map Bench Press")));

  profile.exerciseMap["11"] = "confirmed";
  h.values.set("lifttracker_hevy_setup_v2", JSON.stringify({
    activeAccount: "acct", profiles: { acct: profile },
  }));
  vm.runInContext("renderHevyExerciseMappings()", h.ctx);
  const savedRow = container.children[0];
  const savedHint = savedRow.children.find(child => child.tag === "div");
  const savedSelect = savedRow.children.find(child => child.tag === "select");
  assert.equal(savedSelect.value, "confirmed");
  assert.match(savedHint.textContent, /Saved match/);
});

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

test("routine exercise notes show each day's target RPE without duplicating or replacing user notes", () => {
  const h = context({ getRPEForExercise: (_week, dayId) => dayId === 1 ? 7.5 : 8.5 });
  vm.runInContext(`hevyRuntimeRoutines = {
    a: {id:"a",title:"Upper 1",exercises:[{exercise_template_id:"bench",notes:"Keep my cue\\nElbows under bar",sets:[]}]},
    b: {id:"b",title:"Upper 2",exercises:[{exercise_template_id:"bench",notes:"Pause on chest",sets:[]}]}
  }`, h.ctx);
  const profile = {
    exerciseMap: { 11: "bench" }, dayRoutines: { 1: "a", 2: "b" },
    dayOccurrences: { 1: { 0: 0 }, 2: { 0: 0 } },
  };
  const notes = (dayId, week) => vm.runInContext(
    `hevyMergeRoutine(hevyPlanForDay(state.days.find(d => d.id === ${dayId}), ${week}, ${JSON.stringify(profile)})).exercises[0].notes`,
    h.ctx,
  );

  const upper1 = notes(1, 2);
  const upper2 = notes(2, 2);
  assert.equal(upper1, "Keep my cue\nElbows under bar\nLiftTracker target RPE: 7.5 (week 2)");
  assert.equal(upper2, "Pause on chest\nLiftTracker target RPE: 8.5 (week 2)");
  assert.equal(notes(1, 2), upper1, "rebuilding the same plan is idempotent");
  assert.equal(notes(1, 3), "Keep my cue\nElbows under bar\nLiftTracker target RPE: 7.5 (week 3)", "a new week replaces the managed line");
  assert.equal(vm.runInContext('hevyWithTargetRpeNote("Personal note\\nLiftTracker target RPE: 6 (week 1)", 2, 8)', h.ctx),
    "Personal note\nLiftTracker target RPE: 8 (week 2)");
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
    routineSnapshots: { a: structuredClone(remote.a), b: structuredClone(remote.b) }, enabled: true, autoSync: true,
  };
  h.values.set("lifttracker_hevy_setup_v2", JSON.stringify({ activeAccount: "acct", profiles: { acct: profile } }));
  vm.runInContext('hevyRuntimeAccount = "acct"; hevyRuntimeRoutines = {a:{id:"a",title:"Upper A",exercises:[{exercise_template_id:"bench"}]},b:{id:"b",title:"Upper B",exercises:[{exercise_template_id:"bench"}]}}', h.ctx);
  h.getElement("#week").value = "1";
  h.ctx.window.renderToday = () => "rendered";
  h.ctx.window.persist = () => "saved";
  vm.runInContext("initHevy()", h.ctx);
  assert.equal(h.ctx.window.renderToday(), "rendered");
  assert.equal(h.ctx.window.persist(), "saved");

  assert.equal(puts, 0, "app renders and persistence never trigger sync");
  remote.b.notes = "External edit after review";
  await h.getElement("#hevyTodaySync").onclick();
  assert.equal(puts, 0, "all routines are preflighted before the first write");
  assert.match(h.getElement("#hevyStatus").textContent, /conflict/);

  delete remote.b.notes;
  await h.getElement("#hevyTodaySync").onclick();
  assert.equal(puts, 2);
  await h.getElement("#hevyTodaySync").onclick();
  assert.equal(puts, 2);
  assert.match(h.getElement("#hevyStatus").textContent, /0 changed/);
  assert.equal(JSON.parse(h.values.get("lifttracker_hevy_setup_v2")).profiles.acct.autoSync, false,
    "legacy automatic-sync preferences are cleared on the manual path");
});

test("Today sync button routes incomplete setup to mapping and never writes early", async () => {
  let requests = 0;
  const h = context({ fetch: async () => { requests++; throw new Error("unexpected request"); } });
  h.values.set("lifttracker_hevy_setup_v2", JSON.stringify({
    activeAccount: "acct", profiles: { acct: { accountId: "acct", exerciseMap: {}, dayRoutines: {}, dayOccurrences: {}, enabled: false } },
  }));
  vm.runInContext('hevyRuntimeAccount = "acct"', h.ctx);
  h.getElement("#hevyWizard").hidden = true;
  vm.runInContext("initHevy()", h.ctx);
  await h.getElement("#hevyTodaySync").onclick();
  assert.equal(requests, 0);
  assert.equal(h.getElement("#hevyWizard").hidden, false);
  assert.match(h.getElement("#hevyStatus").textContent, /Finish or review/);
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
  let storedKey = "";
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
      } }, HevySecureStore: {
        getApiKey: async () => ({ apiKey: storedKey, saved: Boolean(storedKey) }),
        saveApiKey: async ({ apiKey }) => { storedKey = apiKey; return { saved: true }; },
        deleteApiKey: async () => { storedKey = ""; return { deleted: true }; },
      } },
    } },
    fetch: async () => { throw new Error("No companion calls expected"); },
  });
  await vm.runInContext("initHevy()", h.ctx);
  h.getElement("#hevyApiKey").value = "private-key-value";
  await vm.runInContext("$('#hevySaveKey').onclick()", h.ctx);
  assert.equal(h.getElement("#hevyApiKey").value, "");
  assert.equal(storedKey, "private-key-value");
  assert.ok(calls.length >= 5);
  assert.ok(calls.every(call => call.headers["api-key"] === "private-key-value"));
  assert.equal([...h.values.values()].some(value => String(value).includes("private-key-value")), false);
  await vm.runInContext("$('#hevyForgetKey').onclick()", h.ctx);
  assert.equal(storedKey, "");
  assert.equal(vm.runInContext("hevyRuntimeKey", h.ctx), "");
});

test("saved Android key reconnects read-only and restores this account's mappings and status", async () => {
  const calls = [];
  const storedKey = "secure-device-key";
  const routines = [
    { id: "routine-a", title: "Upper 1", exercises: [{ exercise_template_id: "bench", notes: "cue", sets: [] }] },
    { id: "routine-b", title: "Upper 2", exercises: [{ exercise_template_id: "bench", notes: "pause", sets: [] }] },
  ];
  const h = context({
    window: { Capacitor: {
      getPlatform: () => "android", isPluginAvailable: () => true,
      Plugins: {
        HevySecureStore: { getApiKey: async () => ({ apiKey: storedKey, saved: true }) },
        CapacitorHttp: { request: async request => {
          calls.push(request);
          if (request.url.endsWith("/user/info")) return { status: 200, data: { user: { id: "acct", name: "Test" } } };
          if (request.url.includes("/routines?page=")) return { status: 200, data: { routines } };
          if (request.url.includes("/exercise_templates?page=")) return { status: 200, data: { exercise_templates: [{ id: "bench", title: "Bench Press" }] } };
          if (request.url.includes("/routine_folders?page=")) return { status: 200, data: { routine_folders: [] } };
          throw new Error("Unexpected request " + request.url);
        } },
      },
    } },
    fetch: async () => { throw new Error("Android should not use companion fetch"); },
  });
  const profile = {
    accountId: "acct", exerciseMap: { 11: "bench" },
    dayRoutines: { 1: "routine-a", 2: "routine-b" }, dayOccurrences: { 1: { 0: 0 }, 2: { 0: 0 } },
    routineSnapshots: {}, enabled: true, autoSync: true, lastSync: "2026-10-26T10:00:00.000Z", syncStatus: "success",
  };
  h.values.set("lifttracker_hevy_setup_v2", JSON.stringify({ activeAccount: "acct", profiles: { acct: profile } }));
  await vm.runInContext("initHevy()", h.ctx);

  assert.equal(vm.runInContext("hevyRuntimeKey", h.ctx), storedKey);
  assert.equal(vm.runInContext("hevyRuntimeAccount", h.ctx), "acct");
  assert.ok(calls.length > 0 && calls.every(call => call.headers["api-key"] === storedKey));
  assert.equal(calls.some(call => call.method === "PUT"), false, "startup reconnect must never sync");
  const restored = JSON.parse(h.values.get("lifttracker_hevy_setup_v2")).profiles.acct;
  assert.deepEqual(restored.exerciseMap, { 11: "bench" });
  assert.deepEqual(restored.dayRoutines, { 1: "routine-a", 2: "routine-b" });
  assert.equal(restored.autoSync, false);
  assert.match(h.getElement("#hevyKeyState").textContent, /saved securely/);
  assert.match(h.getElement("#hevyCurrentState").textContent, /1\/1 exercises, 2\/2 days/);
  assert.match(h.getElement("#hevyCurrentState").textContent, /Verified for the connected account/);
  assert.match(h.getElement("#hevyCurrentState").textContent, /Last successful sync/);
  assert.equal([...h.values.values()].some(value => String(value).includes(storedKey)), false);
});
