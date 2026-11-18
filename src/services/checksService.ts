import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RepoRegistry } from '../adapter/repoRegistry';
import type { CheckId, CheckReport, CheckResult, ChangelistFileRef } from '../protocol/models';

export interface CheckFile {
  rootPath: string;
  path: string;
}

/** Editor-side check operations, implemented by ui/editorActions (vscode-bound). */
export interface EditorCheckPort {
  reformat(files: CheckFile[]): Promise<'ok' | 'skipped'>;
  optimizeImports(files: CheckFile[]): Promise<'ok' | 'skipped'>;
  cleanup(files: CheckFile[]): Promise<'ok' | 'skipped'>;
  analyze(files: CheckFile[]): Promise<{ problems: number; detail: string }>;
}

export type CheckProgress = (checkId: CheckId, status: 'running' | 'done') => void;

const UNAVAILABLE: ReadonlySet<CheckId> = new Set(['rearrange', 'copyright', 'runConfiguration', 'afterCommitUpload']);
const SCAN_FILE_CAP = 500;
const SCAN_SIZE_CAP = 2 * 1024 * 1024;
const AUDIT_TIMEOUT_MS = 60_000;
const TODO_RE = /\b(?:TODO|FIXME)\b/;

/**
 * Commit Checks runner. Editor checks delegate to the EditorCheckPort;
 * TODO scanning and dependency audits run here with fixed, whitelisted
 * argv (the git-only MiniRunner is deliberately not reused for npm/pnpm/yarn).
 */
export class ChecksService {
  constructor(
    private readonly registry: RepoRegistry,
    private readonly editor: EditorCheckPort,
  ) {}

  async run(repoIds: string[], checkIds: CheckId[], refs: ChangelistFileRef[], onProgress?: CheckProgress): Promise<CheckReport> {
    const wanted = new Set(repoIds);
    const files: CheckFile[] = [];
    for (const ref of refs) {
      if (!wanted.has(ref.repoId)) {
        continue;
      }
      const desc = this.registry.descriptor(ref.repoId);
      if (desc) {
        files.push({ rootPath: desc.rootPath, path: ref.path });
      }
    }
    const results: CheckResult[] = [];
    for (const id of checkIds) {
      onProgress?.(id, 'running');
      results.push(await this.runOne(id, files, repoIds));
      onProgress?.(id, 'done');
    }
    return { results };
  }

  private async runOne(id: CheckId, files: CheckFile[], repoIds: string[]): Promise<CheckResult> {
    if (UNAVAILABLE.has(id)) {
      return { id, status: 'unavailable', details: 'Not supported in this environment' };
    }
    if (files.length === 0 && id !== 'dependencies') {
      return { id, status: 'skipped', details: 'No included files' };
    }
    switch (id) {
      case 'reformat':
      case 'optimizeImports':
      case 'cleanup': {
        const status = await this.editor[id](files);
        return status === 'ok'
          ? { id, status: 'ok', details: id === 'cleanup' ? 'Applied source.fixAll where available' : undefined }
          : { id, status: 'skipped', details: 'No provider responded for the included files' };
      }
      case 'analyze': {
        const { problems, detail } = await this.editor.analyze(files);
        return problems > 0
          ? { id, status: 'issues', details: `${problems} problem(s)${detail ? `: ${detail}` : ''}` }
          : { id, status: 'ok' };
      }
      case 'todo':
        return this.scanTodo(id, files);
      case 'dependencies':
        return this.auditDependencies(id, repoIds);
      default:
        return { id, status: 'unavailable', details: 'Not supported in this environment' };
    }
  }

  private async scanTodo(id: CheckId, files: CheckFile[]): Promise<CheckResult> {
    let count = 0;
    const locations: string[] = [];
    for (const file of files.slice(0, SCAN_FILE_CAP)) {
      const abs = path.join(file.rootPath, file.path);
      let text: string;
      try {
        const stat = await fs.promises.stat(abs);
        if (!stat.isFile() || stat.size > SCAN_SIZE_CAP) {
          continue;
        }
        const buf = await fs.promises.readFile(abs);
        if (buf.subarray(0, 8192).includes(0)) {
          continue;
        }
        text = buf.toString('utf8');
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (TODO_RE.test(lines[i] as string)) {
          count++;
          if (locations.length < 3) {
            locations.push(`${file.path}:${i + 1}`);
          }
        }
      }
    }
    return count > 0
      ? { id, status: 'issues', details: `${count} TODO/FIXME item(s): ${locations.join(', ')}${count > locations.length ? ', …' : ''}` }
      : { id, status: 'ok' };
  }

  private async auditDependencies(id: CheckId, repoIds: string[]): Promise<CheckResult> {
    const roots = [...new Set(repoIds.map((r) => this.registry.descriptor(r)?.rootPath).filter((r): r is string => !!r))];
    const notes: string[] = [];
    let issues = 0;
    let ran = 0;
    for (const root of roots) {
      const manager = await detectPackageManager(root);
      if (!manager) {
        continue;
      }
      const outcome = await runAudit(root, manager);
      if (outcome.vulnerabilities === undefined) {
        notes.push(`${path.basename(root)}: ${manager} audit could not run (${outcome.reason})`);
        continue;
      }
      ran++;
      issues += outcome.vulnerabilities;
      notes.push(`${path.basename(root)}: ${outcome.vulnerabilities} vulnerable package(s) (${manager} audit)`);
    }
    if (ran === 0) {
      return { id, status: 'skipped', details: notes.join('; ') || 'No package manifest in the included repositories' };
    }
    return issues > 0 ? { id, status: 'issues', details: notes.join('; ') } : { id, status: 'ok', details: notes.join('; ') };
  }
}

type PackageManager = 'npm' | 'pnpm' | 'yarn';

async function detectPackageManager(root: string): Promise<PackageManager | undefined> {
  const exists = async (name: string): Promise<boolean> => {
    try {
      await fs.promises.access(path.join(root, name));
      return true;
    } catch {
      return false;
    }
  };
  if (!(await exists('package.json'))) {
    return undefined;
  }
  if (await exists('pnpm-lock.yaml')) {
    return 'pnpm';
  }
  if (await exists('yarn.lock')) {
    return 'yarn';
  }
  return 'npm';
}

interface AuditOutcome {
  vulnerabilities?: number;
  reason?: string;
}

/** Fixed argv per manager; report-only, never installs or modifies anything. */
function runAudit(root: string, manager: PackageManager): Promise<AuditOutcome> {
  return new Promise((resolve) => {
    const bin = process.platform === 'win32' ? `${manager}.cmd` : manager;
    const child = spawn(bin, ['audit', '--json'], {
      cwd: root,
      env: { ...process.env, npm_config_audit: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (outcome: AuditOutcome): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      }
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ reason: 'timeout' });
    }, AUDIT_TIMEOUT_MS);
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', (err) => finish({ reason: err.message }));
    child.on('close', () => {
      const stdout = Buffer.concat(chunks).toString('utf8');
      const parsed = parseAudit(manager, stdout);
      finish(parsed === undefined ? { reason: 'no usable audit output (offline?)' } : { vulnerabilities: parsed });
    });
  });
}

function parseAudit(manager: PackageManager, stdout: string): number | undefined {
  if (manager === 'yarn') {
    // yarn classic streams one JSON object per line
    let count = 0;
    let sawSummary = false;
    for (const line of stdout.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      try {
        const obj = JSON.parse(line) as { type?: string; data?: { advisories?: unknown } };
        if (obj.type === 'auditAdvisory') {
          count++;
        }
        if (obj.type === 'auditSummary') {
          sawSummary = true;
        }
      } catch {
        // non-JSON noise
      }
    }
    return sawSummary || count > 0 ? count : undefined;
  }
  try {
    const obj = JSON.parse(stdout) as {
      metadata?: { vulnerabilities?: Record<string, number> };
      advisories?: Record<string, unknown>;
    };
    const vulns = obj.metadata?.vulnerabilities;
    if (vulns) {
      return Object.values(vulns).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    }
    if (obj.advisories) {
      return Object.keys(obj.advisories).length;
    }
    return undefined;
  } catch {
    return undefined;
  }
}