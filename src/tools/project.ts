import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config";
import { exec, currentBranch, resolveGitea, giteaApi } from "../helpers";
import { validateIssueTemplate, parseDependencies, parseConventionalCommits } from "../validate";

const LABELS: Record<string, string> = { feat: "🚀 Features", fix: "🐛 Bug Fixes", perf: "⚡ Performance", refactor: "♻️ Refactoring", chore: "🔧 Chores", docs: "📝 Documentation", test: "✅ Tests", ci: "👷 CI/CD", build: "📦 Build", other: "📌 Other" };

export const checkTool = {
  name: "project_check" as const, label: "Check Issue Readiness",
  description: "Validate that an issue is ready to be worked on.",
  parameters: Type.Object({ issue_id: Type.String({}) }),
  async execute(_id: string, params: any, _s: any, _u: any, ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd); const opts = resolveGitea(ctx.cwd);
    const issueId = params.issue_id.replace(/^#/, "");
    const r = await giteaApi(`/issues/${issueId}`, "GET", null, opts, ctx.cwd);
    if (!r.ok || !r.data) return { content: [{ type: "text", text: `Issue #${issueId} not found.` }], isError: true, details: {} };
    const issue = r.data as Record<string, unknown>;
    const lines: string[] = []; const issues: string[] = [];
    lines.push(`📋 Issue #${issueId}: ${issue.title}`);
    const body = (issue.body as string) || "";
    const tpl = validateIssueTemplate(body, config);
    if (!tpl.ok) issues.push(`❌ Missing sections: ${tpl.missingSections.join(", ")}`);
    else lines.push("   Template: ✅");
    const complexity = config.complexityLevels.find(l => body.toLowerCase().includes(l.toLowerCase()));
    lines.push(`   Complexity: ${complexity || "?"}`);
    const deps = parseDependencies(body, config);
    if (deps.length > 0) {
      const blocked: string[] = [];
      for (const dep of deps) { const dr = await giteaApi(`/issues/${dep}`, "GET", null, opts, ctx.cwd); if (dr.ok && (dr.data as any)?.state === "open") blocked.push(dep); }
      if (blocked.length > 0) issues.push(`🔒 Blocked by: #${blocked.join(", #")}`);
      else lines.push("   Dependencies: ✅");
    }
    if (issue.assignee) issues.push(`⚠️ Assigned to ${(issue.assignee as any)?.login}`);
    if (issues.length > 0) { lines.push(""); for (const i of issues) lines.push(`   ${i}`); }
    const blocked = issues.some(i => i.startsWith("❌") || i.startsWith("🔒"));
    lines.push("", blocked ? "❌ Not ready." : issues.length === 0 ? "✅ Ready!" : "⚠️ Warnings but can start.");
    return { content: [{ type: "text", text: lines.join("\n") }], details: { ready: !blocked } };
  },
};

export const startTool = {
  name: "project_start" as const, label: "Start Work",
  description: "Mark an issue as in-progress. Checks WIP limits, dependencies, template.",
  parameters: Type.Object({ issue_id: Type.String({}) }),
  async execute(_id: string, params: any, _s: any, _u: any, ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd); const opts = resolveGitea(ctx.cwd);
    const issueId = params.issue_id.replace(/^#/, "");
    const r = await giteaApi(`/issues/${issueId}`, "GET", null, opts, ctx.cwd);
    if (!r.ok || !r.data) return { content: [{ type: "text", text: `Issue #${issueId} not found.` }], isError: true, details: {} };
    const issue = r.data as Record<string, unknown>;
    const body = (issue.body as string) || "";
    const tpl = validateIssueTemplate(body, config);
    if (!tpl.ok) return { content: [{ type: "text", text: `❌ Missing sections: ${tpl.missingSections.join(", ")}` }], isError: true, details: {} };
    const deps = parseDependencies(body, config);
    if (deps.length > 0) {
      const blocked: string[] = [];
      for (const dep of deps) { const dr = await giteaApi(`/issues/${dep}`, "GET", null, opts, ctx.cwd); if (dr.ok && (dr.data as any)?.state === "open") blocked.push(dep); }
      if (blocked.length > 0) return { content: [{ type: "text", text: `🔒 Blocked: #${blocked.join(", #")}` }], isError: true, details: {} };
    }
    const wipR = await giteaApi("/pulls?state=open&limit=100", "GET", null, opts, ctx.cwd);
    const prs = Array.isArray(wipR.data) ? wipR.data : [];
    const author = (issue.user as any)?.login || "factory";
    const currentWip = prs.filter((p: any) => p.user?.login === author).length;
    if (currentWip >= config.maxWip) return { content: [{ type: "text", text: `⚠️ WIP limit reached (${currentWip}/${config.maxWip}).` }], isError: true, details: {} };
    (globalThis as any).__project_issueId = issueId;
    return { content: [{ type: "text", text: `✅ Work started on #${issueId}: "${issue.title}" (WIP ${currentWip + 1}/${config.maxWip})` }], details: { issueId } };
  },
};

export const statusTool = {
  name: "project_status" as const, label: "Project Status",
  description: "Show project board — active issues, WIP, blockers.",
  parameters: Type.Object({}),
  async execute(_id: string, _p: any, _s: any, _u: any, ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd); const opts = resolveGitea(ctx.cwd);
    const lines = ["📊 Project Status", ""];
    const wipR = await giteaApi("/pulls?state=open&limit=100", "GET", null, opts, ctx.cwd);
    const prs = Array.isArray(wipR.data) ? wipR.data : [];
    const byAuthor: Record<string, number> = {};
    for (const pr of prs) { const a = (pr as any).user?.login || "?"; byAuthor[a] = (byAuthor[a] || 0) + 1; }
    lines.push(`🏗 WIP: ${prs.length} open PRs (limit: ${config.maxWip})`);
    for (const [a, c] of Object.entries(byAuthor).sort(([, a], [, b]) => b - a)) lines.push(`   ${a}: ${c}/${config.maxWip} ${c >= config.maxWip ? "⚠️" : "✅"}`);
    const issuesR = await giteaApi("/issues?state=open&limit=10", "GET", null, opts, ctx.cwd);
    if (issuesR.ok && Array.isArray(issuesR.data)) {
      const assigned = (issuesR.data as any[]).filter((i: any) => i.assignee).slice(0, 5);
      if (assigned.length > 0) { lines.push("", "In Progress:"); for (const i of assigned) lines.push(`   - #${i.number} [${i.assignee?.login}] ${i.title}`); }
    }
    return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
  },
};

export const releaseTool = {
  name: "project_release_notes" as const, label: "Generate Release Notes",
  description: "Generate release notes from conventional commits.",
  parameters: Type.Object({ from: Type.Optional(Type.String({})), to: Type.Optional(Type.String({})) }),
  async execute(_id: string, params: any, _s: any, _u: any, ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd);
    let from = params.from || exec("git describe --tags --abbrev=0 2>/dev/null || echo ''", ctx.cwd).stdout;
    const to = params.to || "HEAD";
    if (!from) from = exec("git rev-list --max-parents=0 HEAD", ctx.cwd).stdout;
    const range = from ? `${from}..${to}` : to;
    const log = exec(`git log ${range} --format="commit %H%n%B%n---" --no-merges`, ctx.cwd);
    const commits = parseConventionalCommits(log.stdout || "");
    const sections: Record<string, string[]> = {};
    for (const g of config.releaseNoteGroups) sections[g] = [];
    sections["other"] = [];
    for (const c of commits) { const prefix = config.releaseNoteIncludeHashes ? `- ${c.hash} ` : "- "; const line = `${prefix}${c.scope ? `**${c.scope}**: ` : ""}${c.subject}`; (sections[c.type] || sections["other"]).push(line); }
    const lines = [`# Release ${to} (${new Date().toISOString().split("T")[0]})`, ""];
    for (const [group, entries] of Object.entries(sections)) { if (entries.length === 0) continue; lines.push(`### ${LABELS[group] || group}`, ""); for (const e of entries) lines.push(e); lines.push(""); }
    return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
  },
};
