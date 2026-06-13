# Study Sprint Tracker

> **Automated accountability for self-directed learners — entirely inside GitHub.**

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-Study%20Sprint%20Tracker-purple?logo=github)](https://github.com/marketplace/actions/study-sprint-tracker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Study Sprint Tracker is a GitHub Action that runs every time you push code. It
reads your chosen track name and sprint length, calculates how far into the
sprint you are, and **automatically appends a dated journal entry** to a
Markdown file inside your repository — no external tools, no dashboards, no
paid subscriptions.

---

## How it works

```
You push code
      │
      ▼
Action calculates today's sprint day
      │
      ▼
Appends entry to STUDY_JOURNAL.md (or your custom path)
e.g.  ### 2025-03-15
      **Track: Full Stack | Day 45 of 200 — 155 days remaining**
      - 📝 Commit: `Add responsive navbar` (link)
      │
      ▼
Commits & pushes the updated journal back to your branch
```

The journal lives as a plain `.md` file in your repo, so it travels with your
code, survives forks, and is readable in any Markdown viewer without ever
leaving GitHub.

---

## Quick start

### 1 — Copy the workflow file

Create `.github/workflows/study-sprint.yml` in your repository:

```yaml
name: Study Sprint Tracker

on:
  push:
    branches:
      - main        # adjust to your default branch

# ⚠️  Required — the Action commits back to your repo.
permissions:
  contents: write

jobs:
  track:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          # Fetch the full history so git push works correctly.
          fetch-depth: 0

      - name: Run Study Sprint Tracker
        uses: your-username/study-sprint-tracker@v1
        with:
          track_name: 'My Coding Sprint'
          total_days: 180
          start_date: '2025-01-01'       # YYYY-MM-DD — the day you started
          journal_file: 'STUDY_JOURNAL.md'
```

### 2 — Push any commit

From this point on, every push automatically updates `STUDY_JOURNAL.md` with
a new entry and commits it back, no manual steps required.

---

## Inputs

| Input          | Required | Default            | Description                                               |
|----------------|----------|--------------------|-----------------------------------------------------------|
| `track_name`   | No       | `Coding Sprint`    | Name of your learning track (e.g. `HTML`, `Full Stack`).  |
| `total_days`   | No       | `180`              | Total number of sprint days.                              |
| `start_date`   | **Yes**  | —                  | Sprint start date in `YYYY-MM-DD` format.                 |
| `journal_file` | No       | `STUDY_JOURNAL.md` | Path to the Markdown journal file (created if absent).    |
| `skip_git`     | No       | `false`            | Set to `"true"` to skip the commit/push step (dry-run).   |

## Outputs

| Output          | Description                                                   |
|-----------------|---------------------------------------------------------------|
| `progress`      | Human-readable progress string (e.g. `Day 45 of 200 — 155 days remaining`). |
| `current_day`   | Numeric current sprint day as a string.                       |
| `days_remaining`| Number of days left as a string. `0` once goal is achieved.  |
| `goal_achieved` | `"true"` when `current_day > total_days`, otherwise `"false"`. |

---

## Configuration examples

### Example 1 — HTML in 30 Days

```yaml
name: Study Sprint Tracker

on:
  push:
    branches:
      - main

permissions:
  contents: write

jobs:
  track:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Track HTML Sprint
        uses: your-username/study-sprint-tracker@v1
        with:
          track_name: 'HTML in 30 Days'
          total_days: 30
          start_date: '2025-06-01'
          journal_file: 'journals/html-sprint.md'
```

A journal entry for this configuration on Day 12 would look like:

```markdown
### 2025-06-12

**Track: HTML in 30 Days | Day 12 of 30 — 18 days remaining**

- 📝 Commit: [`Add form validation examples`](https://github.com/user/repo/commit/abc1234)

---
```

---

### Example 2 — Full Stack in 200 Days

```yaml
name: Study Sprint Tracker

on:
  push:
    branches:
      - main

permissions:
  contents: write

jobs:
  track:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Track Full Stack Sprint
        uses: your-username/study-sprint-tracker@v1
        with:
          track_name: 'Full Stack'
          total_days: 200
          start_date: '2025-01-01'
          journal_file: 'STUDY_JOURNAL.md'
```

A journal entry for this configuration on Day 45 would look like:

```markdown
### 2025-02-14

**Track: Full Stack | Day 45 of 200 — 155 days remaining**

- 📝 Commit: [`Implement JWT authentication middleware`](https://github.com/user/repo/commit/def5678)

---
```

---

## Using outputs in downstream steps

```yaml
      - name: Track Sprint
        id: sprint
        uses: your-username/study-sprint-tracker@v1
        with:
          track_name: 'Data Science'
          total_days: 100
          start_date: '2025-03-01'

      - name: Print progress
        run: echo "Progress — ${{ steps.sprint.outputs.progress }}"

      - name: Celebrate goal completion
        if: steps.sprint.outputs.goal_achieved == 'true'
        run: echo "You finished the sprint! Time to plan the next one."
```

---

## Journal file format

When the journal file does not yet exist the Action creates it automatically
with this header:

```markdown
# My Learning Journey

_This journal is automatically maintained by the
[Study Sprint Tracker](https://github.com/marketplace/actions/study-sprint-tracker)
GitHub Action._

---
```

Each push appends a new dated section beneath the header. The file is
append-only, so your entire history is preserved chronologically.

---

## Goal achieved

Once `current_day > total_days` the Action does not error. Instead it records:

```markdown
### 2025-07-01

**Track: HTML in 30 Days | 🎉 Goal Achieved! (30/30 days complete)**

- 📝 Commit: [`Final project — portfolio page`](https://github.com/user/repo/commit/xyz9999)

---
```

This lets you keep pushing code after the sprint ends without breaking your
workflow.

---

## Avoiding duplicate entries

The Action adds `[skip ci]` to its own commit message. This prevents the
journal-update commit from triggering another workflow run and creating a loop.
If your branch protection rules require status checks, ensure `[skip ci]` is
allowed to bypass them, or use a path filter on the workflow trigger:

```yaml
on:
  push:
    branches:
      - main
    paths-ignore:
      - '**.md'   # ignore pushes that only touch Markdown files
```

---

## Permissions note

The workflow **must** include:

```yaml
permissions:
  contents: write
```

Without this the `git push` step will fail with a 403 error. This is a
GitHub-enforced security requirement for any Action that writes back to the
repository.

---

## Developing locally

```bash
# Install dependencies
npm install

# Build the bundled dist/index.js
npm run build

# Run tests
npm test
```

After `npm run build`, commit the `dist/` directory. The Action runtime reads
`dist/index.js` directly — the `src/` source files are not executed on the
runner.

---

## Contributing

Found a bug? Want to add a feature? Contributions are welcome.

**Please open a pull request** — whether it's a bug fix, a new feature, an improvement to the docs, or a new example workflow. All PRs are reviewed and appreciated.

If you are unsure whether your idea fits the project, open an issue first to discuss it before writing code.

### How to contribute

1. Fork the repository and create a branch from `main`.
2. Install dependencies: `npm install`
3. Make your changes in `src/index.js`.
4. Add or update tests in `__tests__/index.test.js` — all tests must pass (`npm test`).
5. Rebuild the bundle: `npm run build` — always commit the updated `dist/` alongside your source changes.
6. Open a pull request against `main` with a clear description of what changed and why.

---

## License

[MIT](LICENSE)
