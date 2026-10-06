const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scoreLoadTimeline, evaluateLoadSpacing, optimizeLoadSpacing } = require('../js/load-spacing.js');
const calc = vm.createContext({ Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/calculations.js'), 'utf8'), calc);
const options = { loadCalculator: calc.prescribeLoad };
function timeline(weights, deload = false) {
  return weights.map((weight, i) => ({ weight, effectiveLoad: weight / 100, deload: deload && i >= weights.length - 2 }));
}
function fixture() {
  const s = { unit: 'lb', cycleLength: 7, days: [{ id: 0, name: 'Upper 1' }, { id: 1, name: 'Lower 1' }, { id: 2, name: 'Upper 2' }, { id: 3, name: 'Lower 2' }, { id: 4, name: 'Upper 3' }, { id: 5, name: 'Lower 3' }],
    exercises: [{ id: 1, name: 'Bench', cat: 'CHEST', tm: 330 }, { id: 2, name: 'Row', cat: 'BACK', tm: 300 }, { id: 3, name: 'Raise', cat: 'SHOULDERS', tm: 100 }, { id: 4, name: 'Unset', cat: 'BACK', tm: 0 }, { id: 5, name: 'Incline', cat: 'CHEST', tm: 150 }],
    settings: { minJump: 1.25 }, templates: { 0: [{ exId: 1 }, { exId: 2 }, { exId: 3 }], 1: [], 2: [{ exId: 5 }, { exId: 2 }, { exId: 3 }], 3: [], 4: [{ exId: 1 }, { exId: 2 }, { exId: 3 }, { exId: 4 }], 5: [] },
    exerciseRepRanges: { 1: { min: 1, max: 10 }, 2: { min: 3, max: 10 }, 3: { min: 3, max: 10 }, 5: { min: 3, max: 10 } },
    rpeSchedule: { overrides: {}, defaults: {} }, repProgression: { overrides: {}, defaults: {} }, log: [{ exId: 1, weight: 250, reps: 5 }] };
  const r = [9, 8.5, 8, 7, 10, 9, 10, 7.5, 8, 7.5, 9.5, 10, 9.5, 7, 7, 8, 8.5, 9];
  const p = [.4, .6, .6, .8, .8, .2, 0, 1, .8, 1, 0, 0, .2, .2, 1, .6, .4, .4];
  for (let w = 1; w <= 7; w++) for (let d = 0; d < 6; d++) {
    const i = (w - 1) * 3 + Math.floor(d / 2);
    for (const cat of ['CHEST', 'BACK', 'SHOULDERS']) {
      const key = `${w}-${d}-${cat}`;
      s.rpeSchedule.overrides[key] = w === 7 ? 7 : cat === 'CHEST' ? r[i] : cat === 'BACK' ? 17 - r[i] : 8;
      s.repProgression.overrides[key] = w === 7 ? 1 : cat === 'BACK' ? 1 - p[i] : p[i];
    }
  }
  return s;
}

test('same load distribution scores worse when heavy exposures are adjacent', () => {
  const clustered = scoreLoadTimeline(timeline([100, 100, 65, 65, 65, 65]));
  const spread = scoreLoadTimeline(timeline([100, 65, 65, 100, 65, 65]));
  assert(clustered.heavyGapPenalty > spread.heavyGapPenalty);
  assert(clustered.closeLoadPenalty > spread.closeLoadPenalty);
  assert.deepEqual(spread.gaps, [3, 3]);
});

test('cycle end and next cycle start are close, not artificially far apart', () => {
  const ends = scoreLoadTimeline(timeline([100, 65, 65, 65, 65, 100]));
  assert(ends.heavyGapPenalty > 0);
  assert(ends.gaps.includes(1));
});

test('moderate loads below the heavy cutoff still incur a closeness penalty', () => {
  const nearby = scoreLoadTimeline(timeline([100, 90, 65, 100, 90, 65]));
  const farther = scoreLoadTimeline(timeline([100, 65, 90, 100, 65, 90]));
  // A sub-cutoff exposure participates in the smooth score; it is not zeroed.
  const lowered = scoreLoadTimeline(timeline([100, 65, 65, 100, 65, 65]));
  assert(nearby.closeLoadPenalty > lowered.closeLoadPenalty);
  assert(farther.closeLoadPenalty > lowered.closeLoadPenalty);
});

test('ties at the heavy cutoff all count', () => {
  const result = scoreLoadTimeline(timeline([100, 100, 100, 65, 65, 65]));
  assert.equal(result.requestedCount, 2);
  assert.equal(result.heavyCount, 3);
});

test('deload sessions provide separation but never count as heavy working sessions', () => {
  const result = scoreLoadTimeline(timeline([100, 65, 65, 100, 65, 65, 65, 65], true));
  assert(result.heavy.every(point => !point.deload));
  assert.deepEqual(result.gaps, [3, 5]);
});

test('scoring follows all exercise appearances and actual rep range, excluding unset TM', () => {
  const s = fixture(), result = evaluateLoadSpacing(s, options);
  const bench = result.exercises.find(ex => ex.id === 1);
  assert.equal(bench.points.length, 14);
  assert.deepEqual(bench.points.slice(0, 2).map(p => p.day), ['Upper 1', 'Upper 3']);
  const expected = calc.prescribeLoad(330, 5, 9, 'lb', 1.25);
  assert.equal(bench.points[0].weight, expected);
  assert.equal(bench.points[0].effectiveLoad, expected / 330);
  assert(!result.exercises.some(ex => ex.id === 4));
});

test('optimizer preserves input, logs, registry, rep marginals, pairing and deload', async () => {
  const s = fixture(), snapshot = JSON.stringify(s);
  const result = await optimizeLoadSpacing(s, { ...options, seed: 9, restarts: 2, iterations: 500 });
  assert.equal(JSON.stringify(s), snapshot);
  assert(result.after.score >= result.before.score);
  assert(result.after.weeklyRepeats <= result.before.weeklyRepeats);
  assert.deepEqual(result.state.exercises, s.exercises);
  assert.deepEqual(result.state.log, s.log);
  for (const d of s.days) for (const cat of ['CHEST', 'BACK', 'SHOULDERS']) {
    const values = data => Array.from({ length: 6 }, (_, i) => Number(data.repProgression.overrides[`${i + 1}-${d.id}-${cat}`].toFixed(8))).sort();
    assert.deepEqual(values(result.state), values(s));
    for (const schedule of ['rpeSchedule', 'repProgression']) assert.equal(result.state[schedule].overrides[`7-${d.id}-${cat}`], s[schedule].overrides[`7-${d.id}-${cat}`]);
    for (let w = 1; w <= 6; w++) {
      const paired = d.id % 2 === 0 ? d.id + 1 : d.id - 1;
      assert.equal(result.state.rpeSchedule.overrides[`${w}-${d.id}-${cat}`], result.state.rpeSchedule.overrides[`${w}-${paired}-${cat}`]);
      assert.equal(result.state.repProgression.overrides[`${w}-${d.id}-${cat}`], result.state.repProgression.overrides[`${w}-${paired}-${cat}`]);
    }
  }
});

test('incompatible opposing schedules fail without changing the input', async () => {
  const s = fixture(); s.rpeSchedule.overrides['1-0-BACK'] = 10;
  const snapshot = JSON.stringify(s);
  await assert.rejects(optimizeLoadSpacing(s, { ...options, restarts: 1, iterations: 1 }), /opposing/);
  assert.equal(JSON.stringify(s), snapshot);
});

test('equal group optimization preserves bench peak and does not worsen heavy spacing', async () => {
  const s = fixture();
  const result = await optimizeLoadSpacing(s, { ...options, seed: 20261007, restarts: 4, iterations: 2500 });
  const before = result.before.exercises.find(ex => ex.id === 1);
  const after = result.after.exercises.find(ex => ex.id === 1);
  assert(before.heavyGapPenalty > 0);
  assert(after.heavyGapPenalty <= before.heavyGapPenalty);
  assert.equal(result.after.testTimingViolations, 0);
  assert(after.peak >= before.peak);
  assert(result.after.score > result.before.score);
});

test('body-part scores do not favor groups with more copies of an exercise', () => {
  const s = fixture(), before = evaluateLoadSpacing(s, options);
  s.exercises.push({ ...s.exercises.find(ex => ex.id === 2), id: 20 });
  s.exerciseRepRanges[20] = { ...s.exerciseRepRanges[2] };
  for (const items of Object.values(s.templates)) if (items.some(item => item.exId === 2)) items.push({ exId: 20 });
  const after = evaluateLoadSpacing(s, options);
  assert.equal(after.bodyParts.BACK.loss, before.bodyParts.BACK.loss);
  assert.equal(after.meanBodyPartLoss, before.meanBodyPartLoss);
  assert.equal(after.worstBodyPartLoss, before.worstBodyPartLoss);
});

test('a focus option cannot give bench extra weight over other body parts', () => {
  const s = fixture();
  assert.equal(evaluateLoadSpacing(s, options).score, evaluateLoadSpacing(s, { ...options, focusExerciseIds: [1] }).score);
});

test('back tests clustered at the end must spread across working weeks and variants', async () => {
  const s = fixture();
  for (let pair = 0; pair < 3; pair++) {
    const source = Array.from({ length: 6 }, (_, index) => index + 1).find(week => s.rpeSchedule.overrides[`${week}-${pair * 2}-BACK`] === 10);
    const displaced = s.rpeSchedule.overrides[`6-${pair * 2}-CHEST`];
    for (const day of [pair * 2, pair * 2 + 1]) {
      s.rpeSchedule.overrides[`${source}-${day}-CHEST`] = displaced;
      s.rpeSchedule.overrides[`${source}-${day}-BACK`] = 17 - displaced;
      s.rpeSchedule.overrides[`6-${day}-CHEST`] = 7;
      s.rpeSchedule.overrides[`6-${day}-BACK`] = 10;
    }
  }
  const before = evaluateLoadSpacing(s, options);
  assert.deepEqual(before.testCoverage.BACK.testWeeks, [6, 6, 6]);
  assert.deepEqual(before.testCoverage.BACK.variants.map(variant => variant.count), [1, 1, 1]);
  assert(before.testTimingViolations > 0);
  const result = await optimizeLoadSpacing(s, { ...options, seed: 20261010, restarts: 4, iterations: 2500 });
  assert.equal(result.after.testTimingViolations, 0);
  for (const coverage of Object.values(result.after.testCoverage)) {
    if (coverage.total === 3) {
      assert.deepEqual(coverage.periodTests, [1, 1, 1]);
      assert.deepEqual(coverage.variants.map(variant => variant.count), [1, 1, 1]);
      assert(coverage.weekGaps.every(gap => gap >= 2));
    }
  }
});

test('load chart uses actual prescriptions and retains gaps for empty categories', () => {
  const context = vm.createContext({ Math, state: fixture(), BODY_PARTS: ['CHEST', 'BACK', 'SHOULDERS'],
    PROGRESSION_COLORS: { CHEST: '#111111', BACK: '#222222', SHOULDERS: '#333333' } });
  for (const file of ['calculations.js', 'schedule.js', 'progression.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file), 'utf8'), context);
  const dataset = context.buildProgressionDatasets('load').find(d => d.label === 'CHEST');
  assert.equal(dataset.data[0], Number((calc.prescribeLoad(330, 5, 9, 'lb', 1.25) / 330).toFixed(3)));
  assert.equal(dataset.data[1], null);
  assert.equal(dataset.data[5], null);
});

test('three 0-RIR tests must cover variants 1, 2 and 3, excluding deload', async () => {
  const s = fixture();
  function setPair(week, pair, rpe) {
    for (const d of [pair * 2, pair * 2 + 1]) {
      s.rpeSchedule.overrides[`${week}-${d}-CHEST`] = rpe;
      s.rpeSchedule.overrides[`${week}-${d}-BACK`] = 17 - rpe;
    }
  }
  // Preserve the same RPE distribution but move a variant-2 failure target
  // into variant 3, which already has a failure target.
  setPair(2, 1, 9);
  setPair(6, 2, 10);
  const before = evaluateLoadSpacing(s, options);
  assert.deepEqual(before.testCoverage.CHEST.variants.map(v => v.count), [1, 0, 2]);
  assert(before.testCoverageViolations > 0);
  const result = await optimizeLoadSpacing(s, { ...options, seed: 20261008, restarts: 4, iterations: 2500 });
  assert.equal(result.after.testCoverageViolations, 0);
  assert.deepEqual(result.after.testCoverage.CHEST.variants.map(v => v.count), [1, 1, 1]);
  assert.deepEqual(result.after.testCoverage.BACK.variants.map(v => v.count), [1, 1, 1]);
  assert.equal(result.after.testCoverage.CHEST.total, 3);
});
