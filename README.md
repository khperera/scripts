# LiftTracker

A modular, **vanilla HTML/CSS/JavaScript** weightlifting tracker that runs entirely in the browser. No build step, no bundler, no backend, and no framework required.

All state is stored in `localStorage`, making it completely offline-capable and persistent across sessions.

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

## Project Structure

```
scripts/
├── index.html              # HTML entry point
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
│   └── app.js              # App initialization and event listeners
├── tests/
│   └── hamburger.spec.js   # Playwright E2E tests
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

## How It Works

**Training Max (TM)**: A reference weight (typically 90–95% of true 1RM) that all prescriptions are derived from.

**6-Week Block**: Weeks 1–5 are working weeks with varying RPE targets. Week 6 is a deload at 87.5% load.

**4 Sessions/Week**: A-Upper, A-Lower, B-Upper, B-Lower split.

**Automatic Progression**: Your TM adjusts based on how many reps you hit at the target RPE (+1% for strong weeks, -2.5% for struggle weeks, etc.).

## Testing

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
