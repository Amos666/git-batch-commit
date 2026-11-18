import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildDiffRows } from '../core/diffRows';
import type { DiffRow } from '../core/diffRows';
import { countNewSideLines } from '../core/hunkDiff';
import type { ProtocolError } from '../protocol/errors';
import type { DiffDataResult, DiffSide } from '../protocol/messages';
import type { ChangelistState, CommitMode, PartialSelection } from '../protocol/models';
import { Checkbox, IconButton } from '../webview/components/primitives';
import { STRINGS } from '../webview/strings/en';
import type { Transport } from '../webview/transport/types';

const D = STRINGS.diff;

const SIDE_LABEL: Record<DiffSide, string> = {
  head: D.sideHead,
  staged: D.sideStaged,
  worktree: D.sideWorktree,
};

interface Props {
  transport: Transport;
  repoId: string;
  relPath: string;
  side: DiffSide;
  force: boolean;
}

/**
 * IDEA-form diff viewer: dual read-only panes, line numbers, and per-hunk /
 * per-line include checkboxes. Changelist mode persists the selection into
 * the owning changelist (inclusion.setPartial); staging mode stages or
 * unstages immediately (index.stagePartial / unstagePartial).
 */
export function DiffViewer({ transport, repoId, relPath, side, force }: Props) {
  const [data, setData] = useState<DiffDataResult | null>(null);
  const [error, setError] = useState<ProtocolError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<CommitMode>('changelist');
  const [included, setIncluded] = useState(false);
  const [selection, setSelection] = useState<PartialSelection | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [forced, setForced] = useState(force);
  const [currentHunk, setCurrentHunk] = useState(0);
  const hunkRefs = useRef(new Map<number, HTMLElement>());
  const busyRef = useRef(false);

  const applyLists = useCallback((lists: ChangelistState): void => {
    const key = `${repoId}:${relPath}`;
    const owning = lists.lists.find((l) => l.files.some((f) => f.repoId === repoId && f.path === relPath));
    const checked = owning
      ? owning.checked.some((f) => f.repoId === repoId && f.path === relPath)
      : lists.unversionedChecked.some((f) => f.repoId === repoId && f.path === relPath);
    setIncluded(checked);
    setSelection(owning?.partial[key] ?? null);
    setMode(lists.mode);
  }, [repoId, relPath]);

  const load = useCallback(
    async (forceFlag: boolean): Promise<void> => {
      setLoading(true);
      try {
        const tDiff = performance.now();
        const diffReq = transport.request('diff.data', { repoId, path: relPath, side, force: forceFlag }).finally(() => {
          void transport.request('ui.metric', { name: 'diff.data', ms: performance.now() - tDiff }).catch(() => {});
        });
        const [result, modeRes, lists, statuses] = await Promise.all([
          diffReq,
          transport.request('mode.get', undefined),
          transport.request('changelist.list', undefined),
          transport.request('status.get', { repoId }),
        ]);
        setData(result);
        setMode(modeRes.mode);
        applyLists(lists);
        const change = statuses[0]?.changes.find((c) => c.path === relPath);
        setConflicted(change?.conflicted ?? false);
        setError(null);
      } catch (err) {
        setError(err as ProtocolError);
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [transport, repoId, relPath, side, applyLists],
  );

  useEffect(() => {
    void load(forced);
    const offs = [
      transport.onEvent('changelists.changed', ({ state }) => applyLists(state)),
      transport.onEvent('mode.changed', () => void load(forced)),
      transport.onEvent('status.changed', ({ status }) => {
        if (status.repo.id === repoId) {
          const change = status.changes.find((c) => c.path === relPath);
          setConflicted(change?.conflicted ?? false);
        }
      }),
      transport.onEvent('ui.command', ({ command }) => {
        if (command === 'refresh' && !busyRef.current) {
          void load(forced);
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [load, forced, transport, repoId, relPath]);

  const hunks = data?.hunks ?? [];
  const rows = useMemo(
    () => (data && !data.binary && !data.tooLarge ? buildDiffRows(data.oldText, data.newText, data.hunks) : []),
    [data],
  );

  const canEdit = !conflicted && !busy && (mode === 'changelist' || side !== 'head');
  const selHunks = useMemo(() => {
    if (mode === 'staging') {
      return new Set(side === 'staged' ? hunks.map((h) => h.id) : []);
    }
    if (selection) {
      return new Set(selection.hunkIds);
    }
    return new Set(included ? hunks.map((h) => h.id) : []);
  }, [mode, side, selection, included, hunks]);

  const lineOn = (hunkId: number, offset: number): boolean => {
    if (!selHunks.has(hunkId)) {
      return false;
    }
    if (mode === 'staging') {
      return side === 'staged';
    }
    const lines = selection?.lines?.[hunkId];
    return lines ? lines.includes(offset) : true;
  };

  const withBusy = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    busyRef.current = true;
    try {
      await fn();
      setError(null);
    } catch (err) {
      setError(err as ProtocolError);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  /** Persist a changelist-mode selection; null = whole file, empty = excluded. */
  const applySelection = async (next: PartialSelection | null, inc: boolean): Promise<void> => {
    await transport.request('inclusion.setPartial', { repoId, path: relPath, selection: next });
    await transport.request('inclusion.set', { refs: [{ repoId, path: relPath }], included: inc });
  };

  const commitSelection = async (nextHunks: Set<number>, lines: Record<number, number[]>): Promise<void> => {
    const all = hunks.every((h) => nextHunks.has(h.id));
    const hasLines = Object.keys(lines).length > 0;
    if (nextHunks.size === 0) {
      await applySelection(null, false);
    } else if (all && !hasLines) {
      await applySelection(null, true);
    } else {
      await applySelection({ hunkIds: [...nextHunks], ...(hasLines ? { lines } : {}) }, true);
    }
  };

  const toggleHunk = (hunkId: number): void => {
    void withBusy(async () => {
      if (mode === 'staging') {
        const method = side === 'staged' ? 'index.unstagePartial' : 'index.stagePartial';
        await transport.request(method, { repoId, path: relPath, selection: { hunkIds: [hunkId] } });
        await load(forced);
        return;
      }
      const next = new Set(selHunks);
      if (next.has(hunkId)) {
        next.delete(hunkId);
      } else {
        next.add(hunkId);
      }
      const lines: Record<number, number[]> = {};
      for (const h of hunks) {
        const existing = selection?.lines?.[h.id];
        if (next.has(h.id) && existing) {
          lines[h.id] = existing;
        }
      }
      await commitSelection(next, lines);
    });
  };

  const toggleLine = (hunkId: number, offset: number): void => {
    void withBusy(async () => {
      if (mode === 'staging') {
        const method = side === 'staged' ? 'index.unstagePartial' : 'index.stagePartial';
        await transport.request(method, { repoId, path: relPath, selection: { hunkIds: [hunkId], lines: { [hunkId]: [offset] } } });
        await load(forced);
        return;
      }
      const hunk = hunks.find((h) => h.id === hunkId);
      if (!hunk) {
        return;
      }
      const total = countNewSideLines(hunk);
      const current = selection?.lines?.[hunkId] ?? (selHunks.has(hunkId) ? Array.from({ length: total }, (_, i) => i) : []);
      const nextLines = current.includes(offset) ? current.filter((o) => o !== offset) : [...current, offset];
      const nextHunks = new Set(selHunks);
      const lines: Record<number, number[]> = {};
      for (const h of hunks) {
        const existing = selection?.lines?.[h.id];
        if (existing && nextHunks.has(h.id)) {
          lines[h.id] = existing;
        }
      }
      if (nextLines.length === 0) {
        nextHunks.delete(hunkId);
        delete lines[hunkId];
      } else {
        nextHunks.add(hunkId);
        if (nextLines.length === total) {
          delete lines[hunkId];
        } else {
          lines[hunkId] = nextLines.sort((a, b) => a - b);
        }
      }
      await commitSelection(nextHunks, lines);
    });
  };

  const gotoHunk = (index: number): void => {
    if (hunks.length === 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(hunks.length - 1, index));
    setCurrentHunk(clamped);
    const h = hunks[clamped];
    if (h) {
      hunkRefs.current.get(h.id)?.scrollIntoView({ block: 'center' });
    }
  };

  const renderRow = (row: DiffRow, key: number) => {
    if (row.kind === 'hunk') {
      return (
        <div
          key={key}
          className="dv-hunk"
          data-testid={`diff-hunk-${row.hunkId}`}
          ref={(el) => {
            if (el) {
              hunkRefs.current.set(row.hunkId, el);
            } else {
              hunkRefs.current.delete(row.hunkId);
            }
          }}
        >
          <Checkbox
            checked={selHunks.has(row.hunkId)}
            disabled={!canEdit}
            onChange={() => toggleHunk(row.hunkId)}
            label={D.includeHunk}
            testId={`hunk-check-${row.hunkId}`}
          />
          <span className="dv-hunk-header">{row.header}</span>
        </div>
      );
    }
    if (row.kind === 'equal') {
      return (
        <div key={key} className="dv-row">
          <span className="dv-no">{row.oldNo}</span>
          <span className="dv-pane">{row.text}</span>
          <span className="dv-check" />
          <span className="dv-no">{row.newNo}</span>
          <span className="dv-pane">{row.text}</span>
        </div>
      );
    }
    const showLineCheck = row.new?.offset !== undefined && (row.change === 'add' || row.change === 'replace');
    const cls =
      row.change === 'add' ? ' dv-add' : row.change === 'del' ? ' dv-del' : row.change === 'replace' ? ' dv-replace' : '';
    return (
      <div key={key} className={`dv-row${cls}`} data-hunk={row.hunkId}>
        <span className="dv-no">{row.old?.no ?? ''}</span>
        <span className={`dv-pane${row.change === 'del' || row.change === 'replace' ? ' dv-pane-del' : ''}`}>
          {row.old?.text ?? ''}
        </span>
        <span className="dv-check">
          {showLineCheck && (
            <Checkbox
              checked={lineOn(row.hunkId, row.new?.offset ?? 0)}
              disabled={!canEdit}
              onChange={() => toggleLine(row.hunkId, row.new?.offset ?? 0)}
              label={D.includeLine}
              testId={`line-check-${row.hunkId}-${row.new?.offset}`}
            />
          )}
        </span>
        <span className="dv-no">{row.new?.no ?? ''}</span>
        <span className={`dv-pane${row.change === 'add' || row.change === 'replace' ? ' dv-pane-add' : ''}`}>
          {row.new?.text ?? ''}
        </span>
      </div>
    );
  };

  return (
    <div className="dv-root" data-testid="diff-viewer">
      <div className="dv-toolbar">
        <span className="dv-title" title={relPath}>{relPath}</span>
        <span className="dv-side">{SIDE_LABEL[side]}</span>
        {mode === 'staging' && side === 'head' && <span className="dv-readonly">{D.readOnly}</span>}
        <span className="dv-spacer" />
        <span className="dv-prev">
          <IconButton icon="chevronDown" label={D.prevHunk} onClick={() => gotoHunk(currentHunk - 1)} disabled={hunks.length === 0} testId="diff-prev-hunk" />
        </span>
        <IconButton icon="chevronDown" label={D.nextHunk} onClick={() => gotoHunk(currentHunk + 1)} disabled={hunks.length === 0} testId="diff-next-hunk" />
        <span className="dv-counter" data-testid="diff-hunk-counter">{D.hunkCounter(hunks.length === 0 ? 0 : currentHunk + 1, hunks.length)}</span>
        <IconButton icon="refresh" label={D.refresh} onClick={() => void load(forced)} testId="diff-refresh" />
      </div>
      {error && (
        <div className="dv-error" data-testid="diff-error">
          <span>{error.message}</span>
          {error.code === 'DIFF_GUARDED' && (
            <button
              type="button"
              className="gbc-btn gbc-btn-sm"
              data-testid="diff-force-open"
              onClick={() => {
                setForced(true);
                void load(true);
              }}
            >
              {STRINGS.recovery.forceOpenDiff}
            </button>
          )}
          <button type="button" className="gbc-btn gbc-btn-sm" data-testid="diff-retry" onClick={() => void load(forced)}>
            {STRINGS.actions.retry}
          </button>
        </div>
      )}
      {loading && !data && <div className="dv-notice" data-testid="diff-loading">{D.loading}</div>}
      {data?.binary && <div className="dv-notice" data-testid="diff-binary">{D.binary}</div>}
      {data?.tooLarge && <div className="dv-notice" data-testid="diff-toolarge">{D.tooLarge}</div>}
      {data && !data.binary && !data.tooLarge && (
        <div className="dv-body" data-testid="diff-body">
          {rows.length === 0 ? <div className="dv-notice">{D.noChanges}</div> : rows.map(renderRow)}
        </div>
      )}
    </div>
  );
}