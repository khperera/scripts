/* Hevy integration: native Android HTTP, same-origin companion in a browser. */
const HEVY_META_KEY = "lifttracker_hevy_setup_v2";
const HEVY_API_BASE = "https://api.hevyapp.com/v1";
let hevyRuntimeKey = "";
let hevyRuntimeAccount = null;
let hevyRuntimeTemplates = [];
let hevyRuntimeTemplateNames = {};
let hevyRuntimeRoutines = {};
let hevyPreview = null;
let hevySyncBusy = false;

function hevyIsAndroid() {
  return window.Capacitor?.getPlatform?.() === "android";
}
function hevyNativeHttp() {
  if (!hevyIsAndroid()) return null;
  if (!window.Capacitor?.isPluginAvailable?.("CapacitorHttp")) return null;
  return window.Capacitor?.Plugins?.CapacitorHttp || null;
}
function hevyStoreRead() {
  try {
    const value = JSON.parse(localStorage.getItem(HEVY_META_KEY) || "{}");
    if (!value.profiles) value.profiles = {};
    return value;
  } catch {
    return { activeAccount: null, profiles: {} };
  }
}
function hevyMeta() {
  const store = hevyStoreRead();
  return store.profiles[store.activeAccount] || null;
}
function hevySave(profile) {
  const store = hevyStoreRead();
  const accountId = String(profile.accountId || store.activeAccount || "");
  if (!accountId) throw new Error("Connect to Hevy before saving setup.");
  profile.accountId = accountId;
  store.activeAccount = accountId;
  store.profiles[accountId] = profile;
  localStorage.setItem(HEVY_META_KEY, JSON.stringify(store));
}
function hevyActivateAccount(accountId) {
  const store = hevyStoreRead();
  const id = String(accountId);
  store.activeAccount = id;
  if (!store.profiles[id]) {
    store.profiles[id] = {
      accountId: id,
      exerciseMap: {},
      dayRoutines: {},
      dayOccurrences: {},
      routineSnapshots: {},
      routineSummaries: [],
      enabled: false,
      autoSync: false,
      lastSync: null,
    };
  }
  localStorage.setItem(HEVY_META_KEY, JSON.stringify(store));
  return store.profiles[id];
}
function hevyErrorMessage(data, status) {
  if (typeof data === "string") return "Hevy returned HTTP " + status + ".";
  return data?.error || data?.message || "Hevy returned HTTP " + status + ".";
}
async function hevyRequest(path, options = {}, keyOverride = null) {
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : undefined;
  if (hevyIsAndroid()) {
    if (path === "/api/status") {
      return { configured: Boolean(keyOverride || hevyRuntimeKey), source: "session" };
    }
    if (path === "/api/key") throw new Error("Key controls are handled in the app.");
    const plugin = hevyNativeHttp();
    if (!plugin) throw new Error("CapacitorHttp is unavailable in this Android build. Rebuild and sync the Android app.");
    const key = keyOverride || hevyRuntimeKey;
    if (!key) throw new Error("Enter your Hevy API key first.");
    const apiPath = path.replace(/^\/api\/hevy/, "");
    const response = await plugin.request({
      url: HEVY_API_BASE + apiPath,
      method,
      headers: { "api-key": key, "Content-Type": "application/json" },
      data: body,
      connectTimeout: 15000,
      readTimeout: 20000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(hevyErrorMessage(response.data, response.status));
    }
    return response.data;
  }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(path, {
        ...options,
        headers: { "content-type": "application/json", ...(options.headers || {}) },
      });
      const data = await response.json();
      if (response.ok) return data;
      lastError = new Error(hevyErrorMessage(data, response.status));
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) throw lastError;
      const retryAfter = Math.min(5, Math.max(0, Number(data.retry_after) || 0));
      await new Promise(resolve => setTimeout(resolve, retryAfter ? retryAfter * 1000 : 500 * (2 ** attempt)));
    } catch (error) {
      if (error === lastError || attempt === 2) throw error;
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw lastError || new Error("Hevy request failed.");
}
function hevyUserObject(response) {
  return response?.user || response?.data || response;
}
function hevyUnwrapRoutine(response) {
  const routine = response?.routine;
  if (Array.isArray(routine)) return routine[0] || {};
  return routine || response;
}
function hevyNormalizeName(name) {
  return String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function hevyExerciseNameTokens(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\brdl\b/g, "romanian deadlift")
    .replace(/\bohp\b/g, "overhead press")
    .replace(/\bdbs?\b/g, "dumbbell")
    .replace(/\bdumbbells\b/g, "dumbbell")
    .replace(/\bbarbells\b/g, "barbell")
    .replace(/\bbb\b/g, "barbell")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
function hevyEditSimilarity(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}
function hevyExerciseNameSimilarity(left, right) {
  const leftTokens = [...new Set(hevyExerciseNameTokens(left))];
  const rightTokens = [...new Set(hevyExerciseNameTokens(right))];
  if (!leftTokens.length || !rightTokens.length) return 0;
  const rightSet = new Set(rightTokens);
  const common = leftTokens.filter(token => rightSet.has(token));
  if (!common.length) return 0;

  // A shared generic movement word ("press", "row", "curl") alone is too
  // weak to suggest unrelated exercises such as bench press and leg press.
  const generic = new Set([
    "press", "row", "curl", "squat", "deadlift", "extension", "raise",
    "fly", "pulldown", "pullover", "pushdown", "dip", "crunch", "plank",
  ]);
  const leftSpecific = leftTokens.filter(token => !generic.has(token));
  const rightSpecific = rightTokens.filter(token => !generic.has(token));
  if (leftSpecific.length && rightSpecific.length && !leftSpecific.some(token => rightSpecific.includes(token))) return 0;

  const dice = (2 * common.length) / (leftTokens.length + rightTokens.length);
  const leftSorted = leftTokens.slice().sort().join("");
  const rightSorted = rightTokens.slice().sort().join("");
  return dice * 0.8 + hevyEditSimilarity(leftSorted, rightSorted) * 0.2;
}
function hevyClosestExerciseMatch(name, templates, usedTemplateIds = new Set()) {
  const exact = templates.filter(item => hevyNormalizeName(item.title) === hevyNormalizeName(name));
  if (exact.length) {
    exact.sort((a, b) => Number(usedTemplateIds.has(String(b.id))) - Number(usedTemplateIds.has(String(a.id))) || String(a.title).localeCompare(String(b.title)));
    return { template: exact[0], score: 1, exact: true, used: usedTemplateIds.has(String(exact[0].id)) };
  }
  const scored = templates.map(template => ({
    template,
    score: hevyExerciseNameSimilarity(name, template.title),
    used: usedTemplateIds.has(String(template.id)),
  })).filter(match => match.score >= 0.42);
  scored.sort((a, b) => b.score - a.score || Number(b.used) - Number(a.used) || String(a.template.title).localeCompare(String(b.template.title)));
  return scored.length ? { ...scored[0], exact: false } : null;
}
async function hevyFetchPages(path, key, prop, pageSize, maxPages) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = await hevyRequest(path + "?page=" + page + "&pageSize=" + pageSize, {}, key);
    const rows = response?.[prop] || [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
  throw new Error("Hevy returned more pages than the safety limit for " + prop + ".");
}
async function hevyLoadAccountData(key) {
  const rawInfo = await hevyRequest("/api/hevy/user/info", {}, key);
  const user = hevyUserObject(rawInfo);
  const accountId = user?.id || user?.user_id || user?.email;
  if (!accountId) throw new Error("Hevy did not return an account ID; mappings cannot be safely scoped.");
  const [routines, templates, folders] = await Promise.all([
    hevyFetchPages("/api/hevy/routines", key, "routines", 10, 100),
    hevyFetchPages("/api/hevy/exercise_templates", key, "exercise_templates", 100, 100),
    hevyFetchPages("/api/hevy/routine_folders", key, "routine_folders", 10, 100),
  ]);
  const details = {};
  for (let i = 0; i < routines.length; i += 3) {
    await Promise.all(routines.slice(i, i + 3).map(async routine => {
      const id = String(routine.id);
      const detail = Array.isArray(routine.exercises)
        ? routine
        : hevyUnwrapRoutine(await hevyRequest("/api/hevy/routines/" + encodeURIComponent(id), {}, key));
      details[id] = detail;
    }));
  }
  return { rawInfo, user, accountId: String(accountId), routines, templates, folders, details };
}
function hevyActiveDays() {
  return state.days.filter(day => (state.templates[String(day.id)] || []).some(item => state.exercises.some(ex => ex.id === item.exId)));
}
function hevyActiveExercises() {
  const seen = new Set();
  const result = [];
  hevyActiveDays().forEach(day => (state.templates[String(day.id)] || []).forEach(item => {
    const ex = state.exercises.find(candidate => candidate.id === item.exId);
    if (ex && !seen.has(String(ex.id))) { seen.add(String(ex.id)); result.push(ex); }
  }));
  return result;
}
function hevyRoutineTitle(id) {
  return hevyRuntimeRoutines[String(id)]?.title || "Routine " + id;
}
function hevyTemplateTitle(id) {
  return hevyRuntimeTemplateNames[String(id)] || "Unknown Hevy exercise";
}
async function hevyConnect(keyOverride = null) {
  const button = $("#hevyConnect");
  button.disabled = true;
  $("#hevyStatus").textContent = hevyIsAndroid() ? "Connecting directly to Hevy…" : "Connecting through the local companion…";
  try {
    const keyStatus = await hevyRequest("/api/status", {}, keyOverride);
    if (!keyStatus.configured) throw new Error(hevyIsAndroid() ? "Enter your Hevy API key first." : "Enter your Hevy API key above or configure HEVY_API_KEY on the companion.");
    const data = await hevyLoadAccountData(keyOverride);
    hevyRuntimeAccount = data.accountId;
    const profile = hevyActivateAccount(data.accountId);
    hevyRuntimeTemplates = data.templates;
    hevyRuntimeTemplateNames = Object.fromEntries(data.templates.map(item => [String(item.id), item.title]));
    hevyRuntimeRoutines = data.details;
    profile.routineSummaries = data.routines.map(r => ({ id: String(r.id), title: r.title, folder_id: r.folder_id ?? null }));
    profile.folderTitles = Object.fromEntries(data.folders.map(folder => [String(folder.id), folder.title]));
    profile.templateNames = hevyRuntimeTemplateNames;
    hevySave(profile);
    $("#hevyWizard").hidden = false;
    renderHevyExerciseMappings();
    renderHevyDayMappings();
    renderHevyControls();
    const displayName = data.user?.name || data.user?.username || data.user?.email || "Hevy account";
    $("#hevyStatus").textContent = "Connected to " + displayName + ". Map exercises and active days before syncing.";
    return true;
  } catch (error) {
    $("#hevyStatus").textContent = error.message;
    $("#hevyWizard").hidden = true;
    return false;
  } finally {
    button.disabled = false;
  }
}
function hevyCurrentRoutineOptions() {
  const profile = hevyMeta() || {};
  return (profile.routineSummaries || []).map(routine => {
    const folder = routine.folder_id == null ? "My Routines" : (profile.folderTitles?.[String(routine.folder_id)] || "Routine folder");
    return { ...routine, label: routine.title + " — " + folder };
  });
}
function hevyUsedTemplateIds() {
  const used = new Set();
  Object.values(hevyRuntimeRoutines).forEach(routine => (routine.exercises || []).forEach(exercise => {
    if (exercise.exercise_template_id) used.add(String(exercise.exercise_template_id));
  }));
  return used;
}
function renderHevyExerciseMappings() {
  const container = $("#hevyExerciseMappings");
  container.replaceChildren();
  const profile = hevyMeta();
  if (!profile) return;
  const used = hevyUsedTemplateIds();
  const activeExercises = hevyActiveExercises();
  activeExercises.forEach(exercise => {
    const row = document.createElement("div");
    row.className = "card hevy-map-row";
    const title = document.createElement("strong");
    title.textContent = exercise.name + " (" + exercise.cat + ")";
    const savedId = String(profile.exerciseMap?.[String(exercise.id)] || "");
    const savedMatch = hevyRuntimeTemplates.find(item => String(item.id) === savedId);
    const suggestion = savedMatch ? null : hevyClosestExerciseMatch(exercise.name, hevyRuntimeTemplates, used);
    const displayedMatch = savedMatch || suggestion?.template;
    const hint = document.createElement("div");
    hint.className = "tiny";
    hint.textContent = savedMatch
      ? "Saved match: " + savedMatch.title + ". Change it below if this is not the same movement."
      : suggestion
        ? (suggestion.exact ? "Exact title match selected: " : "Closest name match selected: ") + suggestion.template.title +
          (suggestion.used ? " (used in your Hevy routines). Check it and change it below if needed." : " (catalog match). Check it and change it below if needed.")
        : "No close name match found. Choose the same movement from Hevy's exercise catalog.";
    const select = document.createElement("select");
    select.dataset.exerciseId = exercise.id;
    select.appendChild(new Option("Choose a Hevy exercise", ""));
    const options = [...hevyRuntimeTemplates].sort((a, b) => Number(used.has(String(b.id))) - Number(used.has(String(a.id))) || String(a.title).localeCompare(String(b.title)));
    options.forEach(item => {
      const descriptor = [item.equipment_category, item.muscle_group].filter(Boolean).join(" · ");
      const option = new Option(item.title + (descriptor ? " — " + descriptor : "") + (used.has(String(item.id)) ? " · used in routine" : ""), String(item.id));
      select.appendChild(option);
    });
    select.value = String(displayedMatch?.id || "");
    row.append(title, hint, select);
    container.appendChild(row);
  });
  $("#hevySaveExerciseMap").disabled = activeExercises.length === 0;
}
function renderHevyDayMappings() {
  const container = $("#hevyDayMappings");
  container.replaceChildren();
  const profile = hevyMeta();
  if (!profile) return;
  const routines = hevyCurrentRoutineOptions();
  const activeDays = hevyActiveDays();
  activeDays.forEach(day => {
    const card = document.createElement("div");
    card.className = "card hevy-day-map";
    const heading = document.createElement("strong");
    heading.textContent = day.name;
    const select = document.createElement("select");
    select.dataset.dayId = day.id;
    select.appendChild(new Option("Choose a Hevy routine", ""));
    routines.forEach(routine => select.appendChild(new Option(routine.label, String(routine.id))));
    select.value = String(profile.dayRoutines?.[String(day.id)] || "");
    select.onchange = () => renderHevyOccurrenceRows(card, day, select.value);
    card.append(heading, select);
    container.appendChild(card);
    if (select.value) renderHevyOccurrenceRows(card, day, select.value);
  });
  $("#hevySaveDayMap").disabled = activeDays.length === 0;
}
function renderHevyOccurrenceRows(card, day, routineId) {
  const old = card.querySelector(".hevy-occurrences");
  if (old) old.remove();
  if (!routineId) return;
  const routine = hevyRuntimeRoutines[String(routineId)];
  if (!routine) return;
  const profile = hevyMeta();
  const rows = document.createElement("div");
  rows.className = "hevy-occurrences";
  const existingMap = profile.dayOccurrences?.[String(day.id)] || {};
  const usedIndices = new Set();
  const dayItems = state.templates[String(day.id)] || [];
  dayItems.forEach((item, itemIndex) => {
    const liftExercise = state.exercises.find(ex => ex.id === item.exId);
    if (!liftExercise) return;
    const hevyId = profile.exerciseMap?.[String(liftExercise.id)];
    const repeatedInLiftTracker = dayItems.filter(candidate => {
      const candidateExercise = state.exercises.find(ex => ex.id === candidate.exId);
      return candidateExercise && String(profile.exerciseMap?.[String(candidateExercise.id)]) === String(hevyId);
    }).length > 1;
    const candidates = (routine.exercises || []).map((exercise, index) => ({ exercise, index }))
      .filter(entry => String(entry.exercise.exercise_template_id) === String(hevyId));
    const line = document.createElement("div");
    line.className = "row hevy-occurrence-row";
    const label = document.createElement("span");
    label.textContent = liftExercise.name + " → ";
    line.appendChild(label);
    const select = document.createElement("select");
    select.dataset.itemIndex = itemIndex;
    select.dataset.dayId = day.id;
    select.appendChild(new Option("Choose routine occurrence", ""));
    candidates.forEach((entry, occurrence) => {
      const note = entry.exercise.notes ? " — " + entry.exercise.notes : "";
      select.appendChild(new Option("Occurrence " + (occurrence + 1) + note, String(entry.index)));
    });
    const saved = existingMap[String(itemIndex)];
    if (saved != null && candidates.some(candidate => candidate.index === Number(saved))) select.value = String(saved);
    else if (candidates.length === 1) select.value = String(candidates[0].index);
    if (select.value) {
      if (usedIndices.has(select.value)) select.value = "";
      else usedIndices.add(select.value);
    }
    if (!hevyId) {
      const message = document.createElement("span");
      message.className = "tiny";
      message.textContent = "Map this LiftTracker exercise first.";
      line.appendChild(message);
    } else if (candidates.length === 0) {
      const message = document.createElement("span");
      message.className = "tiny hevy-warning";
      message.textContent = "Not in this routine. Add the exercise in Hevy, then reconnect to refresh.";
      line.appendChild(message);
    } else if (candidates.length === 1 && repeatedInLiftTracker) {
      const message = document.createElement("span");
      message.className = "tiny hevy-warning";
      message.textContent = "This exercise appears more than once in LiftTracker but only once in this Hevy routine. Add another Hevy occurrence or change the exercise mapping.";
      line.appendChild(message);
    } else if (candidates.length === 1) {
      const message = document.createElement("span");
      message.className = "tiny";
      message.textContent = "Unique match: " + hevyTemplateTitle(hevyId);
      line.appendChild(message);
    } else {
      line.appendChild(select);
      const message = document.createElement("span");
      message.className = "tiny";
      message.textContent = candidates.length + " occurrences. Choose the one for this LiftTracker entry.";
      line.appendChild(message);
    }
    if (candidates.length === 1) {
      select.hidden = true;
      line.appendChild(select);
    }
    rows.appendChild(line);
  });
  card.appendChild(rows);
}
function hevySaveExerciseMappings() {
  const profile = hevyMeta();
  if (!profile) throw new Error("Connect to Hevy first.");
  const proposed = { ...(profile.exerciseMap || {}) };
  $("#hevyExerciseMappings").querySelectorAll("select[data-exercise-id]").forEach(select => {
    if (select.value) proposed[String(select.dataset.exerciseId)] = String(select.value);
    else delete proposed[String(select.dataset.exerciseId)];
  });
  const missing = hevyActiveExercises().filter(ex => !proposed[String(ex.id)]);
  if (missing.length) throw new Error("Choose a Hevy exercise for: " + missing.map(ex => ex.name).join(", ") + ".");
  profile.exerciseMap = proposed;
  profile.dayOccurrences = {};
  profile.dayRoutines = {};
  profile.enabled = false;
  profile.routineSnapshots = {};
  hevySave(profile);
  renderHevyDayMappings();
  renderHevyControls();
  hevySetStatus("Exercise matches saved. Map each active day to a routine.");
}
function hevySaveDayMappings() {
  const profile = hevyMeta();
  if (!profile) throw new Error("Connect to Hevy first.");
  const dayRoutines = {};
  const dayOccurrences = {};
  const selectedRoutineIds = new Set();
  for (const day of hevyActiveDays()) {
    const card = [...$("#hevyDayMappings").children].find(element => Number(element.querySelector("select[data-day-id]")?.dataset.dayId) === Number(day.id));
    const routineSelect = card?.querySelector("select[data-day-id]");
    const routineId = routineSelect?.value;
    if (!routineId) throw new Error("Choose a Hevy routine for " + day.name + ".");
    if (selectedRoutineIds.has(String(routineId))) throw new Error("Each active LiftTracker day needs a distinct Hevy routine. " + hevyRoutineTitle(routineId) + " is selected more than once.");
    selectedRoutineIds.add(String(routineId));
    const routine = hevyRuntimeRoutines[String(routineId)];
    if (!routine) throw new Error("Reconnect to load the selected Hevy routine.");
    dayRoutines[String(day.id)] = String(routineId);
    const mappings = {};
    const usedIndices = new Set();
    for (let itemIndex = 0; itemIndex < (state.templates[String(day.id)] || []).length; itemIndex++) {
      const item = state.templates[String(day.id)][itemIndex];
      const exercise = state.exercises.find(ex => ex.id === item.exId);
      if (!exercise) throw new Error(day.name + " has a template row whose LiftTracker exercise is missing.");
      const hevyId = profile.exerciseMap?.[String(exercise.id)];
      if (!hevyId) throw new Error("Map " + exercise.name + " to a Hevy exercise before saving day mappings.");
      const candidates = (routine.exercises || []).map((entry, index) => ({ entry, index })).filter(match => String(match.entry.exercise_template_id) === String(hevyId));
      if (!candidates.length) throw new Error(hevyTemplateTitle(hevyId) + " is missing from the Hevy routine " + routine.title + ". Add it in Hevy and reconnect.");
      let index;
      if (candidates.length === 1) index = candidates[0].index;
      else {
        const occurrenceSelect = card.querySelector('select[data-item-index="' + itemIndex + '"]');
        index = occurrenceSelect?.value === "" ? null : Number(occurrenceSelect?.value);
        if (!Number.isInteger(index) || !candidates.some(candidate => candidate.index === index)) throw new Error("Choose the exact Hevy occurrence for " + exercise.name + " in " + day.name + ".");
      }
      if (usedIndices.has(index)) throw new Error("Two LiftTracker entries in " + day.name + " point to the same Hevy occurrence. Assign distinct occurrences.");
      usedIndices.add(index);
      mappings[String(itemIndex)] = index;
    }
    dayOccurrences[String(day.id)] = mappings;
  }
  profile.dayRoutines = dayRoutines;
  profile.dayOccurrences = dayOccurrences;
  profile.enabled = false;
  profile.routineSnapshots = {};
  hevySave(profile);
  renderHevyControls();
  hevySetStatus("Day and occurrence matches saved. Review all routines before the first write.");
}
function hevySetStatus(message) { $("#hevyStatus").textContent = message; }
function hevyValidateSetup(profile = hevyMeta()) {
  const errors = [];
  if (!profile) return ["Connect to Hevy first."];
  const exercises = hevyActiveExercises();
  for (const exercise of exercises) {
    const mappedId = profile.exerciseMap?.[String(exercise.id)];
    if (!mappedId) errors.push("Map " + exercise.name + " to a Hevy exercise.");
    else if (hevyRuntimeTemplates.length && !hevyRuntimeTemplates.some(template => String(template.id) === String(mappedId))) {
      errors.push("Reconnect and refresh the Hevy exercise mapping for " + exercise.name + ".");
    }
  }
  const activeDays = hevyActiveDays();
  const usedRoutines = new Set();
  for (const day of activeDays) {
    const dayKey = String(day.id);
    const routineId = profile.dayRoutines?.[dayKey];
    if (!routineId) { errors.push("Map " + day.name + " to a Hevy routine."); continue; }
    if (usedRoutines.has(String(routineId))) errors.push("Routine " + hevyRoutineTitle(routineId) + " is assigned to multiple days.");
    usedRoutines.add(String(routineId));
    const routine = hevyRuntimeRoutines[String(routineId)];
    if (!routine) { errors.push("Reconnect to refresh " + hevyRoutineTitle(routineId) + "."); continue; }
    const occurrences = profile.dayOccurrences?.[dayKey] || {};
    const usedIndices = new Set();
    const items = state.templates[dayKey] || [];
    items.forEach((item, itemIndex) => {
      const exercise = state.exercises.find(ex => ex.id === item.exId);
      const templateId = exercise && profile.exerciseMap?.[String(exercise.id)];
      if (!exercise || !templateId) { errors.push("Map every exercise used in " + day.name + "."); return; }
      const index = Number(occurrences[String(itemIndex)]);
      const entry = (routine.exercises || [])[index];
      if (!Number.isInteger(index) || !entry || String(entry.exercise_template_id) !== String(templateId)) {
        errors.push("Confirm the Hevy occurrence for " + exercise.name + " in " + day.name + ".");
        return;
      }
      if (usedIndices.has(index)) errors.push("Two LiftTracker entries use the same Hevy occurrence in " + day.name + ".");
      usedIndices.add(index);
    });
  }
  if (!activeDays.length) errors.push("There are no active LiftTracker days to sync.");
  return [...new Set(errors)];
}
function hevyPlanForDay(day, week, profile) {
  const routineId = profile.dayRoutines[String(day.id)];
  const routine = hevyRuntimeRoutines[String(routineId)];
  const assignments = {};
  (state.templates[String(day.id)] || []).forEach((item, itemIndex) => {
    const exercise = state.exercises.find(ex => ex.id === item.exId);
    const rpe = getRPEForExercise(week, day.id, exercise.cat);
    const reps = calculateTargetReps(exercise.id, week, day.id, exercise.cat);
    const topWeight = prescribeLoad(exercise.tm, reps, rpe, state.unit, state.settings.minJump);
    const miniWeight = prescribeLoad(exercise.tm, 13, rpe, state.unit, state.settings.minJump);
    const totalSets = Math.max(1, Math.floor(Number(item.sets) || 1));
    assignments[Number(profile.dayOccurrences[String(day.id)][String(itemIndex)])] = {
      name: exercise.name,
      templateId: profile.exerciseMap[String(exercise.id)],
      targetRpe: rpe,
      notes: hevyWithTargetRpeNote(
        routine.exercises[Number(profile.dayOccurrences[String(day.id)][String(itemIndex)])]?.notes,
        week,
        rpe,
      ),
      totalSets,
      desired: [
        { weight_kg: state.unit === "lb" ? topWeight / 2.2046226218 : topWeight, reps },
        ...Array.from({ length: totalSets - 1 }, () => ({ weight_kg: state.unit === "lb" ? miniWeight / 2.2046226218 : miniWeight, reps: 5 })),
      ],
    };
  });
  return { dayId: String(day.id), dayName: day.name, routineId: String(routineId), routine, assignments };
}
function hevyWithTargetRpeNote(existingNotes, week, rpe) {
  const marker = "LiftTracker target RPE:";
  const retained = String(existingNotes || "")
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith(marker));
  while (retained.length && retained[retained.length - 1] === "") retained.pop();
  const note = marker + " " + rpe + " (week " + week + ")";
  return retained.length ? retained.join("\n") + "\n" + note : note;
}
function stableHevy(value) {
  if (Array.isArray(value)) return value.map(stableHevy);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).filter(key => !["id", "created_at", "updated_at"].includes(key)).sort().map(key => [key, stableHevy(value[key])]));
  }
  return value;
}
function hevyStableString(value) { return JSON.stringify(stableHevy(value)); }
function hevyRoutineWriteProjection(routine) {
  return {
    title: routine.title,
    notes: routine.notes,
    exercises: (routine.exercises || []).map(exercise => ({
      exercise_template_id: exercise.exercise_template_id,
      superset_id: exercise.superset_id ?? exercise.supersets_id ?? null,
      rest_seconds: exercise.rest_seconds,
      notes: exercise.notes,
      sets: (exercise.sets || []).map(set => ({
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
function hevyMergeRoutine(dayPlan) {
  const routine = dayPlan.routine;
  const exercises = (routine.exercises || []).map((exercise, index) => {
    const target = dayPlan.assignments[index];
    if (!target) return exercise;
    const existing = exercise.sets || [];
    const normals = existing.filter(set => String(set.type || "normal").toLowerCase() === "normal");
    const desiredNormals = target.desired.map((set, setIndex) => ({ ...(normals[setIndex] || { type: "normal" }), ...set }));
    let nextNormal = 0;
    const sets = existing.flatMap(set => {
      if (String(set.type || "normal").toLowerCase() !== "normal") return [set];
      if (nextNormal >= desiredNormals.length) return [];
      return [desiredNormals[nextNormal++]];
    });
    while (nextNormal < desiredNormals.length) sets.push(desiredNormals[nextNormal++]);
    return { ...exercise, notes: target.notes, sets };
  });
  return { ...routine, exercises };
}
async function hevyFetchRoutineFresh(routineId) {
  return hevyUnwrapRoutine(await hevyRequest("/api/hevy/routines/" + encodeURIComponent(routineId)));
}
function hevyRenderPreview(rows, conflicts) {
  const container = $("#hevyPreviewResults");
  container.replaceChildren();
  const heading = document.createElement("div");
  heading.textContent = conflicts.length ? "Review stopped: remote edits need your attention." : "Review this full update before allowing the first write:";
  container.appendChild(heading);
  rows.forEach(row => {
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("strong");
    title.textContent = row.plan.routine.title + " — " + row.plan.dayName;
    const list = document.createElement("ul");
    row.targets.forEach(target => {
      const li = document.createElement("li");
      const setsText = target.desired.map(set => set.weight_kg.toFixed(1) + " kg × " + set.reps).join("; ");
      li.textContent = target.name + ": target RPE " + target.targetRpe + "; " + setsText + (target.changed ? " (will update)" : " (already matches)");
      list.appendChild(li);
    });
    if (!row.targets.length) {
      const li = document.createElement("li");
      li.textContent = "No mapped exercise set changes.";
      list.appendChild(li);
    }
    card.append(title, list);
    container.appendChild(card);
  });
  conflicts.forEach(message => {
    const p = document.createElement("p");
    p.className = "hevy-warning";
    p.textContent = message;
    container.appendChild(p);
  });
  $("#hevyEnableSync").hidden = conflicts.length > 0;
}
async function hevyReviewAllRoutines() {
  const profile = hevyMeta();
  const errors = hevyValidateSetup(profile);
  if (errors.length) throw new Error(errors.join(" "));
  const week = Number($("#week").value) || 1;
  const plans = hevyActiveDays().map(day => hevyPlanForDay(day, week, profile));
  const rows = [];
  const conflicts = [];
  const snapshots = profile.routineSnapshots || {};
  for (const plan of plans) {
    const current = await hevyFetchRoutineFresh(plan.routineId);
    const prior = snapshots[plan.routineId];
    if (prior && hevyStableString(current) !== hevyStableString(prior)) {
      conflicts.push(plan.routine.title + " was changed in Hevy since its last accepted snapshot.");
    }
    plan.routine = current;
    const merged = hevyMergeRoutine(plan);
    const projectedCurrent = hevyRoutineWriteProjection(current);
    const projectedMerged = hevyRoutineWriteProjection(merged);
    const targets = Object.values(plan.assignments).map(target => ({
      name: target.name,
      desired: target.desired,
      changed: hevyStableString(projectedMerged) !== hevyStableString(projectedCurrent),
    }));
    rows.push({ plan, merged, current, targets, changed: hevyStableString(projectedMerged) !== hevyStableString(projectedCurrent) });
  }
  hevyPreview = { week, rows, conflicts };
  hevyRenderPreview(rows, conflicts);
  if (!conflicts.length) hevySetStatus("Preview ready. No routine has been changed yet.");
  else hevySetStatus("Sync blocked by a Hevy routine conflict.");
  return hevyPreview;
}
async function hevyApplyPreview(enable) {
  const profile = hevyMeta();
  const errors = hevyValidateSetup(profile);
  if (errors.length) throw new Error(errors.join(" "));
  if (!hevyPreview) throw new Error("Review the full routine update before syncing.");
  if (Number($("#week").value) !== hevyPreview.week) throw new Error("The selected week changed. Review the routines again.");
  if (hevyPreview.conflicts.length) throw new Error("Resolve the listed Hevy conflicts before syncing.");
  const currentPlans = hevyActiveDays().map(day => hevyPlanForDay(day, hevyPreview.week, profile));
  if (currentPlans.length !== hevyPreview.rows.length || currentPlans.some((plan, index) => {
    const reviewed = hevyPreview.rows[index].plan;
    return plan.dayId !== reviewed.dayId || plan.routineId !== reviewed.routineId ||
      hevyStableString(plan.assignments) !== hevyStableString(reviewed.assignments);
  })) throw new Error("The plan or mappings changed after preview. Review the routines again before syncing.");
  const fresh = [];
  const oldSnapshots = profile.routineSnapshots || {};
  for (const row of hevyPreview.rows) {
    const current = await hevyFetchRoutineFresh(row.plan.routineId);
    const expected = oldSnapshots[row.plan.routineId] || row.current;
    if (hevyStableString(current) !== hevyStableString(expected)) throw new Error(row.plan.routine.title + " changed after preview. Review again before syncing.");
    const plan = { ...row.plan, routine: current };
    const merged = hevyMergeRoutine(plan);
    fresh.push({ ...row, plan, current, merged, changed: hevyStableString(hevyRoutineWriteProjection(current)) !== hevyStableString(hevyRoutineWriteProjection(merged)) });
  }
  const newSnapshots = { ...(profile.routineSnapshots || {}) };
  let changedCount = 0;
  for (const row of fresh) {
    if (row.changed) {
      await hevyRequest("/api/hevy/routines/" + encodeURIComponent(row.plan.routineId), {
        method: "PUT",
        body: JSON.stringify({ routine: hevyRoutineWriteProjection(row.merged) }),
      });
      const updated = await hevyFetchRoutineFresh(row.plan.routineId);
      newSnapshots[row.plan.routineId] = updated;
      changedCount++;
    } else {
      newSnapshots[row.plan.routineId] = row.current;
    }
    profile.routineSnapshots = { ...newSnapshots };
    hevySave(profile);
  }
  profile.enabled = enable || profile.enabled;
  profile.autoSync = false;
  profile.lastSync = new Date().toISOString();
  hevySave(profile);
  hevyPreview = null;
  $("#hevyEnableSync").hidden = true;
  hevySetStatus("Prepared " + fresh.length + " Hevy routines for week " + (Number($("#week").value) || 1) + ". " + changedCount + " changed.");
  return { count: fresh.length, changedCount };
}
async function hevySyncAll(reason = "manual") {
  if (hevySyncBusy) return;
  hevySyncBusy = true;
  $("#hevyTodaySync").disabled = true;
  $("#hevyTodaySync").textContent = "Syncing Hevy…";
  try {
    const profile = hevyMeta();
    if (!profile?.enabled) throw new Error("Complete the mappings and confirm the initial review in Hevy setup before syncing.");
    const errors = hevyValidateSetup(profile);
    if (errors.length) throw new Error(errors.join(" "));
    hevySetStatus("Preparing all active-day routines (" + reason + ")…");
    await hevyReviewAllRoutines();
    if (hevyPreview?.conflicts.length) throw new Error("Sync stopped. Review the routine conflicts before continuing.");
    await hevyApplyPreview(false);
  } catch (error) {
    hevySetStatus(error.message);
  } finally {
    hevySyncBusy = false;
    renderHevyControls();
  }
}
function hevyTodaySync() {
  const profile = hevyMeta();
  if (!hevyRuntimeAccount || !profile?.enabled || hevyValidateSetup(profile).length) {
    $("#hevyWizard").hidden = false;
    hevySetStatus(!hevyRuntimeAccount
      ? "Connect your Hevy account and finish setup here before syncing."
      : "Finish or review the exercise and day mappings in Hevy setup before syncing.");
    $("#hevySettings").scrollIntoView?.({ behavior: "smooth", block: "start" });
    return;
  }
  return hevySyncAll("manual");
}
function renderHevyControls() {
  const profile = hevyMeta();
  const errors = hevyValidateSetup(profile);
  $("#hevyPreview").disabled = errors.length > 0;
  $("#hevyTodaySync").disabled = hevySyncBusy;
  $("#hevyTodaySync").textContent = hevySyncBusy ? "Syncing Hevy…" : (profile?.enabled && !errors.length ? "Sync Hevy now" : "Set up Hevy sync");
}
function hevySaveImportSummary(records, summary, count) {
  const profile = hevyMeta();
  if (!profile) return;
  profile.imports = records;
  profile.importedSummary = { best: summary, count };
  hevySave(profile);
}
function hevyRenderImport(summary, count) {
  const lines = Object.values(summary || {}).map(item => item.name + ": " + item.value.toFixed(1) + " " + state.unit + " from " + item.weight.toFixed(1) + " " + state.unit + " × " + item.reps + " @ RPE " + item.rpe + " (" + item.workout + ", " + (item.date || "date unavailable") + ")");
  $("#hevyResults").textContent = "Imported " + count + " workouts. Best imported estimated 1RM by exercise:\n" + (lines.join("\n") || "No eligible sets found.");
}
async function hevyImport() {
  const output = $("#hevyResults");
  output.textContent = "Loading workout history…";
  try {
    const workouts = await hevyFetchPages("/api/hevy/workouts", null, "workouts", 10, 100);
    const records = {};
    for (const listed of workouts) {
      const detail = Array.isArray(listed.exercises) ? listed : await hevyRequest("/api/hevy/workouts/" + encodeURIComponent(listed.id));
      const workout = detail.workout || detail;
      records[String(workout.id || listed.id)] = workout;
    }
    const profile = hevyMeta() || {};
    const best = {};
    const names = profile.templateNames || {};
    for (const workout of Object.values(records)) for (const exercise of workout.exercises || []) for (const set of exercise.sets || []) {
      const reps = Number(set.reps);
      const weightKg = Number(set.weight_kg);
      const type = String(set.type || "normal").toLowerCase();
      if (!Number.isInteger(reps) || reps < 1 || !(weightKg > 0) || type === "warmup" || !["normal", "failure", "drop", "dropset", "myorep"].includes(type)) continue;
      const providedRpe = Number(set.rpe);
      const rpe = Number.isFinite(providedRpe) && providedRpe >= 1 && providedRpe <= 10 ? providedRpe : 10;
      const weight = state.unit === "lb" ? weightKg * 2.2046226218 : weightKg;
      const e1rm = calculateE1RM(weight, reps, rpe);
      const id = String(exercise.exercise_template_id || exercise.id || "unknown");
      if (!best[id] || e1rm > best[id].value) best[id] = {
        value: e1rm,
        name: names[id] || exercise.title || exercise.name || id,
        date: workout.start_time || workout.created_at || "",
        rpe,
        weight,
        reps,
        workout: workout.title || "Hevy workout",
      };
    }
    hevySaveImportSummary(records, best, workouts.length);
    hevyRenderImport(best, workouts.length);
  } catch (error) { output.textContent = error.message; }
}
function hevyRenderCachedImport() {
  const profile = hevyMeta();
  if (profile?.importedSummary) hevyRenderImport(profile.importedSummary.best, profile.importedSummary.count);
}
function renderHevy() {
  const profile = hevyMeta();
  if (!profile || !hevyRuntimeAccount || profile.accountId !== hevyRuntimeAccount) {
    $("#hevyWizard").hidden = true;
    $("#hevyStatus").textContent = "Connect to load account-specific mappings.";
    return;
  }
  $("#hevyWizard").hidden = false;
  hevyRuntimeTemplateNames = profile.templateNames || hevyRuntimeTemplateNames;
  renderHevyExerciseMappings();
  renderHevyDayMappings();
  renderHevyControls();
  hevyRenderCachedImport();
}
function initHevy() {
  $("#hevyConnect").onclick = () => hevyConnect();
  $("#hevySaveKey").onclick = async () => {
    const field = $("#hevyApiKey");
    const candidate = field.value.trim();
    if (!candidate) return hevySetStatus("Enter your Hevy API key first.");
    if (hevyIsAndroid()) {
      const oldKey = hevyRuntimeKey;
      try {
        await hevyRequest("/api/hevy/user/info", {}, candidate);
        hevyRuntimeKey = candidate;
        field.value = "";
        if (!(await hevyConnect())) hevyRuntimeKey = oldKey;
      } catch (error) {
        field.value = "";
        hevyRuntimeKey = oldKey;
        hevySetStatus(error.message);
      }
    } else {
      try {
        await hevyRequest("/api/key", { method: "POST", body: JSON.stringify({ api_key: candidate }) });
        field.value = "";
        await hevyConnect();
      } catch (error) { hevySetStatus(error.message); }
    }
  };
  $("#hevyForgetKey").onclick = async () => {
    if (hevyIsAndroid()) {
      hevyRuntimeKey = "";
      $("#hevyApiKey").value = "";
      hevyRuntimeAccount = null;
      $("#hevyWizard").hidden = true;
      hevySetStatus("Session key forgotten. Enter it again to connect.");
      return;
    }
    try {
      const status = await hevyRequest("/api/key", { method: "DELETE", body: "{}" });
      $("#hevyApiKey").value = "";
      if (status.configured) await hevyConnect();
      else { hevyRuntimeAccount = null; $("#hevyWizard").hidden = true; hevySetStatus("Entered key forgotten. No companion key is configured."); }
    } catch (error) { hevySetStatus(error.message); }
  };
  $("#hevySaveExerciseMap").onclick = () => {
    try { hevySaveExerciseMappings(); } catch (error) { hevySetStatus(error.message); }
  };
  $("#hevySaveDayMap").onclick = () => {
    try { hevySaveDayMappings(); } catch (error) { hevySetStatus(error.message); }
  };
  $("#hevyPreview").onclick = () => hevyReviewAllRoutines().catch(error => hevySetStatus(error.message));
  $("#hevyEnableSync").onclick = () => hevyApplyPreview(true).catch(error => hevySetStatus(error.message));
  $("#hevyTodaySync").onclick = hevyTodaySync;
  $("#hevyResetSetup").onclick = () => {
    const profile = hevyMeta();
    if (!profile) return;
    profile.exerciseMap = {};
    profile.dayRoutines = {};
    profile.dayOccurrences = {};
    profile.routineSnapshots = {};
    profile.enabled = false;
    profile.lastSync = null;
    hevySave(profile);
    renderHevy();
    hevySetStatus("Mappings cleared. Reconfirm exercises and days before syncing.");
  };
  $("#hevyImport").onclick = hevyImport;
  renderHevy();
  // Ignore legacy auto-sync preferences from earlier versions. Sync is command-only.
  const profile = hevyMeta();
  if (profile?.autoSync) { profile.autoSync = false; hevySave(profile); }
}
