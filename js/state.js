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

const PROG_X_LABELS = [
  'W1-A','W1-B','W2-A','W2-B',
  'W3-A','W3-B','W4-A','W4-B',
  'W5-A','W5-B','W6-A','W6-B'
];

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
  nextId: 5,
  templates: {
    'A-Upper': [
      { exId: 1, reps: 5, rpe: 8.5, sets: 4 },
      { exId: 3, reps: 6, rpe: 8.0, sets: 3 }
    ],
    'A-Lower': [
      { exId: 2, reps: 5, rpe: 8.5, sets: 4 },
      { exId: 4, reps: 6, rpe: 8.0, sets: 3 }
    ],
    'B-Upper': [
      { exId: 1, reps: 4, rpe: 8.0, sets: 3 },
      { exId: 3, reps: 5, rpe: 8.0, sets: 3 }
    ],
    'B-Lower': [
      { exId: 2, reps: 4, rpe: 8.0, sets: 3 },
      { exId: 4, reps: 5, rpe: 8.0, sets: 3 }
    ]
  },
  // RPE Schedule System
  rpeSchedule: {
    // Format: "week-section-bodypart": rpe
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
    // Format: "week-section-bodypart": percentage (0-1)
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

// Load or initialize state
let state = JSON.parse(localStorage.getItem(STORE_KEY)) || JSON.parse(JSON.stringify(DEFAULT_STATE));

// Ensure RPE schedule exists in loaded state (for backwards compatibility)
if (!state.rpeSchedule) {
  state.rpeSchedule = JSON.parse(JSON.stringify(DEFAULT_STATE.rpeSchedule));
}

// Ensure rep progression exists in loaded state (for backwards compatibility)
if (!state.repProgression) {
  state.repProgression = JSON.parse(JSON.stringify(DEFAULT_STATE.repProgression));
}

// Ensure exercise rep ranges exist (for backwards compatibility)
if (!state.exerciseRepRanges) {
  state.exerciseRepRanges = {};
}

/* ---------- Utility Functions ---------- */
function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
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
