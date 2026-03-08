/* ---------- Rep Progression Functions ---------- */
function getRepPercentageForExercise(week, section, bodyPart) {
  const key = `${week}-${section}-${bodyPart}`;

  // Check for specific override first
  if (state.repProgression.overrides[key] !== undefined) {
    return state.repProgression.overrides[key];
  }

  // Fall back to default for body part
  return state.repProgression.defaults[bodyPart] || 0.5;
}

function setRepPercentageOverride(week, section, bodyPart, percentage) {
  const key = `${week}-${section}-${bodyPart}`;
  state.repProgression.overrides[key] = percentage;
  persist();
}

function removeRepPercentageOverride(week, section, bodyPart) {
  const key = `${week}-${section}-${bodyPart}`;
  delete state.repProgression.overrides[key];
  persist();
}

function getExerciseRepRange(exerciseId) {
  return state.exerciseRepRanges[exerciseId] || { min: 3, max: 10 };
}

function setExerciseRepRange(exerciseId, minReps, maxReps) {
  state.exerciseRepRanges[exerciseId] = { min: minReps, max: maxReps };
  persist();
}

function calculateTargetReps(exerciseId, week, section, bodyPart) {
  const repRange = getExerciseRepRange(exerciseId);
  const percentage = getRepPercentageForExercise(week, section, bodyPart);
  return Math.round(percentage * (repRange.max - repRange.min) + repRange.min);
}

function resetRepProgression() {
  state.repProgression = JSON.parse(JSON.stringify(DEFAULT_STATE.repProgression));
  persist();
}

/* ---------- RPE Schedule Functions ---------- */
function getRPEForExercise(week, section, bodyPart) {
  const key = `${week}-${section}-${bodyPart}`;

  // Check for specific override first
  if (state.rpeSchedule.overrides[key] !== undefined) {
    return state.rpeSchedule.overrides[key];
  }

  // Fall back to default for body part
  return state.rpeSchedule.defaults[bodyPart] || 8.0;
}

function setRPEOverride(week, section, bodyPart, rpe) {
  const key = `${week}-${section}-${bodyPart}`;
  state.rpeSchedule.overrides[key] = rpe;
  persist();
}

function removeRPEOverride(week, section, bodyPart) {
  const key = `${week}-${section}-${bodyPart}`;
  delete state.rpeSchedule.overrides[key];
  persist();
}

function applyLinearProgression() {
  // Linear progression from week 1 to 6: 8.0 → 9.5
  state.rpeSchedule.overrides = {};

  for (let week = 1; week <= 6; week++) {
    for (const section of ['A', 'B']) {
      for (const bodyPart of BODY_PARTS) {
        const rpe = 8.0 + ((week - 1) * 0.3); // Increases by 0.3 each week
        setRPEOverride(week, section, bodyPart, Math.round(rpe * 2) / 2); // Round to nearest 0.5
      }
    }
  }
  renderProgression();
  alert('Applied Linear Progression (8.0 → 9.5)');
}

function applyWaveProgression() {
  // Wave progression: 8.0 → 9.0 → 8.5 → 9.5 → 8.0 → 9.0
  const waves = [8.0, 9.0, 8.5, 9.5, 8.0, 9.0];
  state.rpeSchedule.overrides = {};

  for (let week = 1; week <= 6; week++) {
    for (const section of ['A', 'B']) {
      for (const bodyPart of BODY_PARTS) {
        setRPEOverride(week, section, bodyPart, waves[week - 1]);
      }
    }
  }
  renderProgression();
  alert('Applied Wave Progression');
}


function applyRandomProgression() {
  state.rpeSchedule.overrides = {};

  for (let week = 1; week <= 6; week++) {
    for (const section of ['A', 'B']) {
      for (const bodyPart of BODY_PARTS) {
        let rpe = Math.round((Math.random() * 2 + 8) * 2) / 2;
        if (week === 6) rpe = 8.0; // deload week - keep it manageable
        setRPEOverride(week, section, bodyPart, rpe);
      }
    }
  }
  renderProgression();
  alert('Applied Random Progression');
}

function applyBlockProgression() {
  // Block progression: 2 weeks at each intensity
  const blocks = [8.0, 8.0, 8.5, 8.5, 9.0, 9.0];
  state.rpeSchedule.overrides = {};

  for (let week = 1; week <= 6; week++) {
    for (const section of ['A', 'B']) {
      for (const bodyPart of BODY_PARTS) {
        setRPEOverride(week, section, bodyPart, blocks[week - 1]);
      }
    }
  }
  renderProgression();
  alert('Applied Block Progression (2-week blocks)');
}

function resetRPESchedule() {
  state.rpeSchedule = JSON.parse(JSON.stringify(DEFAULT_STATE.rpeSchedule));
  persist();
}

function applyLinearRepProgression() {
  // Linear progression from week 1 to 6: 1.0 → 0.0 (high reps to low reps)
  state.repProgression.overrides = {};

  for (let week = 1; week <= 6; week++) {
    for (const section of ['A', 'B']) {
      for (const bodyPart of BODY_PARTS) {
        const percentage = 1.0 - ((week - 1) * 0.2); // Decreases by 0.2 each week
        setRepPercentageOverride(week, section, bodyPart, Math.max(0, Math.round(percentage * 10) / 10)); // Round to nearest 0.1
      }
    }
  }
  renderProgression();
  alert('Applied Linear Rep Progression (1.0 → 0.0)');
}

function applyWaveRepProgression() {
  // Wave progression: high → low → mid → lower → high → low
  const waves = [1.0, 0.2, 0.6, 0.1, 0.8, 0.3];
  state.repProgression.overrides = {};

  for (let week = 1; week <= 6; week++) {
    for (const section of ['A', 'B']) {
      for (const bodyPart of BODY_PARTS) {
        setRepPercentageOverride(week, section, bodyPart, waves[week - 1]);
      }
    }
  }
  renderProgression();
  alert('Applied Wave Rep Progression');
}

function applyBlockRepProgression() {
  // Block progression: 2 weeks at each rep range
  const blocks = [0.8, 0.8, 0.5, 0.5, 0.2, 0.2];
  state.repProgression.overrides = {};

  for (let week = 1; week <= 6; week++) {
    for (const section of ['A', 'B']) {
      for (const bodyPart of BODY_PARTS) {
        setRepPercentageOverride(week, section, bodyPart, blocks[week - 1]);
      }
    }
  }
  renderProgression();
  alert('Applied Block Rep Progression (2-week blocks)');
}


function applyRandomRepProgression() {
  state.repProgression.overrides = {};

  for (let week = 1; week <= 6; week++) {
    for (const section of ['A', 'B']) {
      for (const bodyPart of BODY_PARTS) {
        const rep = Math.round(Math.random() * 10) / 10;
        setRepPercentageOverride(week, section, bodyPart, rep);
      }
    }
  }
  renderProgression();
  alert('Applied Random Rep Progression');
}
