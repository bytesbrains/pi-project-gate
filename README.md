# Project Gate for Pi

[![npm version](https://img.shields.io/npm/v/@bytesbrains/pi-project-gate)](https://www.npmjs.com/package/@bytesbrains/pi-project-gate)
[![license](https://img.shields.io/npm/l/@bytesbrains/pi-project-gate)](./LICENSE)

> Project orchestration gate for AI agents — structured issues, WIP limits, dependency blocking, and auto-generated release notes. **Agents work from issues, not vibes.**

## Philosophy

`pi-contrib-gate` handles the *contribution* side (branch → commit → PR).  
`pi-review-gate` handles the *review* side (check → approve → merge).  
`pi-project-gate` handles the *project* side (issue → plan → release).

## Install

```bash
pi install npm:@bytesbrains/pi-project-gate
```

## Tools

| Tool | What it does |
|---|---|
| `project_check(issue_id)` | Validate issue readiness — template, complexity, dependencies |
| `project_start(issue_id)` | Start work on an issue — checks WIP, dependencies, template |
| `project_status()` | Project board — active issues, WIP counts, blockers |
| `project_release_notes(from, to)` | Generate release notes from conventional commits |

## Gates

| Gate | Config | Description |
|---|---|---|
| Issue template | `requiredSections` | Block work start if issue is missing required sections |
| WIP limit | `maxWip` | Max concurrent open PRs per agent (default: 3) |
| Dependency blocking | `dependencyPattern` | Prevent starting issues with unresolved dependencies |
| Complexity tracking | `complexityLevels` | Ensure issues are scoped with complexity labels |
| Release notes | `releaseNoteGroups` | Auto-generate grouped release notes from conventional commits |

## Configuration

Create `.projectrc.yml`:

```yaml
# Max open PRs per agent
maxWip: 3

# Required sections in issue body (comma-separated)
requiredSections: "## Problem,## Proposed Solution,## Acceptance Criteria"

# Complexity levels
complexityLevels: trivial,small,medium,large,epic

# Area labels for categorization
areas: backend,frontend,infra,docs,tooling

# Grouping order for release notes
releaseNoteGroups: feat,fix,perf,refactor,chore,docs,test,ci,build

# Include commit hashes in release notes
releaseNoteIncludeHashes: false

# Regex pattern for issue dependencies
dependencyPattern: "(?:Depends on|Blocked by|Requires)\\s+#(\\d+)"
```

## Workflow

```
project_check(#42)               ← validate issue readiness
  │
  ▼
project_start(#42)               ← start work (WIP + deps checked)
  │
  ▼
contrib_start_work(#42)          ← create branch
  │
  ▼
[implement]
  │
  ▼
contrib_propose(...)             ← validate + commit
  │
  ▼
contrib_submit(...)              ← push + create PR
  │
  ▼
[CI + review gates pass]
  │
  ▼
MERGED → project_status()        ← WIP freed, blockers resolved
```

## Release Notes

```bash
# Generate notes from last tag to HEAD
project_release_notes()

# Generate notes between two tags
project_release_notes(from="v1.0.0", to="v1.1.0")
```

Example output:

```
# Release v1.1.0 (2026-05-14)

### 🚀 Features
- **auth**: add OAuth2 support
- **api**: new user endpoint

### 🐛 Bug Fixes
- fix null pointer in login flow
- fix race condition in task queue

### 🔧 Chores
- update dependencies
```

## Integration

Install all three gates for full agent governance:

```bash
pi install npm:@bytesbrains/pi-contrib-gate
pi install npm:@bytesbrains/pi-review-gate
pi install npm:@bytesbrains/pi-project-gate
```

## License

MIT © [nandal](https://github.com/nandal)

---

Built and maintained by [BytesBrains](https://bytesbrains.com) — AI automation & agents, engineered to production standards.
*The model proposes, code guarantees.*
