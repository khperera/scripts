/* ---------- Progression Tab ---------- */
let rpeChartInstance  = null;
let repChartInstance  = null;
let loadChartInstance = null;
const progressionVisibility = {};
BODY_PARTS.forEach(bp => { progressionVisibility[bp] = true; });

/**
 * Felt load: actual load / 1RM.
 * rep% maps to prescribed reps (3–12 range), then Brzycki gives W/1RM directly.
 * RIR is not included — it represents unused capacity, not load on the bar.
 */
function computeLoadFactor(rpe, repPct) {
  const reps = repPct * 9 + 3;
  const raw = 1.0278 - 0.0278 * reps;
  return Math.min(1, Math.max(0, raw));
}

function buildProgressionDatasets(type) {
  return BODY_PARTS.map(bp => {
    const color = PROGRESSION_COLORS[bp];
    const data = [];
    for (let week = 1; week <= 6; week++) {
      for (const section of ['A', 'B']) {
        const rpe    = getRPEForExercise(week, section, bp);
        const repPct = getRepPercentageForExercise(week, section, bp);
        let value;
        if (type === 'rpe')       value = rpe;
        else if (type === 'rep')  value = repPct;
        else                      value = computeLoadFactor(rpe, repPct);
        data.push(parseFloat(value.toFixed(3)));
      }
    }
    return {
      label: bp,
      data,
      borderColor: color,
      backgroundColor: color + '22',
      pointBackgroundColor: color,
      pointRadius: 4,
      pointHoverRadius: 7,
      tension: 0.3,
      fill: false,
      hidden: !progressionVisibility[bp],
    };
  });
}

function progressionChartOptions(yLabel, yMin, yMax, fmtFn) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: fmtFn || (c => `${c.dataset.label}: ${c.parsed.y}`) } }
    },
    scales: {
      x: { ticks: { color: '#8b95a7', font: { size: 11 } }, grid: { color: '#1e2230' } },
      y: {
        min: yMin, max: yMax,
        ticks: { color: '#8b95a7', font: { size: 11 } },
        grid:  { color: '#1e2230' },
        title: { display: true, text: yLabel, color: '#8b95a7', font: { size: 11 } }
      }
    }
  };
}

function destroyProgressionCharts() {
  if (rpeChartInstance)  { rpeChartInstance.destroy();  rpeChartInstance  = null; }
  if (repChartInstance)  { repChartInstance.destroy();  repChartInstance  = null; }
  if (loadChartInstance) { loadChartInstance.destroy(); loadChartInstance = null; }
}

function initProgressionCharts() {
  destroyProgressionCharts();

  const rpeOpts = progressionChartOptions('RPE', 5, 10, c => `${c.dataset.label}: ${c.parsed.y.toFixed(1)}`);
  rpeOpts.plugins.dragData = {
    round: 1,
    showTooltip: true,
    dragX: false,
    onDragStart: (e, datasetIndex) => {
      const bp = BODY_PARTS[datasetIndex];
      return bp && progressionVisibility[bp] ? undefined : false;
    },
    onDrag: (e, datasetIndex, index, value) => Math.min(10, Math.max(5, value)),
    onDragEnd: (e, datasetIndex, index, value) => handleProgressionDrag('rpe', datasetIndex, index, value),
  };
  rpeChartInstance = new Chart($('#rpeChart').getContext('2d'), {
    type: 'line',
    data: { labels: PROG_X_LABELS, datasets: buildProgressionDatasets('rpe') },
    options: rpeOpts,
  });

  const repOpts = progressionChartOptions('Rep %', 0, 1, c => `${c.dataset.label}: ${(c.parsed.y * 100).toFixed(0)}%`);
  repOpts.plugins.dragData = {
    round: 2,
    showTooltip: true,
    dragX: false,
    onDragStart: (e, datasetIndex) => {
      const bp = BODY_PARTS[datasetIndex];
      return bp && progressionVisibility[bp] ? undefined : false;
    },
    onDrag: (e, datasetIndex, index, value) => Math.min(1, Math.max(0, value)),
    onDragEnd: (e, datasetIndex, index, value) => handleProgressionDrag('rep', datasetIndex, index, value),
  };
  repChartInstance = new Chart($('#repChart').getContext('2d'), {
    type: 'line',
    data: { labels: PROG_X_LABELS, datasets: buildProgressionDatasets('rep') },
    options: repOpts,
  });

  loadChartInstance = new Chart($('#loadChart').getContext('2d'), {
    type: 'line',
    data: { labels: PROG_X_LABELS, datasets: buildProgressionDatasets('load') },
    options: progressionChartOptions('Felt Load %1RM', 0.5, 1.0, c => `${c.dataset.label}: ${(c.parsed.y * 100).toFixed(1)}%`),
  });
}

function updateProgressionCharts() {
  if (!rpeChartInstance) return;
  const types = ['rpe', 'rep', 'load'];
  const instances = [rpeChartInstance, repChartInstance, loadChartInstance];
  types.forEach((type, ci) => {
    const datasets = buildProgressionDatasets(type);
    instances[ci].data.datasets.forEach((ds, i) => {
      ds.data   = datasets[i].data;
      ds.hidden = !progressionVisibility[datasets[i].label];
    });
    instances[ci].update('none');
  });
}

function handleProgressionDrag(type, datasetIndex, dataIndex, value) {
  const bp = BODY_PARTS[datasetIndex];
  if (!bp) return;
  const week    = Math.floor(dataIndex / 2) + 1;
  const section = dataIndex % 2 === 0 ? 'A' : 'B';

  if (type === 'rpe') {
    const snapped = Math.round(Math.min(10, Math.max(5, value)) * 2) / 2;
    const def = state.rpeSchedule.defaults[bp] || 8.0;
    if (snapped === def) removeRPEOverride(week, section, bp);
    else setRPEOverride(week, section, bp, snapped);
  } else {
    const snapped = Math.round(Math.min(1, Math.max(0, value)) * 20) / 20;
    const def = state.repProgression.defaults[bp] || 0.5;
    if (snapped === def) removeRepPercentageOverride(week, section, bp);
    else setRepPercentageOverride(week, section, bp, snapped);
  }

  // Sync the number input in the table cell
  const cell = document.querySelector(`.prog-cell[data-week="${week}"][data-section="${section}"][data-bp="${bp}"][data-type="${type}"]`);
  if (cell) {
    const numInput = cell.querySelector('.prog-num');
    if (numInput) {
      numInput.value = type === 'rpe'
        ? getRPEForExercise(week, section, bp)
        : getRepPercentageForExercise(week, section, bp);
    }
    const key = `${week}-${section}-${bp}`;
    const isOvr = type === 'rpe'
      ? state.rpeSchedule.overrides[key] !== undefined
      : state.repProgression.overrides[key] !== undefined;
    cell.classList.toggle('is-override', isOvr);
  }

  // Rebuild all charts from state (corrects snapping and updates load chart)
  updateProgressionCharts();
  if (!$('#page-today').hidden) renderToday();
}

function renderProgressionToggles() {
  const container = $('#progressionToggles');
  container.innerHTML = '';
  BODY_PARTS.forEach(bp => {
    const color   = PROGRESSION_COLORS[bp];
    const isActive = progressionVisibility[bp];
    const btn = document.createElement('button');
    btn.className   = 'bp-toggle' + (isActive ? ' active' : '');
    btn.textContent = bp;
    btn.style.borderColor  = color;
    btn.style.background   = isActive ? color : 'transparent';
    btn.onclick = () => {
      progressionVisibility[bp] = !progressionVisibility[bp];
      renderProgressionToggles();
      // Update chart dataset visibility in-place
      [rpeChartInstance, repChartInstance, loadChartInstance].forEach(chart => {
        if (!chart) return;
        const ds = chart.data.datasets.find(d => d.label === bp);
        if (ds) ds.hidden = !progressionVisibility[bp];
        chart.update('none');
      });
      // Toggle table row visibility
      document.querySelectorAll(`tr.prog-row-rpe[data-bp="${bp}"], tr.prog-row-rep[data-bp="${bp}"]`)
        .forEach(row => { row.style.display = progressionVisibility[bp] ? '' : 'none'; });
    };
    container.appendChild(btn);
  });
}

function renderProgressionTable() {
  const tbody = document.querySelector('#progressionTable tbody');
  tbody.innerHTML = '';
  BODY_PARTS.forEach(bp => {
    const color = PROGRESSION_COLORS[bp];
    // RPE row
    const rpeRow = document.createElement('tr');
    rpeRow.className = 'prog-row-rpe';
    rpeRow.dataset.bp = bp;
    if (!progressionVisibility[bp]) rpeRow.style.display = 'none';
    const labelCell = document.createElement('td');
    labelCell.className = 'prog-bp-label';
    labelCell.rowSpan = 2;
    labelCell.innerHTML = `<strong style="color:${color};">${bp}</strong><div class="tiny" style="margin-top:3px;color:#71a8ff;">RPE ↑</div><div class="tiny" style="color:#37d67a;">Rep% ↓</div>`;
    rpeRow.appendChild(labelCell);
    for (let week = 1; week <= 6; week++) {
      for (const section of ['A', 'B']) {
        const val  = getRPEForExercise(week, section, bp);
        const isOvr = state.rpeSchedule.overrides[`${week}-${section}-${bp}`] !== undefined;
        const td = document.createElement('td');
        td.className = 'prog-cell' + (isOvr ? ' is-override' : '');
        td.dataset.week = week; td.dataset.section = section; td.dataset.bp = bp; td.dataset.type = 'rpe';
        td.innerHTML = `<input type="number" class="prog-num" min="5" max="10" step="0.5" value="${val}">`;
        rpeRow.appendChild(td);
      }
    }
    tbody.appendChild(rpeRow);
    // Rep% row
    const repRow = document.createElement('tr');
    repRow.className = 'prog-row-rep';
    repRow.dataset.bp = bp;
    if (!progressionVisibility[bp]) repRow.style.display = 'none';
    for (let week = 1; week <= 6; week++) {
      for (const section of ['A', 'B']) {
        const val  = getRepPercentageForExercise(week, section, bp);
        const isOvr = state.repProgression.overrides[`${week}-${section}-${bp}`] !== undefined;
        const td = document.createElement('td');
        td.className = 'prog-cell' + (isOvr ? ' is-override' : '');
        td.dataset.week = week; td.dataset.section = section; td.dataset.bp = bp; td.dataset.type = 'rep';
        td.innerHTML = `<input type="number" class="prog-num" min="0" max="1" step="0.05" value="${val}">`;
        repRow.appendChild(td);
      }
    }
    tbody.appendChild(repRow);
    // Separator
    const sep = document.createElement('tr');
    sep.className = 'prog-separator';
    sep.innerHTML = '<td colspan="13"></td>';
    tbody.appendChild(sep);
  });
  attachProgressionTableListeners();
}

function attachProgressionTableListeners() {
  const tbody = document.querySelector('#progressionTable tbody');
  // Clone to remove existing listeners
  const fresh = tbody.cloneNode(true);
  tbody.parentNode.replaceChild(fresh, tbody);
  fresh.addEventListener('input', e => {
    const target = e.target;
    if (!target.classList.contains('prog-num')) return;
    const cell = target.closest('.prog-cell');
    if (!cell) return;
    const week    = parseInt(cell.dataset.week);
    const section = cell.dataset.section;
    const bp      = cell.dataset.bp;
    const type    = cell.dataset.type;
    const value   = parseFloat(target.value);
    if (type === 'rpe') {
      const def = state.rpeSchedule.defaults[bp] || 8.0;
      if (value === def) removeRPEOverride(week, section, bp);
      else setRPEOverride(week, section, bp, value);
      cell.classList.toggle('is-override', state.rpeSchedule.overrides[`${week}-${section}-${bp}`] !== undefined);
    } else {
      const def = state.repProgression.defaults[bp] || 0.5;
      if (value === def) removeRepPercentageOverride(week, section, bp);
      else setRepPercentageOverride(week, section, bp, value);
      cell.classList.toggle('is-override', state.repProgression.overrides[`${week}-${section}-${bp}`] !== undefined);
    }
    updateProgressionCharts();
    if (!$('#page-today').hidden) renderToday();
  });
}

function renderProgression() {
  const isFirst = (rpeChartInstance === null);
  renderProgressionToggles();
  renderProgressionTable();
  if (isFirst) {
    requestAnimationFrame(() => initProgressionCharts());
  } else {
    updateProgressionCharts();
  }
}

function resetRepProgressionSilent() {
  state.repProgression = JSON.parse(JSON.stringify(DEFAULT_STATE.repProgression));
  persist();
}
