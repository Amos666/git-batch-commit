import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RepoRegistry } from '../../src/adapter/repoRegistry';
import { ChecksService } from '../../src/services/checksService';
import type { CheckFile, EditorCheckPort } from '../../src/services/checksService';
import type { CheckId } from '../../src/protocol/models';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbc-checks-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function registry(rootPath: string): RepoRegistry {
  return {
    descriptor: (id: string) => (id === 'r1' ? { id, rootPath, name: 'r1', kind: 'repository', rootUri: '' } : undefined),
  } as unknown as RepoRegistry;
}

function editor(overrides: Partial<EditorCheckPort> = {}): EditorCheckPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    reformat: async (files: CheckFile[]) => {
      calls.push(`reformat:${files.length}`);
      return 'ok';
    },
    optimizeImports: async () => {
      calls.push('optimizeImports');
      return 'ok';
    },
    cleanup: async () => {
      calls.push('cleanup');
      return 'skipped';
    },
    analyze: async () => {
      calls.push('analyze');
      return { problems: 0, detail: '' };
    },
    ...overrides,
  };
}

const ref = { repoId: 'r1', path: 'a.ts' };

describe('ChecksService', () => {
  it('marks editor-less checks unavailable without hiding them', async () => {
    const svc = new ChecksService(registry(tmp), editor());
    const ids: CheckId[] = ['rearrange', 'copyright', 'runConfiguration', 'afterCommitUpload'];
    const report = await svc.run(['r1'], ids, [ref]);
    expect(report.results.map((r) => r.status)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable']);
  });

  it('delegates editor checks to the port and maps skipped', async () => {
    const port = editor();
    const svc = new ChecksService(registry(tmp), port);
    const report = await svc.run(['r1'], ['reformat', 'cleanup'], [ref]);
    expect(port.calls).toEqual(['reformat:1', 'cleanup']);
    expect(report.results[0]?.status).toBe('ok');
    expect(report.results[1]?.status).toBe('skipped');
  });

  it('reports analyze issues from diagnostics counts', async () => {
    const port = editor({ analyze: async () => ({ problems: 2, detail: 'a.ts:1 oops' }) });
    const svc = new ChecksService(registry(tmp), port);
    const report = await svc.run(['r1'], ['analyze'], [ref]);
    expect(report.results[0]).toMatchObject({ status: 'issues' });
    expect(report.results[0]?.details).toContain('2 problem(s)');
  });

  it('skips file checks when nothing is included', async () => {
    const svc = new ChecksService(registry(tmp), editor());
    const report = await svc.run(['r1'], ['reformat', 'todo'], []);
    expect(report.results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
  });

  it('finds TODO/FIXME items with locations', async () => {
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'ok\n// TODO fix\nlet x; // FIXME\n');
    const svc = new ChecksService(registry(tmp), editor());
    const report = await svc.run(['r1'], ['todo'], [ref]);
    expect(report.results[0]?.status).toBe('issues');
    expect(report.results[0]?.details).toContain('2 TODO/FIXME item(s)');
    expect(report.results[0]?.details).toContain('a.ts:2');
  });

  it('reports ok for clean files and skips binary content', async () => {
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'clean code\n');
    const svc = new ChecksService(registry(tmp), editor());
    const clean = await svc.run(['r1'], ['todo'], [ref]);
    expect(clean.results[0]?.status).toBe('ok');
    fs.writeFileSync(path.join(tmp, 'a.ts'), Buffer.from([0, 1, 2, 0]));
    const binary = await svc.run(['r1'], ['todo'], [ref]);
    expect(binary.results[0]?.status).toBe('ok');
  });

  it('skips dependency audit without a package manifest', async () => {
    const svc = new ChecksService(registry(tmp), editor());
    const report = await svc.run(['r1'], ['dependencies'], [ref]);
    expect(report.results[0]?.status).toBe('skipped');
  });

  it('emits running/done progress per check in order', async () => {
    const svc = new ChecksService(registry(tmp), editor());
    const events: string[] = [];
    await svc.run(['r1'], ['reformat', 'todo'], [ref], (id, status) => events.push(`${id}:${status}`));
    expect(events).toEqual(['reformat:running', 'reformat:done', 'todo:running', 'todo:done']);
  });

  it('filters refs to the requested repositories', async () => {
    const port = editor();
    const svc = new ChecksService(registry(tmp), port);
    await svc.run(['r1'], ['reformat'], [ref, { repoId: 'other', path: 'b.ts' }]);
    expect(port.calls).toEqual(['reformat:1']);
  });
});