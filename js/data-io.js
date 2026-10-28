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
  const newCycleLength = Number($('#cycleLength').value);
  if (newCycleLength >= 2) {
    state.cycleLength = newCycleLength;
    $('#week').max = newCycleLength;
  }

  persist();
  alert('Settings saved!');
}

function closeWeek(message = 'Close this week and progress all Training Maxes? This cannot be undone.') {
  if (!confirm(message)) return false;
  state.exercises.forEach(exercise => {
    progressTrainingMax(exercise);
  });

  persist();
  saveLastSession();
  alert('Week closed! Training maxes updated.');
  renderExercises();
  renderToday();
  return true;
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

function buildExportPayload() {
  const payload = { ...state };
  if (typeof hevyMappingBackup === 'function') payload.hevyMappings = hevyMappingBackup();
  return payload;
}

async function exportData() {
  const dataStr = JSON.stringify(buildExportPayload(), null, 2);
  const filename = `lifttracker-${new Date().toISOString().split('T')[0]}.json`;
  const blob = new Blob([dataStr], { type: 'application/json' });

  // Android: use the system document picker so the user can save in Downloads
  // or another visible location. App-private Android/data storage is not used.
  if (window.Capacitor?.getPlatform?.() === 'android') {
    const exporter = window.Capacitor?.Plugins?.BackupExport;
    if (!exporter?.saveBackup) {
      alert('Export is unavailable in this app build. Update the app and try again.');
      return;
    }
    try {
      const result = await exporter.saveBackup({ filename, content: dataStr });
      if (result?.cancelled) return;
      alert(`Backup saved as ${filename}. Choose Downloads in the Android save dialog to keep it in your Downloads folder.`);
    } catch (e) {
      alert(`Export failed: ${e.message || 'Android could not save the backup.'}`);
    }
    return;
  }

  // Web Share API (Android share sheet, iOS share sheet).
  if (navigator.canShare) {
    const file = new File([blob], filename, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'LiftTracker Data' });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
  }

  // Desktop browsers: standard blob URL download.
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const originalState = JSON.parse(JSON.stringify(state));
  let stateReplaced = false;
  try {
    const text = await file.text();
    const importedData = JSON.parse(text);
    const includesHevyMappings = Object.prototype.hasOwnProperty.call(importedData || {}, 'hevyMappings');
    const hevyMappings = includesHevyMappings ? importedData.hevyMappings : null;
    if (includesHevyMappings && typeof hevyValidateMappingBackup !== 'function') {
      throw new Error('This app version cannot import the Hevy mappings in this file.');
    }
    if (importedData && typeof importedData === 'object') delete importedData.hevyMappings;

    // Validate imported data structure
    if (importedData && typeof importedData === 'object') {
      // Fully replace state with imported data (not a merge) so stale
      // properties like `days` don't linger when the imported file is
      // an older export that doesn't include them.
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, importedData);
      stateReplaced = true;

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
      if (!state.cycleLength) {
        state.cycleLength = 6;
      }

      // Validate mappings against the imported exercise/day IDs before writing
      // the new state. Older backups without this optional field keep existing
      // Hevy mappings unchanged.
      if (includesHevyMappings) hevyValidateMappingBackup(hevyMappings, state);

      persist();
      if (includesHevyMappings) hevyRestoreMappingBackup(hevyMappings);
      if (typeof hevyRequireMappingReview === 'function') hevyRequireMappingReview();

      // Re-render all views
      renderSettings();
      renderExercises();
      renderTemplates();
      updateDayDropdown();
      renderToday();
      renderHistory();
      if (!$('#page-progression').hidden) renderProgression();
      if (typeof renderHevy === 'function') renderHevy();
      if (typeof hevyRenderCurrentState === 'function') hevyRenderCurrentState();

      alert(includesHevyMappings
        ? 'Data and Hevy mappings imported. Reconnect to Hevy and review the routine setup before syncing.'
        : 'Data imported successfully! Existing Hevy mappings were kept; review setup again before syncing.');
    } else {
      throw new Error('Invalid file format');
    }
  } catch (error) {
    if (stateReplaced) {
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, originalState);
    }
    alert('Error importing file: ' + error.message);
  }

  // Clear file input
  event.target.value = '';
}

// Save the current session as one value so a week and its workout cannot drift
// apart if the page closes between two localStorage writes.
const SESSION_STORE_KEY = 'lifttracker_last_session';

function saveLastSession() {
  const week = Number($('#week').value);
  const dayValue = $('#day').value;
  const dayId = getDayIdFromDayValue(dayValue);
  if (!Number.isInteger(week) || !Number.isInteger(dayId)) return;

  const session = { week, dayId };
  localStorage.setItem(SESSION_STORE_KEY, JSON.stringify(session));
  // Keep the older keys populated for older app versions and existing data.
  localStorage.setItem('lifttracker_last_week', String(week));
  localStorage.setItem('lifttracker_last_day', dayValue);
}

// Restore a valid week/day pair, migrating the older split keys when needed.
function restoreLastSession() {
  const cycleLength = Math.max(2, Number(state.cycleLength) || 6);
  const fallbackDayId = state.days[0]?.id;
  let saved = null;

  try {
    const serialized = localStorage.getItem(SESSION_STORE_KEY);
    if (serialized) saved = JSON.parse(serialized);
  } catch (_) { /* Recover from a malformed session by using the legacy keys. */ }

  if (!saved) {
    const legacyWeek = Number(localStorage.getItem('lifttracker_last_week'));
    const legacyDay = localStorage.getItem('lifttracker_last_day');
    const legacyDayId = legacyDay ? getDayIdFromDayValue(legacyDay) : NaN;
    saved = { week: legacyWeek, dayId: legacyDayId };
  }

  const requestedWeek = Number(saved.week);
  const week = Number.isFinite(requestedWeek)
    ? Math.min(cycleLength, Math.max(1, Math.floor(requestedWeek)))
    : 1;
  const dayId = state.days.some(day => day.id === Number(saved.dayId))
    ? Number(saved.dayId)
    : fallbackDayId;

  $('#week').max = cycleLength;
  $('#week').value = week;
  updateDayDropdown();
  if (dayId !== undefined) $('#day').value = `${week}-${dayId}`;
  saveLastSession();
}
