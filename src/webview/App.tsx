import { useEffect } from 'react';
import { StoreProvider, useInstance, usePanelStore, useStoreApi } from './state/StoreContext';
import type { PanelStoreInstance } from './state/createStore';
import { isEditableTarget, resolveKey, TEXTAREA_ALLOWED } from './state/keymap';
import { splitRefKey } from './state/types';
import { TabBar } from './components/TabBar';
import { Toolbar } from './components/Toolbar';
import { ChangeTree } from './components/tree/ChangeTree';
import { MessageEditor } from './components/message/MessageEditor';
import { OptionsPanel } from './components/options/OptionsPanel';
import { CommitActions } from './components/CommitActions';
import { ShelfTab } from './components/ShelfTab';
import { StashTab } from './components/StashTab';
import { LogView } from './components/LogView';
import { ContextMenu } from './components/menus/ContextMenu';
import { Dialogs } from './components/dialogs/Dialogs';
import { BranchPopup } from './components/BranchPopup';
import { SequencerBanner } from './components/banners/SequencerBanner';
import { MergeBanner } from './components/banners/MergeBanner';
import { ProgressBanner } from './components/banners/ProgressBanner';
import { BackendUnavailable } from './components/banners/BackendUnavailable';
import {
  ErrorBanner,
  IndexModifiedBanner,
  InitializingBanner,
  ProtocolMismatchBanner,
} from './components/banners/StatusBanners';

let lastChordAt = 0;
let lastChordTarget: HTMLElement | null = null;

function usePanelLifecycle(reportFocusEnabled: boolean): void {
  const instance = useInstance();
  useEffect(() => {
    const off = instance.subscribeEvents();
    if (!reportFocusEnabled) {
      return off;
    }
    const reportFocus = (focused: boolean): void => {
      void instance.request('ui.focus', { focused }).catch(() => {});
    };
    const onFocus = (): void => reportFocus(true);
    const onBlur = (): void => {
      // the workbench steals iframe focus when it processes a forwarded chord;
      // take it back so panel chords keep working (IDEA keeps tool-window focus)
      if (Date.now() - lastChordAt < 500) {
        // element focus (unlike window.focus) re-focuses the iframe itself;
        // deferred so it lands after the workbench finishes its focus move
        setTimeout(() => {
          if (!document.hasFocus()) {
            if (lastChordTarget?.isConnected) {
              lastChordTarget.focus();
            } else {
              window.focus();
            }
            reportFocus(true);
          }
        }, 50);
        return;
      }
      reportFocus(false);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    // window focus events can be missed when the iframe gains focus through
    // element focus alone; focusin always fires for DOM focus inside the panel
    document.addEventListener('focusin', onFocus);
    reportFocus(document.hasFocus());
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('focusin', onFocus);
      reportFocus(false);
    };
  }, [instance]);
}

function useKeymap(): void {
  const api = useStoreApi();
  useEffect(() => {
    // capture phase: this handler owns Escape and panel chords, so overlay
    // components never double-close on a single keypress
    const onKeyDown = (e: KeyboardEvent): void => {
      const s = api.getState();
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (s.contextMenu) {
          s.closeContextMenu();
        } else if (s.dialog && !s.dialogBusy) {
          s.closeDialog();
        } else if (s.branchPicker) {
          s.closeBranchPicker();
        } else if (s.historyOpen) {
          void s.toggleHistory();
        } else if (s.lastError) {
          s.dismissError();
        } else if (s.highlighted.length > 0) {
          s.clearHighlight();
        }
        return;
      }
      const command = resolveKey(e);
      if (!command) {
        return;
      }
      if (s.dialog || s.branchPicker || s.contextMenu) {
        return;
      }
      if (isEditableTarget(e.target) && !TEXTAREA_ALLOWED.has(command)) {
        return;
      }
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (command === 'toggleIncluded' && target?.tagName === 'BUTTON') {
        return;
      }
      lastChordAt = Date.now();
      lastChordTarget = e.target instanceof HTMLElement ? e.target : null;
      const refs = s.highlighted.map(splitRefKey);
      switch (command) {
        case 'commit':
          e.preventDefault();
          void s.commit();
          break;
        case 'commitAndPush':
          e.preventDefault();
          void s.commit({ pushAfter: true });
          break;
        case 'push':
          e.preventDefault();
          s.requestPush([]);
          break;
        case 'diff': {
          const first = refs[0];
          if (first) {
            e.preventDefault();
            const change = s.repos[first.repoId]?.changes.find((c) => c.path === first.path);
            void s.openDiff(first.repoId, first.path, change?.staged && s.mode === 'staging' ? 'staged' : 'head');
          }
          break;
        }
        case 'addToVcs':
          if (refs.length > 0) {
            e.preventDefault();
            void s.setIncluded(refs, true);
          }
          break;
        case 'moveChangelist':
          if (refs.length > 0 && s.mode === 'changelist') {
            e.preventDefault();
            s.openDialog({ kind: 'moveChangelist', refs, targetId: s.changelists?.activeId ?? 'default' });
          }
          break;
        case 'toggleOptions':
          e.preventDefault();
          s.toggleOptions();
          break;
        case 'refresh':
          e.preventDefault();
          void s.refresh();
          break;
        case 'pickChangelist':
          if (s.mode === 'changelist') {
            e.preventDefault();
            s.openDialog({ kind: 'pickChangelist' });
          }
          break;
        case 'delete':
          if (refs.length > 0) {
            e.preventDefault();
            s.openDialog({ kind: 'deleteFiles', refs });
          }
          break;
        case 'toggleIncluded':
          if (refs.length > 0) {
            e.preventDefault();
            for (const ref of refs) {
              void s.toggleIncluded(ref);
            }
          }
          break;
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [api]);
}

function CommitTab() {
  return (
    <>
      <Toolbar />
      <ChangeTree />
      <MessageEditor />
      <OptionsPanel />
      <CommitActions />
    </>
  );
}

export function App() {
  usePanelLifecycle(true);
  useKeymap();
  const activeTab = usePanelStore((s) => s.activeTab);
  const panelState = usePanelStore((s) => s.panelState);
  return (
    <div className="gbc-panel" data-testid="commit-panel">
      <TabBar />
      <ProtocolMismatchBanner />
      <BackendUnavailable />
      <InitializingBanner />
      <SequencerBanner />
      <MergeBanner />
      <IndexModifiedBanner />
      <ErrorBanner />
      <ProgressBanner />
      {panelState === 'ready' && activeTab === 'commit' && <CommitTab />}
      {panelState === 'ready' && activeTab === 'shelf' && <ShelfTab />}
      {panelState === 'ready' && activeTab === 'stash' && <StashTab />}
      <ContextMenu />
      <Dialogs />
      <BranchPopup />
    </div>
  );
}

/** Entry for the standalone Log webview view (Alt+9). */
export function LogApp() {
  // only the commit view owns gitBatchCommit.panelFocused; a hidden log
  // iframe reporting blur would clobber the commit panel's focus context
  usePanelLifecycle(false);
  const api = useStoreApi();
  const repoId = usePanelStore((s) => s.logView?.repoId);
  useEffect(() => {
    const s = api.getState();
    if (s.logView && s.logView.entries.length === 0 && !s.logView.busy) {
      void s.reloadLog();
    }
  }, [api, repoId]);
  return (
    <div className="gbc-panel" data-testid="log-panel">
      <SequencerBanner />
      <ErrorBanner />
      <LogView />
      <Dialogs />
    </div>
  );
}

export function Root({ instance, view }: { instance: PanelStoreInstance; view: 'commit' | 'log' }) {
  return <StoreProvider instance={instance}>{view === 'log' ? <LogApp /> : <App />}</StoreProvider>;
}