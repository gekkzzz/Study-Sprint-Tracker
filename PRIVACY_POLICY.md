# Privacy Policy

**Study Sprint Tracker** — GitHub Action
**Last updated:** 2026-06-13

## Overview

Study Sprint Tracker is a GitHub Action. It runs inside GitHub's infrastructure on your own repository. This project does **not** operate any servers, collect any data, or transmit any information to third parties.

## What the Action Accesses

When the Action runs, it reads:

| Data | Purpose |
|------|---------|
| Inputs you configure in your workflow file (`track_name`, `start_date`, etc.) | Generate the journal entry |
| The current date and time (from the GitHub runner) | Calculate sprint day and timestamp the entry |
| Your repository's journal file (if it already exists) | Append the new entry without overwriting history |

## What the Action Does Not Do

- Does not send any data to external servers.
- Does not store data outside your repository.
- Does not access files beyond the journal file path you specify.
- Does not read secrets, tokens, or environment variables beyond what GitHub Actions injects by default (`GITHUB_TOKEN` is used only to commit the journal entry back to your repo).

## Data Storage

All data produced by the Action (journal entries) is written directly to your own GitHub repository. GitHub's own privacy policy governs how that data is stored and handled: [docs.github.com/en/site-policy/privacy-policies](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Changes

This policy may be updated to reflect changes in how the Action works. Updates will be committed to this file with a revised "Last updated" date.

## Contact

For privacy-related questions, open an issue at [github.com/gekkzzz/Study-Sprint-Tracker/issues](https://github.com/gekkzzz/Study-Sprint-Tracker/issues).

---

[← Back to README](README.md)
