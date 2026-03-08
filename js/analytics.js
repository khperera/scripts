/* ---------- Analytics ---------- */
let e1rmChartInstance = null;
let categoryChartInstance = null;

function getDaysAgo(days) {
  return Date.now() - days * 86400000;
}

function getFilteredLog(daysBack) {
  const cutoff = getDaysAgo(daysBack);
  return state.log.filter(s => new Date(s.date).getTime() >= cutoff);
}

// For a single exercise: returns daily best e1RM, in raw units (lb/kg),
// plus the weight and reps from the set that produced that best e1RM.
function getDailyBestE1RM(exId, daysBack) {
  const cutoff = getDaysAgo(daysBack);
  const map = {}; // "YYYY-MM-DD" → { e1rm, weight, reps }
  for (const s of state.log) {
    if (s.exId !== exId) continue;
    if (new Date(s.date).getTime() < cutoff) continue;
    const day = s.date.slice(0, 10);
    if (!map[day] || s.e1rm > map[day].e1rm) {
      map[day] = { e1rm: s.e1rm, weight: s.weight, reps: s.reps };
    }
  }
  const sorted = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  return {
    labels:  sorted.map(e => e[0]),
    values:  sorted.map(e => e[1].e1rm),
    weights: sorted.map(e => e[1].weight),
    reps:    sorted.map(e => e[1].reps),
  };
}

// For a single exercise: returns daily % change relative to the FIRST logged value
// in the period.  First day = 0%, later days = (e1rm - baseline) / baseline * 100.
function getNormalizedExerciseTrend(exId, daysBack) {
  const { labels, values } = getDailyBestE1RM(exId, daysBack);
  if (values.length === 0) return { labels: [], values: [] };
  const baseline = values[0];
  return {
    labels,
    values: values.map(v => ((v - baseline) / baseline) * 100)
  };
}

// For a CATEGORY (multiple exercises): each exercise is independently normalized
// to its own first logged value in the period (% change from that baseline).
// Only dates where an exercise was actually performed appear — no carry-forward.
// The category average on each date is the mean of only the exercises logged that day.
function getNormalizedCategoryTrend(exIds, daysBack) {
  if (exIds.length === 0) return { labels: [], values: [], perExercise: [] };
  const cutoff = getDaysAgo(daysBack);

  // Step 1: build per-exercise daily-best e1RM maps (only actual training days)
  const exDailyMaps = {}; // exId → { date: bestE1rm }
  for (const s of state.log) {
    if (!exIds.includes(s.exId)) continue;
    if (new Date(s.date).getTime() < cutoff) continue;
    const day = s.date.slice(0, 10);
    if (!exDailyMaps[s.exId]) exDailyMaps[s.exId] = {};
    if (!exDailyMaps[s.exId][day] || s.e1rm > exDailyMaps[s.exId][day]) {
      exDailyMaps[s.exId][day] = s.e1rm;
    }
  }

  // Step 2: normalize each exercise to % change from its own first logged value
  const exNorm = {}; // exId → { date → pct }
  for (const [exId, dayMap] of Object.entries(exDailyMaps)) {
    const sorted = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0]));
    if (sorted.length === 0) continue;
    const baseline = sorted[0][1];
    exNorm[exId] = {};
    for (const [date, val] of sorted) {
      exNorm[exId][date] = ((val - baseline) / baseline) * 100;
    }
  }

  if (Object.keys(exNorm).length === 0) return { labels: [], values: [], perExercise: [] };

  // Step 3: collect all unique dates where ANY exercise was actually performed
  const allDates = [...new Set(
    Object.values(exNorm).flatMap(dateMap => Object.keys(dateMap))
  )].sort();

  // Step 4: on each date, average only exercises actually performed that day
  const rawAvg = allDates.map(date => {
    const pcts = Object.values(exNorm)
      .map(dateMap => dateMap[date])
      .filter(v => v !== undefined);
    return pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
  });

  // Step 4b: recency-weighted rolling average over last 5 non-null data points.
  // Weights [1,2,3,4,5] — most recent point gets 5x the weight of the oldest.
  const WINDOW = 5;
  const W = [1, 2, 3, 4, 5];
  const values = rawAvg.map((_, i) => {
    const window = [];
    for (let j = i; j >= 0 && window.length < WINDOW; j--) {
      if (rawAvg[j] !== null) window.unshift(rawAvg[j]);
    }
    if (window.length === 0) return null;
    const weights = W.slice(W.length - window.length);
    const wSum = weights.reduce((a, b) => a + b, 0);
    return window.reduce((acc, v, k) => acc + v * weights[k], 0) / wSum;
  });

  // Step 5: per-exercise sparse series — null on days not performed, spanGaps handled in chart
  const perExercise = Object.entries(exNorm).map(([exId, dateMap]) => {
    const ex = state.exercises.find(e => e.id === Number(exId));
    return {
      name: ex ? ex.name : `Ex ${exId}`,
      data: allDates.map(d => dateMap[d] !== undefined ? parseFloat(dateMap[d].toFixed(2)) : null)
    };
  });

  return { labels: allDates, values, perExercise };
}

// Per-exercise summary: start = first logged e1RM in period, end = last logged e1RM,
// pct = (end - start) / start * 100.  This is the canonical normalized % change.
function getExerciseSummary(daysBack) {
  const cutoff = getDaysAgo(daysBack);
  return state.exercises.map(ex => {
    const sets = state.log.filter(s => s.exId === ex.id && new Date(s.date).getTime() >= cutoff);
    if (sets.length === 0) return null;
    const sorted = [...sets].sort((a, b) => new Date(a.date) - new Date(b.date));
    // Daily best: first and last day's best e1RM
    const firstDay = sorted[0].date.slice(0, 10);
    const lastDay = sorted[sorted.length - 1].date.slice(0, 10);
    const firstDayBest = Math.max(...sorted.filter(s => s.date.slice(0, 10) === firstDay).map(s => s.e1rm));
    const lastDayBest  = Math.max(...sorted.filter(s => s.date.slice(0, 10) === lastDay).map(s => s.e1rm));
    const best = Math.max(...sets.map(s => s.e1rm));
    const pct = ((lastDayBest - firstDayBest) / firstDayBest) * 100;
    return { ex, sets: sets.length, best, first: firstDayBest, last: lastDayBest, pct };
  }).filter(Boolean);
}

// Category summary: average of each exercise's normalized % change within that category
function getCategorySummary(daysBack) {
  const summary = getExerciseSummary(daysBack);
  const catMap = {};
  for (const item of summary) {
    const cat = item.ex.cat;
    if (!catMap[cat]) catMap[cat] = [];
    catMap[cat].push(item.pct);
  }
  return Object.entries(catMap).map(([cat, pcts]) => ({
    cat,
    avgPct: pcts.reduce((a, b) => a + b, 0) / pcts.length,
    exerciseCount: pcts.length
  })).sort((a, b) => b.avgPct - a.avgPct);
}

function calcPctChange(arr) {
  if (arr.length < 2) return null;
  return arr[arr.length - 1] - arr[0]; // already in % since normalized
}

// Palette for multi-line category chart
const LINE_COLORS = ['#71a8ff','#37d67a','#ff9f43','#ff5f57','#a29bfe','#fd79a8','#00cec9','#fdcb6e'];

function populateAnalyticsFilter(forceRepopulate) {
  var view = $('#analyticsView').value;
  var sel = $('#analyticsFilter');
  var currentMode = sel.dataset.mode;

  // Only rebuild the list when the view type changes (or forced).
  // Rebuilding every render resets the selected value, causing the bug
  // where selecting any exercise always snaps back to the first one.
  if (!forceRepopulate && currentMode === view) return;
  sel.dataset.mode = view;

  var prevValue = sel.value;
  sel.innerHTML = '';

  if (view === 'exercise') {
    state.exercises.forEach(function(ex) {
      var o = document.createElement('option');
      o.value = ex.id;
      o.textContent = ex.name + ' (' + ex.cat + ')';
      sel.appendChild(o);
    });
  } else {
    var cats = [];
    state.exercises.forEach(function(e) {
      if (cats.indexOf(e.cat) === -1) cats.push(e.cat);
    });
    cats.forEach(function(bp) {
      var o = document.createElement('option');
      o.value = bp;
      o.textContent = bp;
      sel.appendChild(o);
    });
  }

  // Restore previous selection if it still exists in the rebuilt list
  var stillExists = false;
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === prevValue) { stillExists = true; break; }
  }
  if (stillExists) sel.value = prevValue;
}

function buildTrendline(values) {
  const n = values.length;
  if (n < 2) return values.slice();
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  values.forEach((v, i) => { num += (i - xMean) * (v - yMean); den += (i - xMean) ** 2; });
  const slope = den ? num / den : 0;
  const intercept = yMean - slope * xMean;
  return values.map((_, i) => parseFloat((intercept + slope * i).toFixed(3)));
}

function drawNoDataMessage(ctx, msg = 'Not enough data for this selection and period.') {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#8b95a7';
  ctx.font = '14px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(msg, ctx.canvas.width / 2, ctx.canvas.height / 2);
}

function renderAnalytics() {
  var sel = $('#analyticsFilter');
  populateAnalyticsFilter(!sel.dataset.mode); // force on first call, preserve selection after
  const view = $('#analyticsView').value;
  const period = Number($('#analyticsPeriod').value);
  const filterVal = $('#analyticsFilter').value;
  const periodLabel = period >= 9999 ? 'All Time' : `${period}d`;

  if (e1rmChartInstance) { e1rmChartInstance.destroy(); e1rmChartInstance = null; }
  if (categoryChartInstance) { categoryChartInstance.destroy(); categoryChartInstance = null; }

  const mainCtx = $('#e1rmChart').getContext('2d');
  const catCtx  = $('#categoryChart').getContext('2d');

  /* ── EXERCISE VIEW ── */
  if (view === 'exercise') {
    const exId = Number(filterVal);
    const ex = state.exercises.find(e => e.id === exId);
    const label = ex ? ex.name : 'Exercise';
    $('#analyticsChartTitle').textContent = `e1RM Over Time — ${label}`;

    // Plot raw estimated 1RM on Y-axis, plus actual weight and reps
    const { labels, values: rawValues, weights, reps } = getDailyBestE1RM(exId, period);
    // % change computed from first→last for the stat card only
    const baseline = rawValues[0] || 0;
    const totalPct = rawValues.length >= 2
      ? ((rawValues[rawValues.length - 1] - baseline) / baseline) * 100
      : null;

    if (labels.length < 2) {
      drawNoDataMessage(mainCtx);
    } else {
      const trendData = buildTrendline(rawValues);
      e1rmChartInstance = new Chart(mainCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: `Estimated 1RM (${state.unit})`,
              data: rawValues.map(v => parseFloat(v.toFixed(1))),
              borderColor: '#71a8ff',
              backgroundColor: 'rgba(113,168,255,0.10)',
              pointRadius: 4,
              pointHoverRadius: 6,
              tension: 0.3,
              fill: true,
            },
            {
              label: `Weight Lifted (${state.unit})`,
              data: weights.map(v => parseFloat(v.toFixed(1))),
              borderColor: '#ff9f43',
              backgroundColor: 'rgba(255,159,67,0.08)',
              borderDash: [4, 2],
              pointRadius: 4,
              pointHoverRadius: 6,
              tension: 0.3,
              fill: false,
            },
            {
              label: 'Trend',
              data: trendData,
              borderColor: '#37d67a',
              borderDash: [6, 3],
              pointRadius: 0,
              tension: 0,
              fill: false,
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { labels: { color: '#e7ecf3' } },
            tooltip: {
              callbacks: {
                label: c => {
                  if (c.datasetIndex === 0) {
                    const pct = baseline > 0 ? ((c.parsed.y - baseline) / baseline) * 100 : null;
                    const pctStr = pct !== null ? `  (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs start)` : '';
                    return `e1RM: ${c.parsed.y.toFixed(1)} ${state.unit}${pctStr}`;
                  }
                  if (c.datasetIndex === 1) {
                    return `Lifted: ${c.parsed.y.toFixed(1)} ${state.unit} × ${reps[c.dataIndex]} reps`;
                  }
                  return `Trend: ${c.parsed.y.toFixed(1)} ${state.unit}`;
                }
              }
            }
          },
          scales: {
            x: { ticks: { color: '#8b95a7', maxTicksLimit: 10 }, grid: { color: '#1e2230' } },
            y: {
              ticks: { color: '#8b95a7', callback: v => v + ' ' + state.unit },
              grid: { color: '#1e2230' },
              title: { display: true, text: `Weight (${state.unit})`, color: '#8b95a7' }
            }
          }
        }
      });
    }

    // Stat cards for single exercise
    const setsInPeriod = getFilteredLog(period).filter(s => s.exId === exId).length;
    const bestRaw = rawValues.length ? Math.max(...rawValues) : null;

    $('#analyticsStatCards').innerHTML = `
      <div class="card" style="text-align:center;overflow:hidden;">
        <div class="tiny" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Best e1RM (${periodLabel})</div>
        <div style="font-size:clamp(16px,4vw,28px);font-weight:700;color:var(--accent);overflow:hidden;word-break:break-word;">${bestRaw ? bestRaw.toFixed(1) : '—'} <span style="font-size:14px;">${state.unit}</span></div>
      </div>
      <div class="card" style="text-align:center;overflow:hidden;">
        <div class="tiny" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">% Change (${periodLabel})</div>
        <div style="font-size:clamp(16px,4vw,28px);font-weight:700;color:${totalPct === null ? 'var(--muted)' : totalPct >= 0 ? 'var(--good)' : 'var(--bad)'};overflow:hidden;word-break:break-word;">
          ${totalPct === null ? '—' : (totalPct >= 0 ? '+' : '') + totalPct.toFixed(1) + '%'}
        </div>
      </div>
      <div class="card" style="text-align:center;overflow:hidden;">
        <div class="tiny" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Sets Logged (${periodLabel})</div>
        <div style="font-size:clamp(16px,4vw,28px);font-weight:700;color:var(--text);overflow:hidden;word-break:break-word;">${setsInPeriod}</div>
      </div>
    `;

  /* ── CATEGORY VIEW ── */
  } else {
    const cat = filterVal;
    const exIds = state.exercises.filter(e => e.cat === cat).map(e => e.id);
    $('#analyticsChartTitle').textContent = `Normalized % Change — ${cat} (avg of exercises)`;

    const { labels, values: avgPctValues, perExercise } = getNormalizedCategoryTrend(exIds, period);

    if (labels.length < 2) {
      drawNoDataMessage(mainCtx);
    } else {
      const trendData = buildTrendline(avgPctValues);

      // Build datasets: one thin line per exercise + thick average line + trend
      const exDatasets = perExercise.map((ex, i) => ({
        label: ex.name,
        data: ex.data,
        borderColor: LINE_COLORS[i % LINE_COLORS.length],
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.3,
        fill: false,
        spanGaps: true,
      }));

      e1rmChartInstance = new Chart(mainCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            ...exDatasets,
            {
              label: `${cat} Avg (weighted)`,
              data: avgPctValues.map(v => v !== null ? parseFloat(v.toFixed(2)) : null),
              borderColor: '#ffffff',
              backgroundColor: 'rgba(255,255,255,0.06)',
              borderWidth: 3,
              pointRadius: 3,
              tension: 0.3,
              fill: true,
              spanGaps: true,
            },
            {
              label: 'Trend',
              data: trendData,
              borderColor: '#37d67a',
              borderDash: [6, 3],
              borderWidth: 2,
              pointRadius: 0,
              tension: 0,
              fill: false,
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { labels: { color: '#e7ecf3', boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: c => `${c.dataset.label}: ${c.parsed.y !== null ? (c.parsed.y >= 0 ? '+' : '') + c.parsed.y.toFixed(2) + '%' : '—'}`
              }
            }
          },
          scales: {
            x: { ticks: { color: '#8b95a7', maxTicksLimit: 10 }, grid: { color: '#1e2230' } },
            y: {
              ticks: { color: '#8b95a7', callback: v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%' },
              grid: { color: '#1e2230' },
              title: { display: true, text: '% Change from Period Start', color: '#8b95a7' }
            }
          }
        }
      });
    }

    // Stat cards for category
    const catExSummary = getExerciseSummary(period).filter(s => s.ex.cat === cat);
    const avgPct = catExSummary.length
      ? catExSummary.reduce((a, b) => a + b.pct, 0) / catExSummary.length
      : null;
    const totalSets = catExSummary.reduce((a, b) => a + b.sets, 0);

    $('#analyticsStatCards').innerHTML = `
      <div class="card" style="text-align:center;overflow:hidden;">
        <div class="tiny" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Exercises Tracked</div>
        <div style="font-size:clamp(16px,4vw,28px);font-weight:700;color:var(--accent);overflow:hidden;word-break:break-word;">${catExSummary.length}</div>
      </div>
      <div class="card" style="text-align:center;overflow:hidden;">
        <div class="tiny" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Avg % Change (${periodLabel})</div>
        <div style="font-size:clamp(16px,4vw,28px);font-weight:700;color:${avgPct === null ? 'var(--muted)' : avgPct >= 0 ? 'var(--good)' : 'var(--bad)'};overflow:hidden;word-break:break-word;">
          ${avgPct === null ? '—' : (avgPct >= 0 ? '+' : '') + avgPct.toFixed(1) + '%'}
        </div>
      </div>
      <div class="card" style="text-align:center;overflow:hidden;">
        <div class="tiny" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Total Sets (${periodLabel})</div>
        <div style="font-size:clamp(16px,4vw,28px);font-weight:700;color:var(--text);overflow:hidden;word-break:break-word;">${totalSets}</div>
      </div>
    `;
  }

  /* ── CATEGORY BAR CHART (always shown, all categories) ── */
  const catSummary = getCategorySummary(period);
  if (catSummary.length > 0) {
    categoryChartInstance = new Chart(catCtx, {
      type: 'bar',
      data: {
        labels: catSummary.map(c => `${c.cat} (${c.exerciseCount}ex)`),
        datasets: [{
          label: `Avg Normalized % Change (${periodLabel})`,
          data: catSummary.map(c => parseFloat(c.avgPct.toFixed(2))),
          backgroundColor: catSummary.map(c => c.avgPct >= 0 ? 'rgba(55,214,122,0.7)' : 'rgba(255,95,87,0.7)'),
          borderColor: catSummary.map(c => c.avgPct >= 0 ? '#37d67a' : '#ff5f57'),
          borderWidth: 1,
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#e7ecf3' } },
          tooltip: { callbacks: { label: c => `${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y.toFixed(2)}% avg` } }
        },
        scales: {
          x: { ticks: { color: '#8b95a7' }, grid: { color: '#1e2230' } },
          y: {
            ticks: { color: '#8b95a7', callback: v => v + '%' },
            grid: { color: '#1e2230' },
            title: { display: true, text: 'Avg % Change from Period Start', color: '#8b95a7' }
          }
        }
      }
    });
  } else {
    drawNoDataMessage(catCtx, 'No category data for selected period.');
  }

  /* ── SUMMARY TABLE (all exercises with data) ── */
  const summary = getExerciseSummary(period);
  const tbody = $('#analyticsTable tbody');
  tbody.innerHTML = '';
  if (summary.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="tiny" style="text-align:center;">No data for selected period.</td></tr>';
  } else {
    summary.sort((a, b) => b.pct - a.pct).forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.ex.name}</td>
        <td>${item.ex.cat}</td>
        <td>${item.best.toFixed(1)} ${state.unit}</td>
        <td>${item.first.toFixed(1)} ${state.unit}</td>
        <td>${item.last.toFixed(1)} ${state.unit}</td>
        <td class="${item.pct >= 0 ? 'good' : 'bad'}">${item.pct >= 0 ? '+' : ''}${item.pct.toFixed(1)}%</td>
        <td>${item.sets}</td>
      `;
      tbody.appendChild(row);
    });
  }
}
