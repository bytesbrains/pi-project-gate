import * as cp from "node:child_process";

export function exec(cmd: string, cwd?: string): { ok: boolean; stdout: string; stderr: string } {
  try { const r = cp.execSync(cmd, { cwd, encoding: "utf-8", timeout: 30000 }); return { ok: true, stdout: r.trim(), stderr: "" }; }
  catch (e: any) { return { ok: false, stdout: e.stdout?.trim() || "", stderr: e.stderr?.trim() || e.message }; }
}

export function currentBranch(cwd: string): string { return exec("git branch --show-current", cwd).stdout; }

export function resolveGitea(cwd: string): { repo: string; token: string } {
  const remote = exec("git remote get-url gitea 2>/dev/null || git remote get-url origin", cwd);
  const url = remote.stdout || "";
  const match = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  const repo = match ? `${match[1]}/${match[2]}` : "factory/wrok.in";
  const credMatch = url.match(/:\/\/([^:]+):([^@]+)@/);
  return { repo, token: credMatch ? credMatch[2] : "" };
}

export function giteaApi(path: string, method: string, body: Record<string, unknown> | null, opts: { repo: string; token?: string }, cwd: string): { ok: boolean; data: unknown; error?: string } {
  const base = `http://127.0.0.1:3001/api/v1/repos/${opts.repo}`;
  const headers = [opts.token ? `-H "Authorization: token ${opts.token}"` : "", `-H "Content-Type: application/json"`].filter(Boolean).join(" ");
  const dataFlag = body ? `-d '${JSON.stringify(body).replace(/'/g, "'\\''")}'` : "";
  const cmd = `curl -sf -w "\\n%{http_code}" -X ${method} "${base}${path}" ${headers} ${dataFlag}`;
  const r = exec(cmd, cwd);
  if (!r.ok) { const lines = r.stdout.split("\n"); return { ok: false, data: null, error: r.stderr || lines.slice(0, -1).join("\n") || "API error" }; }
  const lines = r.stdout.split("\n"); const bodyText = lines.slice(0, -1).join("\n");
  try { return { ok: true, data: JSON.parse(bodyText) }; } catch { return { ok: true, data: bodyText }; }
}
