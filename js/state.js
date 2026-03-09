/* ---------- Constants and State ---------- */
const STORE_KEY = 'lifttracker_v1';

// RPE to %1RM conversion table
const RPE_TABLE = {
  3: { 8.0: 0.89, 8.5: 0.90, 9.0: 0.92 },
  4: { 8.0: 0.86, 8.5: 0.87, 9.0: 0.89 },
  5: { 8.0: 0.83, 8.5: 0.85, 9.0: 0.86 },
  6: { 8.0: 0.81, 8.5: 0.82, 9.0: 0.84 },
  8: { 8.0: 0.76, 8.5: 0.78, 9.0: 0.80 },
  10: { 8.0: 0.72, 8.5: 0.74, 9.0: 0.76 }
};

// Body part categories
const BODY_PARTS = ['CHEST', 'BACK', 'QUADS', 'HAMSTRINGS', 'SHOULDERS', 'ARMS'];

const PROGRESSION_COLORS = {
  CHEST:      '#71a8ff',
  BACK:       '#37d67a',
  QUADS:      '#ff8c42',
  HAMSTRINGS: '#ff5f57',
  SHOULDERS:  '#c084fc',
  ARMS:       '#ffd166',
};

// Dynamic progression X-axis labels based on state.days and state.cycleLength
function getProgXLabels() {
  const labels = [];
  const cycleLength = state.cycleLength || 6;
  for (let week = 1; week <= cycleLength; week++) {
    state.days.forEach(day => {
      labels.push(`W${week}-${day.name}`);
    });
  }
  return labels;
}

// Default state
const DEFAULT_STATE = {
  unit: 'lb',
  settings: {
    upUpperStrong: 1.5,
    upUpperSmall: 0.5,
    downUpper: 2.5,
    upLowerStrong: 1.5,
    upLowerSmall: 1.0,
    downLower: 2.5,
    minJump: 2.5
  },
  exercises: [
    { id: 1, name: 'Barbell Bench Press', cat: 'CHEST', tm: 185 },
    { id: 2, name: 'Back Squat', cat: 'QUADS', tm: 275 },
    { id: 3, name: 'Barbell Row', cat: 'BACK', tm: 185 },
    { id: 4, name: 'RDL', cat: 'HAMSTRINGS', tm: 225 }
  ],
  cycleLength: 6,
  nextId: 5,
  days: [
    { id: 0, name: 'A-Upper' },
    { id: 1, name: 'A-Lower' },
    { id: 2, name: 'B-Upper' },
    { id: 3, name: 'B-Lower' }
  ],
  nextDayId: 4,
  templates: {
    '0': [
      { exId: 1, reps: 5, rpe: 8.5, sets: 4 },
      { exId: 3, reps: 6, rpe: 8.0, sets: 3 }
    ],
    '1': [
      { exId: 2, reps: 5, rpe: 8.5, sets: 4 },
      { exId: 4, reps: 6, rpe: 8.0, sets: 3 }
    ],
    '2': [
      { exId: 1, reps: 4, rpe: 8.0, sets: 3 },
      { exId: 3, reps: 5, rpe: 8.0, sets: 3 }
    ],
    '3': [
      { exId: 2, reps: 4, rpe: 8.0, sets: 3 },
      { exId: 4, reps: 5, rpe: 8.0, sets: 3 }
    ]
  },
  // RPE Schedule System
  rpeSchedule: {
    // Format: "week-dayId-bodypart": rpe
    overrides: {},
    // Default RPE values when no override exists
    defaults: {
      'CHEST': 8.5,
      'BACK': 8.0,
      'QUADS': 8.5,
      'HAMSTRINGS': 8.0,
      'SHOULDERS': 8.0,
      'ARMS': 8.0
    }
  },
  // Rep Progression System
  repProgression: {
    // Format: "week-dayId-bodypart": percentage (0-1)
    overrides: {},
    // Default rep percentages when no override exists
    defaults: {
      'CHEST': 0.5,
      'BACK': 0.5,
      'QUADS': 0.5,
      'HAMSTRINGS': 0.5,
      'SHOULDERS': 0.5,
      'ARMS': 0.5
    }
  },
  // Exercise rep ranges (min-max reps for each exercise)
  exerciseRepRanges: {},
  log: []
};

// State is populated asynchronously from SQLite in initDatabase() (db.js),
// called during DOMContentLoaded in app.js. DEFAULT_STATE is the safe placeholder.
let state = JSON.parse(JSON.stringify(DEFAULT_STATE));

// Migration: convert old fixed A/B template system to custom days
// Called by importData() (data-io.js) when importing a pre-custom-days export.
function migrateToCustomDays() {
  if (state.days) return; // Already migrated

  const oldTemplateKeys = Object.keys(state.templates);
  // Build days array from existing template keys
  const days = [];
  const nameToId = {};
  oldTemplateKeys.forEach((name, index) => {
    days.push({ id: index, name: name });
    nameToId[name] = index;
  });

  state.days = days;
  state.nextDayId = days.length;

  // Rekey templates from name keys to ID keys
  const newTemplates = {};
  oldTemplateKeys.forEach(name => {
    newTemplates[String(nameToId[name])] = state.templates[name];
  });
  state.templates = newTemplates;

  // Build section-to-dayIds map for override migration
  // Old keys used section letter (A or B) extracted via templateKey.split('-')[0]
  const sectionToDayIds = {};
  oldTemplateKeys.forEach(name => {
    const section = name.split('-')[0]; // 'A' or 'B'
    if (!sectionToDayIds[section]) sectionToDayIds[section] = [];
    sectionToDayIds[section].push(nameToId[name]);
  });

  // Migrate RPE overrides
  const oldRpeOverrides = state.rpeSchedule.overrides;
  const newRpeOverrides = {};
  Object.keys(oldRpeOverrides).forEach(key => {
    const parts = key.split('-');
    const week = parts[0];
    const section = parts[1];
    const bodyPart = parts.slice(2).join('-');
    const dayIds = sectionToDayIds[section] || [];
    dayIds.forEach(dayId => {
      newRpeOverrides[`${week}-${dayId}-${bodyPart}`] = oldRpeOverrides[key];
    });
  });
  state.rpeSchedule.overrides = newRpeOverrides;

  // Migrate rep progression overrides
  const oldRepOverrides = state.repProgression.overrides;
  const newRepOverrides = {};
  Object.keys(oldRepOverrides).forEach(key => {
    const parts = key.split('-');
    const week = parts[0];
    const section = parts[1];
    const bodyPart = parts.slice(2).join('-');
    const dayIds = sectionToDayIds[section] || [];
    dayIds.forEach(dayId => {
      newRepOverrides[`${week}-${dayId}-${bodyPart}`] = oldRepOverrides[key];
    });
  });
  state.repProgression.overrides = newRepOverrides;

  // Migrate log entries
  // Old day values: "A-Upper", "B-Lower", or "1-A-upper" style from day dropdown
  state.log.forEach(entry => {
    if (entry.day === undefined || entry.day === null) return;
    // If already a number, skip
    if (typeof entry.day === 'number') return;
    const dayStr = String(entry.day);
    // Try direct name match first (e.g., "A-Upper")
    if (nameToId[dayStr] !== undefined) {
      entry.day = nameToId[dayStr];
      return;
    }
    // Try parsing old dropdown format "week-section-split" (e.g., "1-A-upper")
    const dParts = dayStr.split('-');
    if (dParts.length === 3) {
      const section = dParts[1];
      const split = dParts[2].charAt(0).toUpperCase() + dParts[2].slice(1);
      const oldKey = `${section}-${split}`;
      if (nameToId[oldKey] !== undefined) {
        entry.day = nameToId[oldKey];
        return;
      }
    }
  });

  persist();
}

/* ---------- Utility Functions ---------- */
function persist() {
  if (window._liftDb) {
    persistToSQLite(window._liftDb, state);
  } else {
    // Fallback: DB not yet initialized (e.g. during initial migration)
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }
}

function $(selector) {
  return document.querySelector(selector);
}

function fmt(number) {
  return Number(number).toFixed(0);
}

function isLowerBody(category) {
  return category === 'QUADS' || category === 'HAMSTRINGS';
}
