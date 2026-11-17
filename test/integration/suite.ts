import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { acquireGitApi } from '../../src/adapter/gitApi';
import { mapLocalBranches } from '../../src/adapter/branchRefs';
import { RepoRegistry, repoIdFor } from '../../src/adapter/repoRegistry';
import { BatchOrchestrator } from '../../src/core/batchOrchestrator';
import { InclusionModel } from '../../src/core/inclusionModel';
import { MiniRunner } from '../../src/core/miniRunner';
import { OperationTracker } from '../../src/core/operationTracker';
import { StatusService } from '../../src/core/statusService';
import type { ProtocolError } from '../../src/protocol/errors';
import { DiffService } from '../../src/services/diffService';
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

  const registry = new RepoRegistry(api);
  const status = new StatusService(registry, 50);
  const inclusion = new InclusionModel(registry);
  const tracker = new OperationTracker();
  const orchestrator = new BatchOrchestrator(registry, inclusion, tracker, () => ({ stopOnFirstRepoError: true }));

  const repoA = api.repositories.find((r) => r.rootUri.fsPath === repoAPath);
  const repoB = api.repositories.find((r) => r.rootUri.fsPath === repoBPath);
  assert.ok(repoA && repoB);
  const idA = repoIdFor(repoA.rootUri);
  const idB = repoIdFor(repoB.rootUri);

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
    const empty = await orchestrator.run({ repoIds: [idA], message: 'should not commit' });
    assert.strictEqual(empty[0]?.ok, false);
    assert.strictEqual(empty[0]?.error?.code, 'NO_CHANGES');
    ok('empty index blocked with NO_CHANGES');

    // 9. empty message rejected
    await assert.rejects(
      () => orchestrator.run({ repoIds: [idA], message: '   ' }),
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
    const idW = repoIdFor(repoW.rootUri);
    const idC = repoIdFor(repoC.rootUri);
    await waitFor(() => status.snapshot(idW) !== undefined, 'worktree snapshot available');
    const snapW = status.snapshot(idW);
    assert.ok(snapW);
    assert.strictEqual(snapW.branch.name, 'wt');
    assert.ok(snapW.changes.some((c) => c.path === 'modified.txt'), 'worktree change missing');
    ok('worktree state mapping (branch + changes)');

    // 13. amend rewrites HEAD message without staged files
    const amend = await orchestrator.run({ repoIds: [idA], message: 'phase0: amended message', amend: true });
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
    const cancelRun = orchestrator.run({ repoIds: [idC, idW], message: 'phase0: cancel timing test' });
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
    const diff = new DiffService(api, registry);
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
    const hunk = new HunkService(registry, new MiniRunner());
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
      signoff: true,
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
        keybindings?: { command: string; when?: string }[];
        configuration: { properties: Record<string, unknown> };
      };
    };
    const kbs = pkg.contributes.keybindings ?? [];
    assert.ok(
      kbs.some((k) => k.command === 'gitBatchCommit.commit' && k.when === 'gitBatchCommit.panelFocused'),
      'commit keybinding must be scoped to panel focus',
    );
    assert.ok(
      kbs.every((k) => k.when === 'gitBatchCommit.panelFocused'),
      'all panel keybindings must use the focus when-clause',
    );
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
    const idNested = repoIdFor(repoNested.rootUri);
    await assert.rejects(
      () => seq.undoCommit(idNested),
      (err: ProtocolError) => err.code === 'GENERIC' && /根提交/.test(err.message),
    );
    // pushed HEAD → rejected
    const bareDir = path.join(fixtureDir, '.undo-remote.git');
    execFileSync('git', ['init', '--bare', bareDir], { stdio: 'pipe' });
    gitA('remote', 'add', 'undo-origin', bareDir);
    gitA('push', '-u', 'undo-origin', 'main');
    await assert.rejects(
      () => seq.undoCommit(idA),
      (err: ProtocolError) => err.code === 'GENERIC' && /远端/.test(err.message),
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
      (err: ProtocolError) => err.code === 'GENERIC' && /进行中/.test(err.message),
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

    console.log(`\n${results.length} integration checks passed`);
  } finally {
    tracker.dispose();
    status.dispose();
    registry.dispose();
  }
}