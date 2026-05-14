/**
 * pi-project-gate — Project Orchestration Gate
 *
 * Tools: project_check, project_start, project_status, project_release_notes
 * Config: .projectrc.yml
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkTool, startTool, statusTool, releaseTool } from "./tools/project";

export default function (pi: ExtensionAPI) {
  pi.registerTool(checkTool);
  pi.registerTool(startTool);
  pi.registerTool(statusTool);
  pi.registerTool(releaseTool);
  pi.on("session_shutdown", () => { delete (globalThis as any).__project_issueId; });
}
