'use strict';

const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Parse a YYYY-MM-DD string as a UTC midnight Date so the result is
 * timezone-independent across all runner environments.
 */
function parseUTCDate(dateStr) {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(
      `Invalid date format "${dateStr}". Expected YYYY-MM-DD (e.g. 2025-01-01).`
    );
  }
  const [, year, month, day] = match.map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Return today's date as a UTC midnight timestamp so it aligns with
 * parseUTCDate() and never drifts by a day due to runner timezone.
 */
function todayUTC() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Format a UTC timestamp as YYYY-MM-DD. */
function formatDate(utcMs) {
  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Progress calculation
// ---------------------------------------------------------------------------

/**
 * Returns { currentDay, daysRemaining, goalAchieved, progressLine }.
 * currentDay is 1-indexed (Day 1 = start date).
 */
function calculateProgress(startDateStr, totalDays) {
  const startMs = parseUTCDate(startDateStr);
  const nowMs = todayUTC();
  const MS_PER_DAY = 86_400_000;

  // Day 1 is the start date itself, so add 1.
  const currentDay = Math.floor((nowMs - startMs) / MS_PER_DAY) + 1;

  if (currentDay < 1) {
    throw new Error(
      `start_date "${startDateStr}" is in the future. ` +
        'The sprint has not begun yet.'
    );
  }

  const goalAchieved = currentDay > totalDays;
  const daysRemaining = goalAchieved ? 0 : totalDays - currentDay;

  return { currentDay, daysRemaining, goalAchieved };
}

// ---------------------------------------------------------------------------
// Journal helpers
// ---------------------------------------------------------------------------

function ensureJournal(filePath) {
  const dir = path.dirname(filePath);
  if (dir && dir !== '.') {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      '# My Learning Journey\n\n' +
        '_This journal is automatically maintained by the ' +
        '[Study Sprint Tracker](https://github.com/marketplace/actions/study-sprint-tracker) ' +
        'GitHub Action._\n\n---\n\n',
      'utf8'
    );
    core.info(`Created new journal file: ${filePath}`);
  }
}

function buildEntry({
  trackName,
  totalDays,
  currentDay,
  daysRemaining,
  goalAchieved,
  commitMessage,
  commitUrl,
  today,
}) {
  const progressStr = goalAchieved
    ? `Track: ${trackName} | 🎉 Goal Achieved! (${totalDays}/${totalDays} days complete)`
    : `Track: ${trackName} | Day ${currentDay} of ${totalDays} — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`;

  const safeMessage = (commitMessage || 'No commit message').trim();
  const commitLink = commitUrl
    ? `[\`${safeMessage}\`](${commitUrl})`
    : `\`${safeMessage}\``;

  return (
    `### ${today}\n\n` +
    `**${progressStr}**\n\n` +
    `- 📝 Commit: ${commitLink}\n\n` +
    `---\n\n`
  );
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function execGit(args, options = {}) {
  let stdout = '';
  let stderr = '';

  const exitCode = await exec.exec('git', args, {
    ignoreReturnCode: true,
    silent: true,
    listeners: {
      stdout: (data) => { stdout += data.toString(); },
      stderr: (data) => { stderr += data.toString(); },
    },
    ...options,
  });

  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function configureGit() {
  await execGit(['config', '--local', 'user.name', 'github-actions[bot]']);
  await execGit([
    'config',
    '--local',
    'user.email',
    '41898282+github-actions[bot]@users.noreply.github.com',
  ]);
}

async function commitAndPush(journalFile) {
  await execGit(['add', journalFile]);

  // Detect whether there is anything staged.
  const { exitCode: diffCode } = await execGit([
    'diff',
    '--cached',
    '--quiet',
  ]);

  if (diffCode === 0) {
    // Exit code 0 from `git diff --cached --quiet` means no staged changes.
    core.info('No changes to commit — journal entry already up to date.');
    return;
  }

  const today = formatDate(todayUTC());
  const { exitCode: commitCode, stderr: commitStderr } = await execGit([
    'commit',
    '-m',
    `docs(journal): update study sprint log for ${today} [skip ci]`,
  ]);

  if (commitCode !== 0) {
    throw new Error(`git commit failed: ${commitStderr}`);
  }

  // Determine the current branch name.
  const { stdout: branchName } = await execGit([
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);

  const { exitCode: pushCode, stderr: pushStderr } = await execGit([
    'push',
    'origin',
    `HEAD:${branchName}`,
  ]);

  if (pushCode !== 0) {
    throw new Error(
      `git push failed: ${pushStderr}\n` +
        'Ensure the workflow has "permissions: contents: write" set.'
    );
  }

  core.info(`Journal committed and pushed to branch "${branchName}".`);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function run() {
  try {
    // ── 1. Read inputs ────────────────────────────────────────────────────
    const trackName = core.getInput('track_name', { required: false }) || 'Coding Sprint';
    const totalDaysRaw = core.getInput('total_days', { required: false }) || '180';
    const startDate = core.getInput('start_date', { required: true });
    const journalFile = core.getInput('journal_file', { required: false }) || 'STUDY_JOURNAL.md';
    const skipGit = core.getInput('skip_git', { required: false }) === 'true';

    const totalDays = parseInt(totalDaysRaw, 10);
    if (isNaN(totalDays) || totalDays < 1) {
      throw new Error(
        `total_days must be a positive integer, received: "${totalDaysRaw}".`
      );
    }

    core.info(`Track      : ${trackName}`);
    core.info(`Total days : ${totalDays}`);
    core.info(`Start date : ${startDate}`);
    core.info(`Journal    : ${journalFile}`);

    // ── 2. Calculate progress ─────────────────────────────────────────────
    const { currentDay, daysRemaining, goalAchieved } = calculateProgress(
      startDate,
      totalDays
    );

    const today = formatDate(todayUTC());
    core.info(`Today      : ${today} (Day ${currentDay} of ${totalDays})`);

    // ── 3. Extract commit info from the push payload ───────────────────────
    const payload = github.context.payload;
    const headCommit = payload.head_commit || {};
    const commitMessage = headCommit.message || '';
    const commitUrl = headCommit.url || '';

    // ── 4. Ensure journal file exists ─────────────────────────────────────
    ensureJournal(journalFile);

    // ── 5. Build & append the journal entry ───────────────────────────────
    const entry = buildEntry({
      trackName,
      totalDays,
      currentDay,
      daysRemaining,
      goalAchieved,
      commitMessage,
      commitUrl,
      today,
    });

    // Skip if an entry for today already exists (e.g. multiple pushes in one day).
    const existing = fs.readFileSync(journalFile, 'utf8');
    if (existing.includes(`### ${today}`)) {
      core.info(`Journal entry for ${today} already exists — skipping duplicate.`);
    } else {
      fs.appendFileSync(journalFile, entry, 'utf8');
    }

    const statusLine = goalAchieved
      ? `🎉 Goal achieved — ${totalDays} days complete!`
      : `Day ${currentDay} of ${totalDays} — ${daysRemaining} day(s) remaining`;

    core.info(`Progress   : ${statusLine}`);

    // Set an output so downstream steps can read the progress string.
    core.setOutput('progress', statusLine);
    core.setOutput('current_day', String(currentDay));
    core.setOutput('days_remaining', String(daysRemaining));
    core.setOutput('goal_achieved', String(goalAchieved));

    // ── 6. Commit & push the updated journal ──────────────────────────────
    if (skipGit) {
      core.info('skip_git=true — skipping git commit/push (dry-run mode).');
    } else {
      await configureGit();
      await commitAndPush(journalFile);
    }
  } catch (err) {
    // Fail the step but surface a clear message so the developer can act.
    core.setFailed(`Study Sprint Tracker failed: ${err.message}`);
  }
}

// Only auto-execute when run directly by Node (i.e. as a GitHub Action).
// When required by Jest the module is imported for its exports instead.
if (require.main === module) {
  run();
}

module.exports = {
  run,
  // Pure helpers exported so unit tests can reach them without mocking the
  // entire action pipeline.
  parseUTCDate,
  formatDate,
  todayUTC,
  calculateProgress,
  buildEntry,
  ensureJournal,
};
