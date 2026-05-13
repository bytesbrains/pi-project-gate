# Project Gate — Agent Usage Guide

> You are an AI agent. Use project-gate tools to validate, start, and track work. Never start work on an issue without checking it first.

## Golden Rule

> **⚠️ DO NOT start work on an issue without calling `project_check()` first.**
> This ensures the issue has required sections, no blockers, and you haven't exceeded WIP limits.

## Workflow

```
project_check(issue_id="42")     ← validate: template? deps resolved? not taken?
  │
  ▼
project_start(issue_id="42")     ← WIP check, dep check, mark started
  │
  ▼
contrib_start_work(issue_id="42") ← create branch
  │
  ▼
[implement + test]
  │
  ▼
contrib_propose(message="...")   ← validate + commit
  │
  ▼
contrib_submit(title="...")      ← push + PR
  │
  ▼
[CI + review gates pass → merged]
  │
  ▼
project_status()                  ← verify WIP freed, blockers clear
```

## Issue Template Requirements

Issues MUST have these sections (configurable in `.projectrc.yml`):

```markdown
## Problem
What is the problem we're solving?

## Proposed Solution
How should we solve it?

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

Complexity: medium
Area: backend
Depends on #41
```

The `project_check()` tool validates these sections exist. If missing, it blocks work start.

## WIP Limits

Default: max 3 open PRs per agent. Configured via `maxWip` in `.projectrc.yml`.

If you have 3 open PRs, `project_start()` will refuse to start new work.

## Dependency Blocking

Issues can declare dependencies using:

```
Depends on #123
Blocked by #456
Requires #789
```

If any dependency is still open, `project_start()` blocks work.

## Release Notes

Generate release notes from conventional commits:

```
project_release_notes()                        ← latest tag to HEAD
project_release_notes(from="v1.0.0")           ← specific tag to HEAD
project_release_notes(from="v1.0.0", to="v1.1.0") ← between two tags
```

## When Things Go Wrong

| Problem | Solution |
|---|---|
| Issue missing sections | Add required sections to the issue body |
| WIP limit reached | Close or merge an existing PR first |
| Blocked by dependency | Help resolve the blocking issue or wait for it to be merged |
| No complexity label | Add `Complexity: small/medium/large/epic` to issue body |
