/* ---------- Tab Navigation ---------- */
function renderTabs() {
  const hamburgerBtn = $('#hamburgerBtn');
  const hamburgerMenu = $('#hamburgerMenu');

  // Toggle menu open/close
  hamburgerBtn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = !hamburgerMenu.hidden;
    hamburgerMenu.hidden = isOpen;
    hamburgerBtn.setAttribute('aria-expanded', String(!isOpen));
    hamburgerBtn.innerHTML = isOpen ? '&#9776;' : '&#10005;';
  };

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!hamburgerMenu.hidden && !hamburgerMenu.contains(e.target) && e.target !== hamburgerBtn) {
      hamburgerMenu.hidden = true;
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      hamburgerBtn.innerHTML = '&#9776;';
    }
  });

  document.querySelectorAll('.tab').forEach(button => {
    button.onclick = () => {
      // Update active tab
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      button.classList.add('active');

      // Close the menu
      hamburgerMenu.hidden = true;
      hamburgerBtn.setAttribute('aria-expanded', 'false');
      hamburgerBtn.innerHTML = '&#9776;';

      // Destroy progression charts when leaving that tab (canvas about to be hidden)
      if (!$('#page-progression').hidden) destroyProgressionCharts();

      // Show corresponding page
      const page = button.dataset.page;
      document.querySelectorAll('main section').forEach(section => section.hidden = true);
      $(`#page-${page}`).hidden = false;

      // Render page content
      switch (page) {
        case 'today': renderToday(); break;
        case 'templates': renderTemplates(); break;
        case 'exercises': renderExercises(); break;
        case 'history': renderHistory(); break;
        case 'settings': renderSettings(); break;
        case 'progression': renderProgression(); break;
        case 'analytics': renderAnalytics(); break;
      }
    };
  });
}

/* ---------- Event Listeners ---------- */
function setupEventListeners() {
  // Week and day changes
  $('#week').onchange = () => {
    updateDayDropdown();
    renderToday();
    saveLastSession();
  };

  $('#day').onchange = () => {
    renderToday();
    saveLastSession();
  };

  // Unit change
  $('#unit').onchange = () => {
    state.unit = $('#unit').value;
    persist();
    renderToday();
  };

  // Advance day button
  $('#advanceBtn').onclick = advanceDay;

  // Close week button
  $('#closeWeekBtn').onclick = closeWeek;

  // Reset templates button
  $('#resetBtn').onclick = resetTemplates;

  // Export button
  $('#exportBtn').onclick = exportData;

  // Import file input
  $('#importFile').onchange = importData;
}

/* ---------- Initialization ---------- */
function initialize() {
  // First, populate the day dropdown based on the week
  updateDayDropdown();
  // Then, restore last session values
  restoreLastSession();
  // Set up event listeners
  setupEventListeners();

  // Set up tab navigation
  renderTabs();

  // Initial render
  renderToday();
  renderTemplates();
  renderExercises();
  renderHistory();
  renderSettings();
  // Progression tab renders on demand (charts need visible canvas)
}

// Start the app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Bind analytics controls
  $('#analyticsView').onchange = () => { populateAnalyticsFilter(true); renderAnalytics(); };
  $('#analyticsPeriod').onchange = renderAnalytics;
  $('#analyticsFilter').onchange = renderAnalytics;

  // Set up tab/hamburger navigation immediately — does not depend on loaded state
  renderTabs();

  // Initialize SQLite, load (or migrate) state
  try {
    const { db, loadedState } = await initDatabase();
    window._liftDb = db;
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, loadedState);
  } catch (_) {
    // SQLite unavailable (e.g. WASM blocked in Capacitor WebView) — fall back to localStorage
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.keys(state).forEach(k => delete state[k]);
        Object.assign(state, parsed);
        migrateLegacyState(state);
        applyCompatGuards(state);
      } catch (_2) { /* keep DEFAULT_STATE */ }
    }
  }

  // Complete initialization now that state is ready
  updateDayDropdown();
  restoreLastSession();
  setupEventListeners();
  renderToday();
  renderTemplates();
  renderExercises();
  renderHistory();
  renderSettings();
  // Progression tab renders on demand (charts need visible canvas)
});
