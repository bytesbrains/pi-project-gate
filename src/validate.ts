import type { ProjectConfig } from "./config";

export function validateIssueTemplate(body: string, config: ProjectConfig): { ok: true } | { ok: false; missingSections: string[] } {
  const missing = config.requiredSections.filter(s => !body.includes(s));
  return missing.length > 0 ? { ok: false, missingSections: missing } : { ok: true };
}

export function parseDependencies(body: string, config: ProjectConfig): string[] {
  const pattern = new RegExp(config.dependencyPattern, "gi");
  const deps = new Set<string>();
  let match;
  while ((match = pattern.exec(body)) !== null) deps.add(match[1]);
  return [...deps];
}

export interface CommitEntry { hash: string; type: string; scope: string; subject: string; }

export function parseConventionalCommits(log: string): CommitEntry[] {
  const entries: CommitEntry[] = [];
  const commits = log.split(/\n(?=commit )/);
  for (const block of commits) {
    const hashMatch = block.match(/^commit (\S+)/m);
    if (!hashMatch) continue;
    const subjectLine = block.split("\n").find(l => l.trim() && !l.startsWith("commit ") && !l.startsWith("Author:") && !l.startsWith("Date:"));
    if (!subjectLine) continue;
    const convMatch = subjectLine.trim().match(/^(feat|fix|perf|refactor|chore|docs|style|test|ci|build|revert)(?:\(([^)]+)\))?:\s(.+)$/);
    if (!convMatch) continue;
    entries.push({ hash: hashMatch[1].slice(0, 8), type: convMatch[1], scope: convMatch[2] || "", subject: convMatch[3].trim() });
  }
  return entries;
}
