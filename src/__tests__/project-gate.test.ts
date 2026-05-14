import { describe, it, expect } from "vitest";
import { loadConfig, DEFAULT_CONFIG } from "../config";
import { validateIssueTemplate, parseDependencies, parseConventionalCommits } from "../validate";
import { exec } from "../helpers";
import { createTool, updateTool, listTool, getTool } from "../tools/issues";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ═══════════════════════════════════════
// Config
// ═══════════════════════════════════════
describe("ProjectConfig", () => {
  it("returns defaults when no config", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-test-"));
    const config = loadConfig(tmp);
    expect(config.maxWip).toBe(3);
    expect(config.requiredSections).toContain("## Problem");
    expect(config.requiredSections).toContain("## Proposed Solution");
    expect(config.requiredSections).toContain("## Acceptance Criteria");
    expect(config.complexityLevels).toContain("medium");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses projectrc.yml", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-test-"));
    fs.writeFileSync(path.join(tmp, ".projectrc.yml"), [
      "maxWip: 5",
      'requiredSections: "## Problem,## Solution"',
      'areas: "backend,frontend,infra"',
      "releaseNoteIncludeHashes: true",
    ].join("\n"));
    const config = loadConfig(tmp);
    expect(config.maxWip).toBe(5);
    expect(config.requiredSections).toEqual(["## Problem", "## Solution"]);
    expect(config.areas).toEqual(["backend", "frontend", "infra"]);
    expect(config.releaseNoteIncludeHashes).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════
// Issue template validation
// ═══════════════════════════════════════
describe("validateIssueTemplate", () => {
  const config = {
    ...DEFAULT_CONFIG,
    requiredSections: ["## Problem", "## Proposed Solution", "## Acceptance Criteria"],
  };

  it("passes a complete template", () => {
    const body = "## Problem\nSomething is broken\n\n## Proposed Solution\nFix it\n\n## Acceptance Criteria\n- [ ] Tests pass";
    expect(validateIssueTemplate(body, config).ok).toBe(true);
  });

  it("fails when missing a section", () => {
    const body = "## Problem\nSomething is broken\n\n## Proposed Solution\nFix it";
    const result = validateIssueTemplate(body, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingSections).toContain("## Acceptance Criteria");
    }
  });

  it("fails when all sections missing", () => {
    const body = "Just a description with no sections";
    const result = validateIssueTemplate(body, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingSections.length).toBe(3);
    }
  });

  it("passes with custom required sections", () => {
    const customConfig = { ...config, requiredSections: ["## Description"] };
    expect(validateIssueTemplate("## Description\nSome text", customConfig).ok).toBe(true);
  });
});

// ═══════════════════════════════════════
// Dependency parsing
// ═══════════════════════════════════════
describe("parseDependencies", () => {
  const config = {
    ...DEFAULT_CONFIG,
    dependencyPattern: "(?:Depends on|Blocked by|Requires)\\s+#(\\d+)",
  };

  it("parses Depends on", () => {
    const deps = parseDependencies("Depends on #42", config);
    expect(deps).toEqual(["42"]);
  });

  it("parses Blocked by", () => {
    const deps = parseDependencies("Blocked by #123", config);
    expect(deps).toEqual(["123"]);
  });

  it("parses Requires", () => {
    const deps = parseDependencies("Requires #789", config);
    expect(deps).toEqual(["789"]);
  });

  it("parses multiple dependencies", () => {
    const deps = parseDependencies("Depends on #42 and Blocked by #123", config);
    expect(deps).toContain("42");
    expect(deps).toContain("123");
    expect(deps.length).toBe(2);
  });

  it("returns empty for no dependencies", () => {
    expect(parseDependencies("No dependencies here", config)).toEqual([]);
  });

  it("is case insensitive", () => {
    const deps = parseDependencies("depends on #42 and blocked by #99", config);
    expect(deps).toContain("42");
    expect(deps).toContain("99");
  });

  it("deduplicates", () => {
    const deps = parseDependencies("Depends on #42 and Depends on #42", config);
    expect(deps).toEqual(["42"]);
  });
});

// ═══════════════════════════════════════
// Conventional commit parsing
// ═══════════════════════════════════════
describe("parseConventionalCommits", () => {
  it("parses feat commits", () => {
    const log = "commit abc12345\nfeat(api): add new endpoint\n---";
    const commits = parseConventionalCommits(log);
    expect(commits.length).toBe(1);
    expect(commits[0].type).toBe("feat");
    expect(commits[0].scope).toBe("api");
    expect(commits[0].subject).toBe("add new endpoint");
    expect(commits[0].hash).toBe("abc12345");
  });

  it("parses fix commits without scope", () => {
    const log = "commit def67890\nfix: resolve null pointer\n---";
    const commits = parseConventionalCommits(log);
    expect(commits.length).toBe(1);
    expect(commits[0].type).toBe("fix");
    expect(commits[0].scope).toBe("");
    expect(commits[0].subject).toBe("resolve null pointer");
  });

  it("skips non-conventional commits", () => {
    const log = "commit ghi11111\nUpdated some stuff\n---";
    const commits = parseConventionalCommits(log);
    expect(commits.length).toBe(0);
  });

  it("parses multiple commits", () => {
    const log = "commit aaa11111\nfeat: first feature\n---\n\ncommit bbb22222\nfix: bug fix\n---";
    const commits = parseConventionalCommits(log);
    expect(commits.length).toBe(2);
    expect(commits[0].type).toBe("feat");
    expect(commits[1].type).toBe("fix");
  });

  it("handles chore and refactor types", () => {
    const log = "commit ccc33333\nchore(deps): update packages\n---\n\ncommit ddd44444\nrefactor: clean up\n---";
    const commits = parseConventionalCommits(log);
    expect(commits.length).toBe(2);
    expect(commits[0].type).toBe("chore");
    expect(commits[1].type).toBe("refactor");
  });
});

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════
describe("exec helper", () => {
  it("returns ok for valid command", () => {
    const r = exec("echo project-test");
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe("project-test");
  });

  it("returns not ok for invalid command", () => {
    const r = exec("nonexistent-cmd-xyz-999 2>/dev/null");
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════
// New config fields for issue CRUD
// ═══════════════════════════════════════
describe("issue config defaults", () => {
  it("has default issue labels", () => {
    expect(DEFAULT_CONFIG.issueLabels).toContain("enhancement");
    expect(DEFAULT_CONFIG.issueLabels).toContain("bug");
    expect(DEFAULT_CONFIG.issueLabels).toContain("documentation");
    expect(DEFAULT_CONFIG.issueLabels).toContain("question");
  });

  it("has create flags defaulting to false", () => {
    expect(DEFAULT_CONFIG.issueCreateRequireComplexity).toBe(false);
    expect(DEFAULT_CONFIG.issueCreateRequireArea).toBe(false);
  });

  it("parses issueLabels from projectrc.yml", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-test-"));
    fs.writeFileSync(path.join(tmp, ".projectrc.yml"), [
      'issueLabels: "enhancement,bug,frontend,backend"',
    ].join("\n"));
    const config = loadConfig(tmp);
    expect(config.issueLabels).toEqual(["enhancement", "bug", "frontend", "backend"]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses issueCreateRequire flags", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-test-"));
    fs.writeFileSync(path.join(tmp, ".projectrc.yml"), [
      "issueCreateRequireComplexity: true",
      "issueCreateRequireArea: true",
    ].join("\n"));
    const config = loadConfig(tmp);
    expect(config.issueCreateRequireComplexity).toBe(true);
    expect(config.issueCreateRequireArea).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════
// Tool definitions
// ═══════════════════════════════════════
describe("issue CRUD tool definitions", () => {
  it("createTool has proper metadata", () => {
    expect(createTool.name).toBe("project_create_issue");
    expect(createTool.label).toBe("Create Issue");
    expect(createTool.description).toContain("Create a new issue");
    expect(createTool.parameters).toBeDefined();
  });

  it("updateTool has proper metadata", () => {
    expect(updateTool.name).toBe("project_update_issue");
    expect(updateTool.label).toBe("Update Issue");
    expect(updateTool.description).toContain("Update an existing issue");
    // issue_id is required, all other fields optional
    const props = (updateTool.parameters as any)?.properties;
    expect(props["issue_id"]).toBeDefined();
    expect(props["title"]).toBeDefined();
    expect(props["body"]).toBeDefined();
    expect(props["state"]).toBeDefined();
    expect(props["labels"]).toBeDefined();
    expect(props["milestone"]).toBeDefined();
    expect(props["assignee"]).toBeDefined();
  });

  it("listTool has proper metadata", () => {
    expect(listTool.name).toBe("project_list_issues");
    expect(listTool.label).toBe("List Issues");
    expect(listTool.description).toContain("Search and list issues");
    const props = (listTool.parameters as any)?.properties;
    expect(props["state"]).toBeDefined();
    expect(props["labels"]).toBeDefined();
    expect(props["milestone"]).toBeDefined();
    expect(props["assignee"]).toBeDefined();
    expect(props["q"]).toBeDefined();
    expect(props["limit"]).toBeDefined();
    expect(props["page"]).toBeDefined();
  });

  it("getTool has proper metadata", () => {
    expect(getTool.name).toBe("project_get_issue");
    expect(getTool.label).toBe("Get Issue");
    expect(getTool.description).toContain("full details");
    const props = (getTool.parameters as any)?.properties;
    expect(props["issue_id"]).toBeDefined();
    expect(props["include_comments"]).toBeDefined();
  });
});

// ═══════════════════════════════════════
// Issue body validation (reused by create/update)
// ═══════════════════════════════════════
describe("issue create body validation", () => {
  const config = {
    ...DEFAULT_CONFIG,
    requiredSections: ["## Problem", "## Proposed Solution", "## Acceptance Criteria"],
  };

  it("accepts a well-formed issue body", () => {
    const body = "## Problem\nBug exists\n\n## Proposed Solution\nFix it\n\n## Acceptance Criteria\n- [ ] Done";
    expect(validateIssueTemplate(body, config).ok).toBe(true);
  });

  it("rejects body missing required sections", () => {
    const body = "## Problem\nBug exists";
    const result = validateIssueTemplate(body, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingSections.length).toBeGreaterThan(0);
    }
  });
});
