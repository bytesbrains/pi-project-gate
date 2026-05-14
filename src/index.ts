/**
 * pi-project-gate — Project Orchestration Gate
 *
 * Tools: project_check, project_start, project_status, project_release_notes,
 *        project_create_issue, project_update_issue, project_list_issues, project_get_issue
 * Config: .projectrc.yml
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkTool, startTool, statusTool, releaseTool } from "./tools/project";
import { createTool, updateTool, listTool, getTool } from "./tools/issues";

export default function (pi: ExtensionAPI) {
  pi.registerTool(checkTool);
  pi.registerTool(startTool);
  pi.registerTool(statusTool);
  pi.registerTool(releaseTool);
  pi.registerTool(createTool);
  pi.registerTool(updateTool);
  pi.registerTool(listTool);
  pi.registerTool(getTool);
  pi.on("session_shutdown", () => { delete (globalThis as any).__project_issueId; });
}
