# Project Gate — Agent Usage Guide

> You are an AI agent. Use project-gate tools to manage issues, validate work readiness, and track progress.

## Golden Rules

> **⚠️ DO NOT start work on an issue without calling `project_check()` first.**
> This ensures the issue has required sections, no blockers, and you haven't exceeded WIP limits.

> **📝 Use `project_create_issue()` to create issues — never use raw `curl` or the browser.**
> This ensures issue templates are validated and governance gates are enforced.

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

## Managing Issues (CRUD)

### Create an Issue

Always use `project_create_issue()` instead of raw curl or browser:

```
project_create_issue(
  title="Add dark mode toggle",
  body="## Problem\nNo dark mode support.\n\n## Proposed Solution\nAdd a toggle in settings.\n\n## Acceptance Criteria\n- [ ] Toggle switches themes\n- [ ] Persists preference",
  labels=["enhancement", "frontend"],
  milestone="v2.0"
)
```

The body is validated against required sections (configurable in `.projectrc.yml`).

### Update an Issue

Modify any aspect of an existing issue:

```
project_update_issue(
  issue_id="42",
  state="closed"
)

project_update_issue(
  issue_id="42",
  title="Updated title",
  labels=["bug", "high-priority"],
  assignee="nandal"
)
```

Only the fields you provide are changed. Omitted fields are left as-is.

### List/Search Issues

Find issues with flexible filters:

```
project_list_issues()                              ← all open issues
project_list_issues(state="closed")                ← closed issues
project_list_issues(labels="bug,high-priority")    ← by labels
project_list_issues(milestone="v2.0")              ← by milestone
project_list_issues(assignee="nandal")             ← by assignee
project_list_issues(q="dark mode")                 ← text search
project_list_issues(state="open", limit=50)        ← pagination
```

### Get Issue Details

Fetch full issue info including comments:

```
project_get_issue(issue_id="42")                   ← full details + comments
project_get_issue(issue_id="42", include_comments=false)  ← body only
```

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
| Issue missing sections | Add required sections to the issue body, or use `project_update_issue()` |
| WIP limit reached | Close or merge an existing PR first |
| Blocked by dependency | Help resolve the blocking issue or wait for it to be merged |
| No complexity label | Add `Complexity: small/medium/large/epic` to issue body |
| Cannot find an issue | Use `project_list_issues(q="keyword")` to search |
| Need to close an issue | Use `project_update_issue(issue_id="42", state="closed")` |
