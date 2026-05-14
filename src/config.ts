import * as fs from "node:fs";
import * as path from "node:path";

export interface ProjectConfig {
  maxWip: number;
  requiredSections: string[];
  complexityLevels: string[];
  areas: string[];
  releaseNoteGroups: string[];
  releaseNoteIncludeHashes: boolean;
  dependencyPattern: string;
}

export const DEFAULT_CONFIG: ProjectConfig = {
  maxWip: 3,
  requiredSections: ["## Problem", "## Proposed Solution", "## Acceptance Criteria"],
  complexityLevels: ["trivial", "small", "medium", "large", "epic"],
  areas: [],
  releaseNoteGroups: ["feat", "fix", "perf", "refactor", "chore", "docs", "test", "ci", "build"],
  releaseNoteIncludeHashes: false,
  dependencyPattern: "(?:Depends on|Blocked by|Requires)\\s+#(\\d+)",
};

export function loadConfig(cwd: string): ProjectConfig {
  const configPath = path.join(cwd, ".projectrc.yml");
  if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const result: Record<string, unknown> = {};
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*([\w][\w.]*):\s*(.+)$/);
      if (m) {
        let val = m[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        result[m[1]] = val;
      }
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
  } catch { return { ...DEFAULT_CONFIG }; }
}
