/* ---------- Day Management ---------- */
function updateDayDropdown() {
  const week = Number($('#week').value) || 1;
  const daySelect = $('#day');
  daySelect.innerHTML = '';

  const days = [
    { value: `${week}-A-upper`, label: `Week ${week} - A Upper` },
    { value: `${week}-A-lower`, label: `Week ${week} - A Lower` },
    { value: `${week}-B-upper`, label: `Week ${week} - B Upper` },
    { value: `${week}-B-lower`, label: `Week ${week} - B Lower` }
  ];

  days.forEach(day => {
    const option = document.createElement('option');
    option.value = day.value;
    option.textContent = day.label;
    daySelect.appendChild(option);
  });
}

function getTemplateKeyFromDayValue(dayValue) {
  const [week, part, split] = dayValue.split('-');
  return `${part}-${split.charAt(0).toUpperCase() + split.slice(1)}`;
}

function getCurrentDayIndex() {
  const week = Number($('#week').value);
  const dayValue = $('#day').value;
  const days = [`${week}-A-upper`, `${week}-A-lower`, `${week}-B-upper`, `${week}-B-lower`];
  return days.indexOf(dayValue);
}

function advanceDay() {
  let week = Number($('#week').value);
  let currentIndex = getCurrentDayIndex();

  if (currentIndex === 3) { // Last day (B Lower)
    week = week === 6 ? 1 : week + 1;
    $('#week').value = week;
    updateDayDropdown();
    $('#day').value = `${week}-A-upper`;
  } else {
    currentIndex++;
    const days = [`${week}-A-upper`, `${week}-A-lower`, `${week}-B-upper`, `${week}-B-lower`];
    $('#day').value = days[currentIndex];
  }

  renderToday();
}

/* ---------- Page Rendering Functions ---------- */
function renderToday() {
  $('#unit').value = state.unit;

  const week = Number($('#week').value) || 1;
  const dayValue = $('#day').value;
  const templateKey = getTemplateKeyFromDayValue(dayValue);
  const section = templateKey.split('-')[0]; // 'A' or 'B'

  $('#todayTitle').textContent = `Week ${week} - ${templateKey.replace('-', ' ')}`;

  const container = $('#todayList');
  container.innerHTML = '';

  const templateItems = state.templates[templateKey] || [];

  if (templateItems.length === 0) {
    container.innerHTML = '<div class="tiny">No exercises in this template yet.</div>';
    return;
  }

  templateItems.forEach(item => {
    const exercise = state.exercises.find(ex => ex.id === item.exId);
    if (!exercise) return;

    // Get RPE from schedule (overrides template RPE)
    const scheduledRPE = getRPEForExercise(week, section, exercise.cat);

    // Get target reps from rep progression
    const targetReps = calculateTargetReps(exercise.id, week, section, exercise.cat);

    let prescribedLoad = prescribeLoad(exercise.tm, targetReps, scheduledRPE, state.unit, state.settings.minJump);
    let prescribedSets = item.sets;

    let prescribedSets_myo = 13;
    let prescribedLoad_myo = prescribeLoad(exercise.tm, prescribedSets_myo, scheduledRPE, state.unit, state.settings.minJump);

    // Apply deload if week 6
    [prescribedLoad, prescribedSets] = applyDeload(week, prescribedLoad, prescribedSets);

    const exerciseCard = document.createElement('div');
    exerciseCard.className = 'card';
    exerciseCard.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: center;">
      <div>
        <div><strong>${exercise.name}</strong> <span class="pill">${exercise.cat}</span></div>
        <div class="tiny">TM ${fmt(exercise.tm)} ${state.unit} • Expected: <b>${fmt(prescribedLoad)}</b> × ${targetReps} × ${prescribedSets} @ RPE ${scheduledRPE}${scheduledRPE !== item.rpe ? "" : ''}${targetReps !== item.reps ? '' : ''}</div>
        <div class="tiny">Myorep load: <b>${fmt(prescribedLoad_myo)}</b> @ RPE ${scheduledRPE}</div>
      </div>
      <div class="row">
        <div><label>Weight</label><input type="number" step="0.5" value="${fmt(prescribedLoad)}" style="width: 110px;" class="weight-input"></div>
        <div><label>Reps</label><input type="number" value="${targetReps}" style="width: 80px;" class="reps-input"></div>
        <div><label>RPE</label><input type="number" step="0.5" value="${scheduledRPE}" style="width: 80px;" class="rpe-input"></div>
        <div><label>&nbsp;</label><button class="log-btn">Add Set</button></div>
      </div>
      </div>
      <div class="tiny feedback" style="margin-top: 6px;" hidden></div>
    `;

    // Add event listener for logging sets
    exerciseCard.querySelector('.log-btn').onclick = () => {
      const weight = Number(exerciseCard.querySelector('.weight-input').value);
      const reps = Number(exerciseCard.querySelector('.reps-input').value);
      const rpe = Number(exerciseCard.querySelector('.rpe-input').value);

      if (!weight || !reps || !rpe) return;

      const e1rm = calculateE1RM(weight, reps, rpe);

      // Log the set
      state.log.unshift({
        date: new Date().toISOString(),
        exId: exercise.id,
        weight: weight,
        reps: reps,
        rpe: rpe,
        e1rm: e1rm,
        week: week,
        day: templateKey,
        targetRpe: scheduledRPE // Store target for progression analysis
      });

      persist();

      // Calculate next set suggestion using scheduled RPE as target
      const adjustmentFactor = getNextSetAdjustment(scheduledRPE, rpe, reps, targetReps);
      const nextWeight = roundToPlates(weight * adjustmentFactor, state.unit, state.settings.minJump);

      // Show feedback
      const feedback = exerciseCard.querySelector('.feedback');
      feedback.hidden = false;
      feedback.innerHTML = `Logged! e1RM: <b>${e1rm.toFixed(1)}</b>. Next set suggestion: <b>${fmt(nextWeight)}</b> ${state.unit}`;

      // Update weight input for next set
      exerciseCard.querySelector('.weight-input').value = fmt(nextWeight);

      renderHistory();
    };

    container.appendChild(exerciseCard);
  });
}

function renderTemplates() {
  const templateKeys = ['A-Upper', 'A-Lower', 'B-Upper', 'B-Lower'];

  templateKeys.forEach(templateKey => {
    const containerId = `tmpl-${templateKey.toLowerCase().replace('-', '-')}`;
    const container = $(`#${containerId}`);
    if (!container) return;

    container.innerHTML = '';

    const templateItems = state.templates[templateKey] || [];

    templateItems.forEach((item, index) => {
      const exercise = state.exercises.find(ex => ex.id === item.exId);

      const row = document.createElement('div');
      row.className = 'row';
      row.style.marginBottom = '8px';
      row.innerHTML = `
        <div>
          <label>Exercise</label>
          <select class="exercise-select"></select>
        </div>
        <div><label>Reps</label><input class="reps-input" type="number" value="${item.reps}" style="width: 80px;"></div>
        <div><label>RPE</label><input class="rpe-input" type="number" step="0.5" value="${item.rpe}" style="width: 80px;"></div>
        <div><label>Sets</label><input class="sets-input" type="number" value="${item.sets}" style="width: 80px;"></div>
        <div><label>&nbsp;</label><button class="delete-btn">Delete</button></div>
      `;

      // Populate exercise dropdown
      const exerciseSelect = row.querySelector('.exercise-select');
      state.exercises.forEach(ex => {
        const option = document.createElement('option');
        option.value = ex.id;
        option.textContent = ex.name;
        if (ex.id === item.exId) option.selected = true;
        exerciseSelect.appendChild(option);
      });

      // Add event listeners
      exerciseSelect.onchange = () => {
        item.exId = Number(exerciseSelect.value);
        persist();
      };

      row.querySelector('.reps-input').onchange = (e) => {
        item.reps = Number(e.target.value);
        persist();
      };

      row.querySelector('.rpe-input').onchange = (e) => {
        item.rpe = Number(e.target.value);
        persist();
      };

      row.querySelector('.sets-input').onchange = (e) => {
        item.sets = Number(e.target.value);
        persist();
      };

      row.querySelector('.delete-btn').onclick = () => {
        templateItems.splice(index, 1);
        persist();
        renderTemplates();
      };

      container.appendChild(row);
    });
  });
}

function renderExercises() {
  const tbody = $('#exTable tbody');
  tbody.innerHTML = '';

  state.exercises.forEach(exercise => {
    const row = document.createElement('tr');
    const repRange = getExerciseRepRange(exercise.id);
    row.innerHTML = `
      <td>${exercise.name}</td>
      <td>${exercise.cat}</td>
      <td><input type="number" step="0.5" value="${exercise.tm}" style="width: 100px;"></td>
      <td>${repRange.min}-${repRange.max} reps</td>
      <td><button class="delete-btn">Delete</button></td>
    `;

    // Add event listeners
    row.querySelector('input').onchange = (e) => {
      exercise.tm = Number(e.target.value);
      persist();
    };

    row.querySelector('.delete-btn').onclick = () => {
      if (confirm('Delete exercise and remove from templates?')) {
        // Remove from templates
        Object.keys(state.templates).forEach(templateKey => {
          state.templates[templateKey] = state.templates[templateKey].filter(item => item.exId !== exercise.id);
        });

        // Remove exercise and rep ranges
        state.exercises = state.exercises.filter(ex => ex.id !== exercise.id);
        delete state.exerciseRepRanges[exercise.id];

        persist();
        renderExercises();
        renderTemplates();
        renderToday();
      }
    };

    tbody.appendChild(row);
  });
}

function renderHistory() {
  const tbody = $('#logTable tbody');
  tbody.innerHTML = '';

  // Show last 100 sets
  state.log.slice(0, 100).forEach((set, idx) => {
    const exercise = state.exercises.find(ex => ex.id === set.exId);
    const row = document.createElement('tr');
    const date = new Date(set.date);

    row.innerHTML = `
      <td>${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</td>
      <td>${exercise?.name || '?'}</td>
      <td>${fmt(set.weight)}×${set.reps}@${set.rpe}</td>
      <td>${set.e1rm.toFixed(1)}</td>
      <td><button class="del-set-btn tiny" style="padding:2px 8px; color:var(--bad); border-color:var(--bad);">✕</button></td>
    `;

    row.querySelector('.del-set-btn').onclick = () => {
      if (confirm('Delete this logged set?')) {
        state.log.splice(idx, 1);
        persist();
        renderHistory();
      }
    };

    tbody.appendChild(row);
  });
}

function renderSettings() {
  $('#unit').value = state.unit;
  $('#minJump').value = state.settings.minJump;
  $('#upUpperStrong').value = state.settings.upUpperStrong;
  $('#upUpperSmall').value = state.settings.upUpperSmall;
  $('#downUpper').value = state.settings.downUpper;
  $('#upLowerStrong').value = state.settings.upLowerStrong;
  $('#upLowerSmall').value = state.settings.upLowerSmall;
  $('#downLower').value = state.settings.downLower;
}

// Legacy stubs — these tables were merged into the Progression tab
function renderRepProgression() { if (!$('#page-progression').hidden) renderProgression(); }
function renderRepProgressionTable() {}
function renderRepOverrideTable() {}

function updateRepPercentageFromTable(week, section, bodyPart, value) {
  const percentage = Number(value);
  const defaultPercentage = state.repProgression.defaults[bodyPart] || 0.5;

  if (percentage === defaultPercentage) {
    // Remove override if setting back to default
    removeRepPercentageOverride(week, section, bodyPart);
  } else {
    // Set override
    setRepPercentageOverride(week, section, bodyPart, percentage);
  }

  if (!$('#page-progression').hidden) renderProgression();
  if (!$('#page-today').hidden) {
    renderToday();
  }
}

// Legacy stubs — these tables were merged into the Progression tab
function renderRPESchedule() { if (!$('#page-progression').hidden) renderProgression(); }
function renderRPEScheduleTable() {}
function renderRPEOverrideTable() {}

function updateRPEFromTable(week, section, bodyPart, value) {
  const rpe = Number(value);
  const defaultRPE = state.rpeSchedule.defaults[bodyPart] || 8.0;

  if (rpe === defaultRPE) {
    // Remove override if setting back to default
    removeRPEOverride(week, section, bodyPart);
  } else {
    // Set override
    setRPEOverride(week, section, bodyPart, rpe);
  }

  if (!$('#page-progression').hidden) renderProgression();
  if (!$('#page-today').hidden) renderToday();
}

/* ---------- Action Functions ---------- */
function addTemplateRow(templateKey) {
  if (!state.templates[templateKey]) {
    state.templates[templateKey] = [];
  }

  state.templates[templateKey].push({
    exId: state.exercises[0]?.id || 0,
    reps: 5,
    rpe: 8.5,
    sets: 3
  });

  persist();
  renderTemplates();
}

function addExercise() {
  const name = $('#exName').value.trim();
  if (!name) return;

  const category = $('#exCat').value;
  const trainingMax = Number($('#exTM').value) || 0;
  if (trainingMax <= 0) {
    alert('Training Max must be greater than 0');
    return;
  }
  const minReps = Number($('#exMinReps').value) || 3;
  const maxReps = Number($('#exMaxReps').value) || 10;

  if (minReps >= maxReps) {
    alert('Min reps must be less than max reps');
    return;
  }

  const exerciseId = state.nextId++;

  state.exercises.push({
    id: exerciseId,
    name: name,
    cat: category,
    tm: trainingMax
  });

  // Set rep range for this exercise
  setExerciseRepRange(exerciseId, minReps, maxReps);

  // Clear form
  $('#exName').value = '';
  $('#exTM').value = '';
  $('#exMinReps').value = '3';
  $('#exMaxReps').value = '10';

  persist();
  renderExercises();
  renderTemplates();
}

function addRPEOverride() { /* removed with old UI */ }
function addRepPercentageOverride() { /* removed with old UI */ }
