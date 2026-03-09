/* ---------- Settings & Data I/O ---------- */
function saveSettings() {
  state.unit = $('#unit').value;
  state.settings.minJump = Number($('#minJump').value);
  state.settings.upUpperStrong = Number($('#upUpperStrong').value);
  state.settings.upUpperSmall = Number($('#upUpperSmall').value);
  state.settings.downUpper = Number($('#downUpper').value);
  state.settings.upLowerStrong = Number($('#upLowerStrong').value);
  state.settings.upLowerSmall = Number($('#upLowerSmall').value);
  state.settings.downLower = Number($('#downLower').value);

  persist();
  alert('Settings saved!');
}

function closeWeek() {
  if (!confirm('Close this week and progress all Training Maxes? This cannot be undone.')) return;
  state.exercises.forEach(exercise => {
    progressTrainingMax(exercise);
  });

  persist();
  alert('Week closed! Training maxes updated.');
  renderExercises();
  renderToday();
}

function resetTemplates() {
  if (confirm('Are you sure you want to reset all templates? This cannot be undone.')) {
    state.days = JSON.parse(JSON.stringify(DEFAULT_STATE.days));
    state.nextDayId = DEFAULT_STATE.nextDayId;
    state.templates = JSON.parse(JSON.stringify(DEFAULT_STATE.templates));
    persist();
    renderTemplates();
    updateDayDropdown();
    renderToday();
    alert('Templates reset to default!');
  }
}

function exportData() {
  const dataStr = JSON.stringify(state, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `lifttracker-${new Date().toISOString().split('T')[0]}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importedData = JSON.parse(text);

    // Validate imported data structure
    if (importedData && typeof importedData === 'object') {
      // Fully replace state with imported data (not a merge) so stale
      // properties like `days` don't linger when the imported file is
      // an older export that doesn't include them.
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, importedData);

      // Run migration if imported data is old format (no days array)
      if (!state.days) {
        migrateToCustomDays();
      }

      // Backwards-compat guards for fields added after the export was created
      if (!state.rpeSchedule) {
        state.rpeSchedule = JSON.parse(JSON.stringify(DEFAULT_STATE.rpeSchedule));
      }
      if (!state.repProgression) {
        state.repProgression = JSON.parse(JSON.stringify(DEFAULT_STATE.repProgression));
      }
      if (!state.exerciseRepRanges) {
        state.exerciseRepRanges = {};
      }
      if (state.nextDayId === undefined || state.nextDayId === null) {
        state.nextDayId = state.days ? state.days.length : 0;
      }

      persist();

      // Re-render all views
      renderSettings();
      renderExercises();
      renderTemplates();
      updateDayDropdown();
      renderToday();
      renderHistory();
      if (!$('#page-progression').hidden) renderProgression();

      alert('Data imported successfully!');
    } else {
      throw new Error('Invalid file format');
    }
  } catch (error) {
    alert('Error importing file: ' + error.message);
  }

  // Clear file input
  event.target.value = '';
}

// Save last selected week and day
function saveLastSession() {
  localStorage.setItem('lifttracker_last_week', $('#week').value);
  localStorage.setItem('lifttracker_last_day', $('#day').value);
}

// Restore last selected week and day
function restoreLastSession() {
  const lastWeek = localStorage.getItem('lifttracker_last_week');
  const lastDay = localStorage.getItem('lifttracker_last_day');
  if (lastWeek) $('#week').value = lastWeek;
  if (lastDay) {
    // Check if the saved day value exists in the current dropdown
    const daySelect = $('#day');
    const optionExists = Array.from(daySelect.options).some(opt => opt.value === lastDay);
    if (optionExists) {
      daySelect.value = lastDay;
    }
  }
}
