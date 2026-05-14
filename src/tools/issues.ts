import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config";
import { resolveGitea, giteaApi } from "../helpers";
import { validateIssueTemplate } from "../validate";

// ─── Create Issue ───────────────────────────────────────────────────────────────

export const createTool = {
  name: "project_create_issue" as const,
  label: "Create Issue",
  description:
    "Create a new issue with structured body. Validates required template sections before creation.",
  parameters: Type.Object({
    title: Type.String({ description: "Issue title" }),
    body: Type.String({ description: "Issue body in markdown (must include required sections)" }),
    labels: Type.Optional(Type.Array(Type.String({}), { description: "Labels to apply" })),
    milestone: Type.Optional(Type.String({ description: "Milestone title or ID" })),
    assignee: Type.Optional(Type.String({ description: "Username to assign" })),
  }),
  async execute(_id: string, params: any, _s: any, _u: any, ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd);
    const opts = resolveGitea(ctx.cwd);

    // Validate template
    const tpl = validateIssueTemplate(params.body, config);
    if (!tpl.ok) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Issue body is missing required sections:\n  - ${tpl.missingSections.join("\n  - ")}`,
          },
        ],
        isError: true,
        details: { missingSections: tpl.missingSections },
      };
    }

    // Detect complexity from body
    const complexity = config.complexityLevels.find((l) =>
      params.body.toLowerCase().includes(l.toLowerCase()),
    );

    // Build payload
    const payload: Record<string, unknown> = {
      title: params.title,
      body: params.body,
    };
    if (params.labels && params.labels.length > 0) payload.labels = params.labels;
    if (params.milestone) payload.milestone = params.milestone;
    if (params.assignee) payload.assignee = params.assignee;

    const r = giteaApi("/issues", "POST", payload, opts, ctx.cwd);
    if (!r.ok || !r.data) {
      return {
        content: [{ type: "text", text: `❌ Failed to create issue: ${r.error || "unknown error"}` }],
        isError: true,
        details: {},
      };
    }

    const issue = r.data as Record<string, unknown>;
    const lines = [
      `✅ Issue #${issue.number} created: "${issue.title}"`,
      `   URL: ${issue.html_url || `http://127.0.0.1:3001/${opts.repo}/issues/${issue.number}`}`,
    ];
    if (complexity) lines.push(`   Complexity: ${complexity}`);
    if (params.labels?.length) lines.push(`   Labels: ${params.labels.join(", ")}`);
    if (params.milestone) lines.push(`   Milestone: ${params.milestone}`);
    if (params.assignee) lines.push(`   Assignee: ${params.assignee}`);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { issueId: issue.number, url: issue.html_url },
    };
  },
};

// ─── Update Issue ───────────────────────────────────────────────────────────────

export const updateTool = {
  name: "project_update_issue" as const,
  label: "Update Issue",
  description:
    "Update an existing issue — title, body, state (open/closed), labels, milestone, or assignee.",
  parameters: Type.Object({
    issue_id: Type.String({ description: "Issue number or ID" }),
    title: Type.Optional(Type.String({ description: "New title" })),
    body: Type.Optional(Type.String({ description: "New body in markdown" })),
    state: Type.Optional(
      Type.String({ description: 'State: "open" or "closed"' }),
    ),
    labels: Type.Optional(Type.Array(Type.String({}), { description: "Replacement labels" })),
    milestone: Type.Optional(Type.String({ description: "Milestone title or ID, or null to remove" })),
    assignee: Type.Optional(Type.String({ description: "Username to assign, or empty string to unassign" })),
  }),
  async execute(_id: string, params: any, _s: any, _u: any, ctx: ExtensionContext) {
    const config = loadConfig(ctx.cwd);
    const opts = resolveGitea(ctx.cwd);
    const issueId = String(params.issue_id).replace(/^#/, "");

    // Fetch current issue to verify it exists
    const current = giteaApi(`/issues/${issueId}`, "GET", null, opts, ctx.cwd);
    if (!current.ok || !current.data) {
      return {
        content: [{ type: "text", text: `❌ Issue #${issueId} not found.` }],
        isError: true,
        details: {},
      };
    }

    // Validate body template if body is being updated
    if (params.body) {
      const tpl = validateIssueTemplate(params.body, config);
      if (!tpl.ok) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Updated body is missing required sections:\n  - ${tpl.missingSections.join("\n  - ")}`,
            },
          ],
          isError: true,
          details: { missingSections: tpl.missingSections },
        };
      }
    }

    // Build patch payload — only include fields that were provided
    const payload: Record<string, unknown> = {};
    if (params.title !== undefined) payload.title = params.title;
    if (params.body !== undefined) payload.body = params.body;
    if (params.state !== undefined) payload.state = params.state;
    if (params.labels !== undefined) payload.labels = params.labels;
    if (params.milestone !== undefined) payload.milestone = params.milestone;
    if (params.assignee !== undefined) payload.assignee = params.assignee;

    if (Object.keys(payload).length === 0) {
      return {
        content: [{ type: "text", text: "⚠️ No fields to update." }],
        isError: true,
        details: {},
      };
    }

    const r = giteaApi(`/issues/${issueId}`, "PATCH", payload, opts, ctx.cwd);
    if (!r.ok || !r.data) {
      return {
        content: [{ type: "text", text: `❌ Failed to update issue: ${r.error || "unknown error"}` }],
        isError: true,
        details: {},
      };
    }

    const issue = r.data as Record<string, unknown>;
    const changes: string[] = [];
    if (params.title !== undefined) changes.push("title");
    if (params.body !== undefined) changes.push("body");
    if (params.state !== undefined) changes.push(`state → ${params.state}`);
    if (params.labels !== undefined) changes.push("labels");
    if (params.milestone !== undefined) changes.push("milestone");
    if (params.assignee !== undefined) changes.push("assignee");

    return {
      content: [
        {
          type: "text",
          text: `✅ Issue #${issueId} updated: "${issue.title}"\n   Changed: ${changes.join(", ")}`,
        },
      ],
      details: { issueId, changed: changes },
    };
  },
};

// ─── List Issues ────────────────────────────────────────────────────────────────

export const listTool = {
  name: "project_list_issues" as const,
  label: "List Issues",
  description:
    "Search and list issues with optional filters: state, labels, milestone, assignee, keyword, and pagination.",
  parameters: Type.Object({
    state: Type.Optional(Type.String({ description: 'Filter by state: "open" or "closed" (default: open)' })),
    labels: Type.Optional(Type.String({ description: "Comma-separated label names" })),
    milestone: Type.Optional(Type.String({ description: "Filter by milestone title" })),
    assignee: Type.Optional(Type.String({ description: "Filter by assignee username" })),
    q: Type.Optional(Type.String({ description: "Full-text search query (searches title + body)" })),
    limit: Type.Optional(Type.Number({ description: "Max issues to return (default: 20, max: 100)" })),
    page: Type.Optional(Type.Number({ description: "Page number (default: 1)" })),
  }),
  async execute(_id: string, params: any, _s: any, _u: any, ctx: ExtensionContext) {
    const opts = resolveGitea(ctx.cwd);
    const queryParts: string[] = [];
    queryParts.push(`state=${params.state || "open"}`);
    queryParts.push(`limit=${Math.min(params.limit || 20, 100)}`);
    queryParts.push(`page=${params.page || 1}`);
    if (params.labels) queryParts.push(`labels=${encodeURIComponent(params.labels)}`);
    if (params.milestone) queryParts.push(`milestone=${encodeURIComponent(params.milestone)}`);
    if (params.assignee) queryParts.push(`assignee=${encodeURIComponent(params.assignee)}`);
    if (params.q) queryParts.push(`q=${encodeURIComponent(params.q)}`);

    const r = giteaApi(`/issues?${queryParts.join("&")}`, "GET", null, opts, ctx.cwd);
    if (!r.ok) {
      return {
        content: [{ type: "text", text: `❌ Failed to list issues: ${r.error || "unknown error"}` }],
        isError: true,
        details: {},
      };
    }

    const issues = Array.isArray(r.data) ? r.data : [];
    if (issues.length === 0) {
      return {
        content: [{ type: "text", text: "No issues found." }],
        details: { count: 0 },
      };
    }

    const lines = [`📋 Issues (${issues.length} found)`];
    if (params.q) lines.push(`   Search: "${params.q}"`);
    lines.push("");

    for (const issue of issues as any[]) {
      const labels =
        issue.labels && issue.labels.length > 0
          ? ` [${issue.labels.map((l: any) => l.name).join(", ")}]`
          : "";
      const assignee = issue.assignee ? ` (👤 ${issue.assignee.login})` : "";
      lines.push(
        `   #${issue.number} ${issue.state === "closed" ? "🔒" : "🟢"} ${issue.title}${labels}${assignee}`,
      );
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { count: issues.length, issues: issues.map((i: any) => i.number) },
    };
  },
};

// ─── Get Issue ───────────────────────────────────────────────────────────────────

export const getTool = {
  name: "project_get_issue" as const,
  label: "Get Issue",
  description:
    "Get full details of an issue including its body, labels, milestone, assignee, and recent comments.",
  parameters: Type.Object({
    issue_id: Type.String({ description: "Issue number or ID" }),
    include_comments: Type.Optional(
      Type.Boolean({ description: "Include recent comments (default: true)" }),
    ),
  }),
  async execute(_id: string, params: any, _s: any, _u: any, ctx: ExtensionContext) {
    const opts = resolveGitea(ctx.cwd);
    const issueId = String(params.issue_id).replace(/^#/, "");

    const r = giteaApi(`/issues/${issueId}`, "GET", null, opts, ctx.cwd);
    if (!r.ok || !r.data) {
      return {
        content: [{ type: "text", text: `❌ Issue #${issueId} not found.` }],
        isError: true,
        details: {},
      };
    }

    const issue = r.data as Record<string, unknown>;
    const labels = Array.isArray(issue.labels)
      ? (issue.labels as any[]).map((l) => l.name).join(", ")
      : "(none)";

    const lines = [
      `📋 Issue #${issueId}`,
      `   Title: ${issue.title}`,
      `   State: ${issue.state}  |  Created: ${String(issue.created_at).slice(0, 10)}`,
      `   Author: ${(issue.user as any)?.login || "?"}`,
      `   Assignee: ${(issue.assignee as any)?.login || "(unassigned)"}`,
      `   Milestone: ${(issue.milestone as any)?.title || "(none)"}`,
      `   Labels: ${labels}`,
      `   URL: ${issue.html_url || `http://127.0.0.1:3001/${opts.repo}/issues/${issueId}`}`,
      "",
      "─── Body ───",
      issue.body || "(empty)",
      "",
    ];

    // Fetch comments
    const includeComments = params.include_comments !== false;
    if (includeComments) {
      const cr = giteaApi(
        `/issues/${issueId}/comments?limit=20`,
        "GET",
        null,
        opts,
        ctx.cwd,
      );
      const comments = Array.isArray(cr.data) ? cr.data : [];
      if (comments.length > 0) {
        lines.push(`─── Comments (${comments.length}) ───`);
        for (const c of comments as any[]) {
          const date = String(c.created_at).slice(0, 10);
          const user = c.user?.login || "?";
          const body = (c.body || "").split("\n").slice(0, 5).join("\n");
          lines.push(`\n   [${date}] ${user}:`);
          for (const bl of body.split("\n")) {
            lines.push(`   ${bl}`);
          }
          if ((c.body || "").split("\n").length > 5) lines.push("   ...");
        }
      } else {
        lines.push("─── Comments ───");
        lines.push("   (none)");
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: {
        issueId,
        state: issue.state,
        title: issue.title,
        url: issue.html_url,
      },
    };
  },
};
