import { headerKeys } from '../../treeRows';
import type { Slice } from '../types';

export const uiSlice: Slice = (set, get) => ({
  activeTab: 'commit',
  viewOptions: { groupByDirectory: true, showUnversioned: true },
  collapsed: {},
  highlighted: [],
  contextMenu: null,
  dialog: null,
  dialogBusy: false,
  optionsOpen: false,

  setActiveTab: (tab) => {
    set({ activeTab: tab, contextMenu: null });
    const s = get();
    if (tab === 'shelf') {
      void s.openShelfTab();
    } else if (tab === 'stash') {
      void s.openStashTab();
    }
  },

  toggleViewOption: (key) =>
    set({ viewOptions: { ...get().viewOptions, [key]: !get().viewOptions[key] } }),

  toggleCollapse: (key) => {
    const collapsed = { ...get().collapsed };
    if (collapsed[key]) {
      delete collapsed[key];
    } else {
      collapsed[key] = true;
    }
    set({ collapsed });
  },

  expandAll: () => set({ collapsed: {} }),

  collapseAll: () => {
    const s = get();
    const keys = headerKeys({
      repoOrder: s.repoOrder,
      repos: s.repos,
      mode: s.mode,
      changelists: s.changelists,
      viewOptions: s.viewOptions,
      collapsed: {},
    });
    const collapsed: Record<string, boolean> = {};
    for (const key of keys) {
      collapsed[key] = true;
    }
    set({ collapsed });
  },

  highlight: (keys, additive) => {
    const current = get().highlighted;
    if (!additive) {
      set({ highlighted: keys });
      return;
    }
    const next = [...current];
    for (const key of keys) {
      const i = next.indexOf(key);
      if (i === -1) {
        next.push(key);
      } else {
        next.splice(i, 1);
      }
    }
    set({ highlighted: next });
  },

  clearHighlight: () => set({ highlighted: [] }),

  openContextMenu: (target) => set({ contextMenu: target }),
  closeContextMenu: () => set({ contextMenu: null }),

  openDialog: (dialog) => set({ dialog, dialogBusy: false, dialogError: undefined, contextMenu: null }),
  closeDialog: () => set({ dialog: null, dialogBusy: false, dialogError: undefined }),
  patchDialog: (patch) => {
    const dialog = get().dialog;
    if (dialog) {
      set({ dialog: { ...dialog, ...patch } as typeof dialog, dialogError: undefined });
    }
  },

  toggleOptions: () => set({ optionsOpen: !get().optionsOpen }),
});