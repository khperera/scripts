# LiftTracker

A modular, **vanilla HTML/CSS/JavaScript** weightlifting tracker that runs entirely in the browser. No build step, no bundler, no backend, and no framework required.

LiftTracker workout data and Recovery Planner settings are stored separately in browser storage. Planner schedules persist in this browser, but they are not included in LiftTracker JSON export/import. The planner files are included in the production build.

## Features

- **6-week block periodization** with automatic deload weeks
- **RPE (Rate of Perceived Exertion) tracking** with body-part specific targets
- **Training Max progression** that automatically adjusts based on weekly performance
- **e1RM estimation** using blended formulas (Epley/Wathan/Lombardi)
- **Interactive charts** for RPE and rep progression with drag-to-edit
- **Multiple progression presets** (linear, wave, block, random)
- **Session logging** with weight, reps, and RPE
- **Exercise templates** for A/B upper/lower splits
- **Data export/import** to backup and restore your training data
- **Responsive design** with dark mode

## Quick Start

1. Open `index.html` in your browser
2. Add exercises with their training max (TM)
3. Select a session template (A-Upper, A-Lower, B-Upper, B-Lower)
4. Log your lifts with weight, reps, and RPE
5. View progression trends and analytics

## Hevy connection

In Android, open **Settings → Hevy sync**, paste your API key, and choose **Use key**. The key stays in app memory for the current session and must be entered again after restarting the app. Android calls Hevy directly using Capacitor native HTTP. In a regular browser, direct Hevy access depends on Hevy's CORS policy, so use the companion server below. The browser sends the key to the loopback companion, which keeps it in memory or reads `HEVY_API_KEY`. The key is never placed in LiftTracker state or exports.

Setup preselects the closest Hevy exercise-name match for each active LiftTracker exercise, prioritizing templates used in the user's routines. Review and edit each selection before saving; a suggestion alone does not count as confirmation. Then map each active training day to a distinct Hevy routine. Repeated exercises require selecting their specific routine occurrence. No routine is changed until all mappings are complete and the user reviews the full preview.

The first confirmed sync prepares every mapped routine for the selected week. Each mapped exercise receives the Today top-set prescription, followed by the remaining template set slots as five-rep mini sets at the 13-rep-derived load. Warmups, special sets, notes, rest times, supersets, and unrelated exercises are preserved. Automatic sync is opt-in, requires one successful initial sync, and runs while the app is open when the selected week or prescription changes. Conflicts stop a batch before any write. Hevy saves routines one at a time, so a connection failure during saving can leave some routines updated. Sync updates routines; it does not create completed workouts or launch Hevy.

Workout history import is manual. It computes the highest estimated 1RM for each exercise across the fetched workout history (up to 1,000 workouts per import), using LiftTracker's e1RM formula and the set's RPE or RPE 10 when missing. Imported records stay separate and do not change training maxes.

For browser use, start the companion and open `http://127.0.0.1:8787`:

```sh
python3 hevy-server.py
```

The key is forgotten when the companion exits or when you choose **Forget key**. Live Hevy API validation requires access to `api.hevyapp.com`.

## Project Structure

```
scripts/
├── index.html              # HTML entry point
├── planner.html            # 14-day concurrent training recovery planner
├── hevy-server.py          # Optional loopback companion; holds the API key in memory
├── css/
│   └── styles.css          # All styles
├── js/
│   ├── state.js            # State management & localStorage
│   ├── calculations.js     # Strength calculations (e1RM, TM progression, etc.)
│   ├── schedule.js         # RPE/rep presets and accessors
│   ├── data-io.js          # Import/export and session management
│   ├── pages.js            # Rendering for all pages
│   ├── progression.js      # Interactive progression charts
│   ├── analytics.js        # Trend analysis and summaries
│   ├── app.js              # App initialization and event listeners
│   └── hevy.js             # Hevy mapping, routine sync, and workout import
├── tests/
│   ├── hamburger.spec.js   # Playwright E2E tests
│   ├── hevy-client.test.cjs # Hevy mapping/sync/import tests
│   └── test_hevy_server.py # Companion server safety tests
└── package.json            # Dev dependency (Playwright)
```

## Pages

| Page | Purpose |
|------|---------|
| **Today** | Log today's session with prescribed loads based on TM and RPE |
| **Templates** | Create and manage workout templates |
| **Exercises** | Add/edit exercises and their training maxes |
| **History** | View past sessions and performance |
| **Settings** | Configure progression rates and units (lb/kg) |
| **Progression** | Interactive charts for RPE and rep percentages (draggable) |
| **Analytics** | Trends, summaries, and e1RM charts |
| **Recovery Planner** | Plan a repeating 14-day lifting and cycling schedule with recovery constraints |

## How It Works

**Training Max (TM)**: A reference weight (typically 90–95% of true 1RM) that all prescriptions are derived from.

**6-Week Block**: Weeks 1–5 are working weeks with varying RPE targets. Week 6 is a deload at 87.5% load.

**4 Sessions/Week**: A-Upper, A-Lower, B-Upper, B-Lower split.

**Automatic Progression**: Your TM adjusts based on how many reps you hit at the target RPE (+1% for strong weeks, -2.5% for struggle weeks, etc.).

## Testing

### Spread heavier sessions

In Progression, click **Spread heavy sessions**. Every active body-part group
receives equal priority. This reorders the current paired schedules; chest/back
and quads/hamstrings must already have complementary targets, and Upper/Lower
pairs must share their targets. The final week remains the deload.

The metric in `js/load-spacing.js` uses each exercise's actual rep range,
training max, and plate-rounded prescription. Effective load is
`prescribed weight / training max`. It follows a lift across all its scheduled
days in workout order, including the boundary into the next cycle.

- The heaviest third of working appearances counts as heavy, including all ties.
  Heavy exposures too close together incur a squared gap penalty.
- Every working load also contributes to a continuous closeness penalty, so a
  load just below the heavy cutoff still matters. Normalize the prescription
  within that lift's possible load range, square this heaviness, and sum
  `heaviness[i] * heaviness[j] / distance[i,j]^2` over every pair of appearances.
  Distance is the shorter gap around the repeating cycle, in appearances of
  that exercise. Deload exposures provide spacing and contribute zero heaviness.
- Repeated weights, worse RIR distributions, and loss of within-day effort
  variation are penalized. The search retains each day's exact rep-position
  distribution, opposing categories, paired-day targets, and the final week.
- Load metrics are normalized by each lift's number of appearances and averaged
  within its body-part group. The score combines the equal-weight group average
  with the worst group's loss, so more exercises or a preferred lift cannot
  dominate the search. Effort closeness and weekly mean RPE variance also count.
- A candidate is accepted only if it preserves every lift's existing peak load
  and heavy-gap penalty, and does not add repeated weekly weights. Adjacent load
  variation is normalized to the lift's possible load range and rewarded.
- 0-RIR targets are evenly shared across the populated workout variants for each
  category. Three such targets mean exactly one on variant 1, one on variant 2,
  and one on variant 3. An Upper/Lower pair counts once, and deload is excluded.
  For other counts, variant totals differ by at most one. This is a required
  condition for the returned schedule, rather than an optional score bonus.
- 0-RIR tests must also be balanced across early, middle and late working weeks.
  With three tests in six working weeks, one falls in weeks 1–2, one in 3–4,
  and one in 5–6, with at least two weeks between tests. They cannot all land
  in the same week. Deload is excluded from test counts and provides separation.

The deterministic search runs asynchronously so the interface remains usable.
It first searches permutations of whole prescriptions, which preserve each
lift's working weight distribution while moving its tests to different weeks.
It searches for improvements and does not guarantee a global optimum. It
changes only the RPE and rep schedules; registry entries, TMs and logs are intact.

Run the metric and optimizer regression tests with `npm run test:load-spacing`.
These use Node's built-in test runner and require no browser installation.

Run Playwright E2E tests:

```bash
npm test
```

Tests verify hamburger menu functionality, page navigation, and tab switching.

## Requirements

- **Browser**: Modern browser with localStorage support (Chrome, Firefox, Safari, Edge)
- **JavaScript**: No external JS framework required

## External Resources

Charts are loaded from CDN at runtime:
- Chart.js 4.4.1 (charting library)
- chartjs-plugin-dragdata 2.2.4 (interactive editing)

## Development

- Edit files directly—no build step required
- Changes appear immediately in the browser
- Always call `persist()` after mutating state
- JavaScript is split across `js/*.js` files loaded via `<script>` tags in `index.html`

## License

Open source. Feel free to use, modify, and redistribute.
