/**
 * pi-project-gate — Project Orchestration Gate
 *
 * Ensures agents work from structured issues, not vibes.
 * Enforces WIP limits, dependency blocking, issue templates,
 * and auto-generates release notes from conventional commits.
 *
 * Tools:
 *   project_check(issue_id)           → validate issue readiness
 *   project_start(issue_id)            → start work (WIP + dependency checks)
 *   project_status()                   → project board — active work, blockers
 *   project_release_notes(from, to)    → generate release notes from commits
 *
 * Config: .projectrc.yml (WIP limits, required template sections, release note format)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ──

interface ProjectConfig {
  /** Maximum concurrent open PRs per agent */
  maxWip: number;
  /** Required sections in issue body */
  requiredSections: string[];
  /** Complexity levels and their labels */
  complexityLevels: string[];
  /** Area labels for categorization */
  areas: string[];
  /** Release note grouping order */
  releaseNoteGroups: string[];
  /** Whether to include commit hashes in release notes */
  releaseNoteIncludeHashes: boolean;
  /** Issue dependency marker pattern (e.g., "Depends on #123") */
  dependencyPattern: string;
}

const DEFAULT_CONFIG: ProjectConfig = {
  maxWip: 3,
  requiredSections: ["## Problem", "## Proposed Solution", "## Acceptance Criteria"],
  complexityLevels: ["trivial", "small", "medium", "large", "epic"],
  areas: [],
  releaseNoteGroups: ["feat", "fix", "perf", "refactor", "chore", "docs", "test", "ci", "build"],
  releaseNoteIncludeHashes: false,
  dependencyPattern: "(?:Depends on|Blocked by|Requires)\\s+#(\\d+)",
};

// ── Session state ──

let activeIssueId: string | null = null;

// ── Config ──

function loadConfig(cwd: string): ProjectConfig {
  const configPath = path.join(cwd, ".projectrc.yml");
  if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const result: Record<string, unknown> = {};
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*([\w][\w.]*):\s*(.+)$/);
      if (m) result[m[1]] = m[2].trim();
    }
    return {
      maxWip: parseInt(result["maxWip"] as string) || DEFAULT_CONFIG.maxWip,
      requiredSections: (result["requiredSections"] as string)?.split(",").map(s => s.trim()).filter(Boolean) || DEFAULT_CONFIG.requiredSections,
      complexityLevels: (result["complexityLevels"] as string)?.split(",").map(s => s.trim()).filter(Boolean) || DEFAULT_CONFIG.complexityLevels,
      areas: (result["areas"] as string)?.split(",").map(s => s.trim()).filter(Boolean) || [],
      releaseNoteGroups: (result["releaseNoteGroups"] as string)?.split(",").map(s => s.trim()).filter(Boolean) || DEFAULT_CONFIG.releaseNoteGroups,
      releaseNoteIncludeHashes: result["releaseNoteIncludeHashes"] === "true",
      dependencyPattern: (result["dependencyPattern"] as string) || DEFAULT_CONFIG.dependencyPattern,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ── Git helpers ──

function exec(cmd: string, cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const r = cp.execSync(cmd, { cwd, encoding: "utf-8", timeout: 30000 });
    return { ok: true, stdout: r.trim(), stderr: "" };
  } catch (e: any) {
    return { ok: false, stdout: e.stdout?.trim() || "", stderr: e.stderr?.trim() || e.message };
  }
}

function currentBranch(cwd: string): string {
  return exec("git branch --show-current", cwd).stdout;
}

// ── Gitea API ──

interface GiteaApiOpts {
  repo: string;
  token?: string;
}

function resolveGitea(cwd: string): GiteaApiOpts {
  const remote = exec("git remote get-url gitea 2>/dev/null || git remote get-url origin", cwd);
  const url = remote.stdout || "";
  const match = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  const repo = match ? `${match[1]}/${match[2]}` : "factory/wrok.in";
  const credMatch = url.match(/:\/\/([^:]+):([^@]+)@/);
  const token = credMatch ? credMatch[2] : "";
  return { repo, token };
}

function giteaApi(
  path: string,
  method: string,
  body: Record<string, unknown> | null,
  opts: GiteaApiOpts,
  cwd: string,
): { ok: boolean; data: unknown; error?: string } {
  const base = `http://127.0.0.1:3001/api/v1/repos/${opts.repo}`;
  const headers = [
    opts.token ? `-H "Authorization: token ${opts.token}"` : "",
    `-H "Content-Type: application/json"`,
    `-H "Accept: application/json"`,
  ].filter(Boolean).join(" ");

  const dataFlag = body ? `-d '${JSON.stringify(body).replace(/'/g, "'\\''")}'` : "";
  const cmd = `curl -sf -w "\\n%{http_code}" -X ${method} "${base}${path}" ${headers} ${dataFlag}`;
  const r = exec(cmd, cwd);

  if (!r.ok) {
    const lines = r.stdout.split("\n");
    const bodyText = lines.slice(0, -1).join("\n");
    return { ok: false, data: null, error: r.stderr || bodyText || "API error" };
  }

  const lines = r.stdout.split("\n");
  const bodyText = lines.slice(0, -1).join("\n");
  try {
    return { ok: true, data: JSON.parse(bodyText) };
  } catch {
    return { ok: true, data: bodyText };
  }
}

// ── Issue template validation ──

function validateIssueTemplate(
  issueBody: string,
  config: ProjectConfig,
): { ok: true } | { ok: false; missingSections: string[] } {
  const missing = config.requiredSections.filter(section =>
    !issueBody.includes(section)
  );
  if (missing.length > 0) {
    return { ok: false, missingSections: missing };
  }
  return { ok: true };
}

// ── Dependency parsing ──

function parseDependencies(body: string, config: ProjectConfig): string[] {
  const pattern = new RegExp(config.dependencyPattern, "gi");
  const deps = new Set<string>();
  let match;
  while ((match = pattern.exec(body)) !== null) {
    deps.add(match[1]);
  }
  return [...deps];
}

// ── WIP counting ──

function countOpenPRs(opts: GiteaApiOpts, cwd: string): { total: number; byAuthor: Record<string, number> } {
  const r = giteaApi("/pulls?state=open&limit=100", "GET", null, opts, cwd);
  if (!r.ok || !r.data) return { total: 0, byAuthor: {} };

  const prs = Array.isArray(r.data) ? r.data : [];
  const byAuthor: Record<string, number> = {};
  for (const pr of prs) {
    const author = (pr as any).user?.login || "unknown";
    byAuthor[author] = (byAuthor[author] || 0) + 1;
  }

  return { total: prs.length, byAuthor };
}

// ── Release notes generation ──

interface CommitEntry {
  hash: string;
  type: string;
  scope: string;
  subject: string;
  body: string;
}

function parseConventionalCommits(log: string): CommitEntry[] {
  const entries: CommitEntry[] = [];
  // Parse each commit from `git log --format` output
  const commits = log.split(/\n(?=commit )/);
  for (const block of commits) {
    const hashMatch = block.match(/^commit (\S+)/m);
    if (!hashMatch) continue;
    const hash = hashMatch[1].slice(0, 8);

    // Extract subject line
    const subjectLine = block.split("\n").find(l => l.trim() && !l.startsWith("commit ") && !l.startsWith("Author:") && !l.startsWith("Date:"));
    if (!subjectLine) continue;

    const convMatch = subjectLine.trim().match(/^(feat|fix|perf|refactor|chore|docs|style|test|ci|build|revert)(?:\(([^)]+)\))?:\s(.+)$/);
    if (!convMatch) continue;

    entries.push({
      hash,
      type: convMatch[1],
      scope: convMatch[2] || "",
      subject: convMatch[3].trim(),
      body: "",
    });
  }
  return entries;
}

function generateReleaseNotes(
  from: string,
  to: string,
  config: ProjectConfig,
  cwd: string,
): { version: string; date: string; sections: Record<string, string[]> } {
  const range = from ? `${from}..${to}` : to;
  const log = exec(`git log ${range} --format="commit %H%n%B%n---" --no-merges`, cwd);
  const commits = parseConventionalCommits(log.stdout || "");

  const sections: Record<string, string[]> = {};
  for (const group of config.releaseNoteGroups) {
    sections[group] = [];
  }
  sections["other"] = [];

  for (const commit of commits) {
    const prefix = config.releaseNoteIncludeHashes ? `- ${commit.hash} ` : "- ";
    const scope = commit.scope ? `**${commit.scope}**: ` : "";
    const line = `${prefix}${scope}${commit.subject}`;

    if (sections[commit.type]) {
      sections[commit.type].push(line);
    } else {
      sections["other"].push(line);
    }
  }

  return {
    version: to || "HEAD",
    date: new Date().toISOString().split("T")[0],
    sections,
  };
}

function formatReleaseNotes(release: { version: string; date: string; sections: Record<string, string[]> }): string {
  const lines: string[] = [];
  lines.push(`# Release ${release.version} (${release.date})`);
  lines.push("");

  const labels: Record<string, string> = {
    feat: "🚀 Features",
    fix: "🐛 Bug Fixes",
    perf: "⚡ Performance",
    refactor: "♻️ Refactoring",
    chore: "🔧 Chores",
    docs: "📝 Documentation",
    test: "✅ Tests",
    ci: "👷 CI/CD",
    build: "📦 Build",
    other: "📌 Other",
  };

  for (const [group, entries] of Object.entries(release.sections)) {
    if (entries.length === 0) continue;
    const label = labels[group] || group;
    lines.push(`### ${label}`);
    lines.push("");
    for (const entry of entries) {
      lines.push(entry);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Extension ──

export default function (pi: ExtensionAPI) {
  // ═══════════════════════════════════════
  // Tool: project_check
  // ═══════════════════════════════════════
  pi.registerTool({
    name: "project_check",
    label: "Check Issue Readiness",
    description: "Validate that an issue is ready to be worked on — has required sections, no blockers, not already taken.",
    parameters: Type.Object({
      issue_id: Type.String({ description: "Issue number to check" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const config = loadConfig(ctx.cwd);
      const opts = resolveGitea(ctx.cwd);
      const issueId = params.issue_id.replace(/^#/, "");

      // Fetch issue from Gitea
      const r = giteaApi(`/issues/${issueId}`, "GET", null, opts, ctx.cwd);
      if (!r.ok || !r.data) {
        return {
          content: [{ type: "text", text: `Issue #${issueId} not found: ${r.error || "API error"}` }],
          isError: true,
          details: {},
        };
      }

      const issue = r.data as Record<string, unknown>;
      const lines: string[] = [];
      const issues: string[] = [];

      lines.push(`📋 Issue #${issueId}: ${issue.title || "untitled"}`);
      lines.push(`   State: ${issue.state}`);
      lines.push(`   Assignee: ${(issue.assignee as any)?.login || "unassigned"}`);

      // 1. Template validation
      const body = (issue.body as string) || "";
      const templateCheck = validateIssueTemplate(body, config);
      if (!templateCheck.ok) {
        issues.push(`❌ Missing required sections: ${templateCheck.missingSections.join(", ")}`);
        issues.push(`   Add to issue: ${config.requiredSections.join(", ")}`);
      } else {
        lines.push(`   Template: ✅ complete`);
      }

      // 2. Complexity check
      const complexity = config.complexityLevels.find(l => body.toLowerCase().includes(l.toLowerCase()));
      if (complexity) {
        lines.push(`   Complexity: ${complexity}`);
      } else {
        issues.push(`⚠️ No complexity label found. Consider adding: ${config.complexityLevels.join(", ")}`);
      }

      // 3. Area check
      const area = config.areas.find(a => body.includes(a));
      if (area) {
        lines.push(`   Area: ${area}`);
      } else if (config.areas.length > 0) {
        issues.push(`⚠️ No area tag found. Available: ${config.areas.join(", ")}`);
      }

      // 4. Dependency check
      const dependencies = parseDependencies(body, config);
      if (dependencies.length > 0) {
        lines.push(`   Dependencies: #${dependencies.join(", #")}`);

        // Check if dependencies are resolved
        const blocked: string[] = [];
        for (const dep of dependencies) {
          const dr = giteaApi(`/issues/${dep}`, "GET", null, opts, ctx.cwd);
          if (dr.ok && dr.data) {
            const depIssue = dr.data as Record<string, unknown>;
            if (depIssue.state === "open") {
              blocked.push(dep);
            }
          }
        }
        if (blocked.length > 0) {
          issues.push(`🔒 Blocked by unresolved dependencies: #${blocked.join(", #")}`);
        } else {
          lines.push(`   Dependencies resolved: ✅`);
        }
      }

      // 5. Already assigned?
      if (issue.assignee) {
        issues.push(`⚠️ Already assigned to ${(issue.assignee as any)?.login}`);
      }

      // Summary
      const hasBlockers = issues.some(i => i.startsWith("❌") || i.startsWith("🔒"));
      if (issues.length > 0) {
        lines.push("");
        for (const i of issues) lines.push(`   ${i}`);
      }

      if (hasBlockers) {
        lines.push("", "❌ Issue is not ready to start. Resolve blockers first.");
      } else if (issues.length === 0) {
        lines.push("", "✅ Issue is ready! Use project_start() to begin work.");
      } else {
        lines.push("", "⚠️ Issue has warnings but can be started.");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          issueId,
          title: issue.title,
          state: issue.state,
          dependencies,
          ready: !hasBlockers,
        },
      };
    },
  });

  // ═══════════════════════════════════════
  // Tool: project_start
  // ═══════════════════════════════════════
  pi.registerTool({
    name: "project_start",
    label: "Start Work on Issue",
    description: "Mark an issue as in-progress. Checks WIP limits, dependency blocking, and template completeness.",
    parameters: Type.Object({
      issue_id: Type.String({ description: "Issue number to start working on" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const config = loadConfig(ctx.cwd);
      const opts = resolveGitea(ctx.cwd);
      const issueId = params.issue_id.replace(/^#/, "");

      // Fetch issue
      const r = giteaApi(`/issues/${issueId}`, "GET", null, opts, ctx.cwd);
      if (!r.ok || !r.data) {
        return {
          content: [{ type: "text", text: `Issue #${issueId} not found.` }],
          isError: true,
          details: {},
        };
      }

      const issue = r.data as Record<string, unknown>;

      // 1. Template validation
      const body = (issue.body as string) || "";
      const templateCheck = validateIssueTemplate(body, config);
      if (!templateCheck.ok) {
        return {
          content: [{
            type: "text",
            text: [
              `❌ Issue #${issueId} is missing required sections:`,
              ...templateCheck.missingSections.map(s => `   - ${s}`),
              "",
              `Required: ${config.requiredSections.join(", ")}`,
              "Add the missing sections to the issue body before starting work.",
            ].join("\n"),
          }],
          isError: true,
          details: { missingSections: templateCheck.missingSections },
        };
      }

      // 2. Dependency check
      const dependencies = parseDependencies(body, config);
      if (dependencies.length > 0) {
        const blocked: string[] = [];
        for (const dep of dependencies) {
          const dr = giteaApi(`/issues/${dep}`, "GET", null, opts, ctx.cwd);
          if (dr.ok && dr.data) {
            const depIssue = dr.data as Record<string, unknown>;
            if (depIssue.state === "open") {
              blocked.push(dep);
            }
          }
        }
        if (blocked.length > 0) {
          return {
            content: [{
              type: "text",
              text: [
                `🔒 Cannot start — blocked by unresolved dependencies:`,
                ...blocked.map(b => `   - #${b} (still open)`),
                "",
                "Close or merge the blocking issues first.",
              ].join("\n"),
            }],
            isError: true,
            details: { blockedBy: blocked },
          };
        }
      }

      // 3. WIP limit check
      const wip = countOpenPRs(opts, ctx.cwd);
      const author = issue.user?.login || "factory";
      const currentWip = wip.byAuthor[author as string] || 0;

      if (currentWip >= config.maxWip) {
        return {
          content: [{
            type: "text",
            text: [
              `⚠️ WIP limit reached (${currentWip}/${config.maxWip} open PRs).`,
              "",
              `Your open PRs:`,
              `   (check with project_status())`,
              "",
              `Complete or close existing PRs before starting new work.`,
              `WIP limit: ${config.maxWip} — configured in .projectrc.yml`,
            ].join("\n"),
          }],
          isError: true,
          details: { currentWip, maxWip: config.maxWip },
        };
      }

      // 4. All checks passed — mark as started
      activeIssueId = issueId;

      return {
        content: [{
          type: "text",
          text: [
            `✅ Work started on #${issueId}: "${issue.title || "untitled"}"`,
            `   WIP: ${currentWip + 1}/${config.maxWip}`,
            "",
            `Next: Use contrib_start_work(#${issueId}) to create your branch,`,
            `then contrib_propose() → contrib_submit() to ship.`,
          ].join("\n"),
        }],
        details: { issueId, title: issue.title, wip: currentWip + 1, maxWip: config.maxWip },
      };
    },
  });

  // ═══════════════════════════════════════
  // Tool: project_status
  // ═══════════════════════════════════════
  pi.registerTool({
    name: "project_status",
    label: "Project Status",
    description: "Show project board — active issues, WIP counts, blockers, and open PRs.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const config = loadConfig(ctx.cwd);
      const opts = resolveGitea(ctx.cwd);

      const lines: string[] = [];
      lines.push("📊 Project Status");
      lines.push("");

      // WIP summary
      const wip = countOpenPRs(opts, ctx.cwd);
      lines.push(`🏗 WIP: ${wip.total} open PRs (limit: ${config.maxWip} per agent)`);
      if (Object.keys(wip.byAuthor).length > 0) {
        lines.push("");
        for (const [author, count] of Object.entries(wip.byAuthor).sort(([, a], [, b]) => b - a)) {
          const status = count >= config.maxWip ? "⚠️ AT LIMIT" : "✅";
          lines.push(`   ${author}: ${count}/${config.maxWip} ${status}`);
        }
      }

      // Open issues (recent)
      const issues = giteaApi("/issues?state=open&limit=10", "GET", null, opts, ctx.cwd);
      if (issues.ok && Array.isArray(issues.data)) {
        const openIssues = issues.data as Record<string, unknown>[];
        const assigned = openIssues.filter(i => i.assignee);
        const unassigned = openIssues.filter(i => !i.assignee);

        lines.push("");
        lines.push(`📝 ${assigned.length} assigned, ${unassigned.length} unassigned open issues`);

        if (assigned.length > 0) {
          lines.push("");
          lines.push("   In Progress:");
          for (const i of assigned.slice(0, 10)) {
            const labels = (i.labels as any[])?.map((l: any) => l.name).join(", ") || "";
            const assignee = (i.assignee as any)?.login || "?";
            lines.push(`   - #${i.number} [${assignee}] ${i.title}${labels ? ` (${labels})` : ""}`);
          }
        }

        // Flag blocked issues
        const blocked = openIssues.filter(i => {
          const b = (i.body as string) || "";
          const deps = parseDependencies(b, config);
          return deps.length > 0;
        });

        if (blocked.length > 0) {
          lines.push("");
          lines.push(`🔒 ${blocked.length} blocked issues (unresolved dependencies):`);
          for (const i of blocked.slice(0, 5)) {
            const deps = parseDependencies((i.body as string) || "", config);
            lines.push(`   - #${i.number} ${i.title} → depends on #${deps.join(", #")}`);
          }
        }
      }

      // Active issue
      if (activeIssueId) {
        lines.push("");
        lines.push(`🎯 Currently working on: #${activeIssueId}`);
      }

      // Release info
      const tags = exec("git tag --sort=-creatordate | head -3", ctx.cwd);
      if (tags.ok && tags.stdout) {
        lines.push("");
        lines.push("🏷 Recent tags:");
        for (const tag of tags.stdout.split("\n").filter(Boolean)) {
          lines.push(`   ${tag}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { wip, activeIssueId },
      };
    },
  });

  // ═══════════════════════════════════════
  // Tool: project_release_notes
  // ═══════════════════════════════════════
  pi.registerTool({
    name: "project_release_notes",
    label: "Generate Release Notes",
    description: "Generate release notes from conventional commits between two tags or from the latest tag to HEAD.",
    parameters: Type.Object({
      from: Type.Optional(Type.String({ description: "Starting tag/ref (default: latest tag)" })),
      to: Type.Optional(Type.String({ description: "Ending tag/ref (default: HEAD)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const config = loadConfig(ctx.cwd);

      // Determine range
      let from = params.from || "";
      const to = params.to || "HEAD";

      if (!from) {
        // Use latest tag
        const latestTag = exec("git describe --tags --abbrev=0 2>/dev/null || echo ''", ctx.cwd);
        from = latestTag.stdout || "";
      }

      if (!from) {
        // No tags found — use all commits
        const firstCommit = exec("git rev-list --max-parents=0 HEAD", ctx.cwd);
        from = firstCommit.stdout || "";
      }

      if (!from && !to) {
        return {
          content: [{ type: "text", text: "No commits or tags found to generate release notes from." }],
          isError: true,
          details: {},
        };
      }

      const release = generateReleaseNotes(from, to, config, ctx.cwd);

      // Check if there's anything
      const totalEntries = Object.values(release.sections).reduce((sum, arr) => sum + arr.length, 0);
      if (totalEntries === 0) {
        return {
          content: [{
            type: "text",
            text: `No conventional commits found between ${from} and ${to}.`,
          }],
          isError: true,
          details: {},
        };
      }

      const notes = formatReleaseNotes(release);

      return {
        content: [{ type: "text", text: notes }],
        details: { from, to, totalEntries, sections: release.sections },
      };
    },
  });

  // ═══════════════════════════════════════
  // Session cleanup
  // ═══════════════════════════════════════
  pi.on("session_shutdown", async () => {
    activeIssueId = null;
  });
}
