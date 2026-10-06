/* ---------- Effective load and heavy-session spacing ---------- */
// Effective load is the actual plate-rounded prescription / exercise TM.
// Timelines follow exercise appearances across every day, including cycle wrap.
function scoreLoadTimeline(points, options = {}) {
  const fraction = options.heavyFraction ?? 1 / 3;
  if (!(fraction > 0 && fraction <= 1)) throw new Error('Heavy fraction must be greater than 0 and at most 1.');
  const working = points.filter(p => !p.deload);
  if (!working.length) return { closeLoadPenalty: 0, heavyGapPenalty: 0, variation: 0, heavyCount: 0, gaps: [], heavy: [] };
  const requestedCount = Math.max(1, Math.ceil(working.length * fraction));
  const sorted = working.map(p => p.effectiveLoad).sort((a, b) => b - a);
  const cutoff = sorted[requestedCount - 1];
  // Every tie at the cutoff counts; identical high loads cannot evade spacing.
  const heavy = points.map((p, i) => ({ ...p, index: i })).filter(p => !p.deload && p.effectiveLoad >= cutoff);
  const gaps = heavy.length > 1 ? heavy.map((p, i) => (heavy[(i + 1) % heavy.length].index - p.index + points.length) % points.length) : [];
  const targetGap = Math.min(3, Math.floor(points.length / requestedCount));
  const heavyGapPenalty = gaps.reduce((sum, gap) => sum + Math.max(0, targetGap - gap) ** 2, 0);
  const low = options.lowLoad ?? Math.min(...working.map(p => p.effectiveLoad));
  const high = options.highLoad ?? Math.max(...working.map(p => p.effectiveLoad));
  const span = high - low;
  const heaviness = points.map(p => p.deload || span <= 0 ? 0 : Math.max(0, Math.min(1, (p.effectiveLoad - low) / span)) ** 2);
  // Smooth penalty covers all loads, not just those above the top-third cutoff.
  // Stronger sessions contribute more; nearby sessions cost more (1 / gap²).
  let closeLoadPenalty = 0, variation = 0, successiveRepeats = 0, maxCloseness = 0, transitions = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const gap = Math.min(j - i, points.length - (j - i));
      closeLoadPenalty += heaviness[i] * heaviness[j] / (gap * gap);
      if (!points[i].deload && !points[j].deload) maxCloseness += 1 / (gap * gap);
    }
    const next = points[(i + 1) % points.length];
    if (points[i].deload && next.deload) continue;
    transitions++;
    variation += Math.abs(points[i].effectiveLoad - next.effectiveLoad);
    if (points[i].weight === next.weight) successiveRepeats++;
  }
  return { closeLoadPenalty, heavyGapPenalty, variation, successiveRepeats, cutoff, targetGap,
    normalizedCloseness: maxCloseness ? closeLoadPenalty / maxCloseness : 0,
    normalizedHeavyGap: gaps.length ? heavyGapPenalty / (gaps.length * targetGap ** 2) : 0,
    normalizedVariation: transitions && span > 0 ? variation / (transitions * span) : 0,
    repeatRatio: transitions ? successiveRepeats / transitions : 0,
    heavyCount: heavy.length, requestedCount, gaps, heavy, peak: sorted[0] };
}

function createLoadSpacingModel(data, options = {}) {
  const calculator = options.loadCalculator || prescribeLoad;
  const weeks = data.cycleLength || 6;
  if (weeks < 2 || !data.days?.length) throw new Error('A schedule needs at least two weeks and one day.');
  const byId = new Map(data.exercises.map(ex => [ex.id, ex]));
  const entries = [], byExercise = new Map();
  const categoryDays = new Map();
  data.days.forEach((day, dayIndex) => {
    const seen = new Set();
    for (const item of data.templates[String(day.id)] || []) {
      const ex = byId.get(item.exId);
      if (!ex || ex.cat === 'ARMS') continue;
      if (!categoryDays.has(ex.cat)) categoryDays.set(ex.cat, new Set());
      categoryDays.get(ex.cat).add(dayIndex);
      if (!(ex.tm > 0) || seen.has(ex.id)) continue;
      seen.add(ex.id);
      const range = data.exerciseRepRanges[ex.id] || { min: 3, max: 10 };
      const entry = { ex, dayIndex, dayId: day.id, dayName: day.name, range, cache: new Map() };
      entries.push(entry);
      if (!byExercise.has(ex.id)) byExercise.set(ex.id, []);
      byExercise.get(ex.id).push(entry);
    }
  });
  function targets(candidate, week, dayId, cat) {
    const key = `${week}-${dayId}-${cat}`;
    return [candidate.rpeSchedule.overrides[key] ?? candidate.rpeSchedule.defaults[cat] ?? 8,
      candidate.repProgression.overrides[key] ?? candidate.repProgression.defaults[cat] ?? 0.5];
  }
  function point(entry, candidate, week) {
    const [rpe, pct] = targets(candidate, week, entry.dayId, entry.ex.cat);
    const key = `${rpe}/${pct}`;
    if (!entry.cache.has(key)) {
      const reps = Math.round(entry.range.min + pct * (entry.range.max - entry.range.min));
      const weight = calculator(entry.ex.tm, reps, rpe, data.unit, data.settings.minJump);
      entry.cache.set(key, { weight, reps, rpe, effectiveLoad: weight / entry.ex.tm });
    }
    return { ...entry.cache.get(key), week, day: entry.dayName, dayId: entry.dayId, deload: week === weeks };
  }
  const bounds = new Map();
  for (const [cat, days] of categoryDays) {
    const frequencies = Array(7).fill(0);
    for (let w = 1; w < weeks; w++) for (const di of days) {
      const rpe = targets(data, w, data.days[di].id, cat)[0];
      const i = Math.round((rpe - 7) * 2);
      if (i >= 0 && i < 7) frequencies[i]++;
    }
    bounds.set(cat, { min: Math.min(...frequencies), max: Math.max(...frequencies) });
  }
  const possibleBounds = new Map();
  for (const [id, ee] of byExercise) {
    const ex = ee[0].ex, range = ee[0].range;
    possibleBounds.set(id, {
      lowLoad: calculator(ex.tm, range.max, 7, data.unit, data.settings.minJump) / ex.tm,
      highLoad: calculator(ex.tm, range.min, 10, data.unit, data.settings.minJump) / ex.tm
    });
  }
  return { weeks, entries, byExercise, categoryDays, bounds, possibleBounds, targets, point, days: data.days, byId };
}

function evaluateLoadSpacing(data, options = {}, model = createLoadSpacingModel(data, options)) {
  let weeklyRepeats = 0, imbalance = 0, noDayVariation = 0;
  let closeLoadPenalty = 0, heavyGapPenalty = 0, variation = 0, successiveRepeats = 0;
  const exercises = [], testCoverage = {}, bodyParts = {};
  let testCoverageViolations = 0, testTimingViolations = 0;
  for (const [id, entries] of model.byExercise) {
    const points = [];
    for (let week = 1; week <= model.weeks; week++) for (const entry of entries) points.push(model.point(entry, data, week));
    const score = scoreLoadTimeline(points, { ...options, ...model.possibleBounds.get(id) });
    closeLoadPenalty += score.closeLoadPenalty;
    heavyGapPenalty += score.heavyGapPenalty;
    variation += score.variation;
    successiveRepeats += score.successiveRepeats;
    exercises.push({ id, name: entries[0].ex.name, cat: entries[0].ex.cat, ...score, points });
    for (const entry of entries) {
      const weights = Array.from({ length: model.weeks }, (_, i) => model.point(entry, data, i + 1).weight);
      for (let i = 0; i < weights.length; i++) if (weights[i] === weights[(i + 1) % weights.length]) weeklyRepeats++;
    }
  }
  for (const [cat, days] of model.categoryDays) {
    const counts = Array(7).fill(0);
    for (let w = 1; w < model.weeks; w++) for (const di of days) {
      const rpe = model.targets(data, w, model.days[di].id, cat)[0];
      const i = Math.round((rpe - 7) * 2);
      if (i >= 0 && i < 7) counts[i]++;
    }
    const bound = model.bounds.get(cat);
    for (const n of counts) imbalance += Math.max(0, bound.min - n, n - bound.max);
    // Count each Upper/Lower pair once. Three failure targets must reach the
    // three distinct variants, rather than testing one variant repeatedly.
    const variants = [...new Set([...days].map(di => Math.floor(di / 2)))].sort((a, b) => a - b);
    const tests = variants.map(variant => {
      let count = 0;
      for (let w = 1; w < model.weeks; w++) {
        if (model.targets(data, w, model.days[variant * 2].id, cat)[0] === 10) count++;
      }
      return { variant: variant + 1, count };
    });
    const total = tests.reduce((sum, test) => sum + test.count, 0);
    const min = Math.floor(total / variants.length), max = Math.ceil(total / variants.length);
    const violations = tests.reduce((sum, test) => sum + Math.max(0, min - test.count, test.count - max), 0);
    const workingWeeks = model.weeks - 1;
    const weeklyTests = Array.from({ length: workingWeeks }, (_, index) => variants.reduce((count, variant) =>
      count + (model.targets(data, index + 1, model.days[variant * 2].id, cat)[0] === 10 ? 1 : 0), 0));
    const periods = Math.min(3, workingWeeks);
    const periodTests = Array(periods).fill(0);
    weeklyTests.forEach((count, index) => periodTests[Math.floor(index * periods / workingWeeks)] += count);
    const periodMin = Math.floor(total / periods), periodMax = Math.ceil(total / periods);
    const weekMin = Math.floor(total / workingWeeks), weekMax = Math.ceil(total / workingWeeks);
    const testWeeks = weeklyTests.flatMap((count, index) => Array(count).fill(index + 1));
    const minWeekGap = total > 1 ? Math.max(1, Math.floor(workingWeeks / total)) : 0;
    const weekGaps = testWeeks.length > 1 ? testWeeks.map((week, index) =>
      (testWeeks[(index + 1) % testWeeks.length] - week + model.weeks) % model.weeks) : [];
    const timingViolations = periodTests.reduce((sum, count) => sum + Math.max(0, periodMin - count, count - periodMax), 0)
      + weeklyTests.reduce((sum, count) => sum + Math.max(0, weekMin - count, count - weekMax), 0)
      + weekGaps.reduce((sum, gap) => sum + Math.max(0, minWeekGap - gap) ** 2, 0);
    testCoverage[cat] = { total, variants: tests, violations, weeklyTests, periodTests, testWeeks, weekGaps, timingViolations };
    testCoverageViolations += violations;
    testTimingViolations += timingViolations;
    // Each category gets one vote, irrespective of its number of exercises or
    // scheduled appearances. Effort timing counts even for an unset exercise TM.
    const categoryExercises = exercises.filter(ex => ex.cat === cat);
    const mean = key => categoryExercises.length ? categoryExercises.reduce((sum, ex) => sum + ex[key], 0) / categoryExercises.length : 0;
    const effort = [];
    const weeklyEffort = Array.from({ length: workingWeeks }, (_, index) => {
      const values = variants.map(variant => {
        const rpe = model.targets(data, index + 1, model.days[variant * 2].id, cat)[0];
        effort.push({ weight: rpe, effectiveLoad: (rpe - 7) / 3, deload: false });
        return (rpe - 7) / 3;
      });
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    });
    variants.forEach(() => effort.push({ weight: 7, effectiveLoad: 0, deload: true }));
    const effortSpacing = scoreLoadTimeline(effort, { lowLoad: 0, highLoad: 1 });
    const averageEffort = weeklyEffort.reduce((sum, value) => sum + value, 0) / workingWeeks;
    const weeklyEffortVariance = weeklyEffort.reduce((sum, value) => sum + (value - averageEffort) ** 2, 0) / workingWeeks;
    const loss = 200 * mean('normalizedHeavyGap') + 100 * mean('normalizedCloseness')
      + 10 * mean('repeatRatio') - 5 * mean('normalizedVariation')
      + 100 * effortSpacing.normalizedCloseness + 100 * weeklyEffortVariance;
    bodyParts[cat] = { exercises: categoryExercises.length, loss, weeklyEffort, weeklyEffortVariance,
      heavyGap: mean('normalizedHeavyGap'), loadCloseness: mean('normalizedCloseness'),
      effortCloseness: effortSpacing.normalizedCloseness };
  }
  for (let w = 1; w < model.weeks; w++) for (const day of model.days) {
    const cats = new Set((data.templates[day.id] || []).map(item => model.byId.get(item.exId)?.cat).filter(cat => cat && cat !== 'ARMS'));
    if (cats.size > 1 && new Set([...cats].map(cat => model.targets(data, w, day.id, cat)[0])).size < 2) noDayVariation++;
  }
  const losses = Object.values(bodyParts).map(part => part.loss);
  const meanBodyPartLoss = losses.reduce((sum, loss) => sum + loss, 0) / losses.length;
  const worstBodyPartLoss = Math.max(...losses);
  // Improve both the equal-weight average and the worst group. A priority lift
  // cannot override fairness between chest, back, legs and shoulders.
  const score = -10000 * (weeklyRepeats + imbalance + noDayVariation + testCoverageViolations + testTimingViolations)
    - 100 * (meanBodyPartLoss + worstBodyPartLoss);
  return { score, weeklyRepeats, imbalance, noDayVariation, closeLoadPenalty, heavyGapPenalty,
    successiveRepeats, variation, testCoverageViolations, testTimingViolations, testCoverage,
    bodyParts, meanBodyPartLoss, worstBodyPartLoss, exercises };
}

async function optimizeLoadSpacing(data, options = {}) {
  // Search a copy. Apply only after the caller validates the complete result.
  const candidate = JSON.parse(JSON.stringify(data));
  const model = createLoadSpacingModel(data, options);
  const before = evaluateLoadSpacing(data, options, model);
  const groups = [['CHEST', 'BACK'], ['QUADS', 'HAMSTRINGS'], ['SHOULDERS']];
  const pairs = Math.ceil(data.days.length / 2), workingWeeks = model.weeks - 1;
  const restarts = options.restarts ?? 4, iterations = options.iterations ?? 1800;
  let seed = options.seed ?? 20261005;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  function shuffle(values) { for (let i = values.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [values[i], values[j]] = [values[j], values[i]]; } return values; }
  const peakFloors = new Map(before.exercises.map(ex => [ex.id, ex.peak]));
  const gapCeilings = new Map(before.exercises.map(ex => [ex.id, ex.heavyGapPenalty]));
  const normalizedGapCeilings = new Map(before.exercises.map(ex => [ex.id, ex.normalizedHeavyGap]));
  // Put peak preservation into the search fitness as well as final validation;
  // otherwise the search could spend all its time in lower-load schedules that
  // look well spaced but can never be accepted.
  function fitness(result) {
    const peakLosses = Object.keys(result.bodyParts).map(cat => {
      const exercises = result.exercises.filter(ex => ex.cat === cat);
      return exercises.length ? exercises.reduce((sum, ex) => sum + Math.max(0, peakFloors.get(ex.id) - ex.peak), 0) / exercises.length : 0;
    });
    const peakLoss = peakLosses.reduce((sum, loss) => sum + loss, 0) / peakLosses.length;
    const gapLosses = Object.keys(result.bodyParts).map(cat => {
      const exercises = result.exercises.filter(ex => ex.cat === cat);
      return exercises.length ? exercises.reduce((sum, ex) => sum + Math.max(0, ex.normalizedHeavyGap - normalizedGapCeilings.get(ex.id)), 0) / exercises.length : 0;
    });
    const gapLoss = gapLosses.reduce((sum, loss) => sum + loss, 0) / gapLosses.length;
    return result.score - 100000 * (peakLoss + gapLoss);
  }
  function admissible(result) {
    return result.weeklyRepeats <= before.weeklyRepeats && result.imbalance === 0 && result.noDayVariation <= before.noDayVariation
      && result.testCoverageViolations <= before.testCoverageViolations
      && result.testTimingViolations <= before.testTimingViolations
      && result.exercises.every(ex => ex.peak + 1e-9 >= peakFloors.get(ex.id)
        && ex.heavyGapPenalty <= gapCeilings.get(ex.id));
  }
  let accepted = before;
  for (let gi = 0; gi < groups.length; gi++) {
    const cats = groups[gi];
    if (!cats.some(cat => model.categoryDays.has(cat))) continue;
    const r = [], p = [];
    for (let w = 1; w <= workingWeeks; w++) for (let pair = 0; pair < pairs; pair++) {
      const day = data.days[pair * 2];
      const [rpe, pct] = model.targets(candidate, w, day.id, cats[0]);
      r.push(rpe); p.push(pct);
      for (const paired of data.days.slice(pair * 2, pair * 2 + 2)) {
        const [pr, pp] = model.targets(candidate, w, paired.id, cats[0]);
        if (Math.abs(pr - rpe) > 1e-8 || Math.abs(pp - pct) > 1e-8) throw new Error('Upper/Lower pairs must share their targets before spreading sessions.');
        if (cats.length === 2) {
          const [otherRpe, otherPct] = model.targets(candidate, w, paired.id, cats[1]);
          if (Math.abs(otherRpe + rpe - 17) > 1e-8 || Math.abs(otherPct + pct - 1) > 1e-8) throw new Error('Chest/back and quads/hamstrings must have opposing targets first.');
        }
      }
    }
    function write(rr, pp) {
      for (let w = 1; w <= workingWeeks; w++) for (let di = 0; di < data.days.length; di++) {
        const index = (w - 1) * pairs + Math.floor(di / 2), day = data.days[di].id;
        cats.forEach((cat, ci) => {
          candidate.rpeSchedule.overrides[`${w}-${day}-${cat}`] = ci === 0 ? rr[index] : 17 - rr[index];
          candidate.repProgression.overrides[`${w}-${day}-${cat}`] = Number((ci === 0 ? pp[index] : 1 - pp[index]).toFixed(10));
        });
      }
    }
    const failureValues = cats.length === 2 ? [10, 7] : [10];
    function spreadTests(rr) {
      for (const value of failureValues) {
        const cat = value === 10 ? cats[0] : cats[1];
        const active = [...new Set([...(model.categoryDays.get(cat) || [])].map(di => Math.floor(di / 2)))];
        if (!active.length) continue;
        const frequency = new Map(active.map(pair => [pair, rr.filter((v, i) => v === value && i % pairs === pair).length]));
        while (Math.max(...frequency.values()) - Math.min(...frequency.values()) > 1) {
          const from = active.reduce((a, b) => frequency.get(a) > frequency.get(b) ? a : b);
          const to = active.reduce((a, b) => frequency.get(a) < frequency.get(b) ? a : b);
          const source = rr.findIndex((v, i) => v === value && i % pairs === from);
          // Preserve an already-spread primary category's 0-RIR placements.
          const target = rr.findIndex((v, i) => v !== value && (value !== 7 || v !== 10) && i % pairs === to);
          if (target < 0) return;
          [rr[source], rr[target]] = [rr[target], rr[source]];
          frequency.set(from, frequency.get(from) - 1);
          frequency.set(to, frequency.get(to) + 1);
        }
      }
    }
    let best = { r: [...r], p: [...p], result: accepted };
    // First try complete prescription permutations. Moving RPE and reps
    // together preserves each lift's weight distribution and peak, allowing
    // the week constraints to be solved without lowering its heaviest load.
    if (workingWeeks <= 6 && cats.every(cat => !accepted.testCoverage[cat]?.violations)) {
      const permutations = [];
      function permute(order, remaining) {
        if (!remaining.length) { permutations.push(order); return; }
        remaining.forEach((value, index) => permute([...order, value], remaining.filter((_, i) => i !== index)));
      }
      permute([], Array.from({ length: workingWeeks }, (_, index) => index));
      const domains = Array.from({ length: pairs }, (_, pair) => {
        const entries = model.entries.filter(entry => cats.includes(entry.ex.cat) && Math.floor(entry.dayIndex / 2) === pair);
        const originals = entries.map(entry => Array.from({ length: model.weeks }, (_, index) => model.point(entry, candidate, index + 1)));
        return shuffle(permutations.filter(order => entries.every((entry, index) => {
          const points = [...order.map((week, i) => ({ ...originals[index][week], week: i + 1 })), originals[index][workingWeeks]];
          if (points.some((point, i) => point.weight === points[(i + 1) % points.length].weight)) return false;
          if (model.byExercise.get(entry.ex.id).length !== 1) return true;
          return scoreLoadTimeline(points, { ...options, ...model.possibleBounds.get(entry.ex.id) }).heavyGapPenalty <= gapCeilings.get(entry.ex.id);
        })).map(order => ({ order, tests: cats.map((cat, ci) => order.flatMap((week, index) => {
          const rpe = ci === 0 ? r[week * pairs + pair] : 17 - r[week * pairs + pair];
          return rpe === 10 ? [index + 1] : [];
        })) })));
      });
      const rr = [...r], pp = [...p], testWeeks = cats.map(() => []);
      let examined = 0;
      const budget = options.permutationBudget ?? 3000;
      function compatible(ci, weeks) {
        const coverage = accepted.testCoverage[cats[ci]];
        if (!coverage) return true;
        const periods = Math.min(3, workingWeeks), periodMax = Math.ceil(coverage.total / periods);
        const weekMax = Math.ceil(coverage.total / workingWeeks);
        const minGap = coverage.total > 1 ? Math.max(1, Math.floor(workingWeeks / coverage.total)) : 0;
        const counts = Array(workingWeeks).fill(0), periodCounts = Array(periods).fill(0);
        for (const week of weeks) {
          if (++counts[week - 1] > weekMax || ++periodCounts[Math.floor((week - 1) * periods / workingWeeks)] > periodMax) return false;
        }
        for (let i = 0; i < weeks.length; i++) for (let j = i + 1; j < weeks.length; j++) {
          const distance = Math.abs(weeks[i] - weeks[j]);
          if (Math.min(distance, model.weeks - distance) < minGap) return false;
        }
        return true;
      }
      async function visit(pair) {
        if (examined >= budget) return;
        if (pair === pairs) {
          examined++;
          write(rr, pp);
          const result = evaluateLoadSpacing(candidate, options, model);
          if (admissible(result) && result.score > best.result.score) best = { r: [...rr], p: [...pp], result };
          if (examined % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
          return;
        }
        for (const domain of domains[pair]) {
          if (examined >= budget) break;
          if (!cats.every((cat, ci) => compatible(ci, [...testWeeks[ci], ...domain.tests[ci]]))) continue;
          const lengths = testWeeks.map(weeks => weeks.length);
          cats.forEach((cat, ci) => testWeeks[ci].push(...domain.tests[ci]));
          domain.order.forEach((week, index) => {
            rr[index * pairs + pair] = r[week * pairs + pair];
            pp[index * pairs + pair] = p[week * pairs + pair];
          });
          await visit(pair + 1);
          testWeeks.forEach((weeks, ci) => weeks.length = lengths[ci]);
        }
      }
      await visit(0);
    }
    for (let restart = 0; restart < restarts; restart++) {
      let rr = restart === 0 ? [...best.r] : shuffle([...r]), pp = restart === 0 ? [...best.p] : [...p];
      spreadTests(rr);
      if (restart) for (let pair = 0; pair < pairs; pair++) {
        const values = shuffle(Array.from({ length: workingWeeks }, (_, w) => p[w * pairs + pair]));
        values.forEach((v, w) => pp[w * pairs + pair] = v);
        // Seed peak-compatible endpoint prescriptions. Swaps preserve the exact
        // rep marginal; the search can subsequently move whole prescriptions.
        for (const value of failureValues) {
          const endpoint = value === 10 ? Math.min(...values) : Math.max(...values);
          const target = rr.findIndex((rpe, index) => index % pairs === pair && rpe === value);
          const source = pp.findIndex((pct, index) => index % pairs === pair && pct === endpoint);
          if (target >= 0 && source >= 0) [pp[target], pp[source]] = [pp[source], pp[target]];
        }
      }
      write(rr, pp);
      let current = evaluateLoadSpacing(candidate, options, model);
      for (let i = 0; i < iterations; i++) {
        const bundle = random() < 1 / 3;
        const vector = bundle || random() < 0.5 ? rr : pp, a = Math.floor(random() * r.length);
        // Rep swaps stay in the same pair, preserving every day/category's
        // exact marginal rep distribution. RPE swaps preserve its shared pool.
        const b = bundle || vector === pp ? Math.floor(random() * workingWeeks) * pairs + a % pairs : Math.floor(random() * r.length);
        // Once test coverage is spread, failure-target swaps stay in a variant.
        // Other RPE swaps still explore the full pool and retain its distribution.
        if (vector === rr && a % pairs !== b % pairs &&
          (failureValues.includes(rr[a]) || failureValues.includes(rr[b]))) continue;
        [vector[a], vector[b]] = [vector[b], vector[a]];
        if (bundle) [pp[a], pp[b]] = [pp[b], pp[a]];
        write(rr, pp);
        const result = evaluateLoadSpacing(candidate, options, model);
        const temperature = 800 * Math.pow(0.0001, i / iterations);
        if (fitness(result) >= fitness(current) || random() < Math.exp((fitness(result) - fitness(current)) / temperature)) current = result;
        else {
          [vector[a], vector[b]] = [vector[b], vector[a]];
          if (bundle) [pp[a], pp[b]] = [pp[b], pp[a]];
        }
        if (admissible(current) && current.score > best.result.score) best = { r: [...rr], p: [...pp], result: current };
        if (i % 100 === 0) {
          options.onProgress?.({ group: gi + 1, groups: groups.length, restart: restart + 1, restarts });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }
    write(best.r, best.p);
    accepted = evaluateLoadSpacing(candidate, options, model);
  }
  if (!admissible(accepted) || accepted.testCoverageViolations !== 0 || accepted.testTimingViolations !== 0 || accepted.score < before.score) {
    const error = new Error('Could not spread the 0-RIR tests and heavy sessions while preserving your schedule rules.');
    error.optimizationMetrics = accepted;
    throw error;
  }
  return { state: candidate, before, after: accepted };
}

async function applyLoadSpacingOptimization() {
  const button = $('#spreadHeavySessions'), status = $('#loadSpacingStatus');
  button.disabled = true;
  status.textContent = 'Spreading heavier sessions…';
  const snapshot = JSON.stringify(state);
  try {
    const result = await optimizeLoadSpacing(state, {
      onProgress: p => { status.textContent = `Spreading heavier sessions (${p.group}/${p.groups})…`; }
    });
    if (JSON.stringify(state) !== snapshot) throw new Error('Your schedule changed during the search. Run it again to use the latest targets.');
    state.rpeSchedule = result.state.rpeSchedule;
    state.repProgression = result.state.repProgression;
    persist();
    renderToday();
    renderProgression();
    status.textContent = 'Finished. All body-part groups receive equal priority. 0-RIR tests are spread across workout variants and early, middle and late working weeks. Your distributions and deload are preserved.';
  } catch (error) {
    status.textContent = error.message;
  } finally { button.disabled = false; }
}

if (typeof module !== 'undefined') module.exports = { scoreLoadTimeline, createLoadSpacingModel, evaluateLoadSpacing, optimizeLoadSpacing };
