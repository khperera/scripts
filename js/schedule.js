/* ---------- Rep Progression Functions ---------- */
function getRepPercentageForExercise(week, dayId, bodyPart) {
  const key = `${week}-${dayId}-${bodyPart}`;

  // Check for specific override first
  if (state.repProgression.overrides[key] !== undefined) {
    return state.repProgression.overrides[key];
  }

  // Fall back to default for body part
  return state.repProgression.defaults[bodyPart] || 0.5;
}

function setRepPercentageOverride(week, dayId, bodyPart, percentage) {
  const key = `${week}-${dayId}-${bodyPart}`;
  state.repProgression.overrides[key] = percentage;
  persist();
}

function removeRepPercentageOverride(week, dayId, bodyPart) {
  const key = `${week}-${dayId}-${bodyPart}`;
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

function calculateTargetReps(exerciseId, week, dayId, bodyPart) {
  const repRange = getExerciseRepRange(exerciseId);
  const percentage = getRepPercentageForExercise(week, dayId, bodyPart);
  return Math.round(percentage * (repRange.max - repRange.min) + repRange.min);
}

function resetRepProgression() {
  state.repProgression = JSON.parse(JSON.stringify(DEFAULT_STATE.repProgression));
  persist();
}

/* ---------- RPE Schedule Functions ---------- */
function getRPEForExercise(week, dayId, bodyPart) {
  const key = `${week}-${dayId}-${bodyPart}`;

  // Check for specific override first
  if (state.rpeSchedule.overrides[key] !== undefined) {
    return state.rpeSchedule.overrides[key];
  }

  // Fall back to default for body part
  return state.rpeSchedule.defaults[bodyPart] || 8.0;
}

function setRPEOverride(week, dayId, bodyPart, rpe) {
  const key = `${week}-${dayId}-${bodyPart}`;
  state.rpeSchedule.overrides[key] = rpe;
  persist();
}

function removeRPEOverride(week, dayId, bodyPart) {
  const key = `${week}-${dayId}-${bodyPart}`;
  delete state.rpeSchedule.overrides[key];
  persist();
}

function applyLinearProgression() {
  // Linear progression from week 1 to last week: 8.0 → 9.5
  const cycleLength = state.cycleLength || 6;
  state.rpeSchedule.overrides = {};

  for (let week = 1; week <= cycleLength; week++) {
    for (const day of state.days) {
      for (const bodyPart of BODY_PARTS) {
        const t = cycleLength > 1 ? (week - 1) / (cycleLength - 1) : 0;
        const rpe = 8.0 + t * 1.5; // Scales 8.0 → 9.5 over the cycle
        setRPEOverride(week, day.id, bodyPart, Math.round(rpe * 2) / 2); // Round to nearest 0.5
      }
    }
  }
  renderProgression();
  alert('Applied Linear Progression (8.0 → 9.5)');
}

function applyWaveProgression() {
  // Wave progression cycling through [8.0, 9.0, 8.5, 9.5]
  const cycleLength = state.cycleLength || 6;
  const wavePattern = [8.0, 9.0, 8.5, 9.5];
  state.rpeSchedule.overrides = {};

  for (let week = 1; week <= cycleLength; week++) {
    for (const day of state.days) {
      for (const bodyPart of BODY_PARTS) {
        const rpe = wavePattern[(week - 1) % wavePattern.length];
        setRPEOverride(week, day.id, bodyPart, rpe);
      }
    }
  }
  renderProgression();
  alert('Applied Wave Progression');
}


function applyRandomProgression() {
  const cycleLength = state.cycleLength || 6;
  state.rpeSchedule.overrides = {};

  for (let week = 1; week <= cycleLength; week++) {
    for (const day of state.days) {
      for (const bodyPart of BODY_PARTS) {
        let rpe = Math.round((Math.random() * 2 + 8) * 2) / 2;
        if (week === cycleLength) rpe = 8.0; // deload week - keep it manageable
        setRPEOverride(week, day.id, bodyPart, rpe);
      }
    }
  }
  renderProgression();
  alert('Applied Random Progression');
}

function applyBlockProgression() {
  // Block progression: 3 intensity blocks distributed across the cycle
  const cycleLength = state.cycleLength || 6;
  const blockRPEs = [8.0, 8.5, 9.0];
  state.rpeSchedule.overrides = {};

  for (let week = 1; week <= cycleLength; week++) {
    for (const day of state.days) {
      for (const bodyPart of BODY_PARTS) {
        const blockIndex = Math.min(Math.floor((week - 1) * blockRPEs.length / cycleLength), blockRPEs.length - 1);
        setRPEOverride(week, day.id, bodyPart, blockRPEs[blockIndex]);
      }
    }
  }
  renderProgression();
  alert('Applied Block Progression (3-block)');
}

function resetRPESchedule() {
  state.rpeSchedule = JSON.parse(JSON.stringify(DEFAULT_STATE.rpeSchedule));
  persist();
}

function applyLinearRepProgression() {
  // Linear progression from week 1 to last week: 1.0 → 0.0 (high reps to low reps)
  const cycleLength = state.cycleLength || 6;
  state.repProgression.overrides = {};

  for (let week = 1; week <= cycleLength; week++) {
    for (const day of state.days) {
      for (const bodyPart of BODY_PARTS) {
        const t = cycleLength > 1 ? (week - 1) / (cycleLength - 1) : 0;
        const percentage = 1.0 - t; // Scales 1.0 → 0.0 over the cycle
        setRepPercentageOverride(week, day.id, bodyPart, Math.max(0, Math.round(percentage * 10) / 10));
      }
    }
  }
  renderProgression();
  alert('Applied Linear Rep Progression (1.0 → 0.0)');
}

function applyWaveRepProgression() {
  // Wave progression cycling through [1.0, 0.2, 0.6, 0.1]
  const cycleLength = state.cycleLength || 6;
  const wavePattern = [1.0, 0.2, 0.6, 0.1];
  state.repProgression.overrides = {};

  for (let week = 1; week <= cycleLength; week++) {
    for (const day of state.days) {
      for (const bodyPart of BODY_PARTS) {
        setRepPercentageOverride(week, day.id, bodyPart, wavePattern[(week - 1) % wavePattern.length]);
      }
    }
  }
  renderProgression();
  alert('Applied Wave Rep Progression');
}

function applyBlockRepProgression() {
  // Block progression: 3 rep blocks distributed across the cycle
  const cycleLength = state.cycleLength || 6;
  const blockPcts = [0.8, 0.5, 0.2];
  state.repProgression.overrides = {};

  for (let week = 1; week <= cycleLength; week++) {
    for (const day of state.days) {
      for (const bodyPart of BODY_PARTS) {
        const blockIndex = Math.min(Math.floor((week - 1) * blockPcts.length / cycleLength), blockPcts.length - 1);
        setRepPercentageOverride(week, day.id, bodyPart, blockPcts[blockIndex]);
      }
    }
  }
  renderProgression();
  alert('Applied Block Rep Progression (3-block)');
}


function applyRandomRepProgression() {
  const cycleLength = state.cycleLength || 6;
  state.repProgression.overrides = {};

  for (let week = 1; week <= cycleLength; week++) {
    for (const day of state.days) {
      for (const bodyPart of BODY_PARTS) {
        const rep = Math.round(Math.random() * 10) / 10;
        setRepPercentageOverride(week, day.id, bodyPart, rep);
      }
    }
  }
  renderProgression();
  alert('Applied Random Rep Progression');
}
