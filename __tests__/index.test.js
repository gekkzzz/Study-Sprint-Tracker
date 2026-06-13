'use strict';

/**
 * Test suite for Study Sprint Tracker
 *
 * HOW TO RUN
 *   npm test               — run once
 *   npm run test:coverage  — run with coverage report
 *   npm run test:watch     — re-run on file save
 *
 * STRUCTURE
 *   Section 1 — Pure helper unit tests (no mocking needed)
 *   Section 2 — run() integration tests via full module mocking
 */

// ---------------------------------------------------------------------------
// Global mock declarations — Jest hoists these above all require() calls,
// so they are in place before src/index.js is first loaded.
// ---------------------------------------------------------------------------

jest.mock('@actions/core');
jest.mock('@actions/exec');

// github.context.payload must be writable so individual tests can override it.
jest.mock('@actions/github', () => ({
  context: {
    payload: {
      head_commit: {
        message: 'feat: add new lesson',
        url: 'https://github.com/user/repo/commit/abc123',
      },
    },
  },
}));

// Spread the real fs so @actions/core can access fs.promises at load time,
// then override only the methods the action touches.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync:    jest.fn(),
  mkdirSync:     jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync:  jest.fn(),
  appendFileSync: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mock declarations)
// ---------------------------------------------------------------------------

const core   = require('@actions/core');
const exec   = require('@actions/exec');
const github = require('@actions/github');
const fs     = require('fs');
const path   = require('path');

const {
  parseUTCDate,
  formatDate,
  todayUTC,
  calculateProgress,
  buildEntry,
  ensureJournal,
  run,
} = require('../src/index');

// ---------------------------------------------------------------------------
// Shared test utilities
// ---------------------------------------------------------------------------

const MS = 86_400_000; // one day in ms

/**
 * Pin fake timers to an explicit UTC date.
 * Call this BEFORE any code that uses new Date() / todayUTC().
 */
function freezeTimeTo(isoDateStr) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(isoDateStr));
}

/**
 * Build the INPUT_* env vars that @actions/core.getInput reads.
 * The real @actions/core is mocked, so we drive getInput via mockImplementation.
 */
function mockInputs(overrides = {}) {
  const defaults = {
    track_name:  'Test Track',
    total_days:  '30',
    start_date:  '', // must be set per test
    journal_file: 'STUDY_JOURNAL.md',
    skip_git:    'true', // always skip git in unit tests
  };
  const inputs = { ...defaults, ...overrides };

  core.getInput.mockImplementation((name) => {
    if (name === 'start_date' && inputs.start_date === '') {
      // Simulate required-field error
      throw new Error('Input required and not supplied: start_date');
    }
    return inputs[name] ?? '';
  });
}

/**
 * Build a mock for exec.exec that understands the listeners pattern used by
 * execGit() in the source. Supply a map of "arg1 arg2 …" → { exitCode, stdout }.
 */
function mockExec(responses = {}) {
  exec.exec.mockImplementation(async (_cmd, args, options) => {
    const key = args.join(' ');
    const res  = responses[key] ?? { exitCode: 0, stdout: '', stderr: '' };
    if (options?.listeners?.stdout && res.stdout) {
      options.listeners.stdout(Buffer.from(res.stdout));
    }
    if (options?.listeners?.stderr && res.stderr) {
      options.listeners.stderr(Buffer.from(res.stderr));
    }
    return res.exitCode ?? 0;
  });
}

/** Default git mock: everything succeeds; diff reports staged changes (exit 1). */
function mockGitSuccess(branch = 'main') {
  mockExec({
    // git diff --cached --quiet exits 1 when there ARE staged changes to commit
    'diff --cached --quiet': { exitCode: 1 },
    'rev-parse --abbrev-ref HEAD': { exitCode: 0, stdout: branch },
  });
}

/** Set up fs mocks for a journal that already exists with given content. */
function mockJournalExists(content = '# My Learning Journey\n\n---\n\n') {
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(content);
  fs.appendFileSync.mockImplementation(() => {});
}

/** Set up fs mocks for a journal that does NOT exist yet. */
function mockJournalMissing() {
  fs.existsSync.mockReturnValue(false);
  fs.mkdirSync.mockImplementation(() => {});
  fs.writeFileSync.mockImplementation(() => {});
  // readFileSync is called after ensureJournal writes the file; return the
  // header that writeFileSync would have written.
  fs.readFileSync.mockReturnValue('# My Learning Journey\n\n---\n\n');
  fs.appendFileSync.mockImplementation(() => {});
}

// ---------------------------------------------------------------------------
// Global setup — runs before/after every test in this file
// ---------------------------------------------------------------------------

// Clear all mock call counts between tests so nothing bleeds across describe
// blocks. restoreMocks is intentionally omitted: factory mocks created via
// jest.mock('fs', factory) cannot be "restored" the way jest.spyOn mocks can.
beforeEach(() => jest.clearAllMocks());

// Always reset fake timers after every test so real time flows for the next.
afterEach(() => jest.useRealTimers());

// ---------------------------------------------------------------------------
// Section 1 — Pure helper unit tests
// ---------------------------------------------------------------------------

describe('parseUTCDate()', () => {
  test('parses a valid YYYY-MM-DD string to a UTC midnight timestamp', () => {
    expect(parseUTCDate('2025-01-01')).toBe(Date.UTC(2025, 0, 1));
    expect(parseUTCDate('2025-12-31')).toBe(Date.UTC(2025, 11, 31));
  });

  test('throws on wrong separators', () => {
    expect(() => parseUTCDate('2025/01/01')).toThrow('Invalid date format');
    expect(() => parseUTCDate('01-01-2025')).toThrow('Invalid date format');
  });

  test('throws on empty string', () => {
    expect(() => parseUTCDate('')).toThrow('Invalid date format');
  });

  test('throws on partial date', () => {
    expect(() => parseUTCDate('2025-01')).toThrow('Invalid date format');
  });
});

describe('formatDate()', () => {
  test('formats a UTC timestamp as YYYY-MM-DD', () => {
    expect(formatDate(Date.UTC(2025, 0, 1))).toBe('2025-01-01');
    expect(formatDate(Date.UTC(2025, 11, 31))).toBe('2025-12-31');
  });

  test('zero-pads single-digit months and days', () => {
    expect(formatDate(Date.UTC(2025, 4, 5))).toBe('2025-05-05');
    expect(formatDate(Date.UTC(2025, 0, 9))).toBe('2025-01-09');
  });

  test('round-trips with parseUTCDate', () => {
    const original = '2025-06-15';
    expect(formatDate(parseUTCDate(original))).toBe(original);
  });
});

describe('todayUTC()', () => {


  test('returns UTC midnight (time component is zero)', () => {
    freezeTimeTo('2025-06-15T14:30:00Z');
    const result = todayUTC();
    expect(result).toBe(Date.UTC(2025, 5, 15)); // midnight, not 14:30
  });

  test('normalises a runner in a non-UTC timezone to the same UTC day', () => {
    // Simulates a runner whose wall clock shows 2025-06-16 01:00 +03:00,
    // which is still 2025-06-15 in UTC.
    freezeTimeTo('2025-06-15T22:00:00Z'); // UTC time
    expect(formatDate(todayUTC())).toBe('2025-06-15');
  });
});

describe('calculateProgress()', () => {


  test('Day 1 — start date is today', () => {
    freezeTimeTo('2025-01-01T00:00:00Z');
    const { currentDay, daysRemaining, goalAchieved } = calculateProgress('2025-01-01', 30);
    expect(currentDay).toBe(1);
    expect(daysRemaining).toBe(29);
    expect(goalAchieved).toBe(false);
  });

  test('mid-sprint — Day 15 of 30', () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    const { currentDay, daysRemaining, goalAchieved } = calculateProgress('2025-01-01', 30);
    expect(currentDay).toBe(15);
    expect(daysRemaining).toBe(15);
    expect(goalAchieved).toBe(false);
  });

  test('last day of sprint (Day 30 of 30)', () => {
    freezeTimeTo('2025-01-30T00:00:00Z');
    const { currentDay, daysRemaining, goalAchieved } = calculateProgress('2025-01-01', 30);
    expect(currentDay).toBe(30);
    expect(daysRemaining).toBe(0);
    expect(goalAchieved).toBe(false);
  });

  test('goal achieved — one day after sprint ends', () => {
    freezeTimeTo('2025-01-31T00:00:00Z');
    const { currentDay, daysRemaining, goalAchieved } = calculateProgress('2025-01-01', 30);
    expect(currentDay).toBe(31);
    expect(daysRemaining).toBe(0);
    expect(goalAchieved).toBe(true);
  });

  test('goal achieved — far past end of sprint', () => {
    freezeTimeTo('2025-06-01T00:00:00Z');
    const { goalAchieved, daysRemaining } = calculateProgress('2025-01-01', 30);
    expect(goalAchieved).toBe(true);
    expect(daysRemaining).toBe(0);
  });

  test('throws when start date is in the future', () => {
    freezeTimeTo('2025-01-01T00:00:00Z');
    expect(() => calculateProgress('2025-06-01', 30)).toThrow('future');
  });
});

describe('buildEntry()', () => {
  const base = {
    trackName: 'HTML in 30 Days',
    totalDays: 30,
    currentDay: 15,
    daysRemaining: 15,
    goalAchieved: false,
    commitMessage: 'feat: add flexbox lesson',
    commitUrl: 'https://github.com/user/repo/commit/abc123',
    today: '2025-06-15',
  };

  test('contains the date heading', () => {
    expect(buildEntry(base)).toContain('### 2025-06-15');
  });

  test('shows correct day count and remaining days', () => {
    const entry = buildEntry(base);
    expect(entry).toContain('Day 15 of 30');
    expect(entry).toContain('15 days remaining');
  });

  test('uses singular "day" when exactly 1 day remains', () => {
    const entry = buildEntry({ ...base, currentDay: 29, daysRemaining: 1 });
    expect(entry).toContain('1 day remaining');
    expect(entry).not.toContain('1 days remaining');
  });

  test('shows goal achieved message instead of day count', () => {
    const entry = buildEntry({ ...base, goalAchieved: true, daysRemaining: 0, currentDay: 31 });
    expect(entry).toContain('🎉 Goal Achieved!');
    expect(entry).toContain('30/30 days complete');
    expect(entry).not.toContain('Day 31');
  });

  test('renders commit as a markdown hyperlink when URL is provided', () => {
    const entry = buildEntry(base);
    expect(entry).toContain('[`feat: add flexbox lesson`](https://github.com/user/repo/commit/abc123)');
  });

  test('renders commit as inline code when URL is absent', () => {
    const entry = buildEntry({ ...base, commitUrl: '' });
    expect(entry).toContain('`feat: add flexbox lesson`');
    expect(entry).not.toContain('](');
  });

  test('falls back to "No commit message" when message is empty', () => {
    const entry = buildEntry({ ...base, commitMessage: '', commitUrl: '' });
    expect(entry).toContain('No commit message');
  });

  test('ends with a horizontal rule separator', () => {
    expect(buildEntry(base).trim()).toMatch(/---\s*$/);
  });
});

describe('ensureJournal()', () => {
  beforeEach(() => {
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.existsSync.mockReturnValue(false);
  });

  test('creates the journal with header content when file is missing', () => {
    ensureJournal('STUDY_JOURNAL.md');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'STUDY_JOURNAL.md',
      expect.stringContaining('# My Learning Journey'),
      'utf8'
    );
  });

  test('creates intermediate directories for nested paths', () => {
    ensureJournal('docs/logs/STUDY_JOURNAL.md');
    expect(fs.mkdirSync).toHaveBeenCalledWith('docs/logs', { recursive: true });
  });

  test('does NOT write the file when it already exists', () => {
    fs.existsSync.mockReturnValue(true);
    ensureJournal('STUDY_JOURNAL.md');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('does NOT call mkdirSync for a root-level file', () => {
    ensureJournal('STUDY_JOURNAL.md');
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section 2 — run() integration tests
// ---------------------------------------------------------------------------

describe('run() — standard progression (Day 15 of 30)', () => {


  test('sets the correct output variables', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });
    mockJournalExists();
    mockGitSuccess();

    await run();

    expect(core.setOutput).toHaveBeenCalledWith('current_day', '15');
    expect(core.setOutput).toHaveBeenCalledWith('days_remaining', '15');
    expect(core.setOutput).toHaveBeenCalledWith('goal_achieved', 'false');
    expect(core.setOutput).toHaveBeenCalledWith(
      'progress',
      'Day 15 of 30 — 15 day(s) remaining'
    );
  });

  test('appends an entry to the journal', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });
    mockJournalExists();
    mockGitSuccess();

    await run();

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      'STUDY_JOURNAL.md',
      expect.stringContaining('### 2025-01-15'),
      'utf8'
    );
  });

  test('does not call setFailed', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });
    mockJournalExists();
    mockGitSuccess();

    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
  });
});

describe('run() — Day 1 (exact start date)', () => {


  test('reports Day 1 and 29 days remaining for a 30-day sprint', async () => {
    freezeTimeTo('2025-01-01T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });
    mockJournalExists();
    mockGitSuccess();

    await run();

    expect(core.setOutput).toHaveBeenCalledWith('current_day', '1');
    expect(core.setOutput).toHaveBeenCalledWith('days_remaining', '29');
    expect(core.setOutput).toHaveBeenCalledWith('goal_achieved', 'false');
  });

  test('journal entry contains "Day 1 of 30"', async () => {
    freezeTimeTo('2025-01-01T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });
    mockJournalExists();
    mockGitSuccess();

    await run();

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      'STUDY_JOURNAL.md',
      expect.stringContaining('Day 1 of 30'),
      'utf8'
    );
  });
});

describe('run() — Goal Achieved (past total_days)', () => {


  test('sets goal_achieved=true and days_remaining=0', async () => {
    freezeTimeTo('2025-02-01T00:00:00Z'); // day 32 of a 30-day sprint
    mockInputs({ start_date: '2025-01-01', total_days: '30' });
    mockJournalExists();
    mockGitSuccess();

    await run();

    expect(core.setOutput).toHaveBeenCalledWith('goal_achieved', 'true');
    expect(core.setOutput).toHaveBeenCalledWith('days_remaining', '0');
  });

  test('progress output contains the celebration message', async () => {
    freezeTimeTo('2025-02-01T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });
    mockJournalExists();
    mockGitSuccess();

    await run();

    expect(core.setOutput).toHaveBeenCalledWith(
      'progress',
      '🎉 Goal achieved — 30 days complete!'
    );
  });

  test('journal entry contains the goal achieved text', async () => {
    freezeTimeTo('2025-02-01T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });
    mockJournalExists();
    mockGitSuccess();

    await run();

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      'STUDY_JOURNAL.md',
      expect.stringContaining('🎉 Goal Achieved!'),
      'utf8'
    );
  });
});

describe('run() — Missing journal file', () => {


  test('creates the journal and writes the header before appending', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });
    mockJournalMissing();
    mockGitSuccess();

    await run();

    // Header was written by ensureJournal
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'STUDY_JOURNAL.md',
      expect.stringContaining('# My Learning Journey'),
      'utf8'
    );
    // Entry was then appended
    expect(fs.appendFileSync).toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('creates intermediate directories when journal_file path is nested', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', journal_file: 'docs/sprints/JOURNAL.md' });
    mockJournalMissing();
    mockGitSuccess();

    await run();

    expect(fs.mkdirSync).toHaveBeenCalledWith('docs/sprints', { recursive: true });
  });
});

describe('run() — No changes to commit (duplicate push same day)', () => {


  test('skips appendFileSync when today\'s heading already exists in the journal', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });

    // Simulate a journal that already contains today's entry
    mockJournalExists('# My Learning Journey\n\n### 2025-01-15\n\n**existing entry**\n\n---\n\n');
    mockGitSuccess();

    await run();

    expect(fs.appendFileSync).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('still sets outputs correctly even when skipping the append', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });
    mockJournalExists('# My Learning Journey\n\n### 2025-01-15\n\n---\n\n');
    mockGitSuccess();

    await run();

    expect(core.setOutput).toHaveBeenCalledWith('current_day', '15');
  });

  test('skips git commit when git diff reports nothing staged (exit 0)', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30', skip_git: 'false' });
    mockJournalExists();

    // diff --cached --quiet exits 0 → nothing staged → should not commit
    mockExec({ 'diff --cached --quiet': { exitCode: 0 } });

    await run();

    // git commit should never have been called
    const commitCall = exec.exec.mock.calls.find(
      ([, args]) => args[0] === 'commit'
    );
    expect(commitCall).toBeUndefined();
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});

describe('run() — input validation', () => {


  test('calls setFailed when start_date is missing', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    // Simulate @actions/core throwing on a missing required field
    core.getInput.mockImplementation((name) => {
      if (name === 'start_date') throw new Error('Input required and not supplied: start_date');
      return '';
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('start_date')
    );
  });

  test('calls setFailed when total_days is not a number', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: 'banana' });
    mockJournalExists();

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('total_days must be a positive integer')
    );
  });

  test('calls setFailed when total_days is zero', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '0' });
    mockJournalExists();

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('total_days must be a positive integer')
    );
  });

  test('calls setFailed when start_date is in the future', async () => {
    freezeTimeTo('2025-01-01T00:00:00Z');
    mockInputs({ start_date: '2025-12-31', total_days: '30' });
    mockJournalExists();

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('future')
    );
  });

  test('calls setFailed when start_date format is invalid', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '15/01/2025', total_days: '30' });
    mockJournalExists();

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid date format')
    );
  });
});

describe('run() — git error handling', () => {


  test('calls setFailed when git commit fails', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30', skip_git: 'false' });
    mockJournalExists();

    mockExec({
      'diff --cached --quiet':       { exitCode: 1 },   // staged changes exist
      'rev-parse --abbrev-ref HEAD': { exitCode: 0, stdout: 'main' },
      'commit -m docs(journal): update study sprint log for 2025-01-15 [skip ci]': {
        exitCode: 1,
        stderr: 'nothing to commit',
      },
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('git commit failed')
    );
  });

  test('calls setFailed when git push fails', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30', skip_git: 'false' });
    mockJournalExists();

    // Build the exact commit message the source constructs
    const today = '2025-01-15';
    mockExec({
      'diff --cached --quiet':       { exitCode: 1 },
      [`commit -m docs(journal): update study sprint log for ${today} [skip ci]`]: { exitCode: 0 },
      'rev-parse --abbrev-ref HEAD': { exitCode: 0, stdout: 'main' },
      'push origin HEAD:main':       { exitCode: 1, stderr: 'remote: Permission denied' },
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('git push failed')
    );
  });
});

describe('run() — commit payload variations', () => {


  test('uses commit message and URL from the GitHub push payload', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });

    // Override the github context for this test
    github.context.payload = {
      head_commit: {
        message: 'fix: correct typo in lesson 3',
        url: 'https://github.com/user/repo/commit/deadbeef',
      },
    };
    mockJournalExists();
    mockGitSuccess();

    await run();

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      'STUDY_JOURNAL.md',
      expect.stringContaining('fix: correct typo in lesson 3'),
      'utf8'
    );
  });

  test('gracefully handles a missing head_commit in the payload', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30' });

    // Simulate a workflow trigger that has no head_commit (e.g. schedule, workflow_dispatch)
    github.context.payload = {};
    mockJournalExists();
    mockGitSuccess();

    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      'STUDY_JOURNAL.md',
      expect.stringContaining('No commit message'),
      'utf8'
    );
  });
});

describe('run() — skip_git flag', () => {


  test('does not call exec.exec at all when skip_git=true', async () => {
    freezeTimeTo('2025-01-15T00:00:00Z');
    mockInputs({ start_date: '2025-01-01', total_days: '30', skip_git: 'true' });
    mockJournalExists();

    await run();

    expect(exec.exec).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
