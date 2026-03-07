# CLAUDE.md — LiftTracker

## Project Overview

LiftTracker is a **single-file, vanilla HTML/CSS/JavaScript** weightlifting tracker that runs entirely in the browser. All state is stored in `localStorage`. There is no build step, no bundler, no backend, and no framework.

The entire application lives in `index.html` (~700+ lines). JSON files (`lifttracker-*.json`) are user data exports and are not source code.

---

## Repository Structure

```
scripts/
├── index.html              # Entire application (HTML + CSS + JS)
├── package.json            # Dev dependency: @playwright/test only
├── playwright.config.js    # Playwright config (Chromium, file:// base URL)
├── tests/
│   └── hamburger.spec.js   # Playwright E2E tests for hamburger menu
├── lifttracker-*.json      # User data exports (not source code)
└── .gitignore              # Ignores node_modules/, test-results/, playwright-report/
```

---

## Architecture

### Single-File SPA Pattern

`index.html` contains three sections in order:
1. `<style>` — All CSS with CSS custom properties (dark theme)
2. `<body>` — Static HTML: `<header>` with hamburger nav + `<main>` with page sections
3. `<script>` — All JavaScript (constants, state, utility functions, render functions, event listeners)

Navigation is tab-based. Each page is a `<section id="page-*">` element. Switching pages toggles the `hidden` attribute on sections.

### Page Sections

| Tab label    | Section ID             | data-page value  |
|-------------|------------------------|-----------------|
| Today       | `#page-today`          | `today`         |
| Templates   | `#page-templates`      | `templates`     |
| Exercises   | `#page-exercises`      | `exercises`     |
| History     | `#page-history`        | `history`       |
| Settings    | `#page-settings`       | `settings`      |
| Progression | `#page-progression`    | `progression`   |
| Analytics   | `#page-analytics`      | `analytics`     |

### Hamburger Menu

The hamburger button (`#hamburgerBtn`) toggles `#hamburgerMenu` via the `hidden` attribute and `aria-expanded`. Clicking outside the menu closes it. Icon switches between `☰` and `✕`.

---

## State Management

State is a plain JS object loaded from/saved to `localStorage` under the key `lifttracker_v1`.

```js
let state = JSON.parse(localStorage.getItem(STORE_KEY)) || JSON.parse(JSON.stringify(DEFAULT_STATE));
```

Call `persist()` after any state mutation — it serializes state back to localStorage.

### State Shape

```js
{
  unit: 'lb' | 'kg',
  settings: {
    upUpperStrong: 1.5,   // % TM increase (upper, strong week)
    upUpperSmall: 0.5,    // % TM increase (upper, solid week)
    downUpper: 2.5,       // % TM decrease (upper, struggle)
    upLowerStrong: 1.5,
    upLowerSmall: 1.0,
    downLower: 2.5,
    minJump: 2.5          // Minimum plate increment (lb or kg per side)
  },
  exercises: [
    { id: Number, name: String, cat: String, tm: Number }
  ],
  nextId: Number,          // Auto-increment ID for new exercises
  templates: {
    'A-Upper': [{ exId, reps, rpe, sets }],
    'A-Lower': [...],
    'B-Upper': [...],
    'B-Lower': [...]
  },
  rpeSchedule: {
    overrides: { 'week-section-bodypart': rpe },  // e.g. '1-A-CHEST': 8.5
    defaults: { CHEST: 8.5, BACK: 8.0, ... }
  },
  repProgression: {
    overrides: { 'week-section-bodypart': percentage },  // 0.0–1.0
    defaults: { CHEST: 0.5, BACK: 0.5, ... }
  },
  exerciseRepRanges: {
    [exerciseId]: { min: Number, max: Number }
  },
  log: [
    { exId, date, weight, reps, rpe, e1rm, targetRpe }
  ]
}
```

### Backwards Compatibility

When loading saved state, three fields are checked and initialized if missing: `rpeSchedule`, `repProgression`, `exerciseRepRanges`. Always add similar guards when introducing new top-level state fields.

---

## Training System Concepts

- **Training Max (TM)**: A per-exercise reference weight, typically ~90–95% of true 1RM. Prescriptions are derived from TM.
- **6-week block**: Weeks 1–5 are working weeks; Week 6 is a **deload** (87.5% load, minus 1 set).
- **4 sessions/week**: A-Upper, A-Lower, B-Upper, B-Lower.
- **RPE** (Rate of Perceived Exertion): 8.0–10.0 scale. At RPE 10 you have 0 reps in reserve (RIR = 0).
- **e1RM**: Estimated 1-rep max, calculated from logged weight/reps/RPE.
- **Body parts**: `CHEST`, `BACK`, `QUADS`, `HAMSTRINGS`, `SHOULDERS`, `ARMS`
- Upper body = CHEST, BACK, SHOULDERS, ARMS; Lower body = QUADS, HAMSTRINGS.

### Schedule Key Format

RPE and rep progression overrides use the key pattern: `"${week}-${section}-${bodyPart}"`
- Example: `"3-A-CHEST"` = Week 3, A session, chest exercises

---

## Key Functions

### Calculations

| Function | Purpose |
|----------|---------|
| `calculateE1RM(weight, reps, rpe)` | Blended Epley+Wathan+Lombardi e1RM estimate with RIR adjustment |
| `prescribeLoad(tm, reps, rpe, unit, minJump)` | Inverse of e1RM formula → prescribed weight rounded to plates |
| `roundToPlates(target, unit, minJump)` | Rounds weight to nearest plate increment |
| `progressTrainingMax(exercise)` | Adjusts TM based on weekly performance score (+1/-1 per set vs target RPE) |
| `getBestRollingE1RM(exId, days)` | Best e1RM for an exercise over the past N days |
| `applyDeload(week, load, sets)` | Returns `[load * 0.875, sets - 1]` for week 6 |

### State Accessors

| Function | Purpose |
|----------|---------|
| `getRPEForExercise(week, section, bodyPart)` | Override → default lookup for RPE |
| `setRPEOverride(week, section, bodyPart, rpe)` | Set RPE override and persist |
| `getRepPercentageForExercise(week, section, bodyPart)` | Override → default lookup for rep % |
| `setRepPercentageOverride(week, section, bodyPart, pct)` | Set rep % override and persist |
| `calculateTargetReps(exId, week, section, bodyPart)` | Interpolates rep count from rep range + percentage |
| `persist()` | Saves state to localStorage |
| `$(selector)` | Shorthand for `document.querySelector` |

### RPE Preset Functions

`applyLinearProgression()`, `applyWaveProgression()`, `applyBlockProgression()`, `applyRandomProgression()` — all reset `rpeSchedule.overrides` and re-populate, then call `renderProgression()`.

### Rep Preset Functions

`applyLinearRepProgression()`, `applyWaveRepProgression()`, `applyBlockRepProgression()`, `applyRandomRepProgression()` — same pattern for `repProgression.overrides`.

---

## External Dependencies

Loaded from CDN at runtime (no local install):
- **Chart.js 4.4.1** — `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`
- **chartjs-plugin-dragdata 2.2.4** — `https://cdn.jsdelivr.net/npm/chartjs-plugin-dragdata@2.2.4/dist/chartjs-plugin-dragdata.min.js`

These enable the interactive RPE and Rep % charts in the Progression tab (drag points to edit values).

---

## Testing

### Running Tests

```bash
npm test
# Runs: PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright playwright test
```

Tests run in Chromium only, serially (`fullyParallel: false`), against a `file://` URL pointing to `index.html`.

### Test File

`tests/hamburger.spec.js` — covers:
- Menu starts hidden
- Hamburger open/close toggle
- Icon switches ☰ ↔ ✕
- Click-outside closes menu
- Each tab shows correct page section and marks tab as `.active`

### Writing New Tests

- Use `file://${path.resolve(__dirname, '../index.html')}` as the app URL
- Wait for specific selectors before interacting (`page.waitForSelector`)
- Page sections are identified by `#page-<tabname>` IDs
- Tabs are `.tab[data-page="<name>"]` elements
- Active tab has class `active`

---

## CSS Conventions

CSS custom properties defined in `:root`:
```css
--bg: #0f1115        /* Page background */
--card: #171a21      /* Card background */
--muted: #8b95a7     /* Muted/label text */
--text: #e7ecf3      /* Primary text */
--accent: #71a8ff    /* Blue accent */
--good: #37d67a      /* Green (success) */
--bad: #ff5f57       /* Red (warning/bad) */
```

Layout utilities: `.row` (flexbox), `.grid`, `.grid-2`, `.grid-3` (CSS grid, 2-col/3-col at 700px+), `.card` (rounded dark card), `.pill` (rounded border chip).

Progression-specific CSS lives in the `/* ===== PROGRESSION TAB ===== */` section.

---

## Data Export/Import

- **Export**: Serializes `state` to a timestamped `.json` file download
- **Import**: Reads a `.json` file and replaces `state`, then calls `persist()` and re-renders

The `lifttracker-*.json` files in the repo are real user data exports and should not be modified.

---

## Development Conventions

1. **No build step** — edit `index.html` directly; changes are immediately visible in the browser.
2. **State mutations must call `persist()`** — never modify `state` without persisting.
3. **Use `$(selector)` not `document.querySelector`** — the `$` alias is defined at the top of the script.
4. **Backwards compatibility guards** — when adding new top-level state fields, add initialization checks after the state load (see the `rpeSchedule`/`repProgression`/`exerciseRepRanges` pattern at lines 642–655).
5. **IDs are auto-incremented** — use `state.nextId++` when creating exercises; persist afterward.
6. **Week 6 is always a deload** — the `applyDeload()` function handles this automatically.
7. **Plate rounding** — always use `roundToPlates()` or `prescribeLoad()` when producing weights to display to the user.
8. **`isLowerBody(cat)`** — use this helper (not inline string comparison) to distinguish upper/lower body progression rates.
9. **No external state libraries** — keep all state in the single `state` object and localStorage.

---

## Branch Workflow

Development branches follow the pattern `claude/<description>-<id>`. Feature changes are submitted as pull requests against `main`/`master`. Commit messages are imperative, sentence-case.
