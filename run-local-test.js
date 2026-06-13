'use strict';

/**
 * run-local-test.js — Local sandbox for Study Sprint Tracker
 *
 * Runs the full action logic on your machine without pushing to GitHub.
 * No real git operations are performed; the journal is written to a temp
 * file and the final Markdown is printed to the terminal.
 *
 * HOW TO RUN
 *   node run-local-test.js
 *
 * CUSTOMISE
 *   Edit the CONFIG block below to try different scenarios:
 *     - Change START_DATE to today for a Day-1 run
 *     - Set TOTAL_DAYS to a small number and START_DATE far in the past
 *       to see the "Goal Achieved" banner
 *     - Set JOURNAL_FILE to a path under /tmp to avoid polluting the repo
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── CONFIG — edit these to simulate different scenarios ─────────────────────

const CONFIG = {
  TRACK_NAME:   process.env.TRACK_NAME   || 'HTML in 30 Days',
  TOTAL_DAYS:   process.env.TOTAL_DAYS   || '30',
  // Default: treat today as Day 15 of a 30-day sprint starting 14 days ago
  START_DATE:   process.env.START_DATE   || offsetDaysFromToday(-14),
  JOURNAL_FILE: process.env.JOURNAL_FILE || path.join(os.tmpdir(), 'study-sprint-local-test.md'),
  SKIP_GIT:     'true',
};

// ─── Fake GitHub push payload ─────────────────────────────────────────────────

const FAKE_PAYLOAD = {
  head_commit: {
    message: 'feat: complete CSS flexbox exercises',
    url:     'https://github.com/your-username/your-repo/commit/abc1234def5678',
  },
};

// ─────────────────────────────────────────────────────────────────────────────

/** Returns a YYYY-MM-DD string for today offset by `days` days. */
function offsetDaysFromToday(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minimal @actions/core shim that prints to the terminal instead of GitHub. */
const coreMock = {
  _outputs: {},
  getInput(name, opts) {
    const envKey = `INPUT_${name.toUpperCase()}`;
    const val = process.env[envKey] ?? CONFIG[name.toUpperCase().replace(/-/g, '_')] ?? '';
    if (opts?.required && !val) {
      throw new Error(`Input required and not supplied: ${name}`);
    }
    return val;
  },
  info:      (msg) => console.log(`  ℹ️  ${msg}`),
  warning:   (msg) => console.warn(`  ⚠️  ${msg}`),
  setFailed: (msg) => { console.error(`\n  ❌ FAILED: ${msg}\n`); process.exitCode = 1; },
  setOutput: (name, value) => {
    coreMock._outputs[name] = value;
    console.log(`  📤 output[${name}] = ${value}`);
  },
};

/** Minimal @actions/exec shim that no-ops all git calls. */
const execMock = {
  exec: async (_cmd, args, _opts) => {
    console.log(`  🔧 [git skip] git ${args.join(' ')}`);
    return 0;
  },
};

/** Minimal @actions/github shim with the fake push payload. */
const githubMock = {
  context: { payload: FAKE_PAYLOAD },
};

// ─── Monkey-patch require() before loading src/index.js ──────────────────────

const Module = require('module');
const _originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === '@actions/core')   return coreMock;
  if (request === '@actions/exec')   return execMock;
  if (request === '@actions/github') return githubMock;
  return _originalLoad.apply(this, arguments);
};

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║       Study Sprint Tracker — Local Test Run      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  console.log('📋 Configuration:');
  Object.entries(CONFIG).forEach(([k, v]) => console.log(`   ${k.padEnd(14)} = ${v}`));
  console.log();

  // Delete any leftover temp journal from a previous run so we always see a
  // fresh file being initialised.
  if (CONFIG.JOURNAL_FILE.startsWith(os.tmpdir()) && fs.existsSync(CONFIG.JOURNAL_FILE)) {
    fs.unlinkSync(CONFIG.JOURNAL_FILE);
    console.log(`🗑️  Deleted previous temp journal: ${CONFIG.JOURNAL_FILE}\n`);
  }

  console.log('▶️  Running action…\n');

  // Require the module AFTER the monkey-patch is in place.
  // The require.main guard in src/index.js means run() is NOT auto-called;
  // we call it ourselves so we can await it.
  const { run } = require('./src/index');
  await run();

  console.log('\n──────────────────────────────────────────────────');
  console.log('📄 Generated journal contents:\n');

  if (fs.existsSync(CONFIG.JOURNAL_FILE)) {
    const contents = fs.readFileSync(CONFIG.JOURNAL_FILE, 'utf8');
    console.log(contents);
  } else {
    console.log('  (journal file was not created — check for errors above)');
  }

  console.log('──────────────────────────────────────────────────');
  console.log(`\n✅ Done.  Full journal written to: ${CONFIG.JOURNAL_FILE}\n`);

  // Restore the original loader so anything required after this point is unaffected.
  Module._load = _originalLoad;
}

main().catch((err) => {
  console.error('\nUnhandled error:', err);
  process.exit(1);
});
