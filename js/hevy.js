/* Hevy bridge: all API traffic is same-origin and the key remains in the local companion. */
const HEVY_META_KEY = "lifttracker_hevy_meta_v1";
const hevyMeta = () => {
  try {
    return JSON.parse(localStorage.getItem(HEVY_META_KEY) || "{}");
  } catch {
    return {};
  }
};
const hevySave = (m) => localStorage.setItem(HEVY_META_KEY, JSON.stringify(m));
async function hevyRequest(path, opts = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(path, {
        ...opts,
        headers: {
          "content-type": "application/json",
          ...(opts.headers || {}),
        },
      });
      const data = await response.json();
      if (response.ok) return data;
      lastError = new Error(
        data.error || data.message || `Request failed (${response.status})`,
      );
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2)
        throw lastError;
      const retryAfter = Math.min(
        5,
        Math.max(0, Number(data.retry_after) || 0),
      );
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          retryAfter ? retryAfter * 1000 : 500 * 2 ** attempt,
        ),
      );
    } catch (error) {
      if (error === lastError || attempt === 2) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError || new Error("Hevy request failed.");
}
async function hevyConnect() {
  try {
    const s = await hevyRequest("/api/status");
    if (!s.configured) throw Error("Set HEVY_API_KEY on the companion server.");
    const info = await hevyRequest("/api/hevy/user/info");
    let list = [],
      page = 1;
    while (page <= 100) {
      const routines = await hevyRequest(
          `/api/hevy/routines?page=${page}&pageSize=10`,
        ),
        rows = routines.routines || [];
      list.push(...rows);
      if (rows.length < 10) break;
      page++;
    }
    if (page > 100) throw Error("Routine list exceeds the safety page limit.");
    const select = $("#hevyRoutine");
    select.replaceChildren(new Option("Choose a routine", ""));
    list.forEach((x) => {
      const o = document.createElement("option");
      o.value = x.id;
      o.textContent = x.title;
      select.appendChild(o);
    });
    $("#hevyStatus").textContent =
      `Connected${info.user ? ` as ${info.user.username || info.user.email || ""}` : ""}. Loaded ${list.length} routines.`;
    let m = hevyMeta();
    const account = String(
      info.user?.id || info.user?.email || info.user?.username || "connected",
    );
    if (m.account && m.account !== account) {
      m = { auto: m.auto, account, routineSummaries: [] };
      localStorage.removeItem(HEVY_META_KEY);
    }
    m.account = account;
    m.routineSummaries = list.map(({ id, title }) => ({ id, title }));
    hevySave(m);
    select.value = m.dayRoutines?.[$("#hevyDay").value] || "";
  } catch (e) {
    $("#hevyStatus").textContent = e.message;
  }
}
async function hevyLoadExerciseMappings() {
  const box = $("#hevyExerciseMappings");
  box.textContent = "Loading templates…";
  try {
    let all = [],
      page = 1;
    while (page <= 100) {
      const d = await hevyRequest(
          `/api/hevy/exercise_templates?page=${page}&pageSize=100`,
        ),
        rows = d.exercise_templates || [];
      all.push(...rows);
      if (rows.length < 100) break;
      page++;
    }
    if (page > 100)
      throw Error("Exercise templates exceed the safety page limit.");
    const m = hevyMeta();
    m.templateNames = Object.fromEntries(
      all.map((t) => [String(t.id), t.title]),
    );
    hevySave(m);
    const map = m.exerciseMap || {};
    box.innerHTML = "";
    state.exercises.forEach((ex) => {
      const row = document.createElement("div");
      row.className = "row";
      const label = document.createElement("label");
      label.textContent = ex.name;
      const sel = document.createElement("select");
      sel.dataset.exid = ex.id;
      sel.innerHTML = '<option value="">Select matching Hevy exercise</option>';
      all.forEach((t) => {
        const o = document.createElement("option");
        o.value = t.id;
        o.textContent = t.title;
        if (String(map[ex.id] || "") === String(t.id)) o.selected = true;
        sel.appendChild(o);
      });
      row.append(label, sel);
      box.append(row);
    });
    $("#hevyStatus").textContent =
      `Loaded ${all.length} templates. Confirm each match.`;
  } catch (e) {
    box.textContent = e.message;
  }
}
function hevyPlannedDay() {
  const dayId = Number($("#hevyDay").value),
    week = Number($("#week").value) || 1;
  return (state.templates[String(dayId)] || []).flatMap((item) => {
    const ex = state.exercises.find((x) => x.id === item.exId);
    if (!ex) return [];
    const rpe = getRPEForExercise(week, dayId, ex.cat),
      reps = calculateTargetReps(ex.id, week, dayId, ex.cat),
      weight = prescribeLoad(
        ex.tm,
        reps,
        rpe,
        state.unit,
        state.settings.minJump,
      ),
      myo = prescribeLoad(ex.tm, 13, rpe, state.unit, state.settings.minJump);
    const map = hevyMeta().exerciseMap || {};
    const id = map[ex.id];
    if (!id) throw Error(`Map ${ex.name} to a Hevy exercise first.`);
    return [
      {
        exId: ex.id,
        id,
        name: ex.name,
        reps,
        weightKg: state.unit === "lb" ? weight / 2.2046226218 : weight,
        myoKg: state.unit === "lb" ? myo / 2.2046226218 : myo,
        totalSets: Math.max(1, Number(item.sets) || 1),
      },
    ];
  });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => !["updated_at", "created_at", "id"].includes(k))
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function stable(value) {
  return JSON.stringify(canonical(value));
}
function unwrapHevyRoutine(value) {
  const routine = value?.routine;
  if (Array.isArray(routine)) return routine[0] || {};
  return routine || value;
}
function routineWriteProjection(routine) {
  return {
    title: routine.title,
    notes: routine.notes,
    exercises: (routine.exercises || []).map((ex) => ({
      exercise_template_id: ex.exercise_template_id,
      superset_id: ex.superset_id ?? ex.supersets_id ?? null,
      rest_seconds: ex.rest_seconds,
      notes: ex.notes,
      sets: (ex.sets || []).map((set) => ({
        type: set.type,
        weight_kg: set.weight_kg,
        reps: set.reps,
        distance_meters: set.distance_meters,
        duration_seconds: set.duration_seconds,
        custom_metric: set.custom_metric,
      })),
    })),
  };
}
async function hevyPush({ automatic = false } = {}) {
  const m = hevyMeta(),
    dayId = $("#hevyDay").value,
    rid = m.dayRoutines?.[dayId];
  if (!rid) throw Error("Map this day to a Hevy routine before syncing.");
  if (automatic && !m.readyRoutines?.[rid])
    throw Error("Run a manual sync once to establish this routine baseline.");
  const items = hevyPlannedDay();
  if (!items.length)
    throw Error("Save mappings for this day’s exercises first.");
  const snap = await hevyRequest(
      `/api/hevy/routines/${encodeURIComponent(rid)}`,
    ),
    routine = unwrapHevyRoutine(snap),
    prior = m.snapshots?.[rid];
  if (prior && stable(routine) !== stable(prior))
    throw Error(
      "This routine changed in Hevy since the last sync. Review it in Hevy, then use Reset snapshot to approve a new baseline.",
    );
  const byId = new Map();
  for (const item of items) {
    const key = String(item.id);
    if (byId.has(key))
      throw Error(
        `The selected day contains repeated ${item.name} entries; map each occurrence separately before syncing.`,
      );
    byId.set(key, item);
  }
  const matches = (routine.exercises || []).filter((ex) =>
    byId.has(String(ex.exercise_template_id)),
  );
  for (const item of items)
    if (
      matches.filter(
        (ex) => String(ex.exercise_template_id) === String(item.id),
      ).length !== 1
    )
      throw Error(
        `Routine must contain exactly one mapped ${item.name} exercise.`,
      );
  const exercises = (routine.exercises || []).map((ex) => {
    const want = byId.get(String(ex.exercise_template_id));
    if (!want) return ex;
    byId.delete(String(ex.exercise_template_id));
    const existingSets = ex.sets || [];
    const miniCount = Math.max(1, want.totalSets - 1);
    const desired = [
      { weight_kg: want.weightKg, reps: want.reps },
      ...Array.from({ length: miniCount }, () => ({
        weight_kg: want.myoKg,
        reps: 5,
      })),
    ];
    let nextIndex = 0;
    const sets = existingSets.flatMap((set) => {
      const type = String(set.type || "normal").toLowerCase();
      if (type !== "normal") return [set]; // Keep warmups, drops, and other special sets intact.
      if (nextIndex >= desired.length) return [];
      return [{ ...set, ...desired[nextIndex++] }];
    });
    while (nextIndex < desired.length)
      sets.push({ type: "normal", ...desired[nextIndex++] });
    return { ...ex, sets };
  });
  if (byId.size)
    throw Error(
      `Routine is missing mapped exercise(s): ${[...byId.values()].map((x) => x.name).join(", ")}.`,
    );
  const merged = { ...routine, exercises };
  if (
    stable(routineWriteProjection(merged)) ===
    stable(routineWriteProjection(routine))
  ) {
    m.dayRoutines = m.dayRoutines || {};
    m.dayRoutines[dayId] = rid;
    m.snapshots = m.snapshots || {};
    m.snapshots[rid] = routine;
    m.readyRoutines = m.readyRoutines || {};
    m.readyRoutines[rid] = true;
    hevySave(m);
    $("#hevyStatus").textContent =
      "Routine already matches this prescription; no update needed.";
    return;
  }
  await hevyRequest(`/api/hevy/routines/${encodeURIComponent(rid)}`, {
    method: "PUT",
    body: JSON.stringify({ routine: routineWriteProjection(merged) }),
  });
  const after = await hevyRequest(
    `/api/hevy/routines/${encodeURIComponent(rid)}`,
  );
  m.snapshots = m.snapshots || {};
  m.snapshots[rid] = unwrapHevyRoutine(after);
  m.dayRoutines = m.dayRoutines || {};
  m.dayRoutines[dayId] = rid;
  m.readyRoutines = m.readyRoutines || {};
  m.readyRoutines[rid] = true;
  hevySave(m);
  $("#hevyStatus").textContent = "Routine updated.";
}
function renderImportedSummary(summary, count, unit) {
  const lines = Object.values(summary || {}).map(
    (x) =>
      `${x.name}: ${x.value.toFixed(1)} ${unit} from ${x.weight.toFixed(1)} ${unit} × ${x.reps} @ RPE ${x.rpe} (${x.workout}, ${x.date || "date unavailable"})`,
  );
  $("#hevyResults").textContent =
    `Imported ${count} workouts. Best imported estimated 1RM by exercise:
${lines.join("\n") || "No eligible sets found."}`;
}
async function hevyImport() {
  const out = $("#hevyResults");
  out.textContent = "Loading workout history…";
  try {
    const runs = [],
      pageSize = 10;
    let page = 1;
    while (page <= 100) {
      const d = await hevyRequest(
        `/api/hevy/workouts?page=${page}&pageSize=${pageSize}`,
      );
      const rows = d.workouts || [];
      runs.push(...rows);
      if (rows.length < pageSize) break;
      page++;
    }
    if (page > 100)
      throw Error("Workout history exceeds the safety page limit.");
    const records = {};
    for (const listed of runs) {
      const detail = Array.isArray(listed.exercises)
        ? listed
        : unwrapHevyRoutine(
            await hevyRequest(
              `/api/hevy/workouts/${encodeURIComponent(listed.id)}`,
            ),
          );
      const workout = detail.workout || detail;
      records[String(workout.id || listed.id)] = workout;
    }
    let m = hevyMeta();
    const account = m.account || "unknown";
    m.importsByAccount = m.importsByAccount || {};
    m.importsByAccount[account] = records;
    const reverse = { ...(m.templateNames || {}) };
    Object.entries(m.exerciseMap || {}).forEach(([exId, templateId]) => {
      const liftName = state.exercises.find(
        (x) => String(x.id) === String(exId),
      )?.name;
      if (liftName) reverse[String(templateId)] = liftName;
    });
    const best = {};
    for (const workout of Object.values(records))
      for (const exercise of workout.exercises || [])
        for (const set of exercise.sets || []) {
          const reps = Number(set.reps),
            weightKg = Number(set.weight_kg),
            type = String(set.type || "normal").toLowerCase();
          if (
            !Number.isInteger(reps) ||
            reps < 1 ||
            !(weightKg > 0) ||
            type === "warmup" ||
            !["normal", "failure", "drop", "dropset", "myorep"].includes(type)
          )
            continue;
          const rawRpe = Number(set.rpe),
            rpe =
              Number.isFinite(rawRpe) && rawRpe >= 1 && rawRpe <= 10
                ? rawRpe
                : 10;
          const weight =
            state.unit === "lb" ? weightKg * 2.2046226218 : weightKg;
          const e1rm = calculateE1RM(weight, reps, rpe),
            id = String(
              exercise.exercise_template_id || exercise.id || "unknown",
            );
          if (!best[id] || e1rm > best[id].value)
            best[id] = {
              value: e1rm,
              name: reverse[id] || exercise.title || exercise.name || id,
              date: workout.start_time || workout.created_at || "",
              rpe,
              weight,
              reps,
              workout: workout.title || "Hevy workout",
            };
        }
    m.importedSummaryByAccount = m.importedSummaryByAccount || {};
    m.importedSummaryByAccount[account] = { count: runs.length, best };
    hevySave(m);
    renderImportedSummary(best, runs.length, state.unit);
  } catch (e) {
    out.textContent = e.message;
  }
}
function initHevy() {
  const d = $("#hevyDay");
  if (!d) return;
  d.innerHTML = "";
  state.days.forEach((day) => {
    const o = document.createElement("option");
    o.value = day.id;
    o.textContent = day.name;
    d.appendChild(o);
  });
  $("#hevySaveMapping").onclick = () => {
    const m = hevyMeta();
    m.exerciseMap = m.exerciseMap || {};
    $("#hevyExerciseMappings")
      .querySelectorAll("select[data-exid]")
      .forEach((sel) => {
        if (sel.value) m.exerciseMap[sel.dataset.exid] = sel.value;
        else delete m.exerciseMap[sel.dataset.exid];
      });
    const mapped = Object.values(m.exerciseMap);
    if (new Set(mapped.map(String)).size !== mapped.length) {
      $("#hevyStatus").textContent =
        "Each LiftTracker exercise must map to a unique Hevy template.";
      return;
    }
    hevySave(m);
    $("#hevyStatus").textContent = "Exercise mapping saved.";
  };
  $("#hevyLoadExercises").onclick = hevyLoadExerciseMappings;
  $("#hevyConnect").onclick = hevyConnect;
  $("#hevyPush").onclick = () =>
    hevyPush().catch((e) => ($("#hevyStatus").textContent = e.message));
  $("#hevyImport").onclick = hevyImport;
  const m = hevyMeta();
  const cached = m.importedSummaryByAccount?.[m.account || "unknown"];
  if (cached) renderImportedSummary(cached.best, cached.count, state.unit);
  $("#hevyAuto").checked = Boolean(m.auto);
  $("#hevyAuto").onchange = () => {
    const x = hevyMeta();
    x.auto = $("#hevyAuto").checked;
    hevySave(x);
  };
  $("#hevyDay").onchange = () => {
    $("#hevyRoutine").value =
      hevyMeta().dayRoutines?.[$("#hevyDay").value] || "";
  };
  $("#hevyRoutine").onchange = () => {
    const x = hevyMeta();
    x.dayRoutines = x.dayRoutines || {};
    if ($("#hevyRoutine").value)
      x.dayRoutines[$("#hevyDay").value] = $("#hevyRoutine").value;
    else delete x.dayRoutines[$("#hevyDay").value];
    hevySave(x);
  };
  $("#hevyResetSnapshot").onclick = () => {
    const x = hevyMeta(),
      rid = $("#hevyRoutine").value;
    if (rid) {
      delete x.snapshots?.[rid];
      delete x.readyRoutines?.[rid];
      hevySave(x);
      $("#hevyStatus").textContent =
        "Snapshot cleared. Push again to establish a fresh baseline.";
    }
  };
  hevyConnect();
}
let hevyAutoTimer;
const _renderToday = window.renderToday;
window.renderToday = function () {
  _renderToday();
  const auto = $("#hevyAuto");
  if (!auto?.checked) return;
  $("#hevyDay").value = $("#day").value.split("-")[1];
  $("#hevyRoutine").value = hevyMeta().dayRoutines?.[$("#hevyDay").value] || "";
  clearTimeout(hevyAutoTimer);
  hevyAutoTimer = setTimeout(
    () =>
      hevyPush({ automatic: true }).catch(
        (e) =>
          ($("#hevyStatus").textContent = `Auto sync paused: ${e.message}`),
      ),
    900,
  );
};
