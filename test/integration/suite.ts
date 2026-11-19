import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { acquireGitApi } from '../../src/adapter/gitApi';
import { mapLocalBranches } from '../../src/adapter/branchRefs';
import { RepoRegistry, repoIdFor } from '../../src/adapter/repoRegistry';
import { BatchOrchestrator } from '../../src/core/batchOrchestrator';
import { CommitTranslator } from '../../src/core/commitTranslator';
import { InclusionModel } from '../../src/core/inclusionModel';
import { MiniRunner } from '../../src/core/miniRunner';
import { OperationTracker } from '../../src/core/operationTracker';
import { StatusService } from '../../src/core/statusService';
import { createVscodeGitKernel } from '../../src/kernel/vscodeGitKernel';
import type { ProtocolError } from '../../src/protocol/errors';
import type { ChangelistState } from '../../src/protocol/models';
import { EditorBridge } from '../../src/ui/editorBridge';
import { ChangelistService } from '../../src/services/changelistService';
import type { ChangelistStorage } from '../../src/services/changelistService';
import { ChecksService } from '../../src/services/checksService';
import { commitFileEntries, rangeFileEntries } from '../../src/services/commitFiles';
import { DiffDataService } from '../../src/services/diffDataService';
import { EditorActions } from '../../src/ui/editorActions';
import { HunkService } from '../../src/services/hunkService';
import { StashService } from '../../src/services/stashService';
import { ShelfService } from '../../src/services/shelfService';
import { SequencerService } from '../../src/services/sequencerService';

const fixtureDir = process.env.GBC_FIXTURE_DIR ?? '';
if (!fixtureDir) {
  throw new Error('GBC_FIXTURE_DIR not set');
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for: ${label}`);
    }
    await sleep(100);
  }
}

export async function run(): Promise<void> {
  const results: string[] = [];
  const ok = (name: string) => {
    results.push(`PASS ${name}`);
    console.log(`PASS ${name}`);
  };

  // 1. our extension activates and registers commands
  const ext = vscode.extensions.getExtension('git-batch-commit-dev.git-batch-commit');
  assert.ok(ext, 'extension not found');
  await ext.activate();
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('gitBatchCommit.refresh'), 'refresh command missing');
  assert.ok(commands.includes('gitBatchCommit.copyDiagnostics'), 'copyDiagnostics command missing');
  ok('extension activates, commands registered');

  // 2. acquire built-in API via our adapter
  const api = await acquireGitApi();
  const repoAPath = path.join(fixtureDir, 'repoA');
  const repoBPath = path.join(fixtureDir, 'repoB');
  await waitFor(
    () => api.repositories.some((r) => r.rootUri.fsPath === repoAPath) && api.repositories.some((r) => r.rootUri.fsPath === repoBPath),
    'both fixture repositories discovered',
  );
  ok('multi-root repository discovery via built-in API');

  const kernel = await createVscodeGitKernel(new MiniRunner());
  const registry = new RepoRegistry(kernel);
  const status = new StatusService(registry, 50);
  const inclusion = new InclusionModel(registry);
  const tracker = new OperationTracker();
  const mini = new MiniRunner();
  const hunk = new HunkService(registry, mini);
  const translator = new CommitTranslator(registry, inclusion, hunk, mini);
  const exclusionRequests: string[][] = [];
  const orchestrator = new BatchOrchestrator(registry, inclusion, translator, tracker, () => ({
    stopOnFirstRepoError: true,
    confirmIndexExclusion: async (_repoId, paths) => {
      exclusionRequests.push(paths);
      return true;
    },
  }));

  const repoA = api.repositories.find((r) => r.rootUri.fsPath === repoAPath);
  const repoB = api.repositories.find((r) => r.rootUri.fsPath === repoBPath);
  assert.ok(repoA && repoB);
  const idA = repoIdFor(repoA.rootUri.fsPath);
  const idB = repoIdFor(repoB.rootUri.fsPath);

  try {
    // 3. state mapping consistency with built-in state
    const snapA = status.snapshot(idA);
    assert.ok(snapA, 'snapshot A missing');
    assert.strictEqual(snapA.branch.name, 'main');
    const rawPaths = new Set(
      [...repoA.state.indexChanges, ...repoA.state.workingTreeChanges, ...repoA.state.untrackedChanges, ...repoA.state.mergeChanges]
        .map((c) => path.relative(repoAPath, c.uri.fsPath).split(path.sep).join('/')),
    );
    assert.strictEqual(snapA.changes.length, rawPaths.size, 'mapped change count differs from built-in state');
    ok('state mapping matches built-in SCM state (count/branch)');

    // 4. special file names survive mapping
    assert.ok(snapA.changes.some((c) => c.path === '中文 文件.txt'), 'unicode/space file name lost');
    ok('special file names (unicode + space) mapped correctly');

    // 5. stage / unstage chain
    await inclusion.stage(idA, ['modified.txt', '中文 文件.txt']);
    await waitFor(() => repoA.state.indexChanges.length === 2, 'two files staged');
    await inclusion.unstage(idA, ['中文 文件.txt']);
    await waitFor(() => repoA.state.indexChanges.length === 1, 'one file unstaged');
    await inclusion.stage(idA, ['中文 文件.txt']);
    await waitFor(() => repoA.state.indexChanges.length === 2, 'two files staged again');
    ok('add/restore (stage/unstage) chain works');

    // 6. expectedStaged validation blocks mismatch
    const mismatch = inclusion.validateExpectedStaged(idA, ['modified.txt']);
    assert.ok(mismatch, 'mismatch not detected');
    assert.strictEqual(mismatch.code, 'STAGED_MISMATCH');
    ok('expectedStaged mismatch detected');

    // 7. batch commit: A succeeds, B fails on pre-commit hook, stop-on-error
    await inclusion.stage(idB, ['b.txt']);
    await waitFor(() => repoB.state.indexChanges.length === 1, 'repoB file staged');
    const headABefore = repoA.state.HEAD?.commit;
    const headBBefore = repoB.state.HEAD?.commit;
    const batch = await orchestrator.run({
      repoIds: [idA, idB],
      message: 'phase0: batch commit test',
      options: {},
      expectedStaged: { [idA]: ['modified.txt', '中文 文件.txt'], [idB]: ['b.txt'] },
    });
    assert.strictEqual(batch.length, 2);
    assert.strictEqual(batch[0]?.ok, true, `repoA commit failed: ${JSON.stringify(batch[0]?.error)}`);
    assert.strictEqual(batch[1]?.ok, false, 'repoB should fail (hook)');
    assert.strictEqual(batch[1]?.error?.code, 'HOOK_FAILED', `expected HOOK_FAILED, got ${batch[1]?.error?.code}`);
    await waitFor(() => repoA.state.HEAD?.commit !== headABefore, 'repoA HEAD advanced');
    assert.strictEqual(repoB.state.HEAD?.commit, headBBefore, 'repoB HEAD must not advance');
    assert.ok(batch[0]?.commitOid && batch[0].commitOid !== headABefore, 'commitOid should be fresh');
    ok('batch commit: A ok + fresh oid, B hook failure classified, stop-on-error, B HEAD unchanged');

    // 8. empty index pre-check
    const empty = await orchestrator.run({ repoIds: [idA], message: 'should not commit', options: {} });
    assert.strictEqual(empty[0]?.ok, false);
    assert.strictEqual(empty[0]?.error?.code, 'NO_CHANGES');
    ok('empty index blocked with NO_CHANGES');

    // 9. empty message rejected
    await assert.rejects(
      () => orchestrator.run({ repoIds: [idA], message: '   ', options: {} }),
      (err: ProtocolError) => err.code === 'EMPTY_MESSAGE',
    );
    ok('empty message rejected with EMPTY_MESSAGE');

    // 10. repeated run while idle is fine; idempotence guard exists (running flag)
    assert.strictEqual(orchestrator.isRunning(), false);
    ok('orchestrator returns to idle after failures');

    // 11. worktree / submodule / nested repository discovery + kinds
    const repoWPath = path.join(fixtureDir, 'repoW');
    const repoCPath = path.join(fixtureDir, 'repoC');
    const subPath = path.join(repoAPath, 'sub');
    const nestedPath = path.join(repoAPath, 'nested');
    await waitFor(
      () =>
        api.repositories.some((r) => r.rootUri.fsPath === repoWPath) &&
        api.repositories.some((r) => r.rootUri.fsPath === subPath) &&
        api.repositories.some((r) => r.rootUri.fsPath === nestedPath),
      'worktree + submodule + nested repositories discovered',
      30_000,
    );
    const repoW = api.repositories.find((r) => r.rootUri.fsPath === repoWPath);
    const repoC = api.repositories.find((r) => r.rootUri.fsPath === repoCPath);
    const repoSub = api.repositories.find((r) => r.rootUri.fsPath === subPath);
    const repoNested = api.repositories.find((r) => r.rootUri.fsPath === nestedPath);
    assert.ok(repoW && repoC && repoSub && repoNested);
    assert.strictEqual(repoW.kind, 'worktree');
    assert.strictEqual(repoSub.kind, 'submodule');
    assert.strictEqual(repoNested.kind, 'repository');
    ok('worktree/submodule/nested discovered with correct kinds');

    // 12. worktree state maps correctly (branch wt + its own change)
    const idW = repoIdFor(repoW.rootUri.fsPath);
    const idC = repoIdFor(repoC.rootUri.fsPath);
    await waitFor(() => status.snapshot(idW) !== undefined, 'worktree snapshot available');
    const snapW = status.snapshot(idW);
    assert.ok(snapW);
    assert.strictEqual(snapW.branch.name, 'wt');
    assert.ok(snapW.changes.some((c) => c.path === 'modified.txt'), 'worktree change missing');
    ok('worktree state mapping (branch + changes)');

    // 13. amend rewrites HEAD message without staged files
    const amend = await orchestrator.run({ repoIds: [idA], message: 'phase0: amended message', options: { amend: true } });
    assert.strictEqual(amend[0]?.ok, true, `amend failed: ${JSON.stringify(amend[0]?.error)}`);
    const amendedOid = amend[0]?.commitOid;
    assert.ok(amendedOid && amendedOid !== batch[0]?.commitOid, 'amend must produce a new oid');
    const amendedCommit = await repoA.getCommit('HEAD');
    assert.strictEqual(amendedCommit.message.trim(), 'phase0: amended message');
    ok('amend: message-only rewrite, fresh oid, no staging required');

    // 14. cancel-remaining: in-flight slow-hook repo completes, later repos skipped
    await inclusion.stage(idC, ['c.txt']);
    await inclusion.stage(idW, ['modified.txt']);
    await waitFor(() => repoC.state.indexChanges.length === 1 && repoW.state.indexChanges.length === 1, 'cancel-test files staged');
    const headWBefore = repoW.state.HEAD?.commit;
    const cancelStart = Date.now();
    const cancelRun = orchestrator.run({ repoIds: [idC, idW], message: 'phase0: cancel timing test', options: {} });
    await sleep(500);
    orchestrator.cancelRemaining();
    const cancelResults = await cancelRun;
    const elapsed = Date.now() - cancelStart;
    assert.strictEqual(cancelResults[0]?.ok, true, 'in-flight repo must complete despite cancel');
    assert.strictEqual(cancelResults[1]?.skipped, 'cancelled', 'later repo must be skipped as cancelled');
    assert.ok(elapsed >= 1800, `slow hook should still run to completion (elapsed=${elapsed}ms)`);
    assert.strictEqual(repoW.state.HEAD?.commit, headWBefore, 'cancelled repo HEAD must not advance');
    ok(`cancel-remaining timing: in-flight completes (${elapsed}ms), later repo skipped`);

    // 15. commit detail view opens via diffBetween (multi-diff or fallback)
    const diff = new EditorBridge(registry);
    assert.ok(amendedOid);
    const amendParent = amendedCommit.parents[0];
    assert.ok(amendParent);
    if (typeof repoA.diffBetweenWithStats2 === 'function') {
      const entries = await repoA.diffBetweenWithStats2(`${amendParent}..${amendedOid}`);
      assert.ok(
        entries.some((e) => (e.renameUri ?? e.uri).fsPath.endsWith('modified.txt')),
        'amended commit entries should list modified.txt',
      );
    }
    await diff.openCommit(idA, amendedOid);
    const rootOid = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: repoCPath }).toString().trim();
    if (typeof repoC.diffBetweenWithStats2 === 'function') {
      const entries = await repoC.diffBetweenWithStats2(`${rootOid}^!`);
      assert.ok(
        entries.some((e) => (e.renameUri ?? e.uri).fsPath.endsWith('c.txt')),
        'root commit entries should list c.txt',
      );
    }
    await diff.openCommit(idC, rootOid);
    ok('commit.show opens commit diff (incl. root commit) without error');

    // 16. diff guards: binary + large file blocked, force bypasses
    await assert.rejects(
      () => diff.open(idA, 'binary.bin', 'head'),
      (err: ProtocolError) => err.code === 'DIFF_GUARDED' && err.diffContext?.path === 'binary.bin',
    );
    await assert.rejects(
      () => diff.open(idA, 'big.txt', 'head'),
      (err: ProtocolError) => err.code === 'DIFF_GUARDED',
    );
    await diff.open(idA, 'binary.bin', 'head', true);
    ok('diff guards: binary/large blocked with DIFF_GUARDED, force opens');

    // 17. hunk-level partial staging (C3 blob approach)
    const hunksAbs = path.join(repoAPath, 'hunks.txt');
    const hlist = await hunk.list(idA, 'hunks.txt', 'worktree');
    assert.strictEqual(hlist.hunks.length, 3, `expected 3 hunks, got ${hlist.hunks.length}`);
    const baseBefore = (await repoA.buffer('', 'hunks.txt')).toString('utf8');
    assert.ok(!baseBefore.includes('line 3 changed'), 'buffer("") should return index (pre-stage) content');
    await hunk.stage(idA, 'hunks.txt', [0]);
    await waitFor(() => repoA.state.indexChanges.some((c) => c.uri.fsPath === hunksAbs), 'hunks.txt partially staged');
    const partial = (await repoA.buffer('', 'hunks.txt')).toString('utf8');
    assert.ok(partial.includes('line 3 changed') && partial.includes('line 3.5 inserted'), 'selected hunk must be in index');
    assert.ok(!partial.includes('line 20 changed'), 'unselected hunk must NOT be in index');
    assert.ok(fs.readFileSync(hunksAbs, 'utf8').includes('line 20 changed'), 'worktree must stay untouched');
    ok('hunk partial stage: index blob = base + selected hunk only, worktree untouched');

    // 18. hunk unstage removes staged hunks back to HEAD blob
    const slist = await hunk.list(idA, 'hunks.txt', 'staged');
    assert.ok(slist.hunks.length >= 1, 'staged-side hunks missing');
    await hunk.unstage(idA, 'hunks.txt', slist.hunks.map((h) => h.id));
    await waitFor(() => !repoA.state.indexChanges.some((c) => c.uri.fsPath === hunksAbs), 'hunks.txt fully unstaged');
    const afterUnstage = (await repoA.buffer('', 'hunks.txt')).toString('utf8');
    assert.strictEqual(afterUnstage, baseBefore, 'unstage must restore HEAD blob');
    ok('hunk unstage restores HEAD blob via restore --staged');

    // 19. full hunk staging equals worktree; untracked file gets synthetic add-hunk
    await hunk.stage(idA, 'hunks.txt', hlist.hunks.map((h) => h.id));
    await waitFor(() => repoA.state.indexChanges.some((c) => c.uri.fsPath === hunksAbs), 'hunks.txt fully staged');
    const full = (await repoA.buffer('', 'hunks.txt')).toString('utf8');
    assert.strictEqual(full, fs.readFileSync(hunksAbs, 'utf8'), 'all-hunk stage must equal worktree content');
    const untrackedAbs = path.join(repoAPath, 'untracked.txt');
    await waitFor(
      () =>
        repoA.state.untrackedChanges.some((c) => c.uri.fsPath === untrackedAbs) ||
        repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === untrackedAbs),
      'untracked.txt visible in built-in state',
    );
    const ulist = await hunk.list(idA, 'untracked.txt', 'worktree');
    assert.strictEqual(ulist.hunks.length, 1, 'untracked file should expose one synthetic hunk');
    await hunk.stage(idA, 'untracked.txt', [0]);
    await waitFor(() => repoA.state.indexChanges.some((c) => c.uri.fsPath === untrackedAbs), 'untracked.txt staged via hunk');
    const stagedUntracked = (await repoA.buffer('', 'untracked.txt')).toString('utf8');
    assert.strictEqual(stagedUntracked, 'temp\n');
    // leave only untracked.txt staged for the signoff check
    const slist2 = await hunk.list(idA, 'hunks.txt', 'staged');
    await hunk.unstage(idA, 'hunks.txt', slist2.hunks.map((h) => h.id));
    await waitFor(() => !repoA.state.indexChanges.some((c) => c.uri.fsPath === hunksAbs), 'hunks.txt unstaged again');
    ok('full hunk stage == worktree; untracked synthetic hunk stages new blob');

    // 20. signoff option appends Signed-off-by trailer
    const sign = await orchestrator.run({
      repoIds: [idA],
      message: 'p1: signoff test',
      options: { signoff: true },
      expectedStaged: { [idA]: ['untracked.txt'] },
    });
    assert.strictEqual(sign[0]?.ok, true, `signoff commit failed: ${JSON.stringify(sign[0]?.error)}`);
    const signMessage = (await repoA.getCommit('HEAD')).message;
    assert.ok(signMessage.includes('Signed-off-by: Phase0 Test <phase0@test.local>'), `missing signoff trailer: ${signMessage}`);
    ok('signoff commit appends Signed-off-by trailer');

    // 21. stash create / list / apply / drop (repoB has staged+worktree b.txt change)
    const stash = new StashService(registry, new MiniRunner());
    const bAbs = path.join(repoBPath, 'b.txt');
    await stash.create(idB, { message: 'p1 stash test' });
    await waitFor(
      () => repoB.state.workingTreeChanges.length === 0 && repoB.state.indexChanges.length === 0,
      'repoB clean after stash',
    );
    const stashList1 = await stash.list(idB);
    assert.strictEqual(stashList1.length, 1, 'one stash expected');
    assert.strictEqual(stashList1[0]?.index, 0);
    assert.ok(stashList1[0]?.description.includes('p1 stash test'), `stash description: ${stashList1[0]?.description}`);
    await stash.apply(idB, 0);
    await waitFor(() => repoB.state.workingTreeChanges.some((c) => c.uri.fsPath === bAbs), 'b.txt restored by apply');
    assert.strictEqual((await stash.list(idB)).length, 1, 'apply must keep the stash');
    await stash.drop(idB, 0);
    assert.strictEqual((await stash.list(idB)).length, 0, 'drop must remove the stash');
    ok('stash create/list/apply/drop chain (drop always index-scoped)');

    // 22. stash pop applies and removes in one step
    await stash.create(idB, { message: 'p1 pop test' });
    await waitFor(() => repoB.state.workingTreeChanges.length === 0, 'repoB clean after second stash');
    await stash.pop(idB, 0);
    await waitFor(() => repoB.state.workingTreeChanges.some((c) => c.uri.fsPath === bAbs), 'b.txt restored by pop');
    assert.strictEqual((await stash.list(idB)).length, 0, 'pop must remove the stash');
    ok('stash pop applies changes and removes entry');

    // 23. stash edge cases: clean repo creates nothing (git exits 0), invalid index rejected
    await stash.create(idC, {});
    assert.strictEqual((await stash.list(idC)).length, 0, 'clean repo must not produce a stash');
    await assert.rejects(
      () => stash.drop(idB, -1),
      (err: ProtocolError) => err.code === 'GENERIC',
    );
    ok('stash: clean repo no-op, invalid index rejected');

    // 24. branch lifecycle: create+checkout, rename via MiniRunner, delete guards, compare
    await repoA.createBranch('p1-topic', true);
    await waitFor(() => repoA.state.HEAD?.name === 'p1-topic', 'new branch checked out');
    fs.writeFileSync(path.join(repoAPath, 'branchfile.txt'), 'branch only\n');
    execFileSync('git', ['add', 'branchfile.txt'], { cwd: repoAPath });
    execFileSync('git', ['commit', '-m', 'p1: branch-only commit'], { cwd: repoAPath });
    await repoA.checkout('main');
    await waitFor(() => repoA.state.HEAD?.name === 'main', 'back on main');
    await assert.rejects(() => repoA.deleteBranch('main', false), 'current branch delete must fail');
    await assert.rejects(() => repoA.deleteBranch('p1-topic', false), 'unmerged branch delete must fail (force=false)');
    const miniBranch = new MiniRunner();
    await miniBranch.run(repoAPath, { cmd: 'branch-rename', from: 'p1-topic', to: 'p1-renamed' });
    const branchRefs = await repoA.getBranches({ remote: false });
    assert.ok(branchRefs.some((b) => b.name === 'p1-renamed'), 'renamed branch missing');
    assert.ok(!branchRefs.some((b) => b.name === 'p1-topic'), 'old branch name must be gone');
    const mainRef = branchRefs.find((b) => b.name === 'main');
    assert.strictEqual(mainRef?.type, 0, 'real API RefType.Head must be numeric 0 (regression: branch.list filter)');
    const mapped = mapLocalBranches(branchRefs, repoA.state.HEAD?.name);
    assert.ok(mapped.some((b) => b.name === 'main' && b.current), 'branch.list mapping must include current main');
    assert.ok(mapped.some((b) => b.name === 'p1-renamed'), 'branch.list mapping must include renamed branch');
    await diff.openBranchCompare(idW, 'main');
    ok('branch create/checkout/rename/delete guards + branch compare');

    // 25. pull/push on the cloned submodule repo (has origin pointing at a local path)
    assert.ok(repoSub.pull && repoSub.push, 'pull/push should be exposed by the API');
    await repoSub.pull();
    const subHead = repoSub.state.HEAD;
    assert.ok(subHead?.name, 'sub repo must be on a branch');
    await repoSub.push(subHead.upstream?.remote, subHead.name, subHead.upstream ? false : true);
    ok('pull/push succeed against local origin (up-to-date)');

    // 26. log pagination + author/grep filters
    assert.ok(repoA.log, 'log should be exposed by the API');
    const page1 = await repoA.log({ maxEntries: 2 });
    assert.strictEqual(page1.length, 2, 'first page should have 2 entries');
    const page2 = await repoA.log({ maxEntries: 2, skip: 2 });
    assert.strictEqual(page2.length, 2, 'second page should have 2 entries');
    assert.ok(!page1.some((c) => page2.some((d) => d.hash === c.hash)), 'pages must not overlap');
    const byAuthor = await repoA.log({ author: 'Phase0 Test' });
    assert.ok(byAuthor.length >= 4, `author filter should match all fixture commits, got ${byAuthor.length}`);
    const noAuthor = await repoA.log({ author: 'nobody-here-xyz' });
    assert.strictEqual(noAuthor.length, 0, 'unknown author must match nothing');
    const byGrep = await repoA.log({ grep: 'signoff' });
    assert.ok(byGrep.length >= 1 && byGrep.every((c) => /signoff/i.test(c.message)), 'grep filter must match message');
    ok('log pagination (skip/maxEntries) + author/grep filters');

    // 27. merge conflict: abort restores pre-merge state; resolve = stage + commit
    const cAbs = path.join(repoCPath, 'c.txt');
    const gitC = (...args: string[]) => execFileSync('git', args, { cwd: repoCPath, stdio: 'pipe' });
    gitC('checkout', '-b', 'conflict-side');
    fs.writeFileSync(cAbs, 'c1\nc2\nside\n');
    gitC('add', 'c.txt');
    gitC('commit', '-m', 'p1: side change');
    gitC('checkout', 'main');
    fs.writeFileSync(cAbs, 'c1\nc2\nmain\n');
    gitC('add', 'c.txt');
    gitC('commit', '-m', 'p1: main change');
    assert.throws(() => gitC('merge', 'conflict-side'), 'merge must conflict');
    await waitFor(() => repoC.state.mergeChanges.length === 1, 'merge conflict visible in state');
    assert.ok(repoC.mergeAbort, 'mergeAbort should be exposed');
    await repoC.mergeAbort();
    await waitFor(
      () => repoC.state.mergeChanges.length === 0 && repoC.state.workingTreeChanges.length === 0,
      'abort restores clean state',
    );
    assert.strictEqual(fs.readFileSync(cAbs, 'utf8'), 'c1\nc2\nmain\n', 'abort must restore pre-merge content');
    assert.throws(() => gitC('merge', 'conflict-side'), 'second merge must conflict');
    await waitFor(() => repoC.state.mergeChanges.length === 1, 'second merge conflict');
    fs.writeFileSync(cAbs, 'c1\nc2\nmerged\n');
    await inclusion.stage(idC, ['c.txt']);
    await waitFor(
      () => repoC.state.mergeChanges.length === 0 && repoC.state.indexChanges.length === 1,
      'staging marks conflict resolved',
    );
    const headCBefore = repoC.state.HEAD?.commit;
    const mergeRun = await orchestrator.run({
      repoIds: [idC],
      message: 'p1: merge resolved',
      options: {},
      expectedStaged: { [idC]: ['c.txt'] },
    });
    assert.strictEqual(mergeRun[0]?.ok, true, `merge commit failed: ${JSON.stringify(mergeRun[0]?.error)}`);
    await waitFor(() => repoC.state.HEAD?.commit !== headCBefore, 'merge commit lands');
    ok('merge conflict: abort restores state; resolve = stage + commit');

    // 28. rebase conflict: rebaseAbort restores the branch tip
    gitC('checkout', '-b', 'rebase-side');
    fs.writeFileSync(cAbs, 'c1\nc2\nrebase\n');
    gitC('add', 'c.txt');
    gitC('commit', '-m', 'p1: rebase side');
    gitC('checkout', 'main');
    fs.writeFileSync(cAbs, 'c1\nc2\nmain2\n');
    gitC('add', 'c.txt');
    gitC('commit', '-m', 'p1: main2');
    gitC('checkout', 'rebase-side');
    const rbTip = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoCPath }).toString().trim();
    assert.throws(() => gitC('rebase', 'main'), 'rebase must conflict');
    await waitFor(() => repoC.state.rebaseCommit !== undefined, 'rebase in progress visible in state');
    assert.ok(repoC.rebaseAbort, 'rebaseAbort should be exposed');
    await repoC.rebaseAbort();
    await waitFor(
      () => repoC.state.rebaseCommit === undefined && repoC.state.HEAD?.name === 'rebase-side',
      'rebase abort restores branch',
    );
    assert.strictEqual(repoC.state.HEAD?.commit, rbTip, 'rebase abort must restore branch tip');
    gitC('checkout', 'main');
    ok('rebase conflict: rebaseAbort restores branch tip');

    // 29. keybindings/settings contributions: scoped when-clause, commit command, log.pageSize
    assert.ok(commands.includes('gitBatchCommit.commit'), 'commit command missing');
    await vscode.commands.executeCommand('gitBatchCommit.commit');
    const pkg = ext.packageJSON as {
      contributes: {
        keybindings?: { command: string; key?: string; when?: string }[];
        configuration: { properties: Record<string, unknown> };
      };
    };
    const kbs = pkg.contributes.keybindings ?? [];
    // chords dispatch locally while the panel has focus; the host binding only
    // fires when the panel is visible but unfocused (double dispatch would
    // toggle twice and the workbench steals iframe focus on handled keys)
    const chordWhen = 'gitBatchCommit.panelVisible && !gitBatchCommit.panelFocused';
    assert.ok(
      kbs.some((k) => k.command === 'gitBatchCommit.commit' && k.when === chordWhen),
      'commit keybinding must be scoped to panel visibility without focus',
    );
    assert.ok(
      kbs.every((k) => k.when === chordWhen || /\.focus$/.test(k.command)),
      'all panel keybindings must use the visibility when-clause (view switchers exempt)',
    );
    assert.ok(
      kbs.some((k) => k.command === 'gitBatchCommit.logPanel.focus' && k.key === 'alt+9'),
      'Alt+9 must focus the Log view',
    );
    await vscode.commands.executeCommand('gitBatchCommit.logPanel.focus');
    await vscode.commands.executeCommand('gitBatchCommit.commitPanel.focus');
    assert.ok(pkg.contributes.configuration.properties['gitBatchCommit.log.pageSize'], 'log.pageSize setting missing');
    ok('keybindings scoped by when-clause; commit command + log.pageSize registered');

    // 30. commit.show with add/rename/delete: both diff sides must resolve
    // (regression: added files pointed at the parent ref made the git content
    // provider throw, and the multi-diff editor showed "No Changed Files")
    fs.writeFileSync(path.join(repoAPath, 'probe-add.txt'), 'added\n');
    fs.renameSync(path.join(repoAPath, 'modified.txt'), path.join(repoAPath, 'probe-renamed.txt'));
    fs.unlinkSync(path.join(repoAPath, '中文 文件.txt'));
    execFileSync('git', ['add', '-A', '--', 'probe-add.txt', 'probe-renamed.txt', 'modified.txt', '中文 文件.txt'], { cwd: repoAPath });
    execFileSync('git', ['commit', '-m', 'p1: add+rename+delete detail'], { cwd: repoAPath });
    const probeOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoAPath }).toString().trim();
    await diff.openCommit(idA, probeOid);
    await sleep(500);
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as
      | { textDiffs?: { original: vscode.Uri; modified: vscode.Uri }[] }
      | undefined;
    const resources = input?.textDiffs;
    assert.ok(resources && resources.length >= 3, 'multi-diff editor must list add/rename/delete entries');
    const addRes = resources.find((r) => r.modified?.fsPath.endsWith('probe-add.txt'));
    assert.ok(addRes, 'added file entry missing');
    assert.ok(addRes.original.toString().includes(EMPTY_TREE), 'added file original side must use the empty tree');
    const addLeft = await vscode.workspace.openTextDocument(addRes.original);
    const addRight = await vscode.workspace.openTextDocument(addRes.modified);
    assert.strictEqual(addLeft.getText(), '', 'added file original side must resolve to empty content');
    assert.strictEqual(addRight.getText(), 'added\n', 'added file modified side must show commit content');
    const delRes = resources.find((r) => r.original?.fsPath.endsWith('中文 文件.txt'));
    assert.ok(delRes, 'deleted file entry missing');
    assert.ok(delRes.modified.toString().includes(EMPTY_TREE), 'deleted file modified side must use the empty tree');
    const delRight = await vscode.workspace.openTextDocument(delRes.modified);
    assert.strictEqual(delRight.getText(), '', 'deleted file modified side must resolve to empty content');
    const renRes = resources.find((r) => r.modified?.fsPath.endsWith('probe-renamed.txt'));
    assert.ok(renRes, 'renamed file entry missing');
    assert.ok(renRes.original.fsPath.endsWith('modified.txt'), 'renamed file original side must use the old path');
    const renLeft = await vscode.workspace.openTextDocument(renRes.original);
    assert.ok(renLeft.getText().length > 0, 'renamed file original side must use the old path content');
    ok('commit.show add/rename/delete: all diff sides resolve (no "No Changed Files")');

    // 31. shelf create: patch saved, reverse-verified, worktree+index reverted to HEAD
    const shelf = new ShelfService(registry, new MiniRunner(), path.join(fixtureDir, '.shelf-store'));
    const probeAddAbs = path.join(repoAPath, 'probe-add.txt');
    const probeRenAbs = path.join(repoAPath, 'probe-renamed.txt');
    const renBase = fs.readFileSync(probeRenAbs, 'utf8');
    fs.writeFileSync(probeAddAbs, 'added\nshelf-me\n');
    fs.writeFileSync(probeRenAbs, `${renBase}shelf-me\n`);
    await waitFor(
      () => repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === probeAddAbs) &&
        repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === probeRenAbs),
      'shelf candidate changes visible in state',
    );
    await inclusion.stage(idA, ['probe-add.txt']);
    await waitFor(() => repoA.state.indexChanges.some((c) => c.uri.fsPath === probeAddAbs), 'probe-add staged before shelve');
    const shelfEntry = await shelf.create(idA, 'p2 shelf test', ['probe-add.txt', 'probe-renamed.txt']);
    assert.strictEqual(shelfEntry.name, 'p2 shelf test');
    assert.strictEqual(shelfEntry.branch, 'main');
    assert.strictEqual(shelfEntry.files.length, 2);
    await waitFor(
      () =>
        !repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === probeAddAbs || c.uri.fsPath === probeRenAbs) &&
        repoA.state.indexChanges.length === 0,
      'shelved files reverted in worktree + index',
    );
    assert.strictEqual(fs.readFileSync(probeAddAbs, 'utf8'), 'added\n', 'shelve must revert worktree to HEAD');
    assert.strictEqual(fs.readFileSync(probeRenAbs, 'utf8'), renBase, 'second shelved file must revert too');
    const shelfList1 = await shelf.list(idA);
    assert.strictEqual(shelfList1.length, 1);
    assert.strictEqual((await shelf.list(idB)).length, 0, 'shelf entries must be repo-scoped');
    ok('shelf create: reverse-verified patch + worktree/index revert, repo-scoped list');

    // 32. partial unshelve on another branch (cross-branch restore)
    await repoA.createBranch('p2-shelf-target', true);
    await waitFor(() => repoA.state.HEAD?.name === 'p2-shelf-target', 'shelf target branch checked out');
    await shelf.unshelve(idA, shelfEntry.id, ['probe-add.txt']);
    await waitFor(
      () => repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === probeAddAbs),
      'partial unshelve applied on other branch',
    );
    assert.strictEqual(fs.readFileSync(probeAddAbs, 'utf8'), 'added\nshelf-me\n', 'selected file restored');
    assert.strictEqual(fs.readFileSync(probeRenAbs, 'utf8'), renBase, 'unselected file must stay untouched');
    assert.strictEqual((await shelf.list(idA)).length, 1, 'unshelve without removeAfter keeps the entry');
    await assert.rejects(
      () => shelf.unshelve(idA, shelfEntry.id, ['probe-add.txt']),
      (err: ProtocolError) => err.code === 'SHELF_APPLY_FAILED',
    );
    ok('partial unshelve restores only selected files on a different branch');

    // 33. unshelve remaining file + removeAfter, delete/not-found guards, untracked & empty-name rejection
    await shelf.unshelve(idA, shelfEntry.id, ['probe-renamed.txt'], true);
    await waitFor(
      () => repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === probeRenAbs),
      'full unshelve applied',
    );
    assert.strictEqual(fs.readFileSync(probeRenAbs, 'utf8'), `${renBase}shelf-me\n`);
    assert.strictEqual((await shelf.list(idA)).length, 0, 'removeAfter must delete the entry');
    await assert.rejects(
      () => shelf.unshelve(idA, shelfEntry.id),
      (err: ProtocolError) => err.code === 'SHELF_NOT_FOUND',
    );
    await assert.rejects(
      () => shelf.delete(idA, shelfEntry.id),
      (err: ProtocolError) => err.code === 'SHELF_NOT_FOUND',
    );
    fs.writeFileSync(path.join(repoAPath, 'shelf-untracked.txt'), 'x\n');
    await waitFor(
      () =>
        repoA.state.untrackedChanges.some((c) => c.uri.fsPath.endsWith('shelf-untracked.txt')) ||
        repoA.state.workingTreeChanges.some((c) => c.uri.fsPath.endsWith('shelf-untracked.txt')),
      'untracked shelf candidate visible',
    );
    await assert.rejects(
      () => shelf.create(idA, 'bad', ['shelf-untracked.txt']),
      (err: ProtocolError) => err.code === 'GENERIC',
    );
    await assert.rejects(
      () => shelf.create(idA, '   ', ['probe-add.txt']),
      (err: ProtocolError) => err.code === 'GENERIC',
    );
    // clean file has no entry in the change set → rejected before diffing
    await assert.rejects(
      () => shelf.create(idA, 'nochange', ['big.txt']),
      (err: ProtocolError) => err.code === 'GENERIC',
    );
    // restore fixture neutrality: revert unshelved changes, drop temp branch, back to main
    await new MiniRunner().run(repoAPath, { cmd: 'restore-head', paths: ['probe-add.txt', 'probe-renamed.txt'] });
    fs.rmSync(path.join(repoAPath, 'shelf-untracked.txt'));
    await repoA.checkout('main');
    await waitFor(() => repoA.state.HEAD?.name === 'main', 'back on main after shelf tests');
    await repoA.deleteBranch('p2-shelf-target', false);
    ok('shelf removeAfter + not-found guards + untracked/empty-name/no-change rejection');

    // 34. cherry-pick a non-merge commit onto a branch that lacks it
    const seq = new SequencerService(registry, new MiniRunner());
    const pickAbs = path.join(repoCPath, 'pick.txt');
    fs.writeFileSync(pickAbs, 'pick me\n');
    gitC('add', 'pick.txt');
    gitC('commit', '-m', 'p2: pick source');
    const pickOid = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoCPath }).toString().trim();
    gitC('checkout', '-b', 'p2-pick-target', 'HEAD~1');
    await waitFor(() => repoC.state.HEAD?.name === 'p2-pick-target', 'pick target branch checked out');
    await seq.cherryPick(idC, pickOid);
    await waitFor(
      () => execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repoCPath }).toString().trim() === 'p2: pick source',
      'cherry-pick commit lands',
    );
    assert.strictEqual(fs.readFileSync(pickAbs, 'utf8'), 'pick me\n', 'cherry-picked content present');
    await waitFor(() => repoC.state.workingTreeChanges.length === 0, 'clean after cherry-pick');
    gitC('checkout', 'main');
    await waitFor(() => repoC.state.HEAD?.name === 'main', 'back on main after cherry-pick');
    ok('cherry-pick applies a non-merge commit onto another branch');

    // 35. revert --no-commit stages the inverse without committing; panel commit completes it
    const headBeforeRevert = repoC.state.HEAD?.commit;
    await seq.revert(idC, pickOid);
    await waitFor(
      () => repoC.state.indexChanges.some((c) => c.uri.fsPath === pickAbs),
      'revert staged inverse change',
    );
    assert.strictEqual(repoC.state.HEAD?.commit, headBeforeRevert, 'revert --no-commit must not advance HEAD');
    assert.ok(!fs.existsSync(pickAbs), 'revert of an added file removes it from worktree');
    assert.strictEqual(execFileSync('git', ['ls-files', '--', 'pick.txt'], { cwd: repoCPath }).toString(), '', 'index entry removed');
    const revertRun = await orchestrator.run({
      repoIds: [idC],
      message: 'p2: revert pick source',
      options: {},
      expectedStaged: { [idC]: ['pick.txt'] },
    });
    assert.strictEqual(revertRun[0]?.ok, true, `revert commit failed: ${JSON.stringify(revertRun[0]?.error)}`);
    await waitFor(() => repoC.state.HEAD?.commit !== headBeforeRevert, 'revert commit lands');
    ok('revert --no-commit stages inverse; HEAD untouched until panel commit');

    // 36. cherry-pick conflict → CONFLICT + abortSequencer; abort restores; merge commit rejected
    const sideTip = execFileSync('git', ['rev-parse', 'rebase-side'], { cwd: repoCPath }).toString().trim();
    const headBeforePick = repoC.state.HEAD?.commit;
    await assert.rejects(
      () => seq.cherryPick(idC, sideTip),
      (err: ProtocolError) => err.code === 'CONFLICT' && err.actions.includes('abortSequencer'),
    );
    await waitFor(() => repoC.state.mergeChanges.length === 1, 'cherry-pick conflict visible in state');
    await seq.abort(idC);
    await waitFor(
      () => repoC.state.mergeChanges.length === 0 && repoC.state.workingTreeChanges.length === 0,
      'sequencer abort restores clean state',
    );
    assert.strictEqual(repoC.state.HEAD?.commit, headBeforePick, 'abort must not advance HEAD');
    assert.strictEqual(fs.readFileSync(cAbs, 'utf8'), 'c1\nc2\nmain2\n', 'abort restores pre-pick content');
    const mergeOid = execFileSync('git', ['rev-list', '--merges', '-1', 'HEAD'], { cwd: repoCPath }).toString().trim();
    await assert.rejects(
      () => seq.cherryPick(idC, mergeOid),
      (err: ProtocolError) => err.code === 'GENERIC',
    );
    await assert.rejects(
      () => seq.abort(idC),
      (err: ProtocolError) => err.code === 'GENERIC',
    );
    ok('cherry-pick conflict classified + abort restores; merge-commit pick and idle abort rejected');

    // 37. undo commit: soft reset keeps changes staged; root/pushed/in-progress guards
    const gitA = (...args: string[]) => execFileSync('git', args, { cwd: repoAPath, stdio: 'pipe' });
    const undoProbeAbs = path.join(repoAPath, 'undo-probe.txt');
    const headBeforeUndo = repoA.state.HEAD?.commit;
    assert.ok(headBeforeUndo);
    fs.writeFileSync(undoProbeAbs, 'undo me\n');
    gitA('add', 'undo-probe.txt');
    gitA('commit', '-m', 'p2: undo probe');
    await waitFor(() => repoA.state.HEAD?.commit !== headBeforeUndo, 'undo probe commit lands');
    await seq.undoCommit(idA);
    await waitFor(() => repoA.state.HEAD?.commit === headBeforeUndo, 'soft reset restores previous HEAD');
    await waitFor(
      () => repoA.state.indexChanges.some((c) => c.uri.fsPath === undoProbeAbs),
      'undone change back in index',
    );
    assert.strictEqual(fs.readFileSync(undoProbeAbs, 'utf8'), 'undo me\n', 'soft reset must keep worktree content');
    // root commit has no parent → rejected (nested repo has exactly one commit)
    const idNested = repoIdFor(repoNested.rootUri.fsPath);
    await assert.rejects(
      () => seq.undoCommit(idNested),
      (err: ProtocolError) => err.code === 'GENERIC' && /root commit/.test(err.message),
    );
    // pushed HEAD → rejected
    const bareDir = path.join(fixtureDir, '.undo-remote.git');
    execFileSync('git', ['init', '--bare', bareDir], { stdio: 'pipe' });
    gitA('remote', 'add', 'undo-origin', bareDir);
    gitA('push', '-u', 'undo-origin', 'main');
    await assert.rejects(
      () => seq.undoCommit(idA),
      (err: ProtocolError) => err.code === 'GENERIC' && /remote branch/.test(err.message),
    );
    gitA('remote', 'remove', 'undo-origin');
    fs.rmSync(bareDir, { recursive: true, force: true });
    // cherry-pick conflict in progress → CONFLICT guard
    await assert.rejects(
      () => seq.cherryPick(idC, sideTip),
      (err: ProtocolError) => err.code === 'CONFLICT',
    );
    await waitFor(() => repoC.state.mergeChanges.length === 1, 'pick conflict for undo guard');
    await assert.rejects(
      () => seq.undoCommit(idC),
      (err: ProtocolError) => err.code === 'CONFLICT',
    );
    await seq.abort(idC);
    await waitFor(() => repoC.state.mergeChanges.length === 0, 'abort after conflict undo guard');
    // empty cherry-pick (pick HEAD onto itself) leaves CHERRY_PICK_HEAD without mergeChanges
    const headCForUndo = repoC.state.HEAD?.commit;
    assert.ok(headCForUndo);
    await assert.rejects(
      () => seq.cherryPick(idC, headCForUndo),
      (err: ProtocolError) => err.code === 'CONFLICT',
    );
    await assert.rejects(
      () => seq.undoCommit(idC),
      (err: ProtocolError) => err.code === 'GENERIC' && /in progress/.test(err.message),
    );
    await seq.abort(idC);
    await waitFor(
      () => repoC.state.workingTreeChanges.length === 0 && repoC.state.HEAD?.commit === headCForUndo,
      'abort after empty-pick undo guard',
    );
    // restore fixture neutrality: drop the staged probe file
    gitA('restore', '--staged', '--worktree', '--', 'undo-probe.txt');
    fs.rmSync(undoProbeAbs, { force: true });
    ok('undo commit: soft reset keeps changes staged; root/pushed/in-progress guards');

    // 38. leave repoC in a fresh merge-conflict state for manual/visual walkthrough
    // of the abort-confirm overlay (fixtures are disposable, regenerated each run)
    gitC('checkout', '-b', 'walkthrough-side');
    fs.writeFileSync(cAbs, 'c1\nc2\nwalkthrough-side\n');
    gitC('add', 'c.txt');
    gitC('commit', '-m', 'walkthrough: side');
    gitC('checkout', 'main');
    fs.writeFileSync(cAbs, 'c1\nc2\nwalkthrough-main\n');
    gitC('add', 'c.txt');
    gitC('commit', '-m', 'walkthrough: main');
    assert.throws(() => gitC('merge', 'walkthrough-side'), 'walkthrough merge must conflict');
    await waitFor(() => repoC.state.mergeChanges.length === 1, 'walkthrough conflict visible in state');
    ok('fixture left in merge-conflict state for visual walkthrough');

    // 39. changelist translation: externally staged file excluded after confirm, only checked file committed
    fs.writeFileSync(path.join(repoAPath, 'cl-checked.txt'), 'checked\n');
    fs.writeFileSync(path.join(repoAPath, 'cl-external.txt'), 'external\n');
    gitA('add', 'cl-external.txt');
    await waitFor(() => repoA.state.indexChanges.some((c) => c.uri.fsPath.endsWith('cl-external.txt')), 'external file staged');
    const clRun = await orchestrator.run({
      repoIds: [idA],
      message: 'p1: changelist translation',
      options: {},
      expectedIncluded: { [idA]: [{ path: 'cl-checked.txt' }] },
    });
    assert.strictEqual(clRun[0]?.ok, true, `changelist commit failed: ${JSON.stringify(clRun[0]?.error)}`);
    assert.deepStrictEqual(exclusionRequests, [['cl-external.txt']], 'exclusion confirm must list the external file');
    const committedFiles = gitA('show', '--name-only', '--format=', 'HEAD').toString().trim().split('\n');
    assert.deepStrictEqual(committedFiles, ['cl-checked.txt'], 'commit must contain only the checked file');
    assert.strictEqual(fs.readFileSync(path.join(repoAPath, 'cl-external.txt'), 'utf8'), 'external\n', 'excluded worktree file untouched');
    await waitFor(
      () => repoA.state.untrackedChanges.some((c) => c.uri.fsPath.endsWith('cl-external.txt')) ||
        repoA.state.workingTreeChanges.some((c) => c.uri.fsPath.endsWith('cl-external.txt')),
      'excluded file back to untracked',
    );
    ok('changelist translation: exclusion confirmed, only checked file committed, worktree untouched');

    // 40. race validation: missing path → INCLUDED_MISMATCH; stale hunk id → HUNK_CONFLICT; index untouched
    const missing = await orchestrator.run({
      repoIds: [idA],
      message: 'p1: should block',
      options: {},
      expectedIncluded: { [idA]: [{ path: 'does-not-exist.txt' }] },
    });
    assert.strictEqual(missing[0]?.ok, false);
    assert.strictEqual(missing[0]?.error?.code, 'INCLUDED_MISMATCH');
    assert.notStrictEqual(missing[0]?.indexModified, true, 'validation failure must not touch the index');
    const staleHunk = await orchestrator.run({
      repoIds: [idA],
      message: 'p1: should block',
      options: {},
      expectedIncluded: { [idA]: [{ path: 'hunks.txt', selection: { hunkIds: [99] } }] },
    });
    assert.strictEqual(staleHunk[0]?.ok, false);
    assert.strictEqual(staleHunk[0]?.error?.code, 'HUNK_CONFLICT');
    ok('race validation: INCLUDED_MISMATCH + HUNK_CONFLICT block before any index mutation');

    // 41. line-level partial commit: only the selected addition lands; remainder stays in worktree
    const linesAbs = path.join(repoAPath, 'lines.txt');
    fs.writeFileSync(linesAbs, 'a\nb\nc\nd\ne\n');
    gitA('add', 'lines.txt');
    gitA('commit', '-m', 'p1: lines base');
    fs.writeFileSync(linesAbs, 'a\nB\nc\nD\ne\n');
    await waitFor(() => repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === linesAbs), 'lines.txt change visible');
    const linesList = await hunk.list(idA, 'lines.txt', 'worktree');
    assert.strictEqual(linesList.hunks.length, 1, 'adjacent edits must form a single hunk');
    const lineRun = await orchestrator.run({
      repoIds: [idA],
      message: 'p1: line partial',
      options: {},
      expectedIncluded: { [idA]: [{ path: 'lines.txt', selection: { hunkIds: [0], lines: { 0: [1] } } }] },
    });
    assert.strictEqual(lineRun[0]?.ok, true, `line partial commit failed: ${JSON.stringify(lineRun[0]?.error)}`);
    assert.strictEqual(gitA('show', 'HEAD:lines.txt').toString(), 'a\nB\nc\nd\ne\n', 'only the selected line may be committed');
    assert.strictEqual(fs.readFileSync(linesAbs, 'utf8'), 'a\nB\nc\nD\ne\n', 'worktree keeps the unselected change');
    // unstagePartial removes just the selected addition from a fully staged file
    await inclusion.stage(idA, ['lines.txt']);
    await waitFor(() => repoA.state.indexChanges.some((c) => c.uri.fsPath === linesAbs), 'lines.txt fully staged');
    const stagedLines = await hunk.list(idA, 'lines.txt', 'staged');
    assert.strictEqual(stagedLines.hunks.length, 1);
    await hunk.unstagePartial(idA, 'lines.txt', { hunkIds: [0], lines: { 0: [3] } });
    await waitFor(() => !repoA.state.indexChanges.some((c) => c.uri.fsPath === linesAbs), 'lines.txt unstaged via line selection');
    assert.strictEqual((await repoA.buffer('', 'lines.txt')).toString('utf8'), 'a\nB\nc\nd\ne\n', 'index back to HEAD blob');
    ok('line-level partial commit + unstagePartial: selected lines only, worktree untouched');

    // 42. author override through the orchestrator (kernel routes to the env-injected mini fallback)
    const authorRun = await orchestrator.run({
      repoIds: [idA],
      message: 'p1: author override',
      options: { author: { name: 'Override Author', email: 'override@test.local' } },
      expectedIncluded: { [idA]: [{ path: 'cl-external.txt' }] },
    });
    assert.strictEqual(authorRun[0]?.ok, true, `author commit failed: ${JSON.stringify(authorRun[0]?.error)}`);
    assert.strictEqual(gitA('log', '-1', '--format=%an <%ae>').toString().trim(), 'Override Author <override@test.local>');
    assert.strictEqual(gitA('log', '-1', '--format=%cn').toString().trim(), 'Phase0 Test', 'committer must stay the repo identity');
    ok('author override: git log author overridden, committer unchanged');

    // 42b. changelist-mode message-only amend: empty checked set must not block
    const clAmend = await orchestrator.run({
      repoIds: [idA],
      message: 'p1: author override (amended)',
      options: { amend: true },
      expectedIncluded: { [idA]: [] },
    });
    assert.strictEqual(clAmend[0]?.ok, true, `changelist amend failed: ${JSON.stringify(clAmend[0]?.error)}`);
    assert.strictEqual(gitA('log', '-1', '--format=%s').toString().trim(), 'p1: author override (amended)');
    assert.strictEqual(gitA('log', '-1', '--format=%an').toString().trim(), 'Override Author', 'amend must preserve the original author');
    const nothingChecked = await orchestrator.run({
      repoIds: [idA],
      message: 'p1: should block',
      options: {},
      expectedIncluded: { [idA]: [] },
    });
    assert.strictEqual(nothingChecked[0]?.error?.code, 'NO_CHANGES');
    ok('changelist amend: message-only rewrite with empty checked set; empty non-amend blocked');

    // 43. mode migration: confirm required, backup written, index↔checked translation both ways
    let saved: ChangelistState | undefined;
    let backedUp: ChangelistState | undefined;
    const storage: ChangelistStorage = {
      load: () => saved,
      save: async (state) => {
        saved = state;
      },
      backup: async (state) => {
        backedUp = state;
      },
    };
    const changelists = new ChangelistService(status, inclusion, hunk, storage, () => ({
      defaultSelectAll: false,
      selectUntracked: false,
    }));
    assert.strictEqual(changelists.get().mode, 'changelist');
    await assert.rejects(
      () => changelists.setMode('staging', false),
      (err: ProtocolError) => err.code === 'MODE_MIGRATION_REQUIRED',
    );
    changelists.setIncluded([{ repoId: idA, path: 'lines.txt' }], true);
    const toStaging = changelists.previewMigration('staging');
    assert.ok(toStaging.checkedToStage >= 1, 'checked file must be counted for staging');
    await changelists.setMode('staging', true);
    assert.ok(backedUp, 'migration must back up the previous state');
    assert.strictEqual(changelists.get().mode, 'staging');
    assert.strictEqual(changelists.get().lists.length, 1, 'staging mode collapses to the default list');
    await waitFor(() => repoA.state.indexChanges.some((c) => c.uri.fsPath === linesAbs), 'checked file staged by migration');
    await changelists.setMode('changelist', true);
    assert.strictEqual(changelists.get().mode, 'changelist');
    assert.strictEqual(backedUp?.mode, 'staging', 'reverse migration backs up the staging state');
    const defList = changelists.get().lists.find((l) => l.isDefault);
    assert.ok(defList?.checked.some((r) => r.repoId === idA && r.path === 'lines.txt'), 'staged entry must become checked');
    const feature = changelists.create('Feature X');
    changelists.move([{ repoId: idA, path: 'lines.txt' }], feature.id, true);
    assert.ok(changelists.get().lists.find((l) => l.id === feature.id)?.files.some((r) => r.path === 'lines.txt'));
    const preview = changelists.previewMigration('staging');
    assert.strictEqual(preview.listsToRemove, 1);
    assert.ok(preview.checkedToStage >= 1);
    changelists.dispose();
    ok('mode migration: confirm gate, backup, checked→index and index→checked, collapse');

    // 44. multi-repo changelist batch: per-repo translation, both commits land
    const multi = await orchestrator.run({
      repoIds: [idA, idW],
      message: 'p1: multi changelist batch',
      options: {},
      expectedIncluded: { [idA]: [{ path: 'lines.txt' }], [idW]: [{ path: 'modified.txt' }] },
    });
    assert.strictEqual(multi[0]?.ok, true, `repoA batch commit failed: ${JSON.stringify(multi[0]?.error)}`);
    assert.strictEqual(multi[1]?.ok, true, `repoW batch commit failed: ${JSON.stringify(multi[1]?.error)}`);
    assert.strictEqual(gitA('show', '--name-only', '--format=', 'HEAD').toString().trim(), 'lines.txt');
    const wFiles = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repoWPath }).toString().trim();
    assert.strictEqual(wFiles, 'modified.txt');
    ok('multi-repo changelist batch: per-repo translation + commit');

    // 45. diff.data: worktree/staged/head sides return correct texts + hunks
    const diffData = new DiffDataService(registry, new MiniRunner());
    const dvAbs = path.join(repoAPath, 'dv-probe.txt');
    fs.writeFileSync(dvAbs, 'l1\nl2\nl3\n');
    gitA('add', 'dv-probe.txt');
    gitA('commit', '-m', 'p3: dv base');
    fs.writeFileSync(dvAbs, 'l1\nL2\nl3\n');
    await waitFor(() => repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === dvAbs), 'dv-probe change visible');
    const wt = await diffData.get(idA, 'dv-probe.txt', 'worktree', false, 2048);
    assert.strictEqual(wt.binary, false);
    assert.strictEqual(wt.oldText, 'l1\nl2\nl3\n', 'worktree side old must be the index blob');
    assert.strictEqual(wt.newText, 'l1\nL2\nl3\n');
    assert.strictEqual(wt.hunks.length, 1);
    await inclusion.stage(idA, ['dv-probe.txt']);
    await waitFor(() => repoA.state.indexChanges.some((c) => c.uri.fsPath === dvAbs), 'dv-probe staged');
    const st = await diffData.get(idA, 'dv-probe.txt', 'staged', false, 2048);
    assert.strictEqual(st.oldText, 'l1\nl2\nl3\n', 'staged side old must be HEAD');
    assert.strictEqual(st.newText, 'l1\nL2\nl3\n', 'staged side new must be the index blob');
    assert.strictEqual(st.hunks.length, 1);
    const hd = await diffData.get(idA, 'dv-probe.txt', 'head', false, 2048);
    assert.strictEqual(hd.oldText, 'l1\nl2\nl3\n');
    assert.strictEqual(hd.newText, 'l1\nL2\nl3\n');
    assert.strictEqual(hd.hunks.length, 1);
    const wt2 = await diffData.get(idA, 'dv-probe.txt', 'worktree', false, 2048);
    assert.strictEqual(wt2.hunks.length, 0, 'index == worktree must yield no hunks');
    assert.strictEqual(wt2.oldText, wt2.newText);
    await inclusion.unstage(idA, ['dv-probe.txt']);
    await waitFor(() => !repoA.state.indexChanges.some((c) => c.uri.fsPath === dvAbs), 'dv-probe unstaged');
    ok('diff.data: worktree/staged/head texts + hunks; identical index↔worktree empty');

    // 46. diff.data guards: binary guard + force flag, DIFF_GUARDED + force, untracked synthetic add
    await assert.rejects(
      () => diffData.get(idA, 'binary.bin', 'worktree', false, 2048),
      (err: ProtocolError) => err.code === 'DIFF_GUARDED' && err.diffContext?.path === 'binary.bin',
    );
    const bin = await diffData.get(idA, 'binary.bin', 'worktree', true, 2048);
    assert.strictEqual(bin.binary, true, 'forced binary diff must be flagged, not rendered');
    await assert.rejects(
      () => diffData.get(idA, 'big.txt', 'head', false, 2048),
      (err: ProtocolError) => err.code === 'DIFF_GUARDED' && err.diffContext?.path === 'big.txt',
    );
    const forced = await diffData.get(idA, 'big.txt', 'head', true, 2048);
    assert.strictEqual(forced.tooLarge, true, 'force must bypass the guard into tooLarge');
    assert.strictEqual(forced.newText, '');
    const dvNewAbs = path.join(repoAPath, 'dv-new.txt');
    fs.writeFileSync(dvNewAbs, 'fresh\n');
    await waitFor(
      () =>
        repoA.state.untrackedChanges.some((c) => c.uri.fsPath === dvNewAbs) ||
        repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === dvNewAbs),
      'dv-new untracked visible',
    );
    const un = await diffData.get(idA, 'dv-new.txt', 'worktree', false, 2048);
    assert.strictEqual(un.oldText, '', 'untracked old side must be empty');
    assert.strictEqual(un.newText, 'fresh\n');
    assert.strictEqual(un.hunks.length, 1, 'untracked file must expose one synthetic add hunk');
    ok('diff.data guards: binary guard + force flag, large DIFF_GUARDED + force tooLarge, untracked synthetic add');

    // 47. checks.run: todo issues, analyze ok, unavailable ids, dependencies skipped, progress + repo filter
    fs.writeFileSync(path.join(repoAPath, 'dv-todo.txt'), 'x\n// TODO: fix me\n');
    fs.writeFileSync(path.join(repoBPath, 'dv-todo-b.txt'), '// FIXME: other repo\n');
    const checks = new ChecksService(registry, new EditorActions());
    const progress: string[] = [];
    const report = await checks.run(
      [idA],
      ['todo', 'analyze', 'rearrange', 'dependencies'],
      [
        { repoId: idA, path: 'dv-todo.txt' },
        { repoId: idB, path: 'dv-todo-b.txt' },
      ],
      (id, status) => progress.push(`${id}:${status}`),
    );
    const byId = new Map(report.results.map((r) => [r.id, r]));
    assert.strictEqual(byId.get('todo')?.status, 'issues');
    assert.strictEqual(byId.get('todo')?.details, '1 TODO/FIXME item(s): dv-todo.txt:2', 'repo filter must exclude repoB file');
    assert.strictEqual(byId.get('analyze')?.status, 'ok', 'plain text file must analyze clean');
    assert.strictEqual(byId.get('rearrange')?.status, 'unavailable');
    assert.strictEqual(byId.get('dependencies')?.status, 'skipped', 'no package.json in repoA');
    assert.deepStrictEqual(progress, [
      'todo:running', 'todo:done',
      'analyze:running', 'analyze:done',
      'rearrange:running', 'rearrange:done',
      'dependencies:running', 'dependencies:done',
    ]);
    fs.rmSync(path.join(repoBPath, 'dv-todo-b.txt'));
    ok('checks.run: todo issues + analyze ok + unavailable + skipped, progress pairs, repo filter');

    // 48. dual-mode partial commit end-to-end: changelist hunk selection + staging line stagePartial
    const hunkRun = await orchestrator.run({
      repoIds: [idA],
      message: 'p3: hunk partial commit',
      options: {},
      expectedIncluded: { [idA]: [{ path: 'hunks.txt', selection: { hunkIds: [0] } }] },
    });
    assert.strictEqual(hunkRun[0]?.ok, true, `hunk partial commit failed: ${JSON.stringify(hunkRun[0]?.error)}`);
    const committedHunks = gitA('show', 'HEAD:hunks.txt').toString();
    assert.ok(committedHunks.includes('line 3 changed') && committedHunks.includes('line 3.5 inserted'), 'selected hunk must land');
    assert.ok(!committedHunks.includes('line 20 changed'), 'unselected hunk must stay out of the commit');
    assert.ok(fs.readFileSync(hunksAbs, 'utf8').includes('line 20 changed'), 'worktree keeps unselected hunks');
    // staging mode: line-level stagePartial then commit the index
    fs.writeFileSync(linesAbs, 'A\nB\nc\nD\nE\n');
    await waitFor(() => repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === linesAbs), 'lines.txt re-edited');
    const stageList = await hunk.list(idA, 'lines.txt', 'worktree');
    assert.strictEqual(stageList.hunks.length, 1, 'both edits must merge into one hunk');
    await hunk.stagePartial(idA, 'lines.txt', { hunkIds: [0], lines: { 0: [0] } });
    await waitFor(() => repoA.state.indexChanges.some((c) => c.uri.fsPath === linesAbs), 'lines.txt partially staged');
    assert.strictEqual((await repoA.buffer('', 'lines.txt')).toString('utf8'), 'A\nB\nc\nD\ne\n', 'only the selected line staged');
    assert.strictEqual(fs.readFileSync(linesAbs, 'utf8'), 'A\nB\nc\nD\nE\n', 'worktree untouched by stagePartial');
    const stagedRun = await orchestrator.run({
      repoIds: [idA],
      message: 'p3: staging line partial',
      options: {},
      expectedStaged: { [idA]: ['lines.txt'] },
    });
    assert.strictEqual(stagedRun[0]?.ok, true, `staging partial commit failed: ${JSON.stringify(stagedRun[0]?.error)}`);
    assert.strictEqual(gitA('show', 'HEAD:lines.txt').toString(), 'A\nB\nc\nD\ne\n');
    assert.strictEqual(fs.readFileSync(linesAbs, 'utf8'), 'A\nB\nc\nD\nE\n', 'unselected line remains in worktree');
    // restore fixture neutrality for the probe files
    gitA('restore', '--', 'lines.txt');
    fs.rmSync(dvNewAbs);
    fs.rmSync(path.join(repoAPath, 'dv-todo.txt'));
    ok('dual-mode partial commit: changelist hunk selection + staging line stagePartial end-to-end');

    // 49. batch push: no-upstream auto remote, continue-on-error, explicit targets, NO_REMOTE, outgoing preview
    const gitB = (...args: string[]) => execFileSync('git', args, { cwd: repoBPath, stdio: 'pipe' });
    const bareA = path.join(fixtureDir, '.pushA.git');
    const bareB = path.join(fixtureDir, '.pushB.git');
    execFileSync('git', ['init', '--bare', '-b', 'main', bareA], { stdio: 'pipe' });
    execFileSync('git', ['init', '--bare', '-b', 'main', bareB], { stdio: 'pipe' });
    gitA('remote', 'add', 'push-origin', bareA);
    gitB('remote', 'add', 'push-origin', bareB);
    gitA('push', '-u', 'push-origin', 'main');
    fs.writeFileSync(path.join(repoAPath, 'push-a.txt'), 'a\n');
    gitA('add', 'push-a.txt');
    gitA('commit', '-m', 'push: outgoing A');
    fs.writeFileSync(path.join(repoBPath, 'push-b.txt'), 'b\n');
    gitB('add', 'push-b.txt');
    gitB('commit', '--no-verify', '-m', 'push: outgoing B');
    await waitFor(() => (repoA.state.HEAD?.ahead ?? 0) > 0, 'repoA ahead of push-origin');
    const kernelRepoA = registry.get(idA);
    const outgoing = await kernelRepoA?.log?.({ range: 'push-origin/main..HEAD' });
    assert.strictEqual(outgoing?.length, 1, 'outgoing preview range must list exactly the unpushed commit');
    assert.ok(outgoing?.[0]?.message.includes('outgoing A'));
    // repoB has no upstream but exactly one remote → auto-resolved, upstream set by push
    const pushBatch = await orchestrator.runPush({ repoIds: [idB, idA] });
    assert.deepStrictEqual(pushBatch.map((r) => r.ok), [true, true], `batch push failed: ${JSON.stringify(pushBatch)}`);
    await waitFor(() => repoB.state.HEAD?.upstream !== undefined, 'repoB upstream set by push');
    assert.strictEqual(
      execFileSync('git', ['--git-dir', bareB, 'rev-parse', 'main'], { stdio: 'pipe' }).toString().trim(),
      gitB('rev-parse', 'HEAD').toString().trim(),
      'bare B must receive the pushed commit',
    );
    ok('batch push: no-upstream root auto-resolves its only remote and sets upstream; outgoing range preview');

    // diverge bare B via a scratch clone → repoB push rejected, repoA must still push (continue-on-error)
    const scratch = path.join(fixtureDir, '.pushScratch');
    execFileSync('git', ['clone', '-q', bareB, scratch], { stdio: 'pipe' });
    fs.writeFileSync(path.join(scratch, 'remote-side.txt'), 'r\n');
    execFileSync('git', ['add', '.'], { cwd: scratch, stdio: 'pipe' });
    execFileSync('git', ['commit', '-q', '-m', 'remote side'], { cwd: scratch, stdio: 'pipe' });
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: scratch, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoBPath, 'push-b2.txt'), 'b2\n');
    gitB('add', 'push-b2.txt');
    gitB('commit', '--no-verify', '-m', 'push: outgoing B2');
    fs.writeFileSync(path.join(repoAPath, 'push-a2.txt'), 'a2\n');
    gitA('add', 'push-a2.txt');
    gitA('commit', '-m', 'push: outgoing A2');
    // behind/ahead derive from local tracking refs: fetch so repoB sees the divergence
    gitB('fetch', '-q', 'push-origin');
    await waitFor(() => (repoB.state.HEAD?.behind ?? 0) > 0, 'repoB behind diverged remote');
    const mixed = await orchestrator.runPush({ repoIds: [idB, idA] });
    assert.strictEqual(mixed[0]?.ok, false, 'diverged repoB must fail');
    assert.strictEqual(mixed[0]?.error?.code, 'PUSH_REJECTED');
    assert.strictEqual(mixed[1]?.ok, true, 'repoA must still push after repoB failed');
    ok('batch push continues past a rejected repo (per-repo results, no whole-batch abort)');

    // no remote at all → NO_REMOTE; several remotes without a choice → NO_REMOTE; explicit target honored
    const noRemote = await orchestrator.runPush({ repoIds: [idC] });
    assert.strictEqual(noRemote[0]?.ok, false);
    assert.strictEqual(noRemote[0]?.error?.code, 'NO_REMOTE');
    const gitC2 = (...args: string[]) => execFileSync('git', args, { cwd: repoCPath, stdio: 'pipe' });
    gitC2('remote', 'add', 'r-one', bareA);
    gitC2('remote', 'add', 'r-two', bareB);
    await waitFor(() => repoC.state.remotes.length === 2, 'repoC remotes discovered');
    const ambiguous = await orchestrator.runPush({ repoIds: [idC] });
    assert.strictEqual(ambiguous[0]?.error?.code, 'NO_REMOTE');
    assert.ok(/Multiple remotes/.test(ambiguous[0]?.error?.message ?? ''));
    const targeted = await orchestrator.runPush({ repoIds: [idC], targets: { [idC]: { remote: 'r-one', branch: 'main' } } });
    assert.notStrictEqual(targeted[0]?.error?.code, 'NO_REMOTE', 'explicit target must bypass remote resolution');
    ok('push target resolution: NO_REMOTE without remotes, ambiguous choice required, explicit target honored');

    // 50. push files data path: per-commit, outgoing range, root commit; single-file diff opens
    fs.writeFileSync(path.join(repoAPath, 'push-a3.txt'), 'a3\n');
    gitA('add', 'push-a3.txt');
    gitA('commit', '-m', 'push: outgoing A3');
    await waitFor(() => (repoA.state.HEAD?.ahead ?? 0) > 0, 'repoA ahead for files preview');
    const filesOid = gitA('rev-parse', 'HEAD').toString().trim();
    const filesCommit = await kernelRepoA!.getCommit(filesOid);
    const filesParent = filesCommit.parents[0];
    const singleFiles = await commitFileEntries(kernelRepoA!, filesOid, filesParent);
    assert.ok(singleFiles.some((f) => f.path === 'push-a3.txt'), 'per-commit file list must include the added file');
    const rangeFiles = await rangeFileEntries(kernelRepoA!, 'push-origin/main', 'HEAD');
    assert.ok(rangeFiles.some((f) => f.path === 'push-a3.txt'), 'outgoing range file list must include the added file');
    const rootA = gitA('rev-list', '--max-parents=0', 'HEAD').toString().trim();
    const rootFiles = await commitFileEntries(kernelRepoA!, rootA, undefined);
    assert.ok(rootFiles.length > 0, 'root commit file list must not be empty');
    const pushDiff = new EditorBridge(registry);
    await pushDiff.openCommitFileDiff(idA, { path: 'push-a3.txt', status: 1 }, filesParent ?? EMPTY_TREE, filesOid);
    await waitFor(
      () => vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.label.includes('push-a3.txt'))),
      'push file diff tab opened',
    );
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    ok('push files: per-commit / outgoing-range / root-commit lists + single-file diff opens');

    // 51. mode-only partial commit: the exec bit reaches the index and HEAD, no residual dirty entry
    // git init's fileMode probe can write false on filesystems that force mode
    // bits (this CI storage layer does); pin the Linux default so the mode-only
    // change is a real modification, as on a normal Linux checkout.
    gitA('config', 'core.fileMode', 'true');
    const modeAbs = path.join(repoAPath, 'mode-file.txt');
    fs.writeFileSync(modeAbs, 'mode\n');
    // this storage layer forces new files to 755; pin a non-exec baseline
    fs.chmodSync(modeAbs, 0o644);
    gitA('add', 'mode-file.txt');
    gitA('commit', '-m', 'mode base');
    fs.chmodSync(modeAbs, 0o755);
    // a pure chmod emits no watcher event; rewrite identical content so the
    // git extension rescans (the diff stays mode-only)
    fs.writeFileSync(modeAbs, 'mode\n');
    await kernelRepoA?.refresh?.();
    await waitFor(() => repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === modeAbs), 'mode-only change visible');
    const modeRun = await orchestrator.run({
      repoIds: [idA],
      message: 'mode-only partial commit',
      options: {},
      expectedIncluded: { [idA]: [{ path: 'mode-file.txt', selection: { hunkIds: [] } }] },
    });
    assert.strictEqual(modeRun[0]?.ok, true, `mode-only commit failed: ${JSON.stringify(modeRun[0]?.error)}`);
    assert.strictEqual(gitA('ls-tree', 'HEAD', 'mode-file.txt').toString().split(' ')[0], '100755', 'exec bit must land in HEAD');
    await waitFor(() => !repoA.state.workingTreeChanges.some((c) => c.uri.fsPath === modeAbs), 'mode-only entry cleared after commit');
    ok('mode-only partial commit: stagePartial syncs the exec bit, no residual dirty entry');

    gitA('remote', 'remove', 'push-origin');
    gitB('remote', 'remove', 'push-origin');
    gitC2('remote', 'remove', 'r-one');
    gitC2('remote', 'remove', 'r-two');
    fs.rmSync(bareA, { recursive: true, force: true });
    fs.rmSync(bareB, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });

    console.log(`\n${results.length} integration checks passed`);
  } catch (err) {
    console.error('Integration failure:', err instanceof Error ? err.stack : JSON.stringify(err));
    throw err;
  } finally {
    tracker.dispose();
    status.dispose();
    registry.dispose();
    kernel.dispose();
  }
}