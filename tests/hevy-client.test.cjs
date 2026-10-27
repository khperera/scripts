const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

function harness() {
  const elements = {
    hevyDay: { value: "0" },
    hevyRoutine: { value: "r-1" },
    hevyStatus: { textContent: "" },
  };
  const values = new Map([
    [
      "lifttracker_hevy_meta_v1",
      JSON.stringify({
        exerciseMap: { 1: "template-1" },
        dayRoutines: { 0: "r-1" },
      }),
    ],
  ]);
  let remote = {
    id: "r-1",
    title: "Routine",
    notes: "keep",
    exercises: [
      {
        exercise_template_id: "template-1",
        notes: "exercise note",
        sets: [
          {
            type: "warmup",
            weight_kg: 20,
            reps: 5,
            custom_metric: { label: "keep" },
          },
          {
            type: "normal",
            weight_kg: 50,
            reps: 5,
            custom_metric: { label: "top" },
          },
          {
            type: "normal",
            weight_kg: 40,
            reps: 13,
            custom_metric: { label: "myo" },
          },
          {
            type: "normal",
            weight_kg: 30,
            reps: 15,
            custom_metric: { label: "extra" },
          },
          {
            type: "normal",
            weight_kg: 25,
            reps: 12,
            custom_metric: { label: "mini 3" },
          },
          {
            type: "drop",
            weight_kg: 15,
            reps: 20,
            custom_metric: { label: "keep drop" },
          },
        ],
      },
      {
        exercise_template_id: "untouched",
        superset_id: null,
        sets: [{ type: "normal", weight_kg: 10, reps: 10 }],
      },
    ],
  };
  let puts = 0;
  const ctx = {
    localStorage: {
      getItem: (k) => values.get(k) || null,
      setItem: (k, v) => values.set(k, v),
    },
    window: { renderToday() {} },
    document: {},
    $: (s) => elements[s.slice(1)] || {},
    state: {
      templates: { 0: [{ exId: 1, sets: 4 }] },
      exercises: [{ id: 1, name: "Bench", cat: "CHEST", tm: 100 }],
      unit: "kg",
      settings: { minJump: 2.5 },
    },
    getRPEForExercise: () => 8,
    calculateTargetReps: () => 5,
    prescribeLoad: (tm, reps) => (reps === 13 ? 60 : 80),
    fetch: async (url, opts = {}) => {
      if (url.includes("/routines/r-1") && opts.method === "PUT") {
        puts++;
        remote = JSON.parse(opts.body).routine;
        return { ok: true, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({ routine: structuredClone(remote) }),
      };
    },
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync("js/hevy.js", "utf8"), ctx);
  return {
    ctx,
    get remote() {
      return remote;
    },
    get puts() {
      return puts;
    },
    elements,
    values,
  };
}

test("routine sync preserves warmups, unrelated sets and exercises; repeats no-op and detects remote edits", async () => {
  const h = harness();
  await vm.runInContext("hevyPush()", h.ctx);
  assert.equal(h.puts, 1);
  assert.deepEqual(
    h.remote.exercises[0].sets.map((x) => x.weight_kg),
    [20, 80, 60, 60, 60, 15],
  );
  assert.equal(h.remote.exercises[0].sets[0].custom_metric.label, "keep");
  assert.deepEqual(h.remote.exercises[1], {
    exercise_template_id: "untouched",
    superset_id: null,
    sets: [{ type: "normal", weight_kg: 10, reps: 10 }],
  });
  await vm.runInContext("hevyPush()", h.ctx);
  assert.equal(h.puts, 1);
  h.remote.title = "Externally edited";
  await assert.rejects(vm.runInContext("hevyPush()", h.ctx), /changed in Hevy/);
  assert.equal(h.puts, 1);
});

test("automatic sync requires a saved day mapping and a manual baseline", async () => {
  const h = harness();
  h.values.set(
    "lifttracker_hevy_meta_v1",
    JSON.stringify({ exerciseMap: { 1: "template-1" }, dayRoutines: {} }),
  );
  await assert.rejects(
    vm.runInContext("hevyPush({automatic:true})", h.ctx),
    /Map this day/,
  );
  assert.equal(h.puts, 0);
  h.values.set(
    "lifttracker_hevy_meta_v1",
    JSON.stringify({
      exerciseMap: { 1: "template-1" },
      dayRoutines: { 0: "r-1" },
    }),
  );
  await assert.rejects(
    vm.runInContext("hevyPush({automatic:true})", h.ctx),
    /manual sync once/,
  );
  assert.equal(h.puts, 0);
});

test("workout import uses LiftTracker e1RM, defaults missing RPE to 10, and leaves TMs unchanged", async () => {
  const result = { textContent: "" };
  const ctx = {
    localStorage: { getItem: () => null, setItem() {} },
    window: { renderToday() {} },
    document: {},
    $: (s) => (s === "#hevyResults" ? result : {}),
    state: { unit: "kg", exercises: [{ id: 1, tm: 85 }] },
    fetch: async (url) => ({
      ok: true,
      json: async () =>
        url.includes("page=")
          ? { workouts: [{ id: "workout-uuid" }] }
          : {
              workout: {
                title: "Session",
                start_time: "2026-02-01",
                exercises: [
                  {
                    exercise_template_id: "template-uuid",
                    sets: [{ weight_kg: 97, reps: 2 }],
                  },
                ],
              },
            },
    }),
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync("js/calculations.js", "utf8"), ctx);
  vm.runInContext(fs.readFileSync("js/hevy.js", "utf8"), ctx);
  await vm.runInContext("hevyImport()", ctx);
  const expected = vm.runInContext("calculateE1RM(97, 2, 10).toFixed(1)", ctx);
  assert.ok(result.textContent.includes(`${expected} kg`));
  assert.match(result.textContent, /@ RPE 10/);
  assert.match(result.textContent, /97\.0 kg × 2/);
  assert.match(result.textContent, /Session/);
  assert.equal(ctx.state.exercises[0].tm, 85);
});
