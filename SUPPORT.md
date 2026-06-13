# Support

## Getting Help

Before opening an issue, check the resources below — your question may already be answered.

### Documentation

- [README](README.md) — full setup guide, all input parameters, and example workflows
- [Examples](examples/) — ready-to-use workflow files you can copy into your repo

### Common Issues

**The Action runs but nothing is committed to my repo**

Make sure your workflow grants write permissions:

```yaml
permissions:
  contents: write
```

Or check that `GITHUB_TOKEN` has repository write access in your repo's **Settings → Actions → General → Workflow permissions**.

---

**The journal file isn't being created**

Confirm the `journal_file` input path is relative to the root of your repository (e.g., `STUDY_JOURNAL.md` or `docs/journal.md`). The Action will create the file on first run if it does not exist.

---

**The sprint day count looks wrong**

Double-check your `start_date` input — it must be in `YYYY-MM-DD` format (e.g., `2025-01-01`). The day count is calculated from that date to the current UTC date.

---

**I want to test locally without committing**

Set `skip_git: 'true'` in your workflow inputs or pass `--skip-git` when running `run-local-test.js`. The journal entry will be written to the file but no git commit will be made.

---

### Opening an Issue

If you've checked the above and still need help, open an issue:

[github.com/gekkzzz/Study-Sprint-Tracker/issues/new](https://github.com/gekkzzz/Study-Sprint-Tracker/issues/new)

Please include:

- Your workflow YAML (redact any secrets)
- The full Action log output from the failing run
- What you expected to happen vs. what actually happened

### Feature Requests

Feature requests are welcome. Open an issue with the **enhancement** label and describe the use case.

---

[← Back to README](README.md)
