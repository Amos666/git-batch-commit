import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { Transport } from '../transport/types';
import { splitRefKey } from './types';
import type { PanelStore, SliceCtx } from './types';
import { coreSlice } from './slices/core';
import { uiSlice } from './slices/ui';
import { changelistsSlice } from './slices/changelists';
import { commitSlice } from './slices/commit';
import { filesSlice } from './slices/files';
import { branchSlice } from './slices/branch';
import { shelfSlice } from './slices/shelf';
import { stashSlice } from './slices/stash';
import { logSlice } from './slices/log';

export type { PanelStore } from './types';

export interface PanelStoreInstance {
  store: UseBoundStore<StoreApi<PanelStore>>;
  subscribeEvents: () => () => void;
  request: SliceCtx['request'];
}

export function createStore(transport: Transport): PanelStoreInstance {
  const ctx: SliceCtx = {
    request: transport.request.bind(transport),
    metric: (name, ms) => {
      void transport.request('ui.metric', { name, ms }).catch(() => {});
    },
  };

  const usePanelStore = create<PanelStore>((set, get) => ({
    ...coreSlice(set, get, ctx),
    ...uiSlice(set, get, ctx),
    ...changelistsSlice(set, get, ctx),
    ...commitSlice(set, get, ctx),
    ...filesSlice(set, get, ctx),
    ...branchSlice(set, get, ctx),
    ...shelfSlice(set, get, ctx),
    ...stashSlice(set, get, ctx),
    ...logSlice(set, get, ctx),
  }) as PanelStore) as UseBoundStore<StoreApi<PanelStore>>;

  const dispatchCommand = (command: string): void => {
    const s = usePanelStore.getState();
    if ((s.dialog || s.branchPicker || s.contextMenu) && command !== 'refresh') {
      return;
    }
    const refs = s.highlighted.map(splitRefKey);
    switch (command) {
      case 'commit':
        void s.commit();
        break;
      case 'commitAndPush':
        void s.commit({ pushAfter: true });
        break;
      case 'push':
        s.requestPush([]);
        break;
      case 'diff': {
        const first = refs[0];
        if (first) {
          const change = s.repos[first.repoId]?.changes.find((c) => c.path === first.path);
          void s.openDiff(first.repoId, first.path, change?.staged && s.mode === 'staging' ? 'staged' : 'head');
        }
        break;
      }
      case 'addToVcs':
        if (refs.length > 0) {
          void s.setIncluded(refs, true);
        }
        break;
      case 'moveChangelist':
        if (refs.length > 0 && s.mode === 'changelist') {
          s.openDialog({ kind: 'moveChangelist', refs, targetId: s.changelists?.activeId ?? 'default' });
        }
        break;
      case 'toggleOptions':
        s.toggleOptions();
        break;
      case 'setActiveChangelist':
        if (s.mode === 'changelist') {
          s.openDialog({ kind: 'pickChangelist' });
        }
        break;
      case 'refresh':
        void s.refresh();
        break;
      case 'rollback':
        if (refs.length > 0) {
          s.openDialog({ kind: 'rollback', refs });
        }
        break;
    }
  };

  function subscribeEvents(): () => void {
    const offs = [
      transport.onEvent('status.changed', ({ status }) => usePanelStore.getState().applyStatus(status)),
      transport.onEvent('repo.opened', ({ status }) => usePanelStore.getState().applyStatus(status)),
      transport.onEvent('repo.closed', ({ repoId }) => usePanelStore.getState().removeRepo(repoId)),
      transport.onEvent('operation.progress', ({ operation }) => usePanelStore.getState().setOperation(operation)),
      transport.onEvent('panel.state', ({ panelState, unavailableReason }) =>
        usePanelStore.getState().setPanelState(panelState, unavailableReason),
      ),
      transport.onEvent('changelists.changed', ({ state }) => usePanelStore.getState().applyChangelists(state)),
      transport.onEvent('mode.changed', ({ mode }) => usePanelStore.getState().applyMode(mode)),
      transport.onEvent('options.changed', ({ options }) => usePanelStore.getState().applyOptions(options)),
      transport.onEvent('checks.progress', ({ checkId, status }) => {
        const current = usePanelStore.getState().checksRunning;
        usePanelStore.setState({
          checksRunning:
            status === 'running' ? [...new Set([...current, checkId])] : current.filter((id) => id !== checkId),
        });
      }),
      transport.onEvent('ui.command', ({ command }) => dispatchCommand(command)),
    ];
    void usePanelStore.getState().init();
    return () => offs.forEach((off) => off());
  }

  return { store: usePanelStore, subscribeEvents, request: ctx.request };
}