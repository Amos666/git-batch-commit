/**
 * From-scratch 16x16 icon geometry (clean-room: no JetBrains/GitJet path
 * data). Each icon is a list of stroke paths on a 16x16 grid; `fill: true`
 * marks solid shapes. Strokes use currentColor so themes recolor them.
 */
export interface IconPath {
  d: string;
  fill?: boolean;
}

const PATHS = {
  refresh: [
    { d: 'M13.2 8a5.2 5.2 0 1 1-1.6-3.8' },
    { d: 'M13.4 1.8v3h-3' },
  ],
  rollback: [
    { d: 'M6 2.8L2.6 6.2 6 9.6' },
    { d: 'M2.6 6.2h7.2a3.6 3.6 0 0 1 0 7.2H6.4' },
  ],
  shelve: [
    { d: 'M8 1.8v7' },
    { d: 'M5.2 6l2.8 2.8L10.8 6' },
    { d: 'M2.4 10.6h11.2v3.2H2.4z' },
  ],
  unshelve: [
    { d: 'M8 8.8v-7' },
    { d: 'M5.2 4.6L8 1.8l2.8 2.8' },
    { d: 'M2.4 10.6h11.2v3.2H2.4z' },
  ],
  diff: [
    { d: 'M2.2 4.8h9' },
    { d: 'M8.6 2.2l2.6 2.6-2.6 2.6' },
    { d: 'M13.8 11.2h-9' },
    { d: 'M7.4 8.6l-2.6 2.6 2.6 2.6' },
  ],
  gear: [
    { d: 'M8 5.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z' },
    { d: 'M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2M3.5 3.5l1.6 1.6M10.9 10.9l1.6 1.6M12.5 3.5l-1.6 1.6M5.1 10.9l-1.6 1.6' },
  ],
  chevronDown: [{ d: 'M4.2 6.2L8 10l3.8-3.8' }],
  chevronRight: [{ d: 'M6.2 4.2L10 8l-3.8 3.8' }],
  expandAll: [
    { d: 'M4.2 6.4L8 2.6l3.8 3.8' },
    { d: 'M4.2 9.6L8 13.4l3.8-3.8' },
  ],
  collapseAll: [
    { d: 'M4.2 2.6L8 6.4l3.8-3.8' },
    { d: 'M4.2 13.4L8 9.6l3.8 3.8' },
  ],
  folder: [{ d: 'M2.2 3.6h4.2l1.6 2h5.8v7.8H2.2z' }],
  history: [
    { d: 'M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8z' },
    { d: 'M8 4.8V8l2.6 1.6' },
  ],
  amend: [
    { d: 'M3 13l.8-3L11 2.8l2.2 2.2L6 12.2z' },
    { d: 'M9.6 4.2l2.2 2.2' },
  ],
  commit: [
    { d: 'M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8z' },
    { d: 'M5.4 8l2 2 3.4-4' },
  ],
  branch: [
    { d: 'M5 5.4v5.2' },
    { d: 'M5 2.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z' },
    { d: 'M5 10.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z' },
    { d: 'M11 2.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z' },
    { d: 'M11 5.4c0 3.2-6 2.4-6 5.2' },
  ],
  file: [
    { d: 'M4 1.6h5.4l3 3v9.8H4z' },
    { d: 'M9.4 1.6v3h3' },
  ],
  warning: [
    { d: 'M8 2.2l6.4 11.4H1.6z' },
    { d: 'M8 6.4v3.6' },
    { d: 'M8 11.8v.6' },
  ],
  stash: [
    { d: 'M2.4 2.8h11.2v2.8H2.4z' },
    { d: 'M3.4 5.6v7.6h9.2V5.6' },
    { d: 'M6.4 8.2h3.2' },
  ],
  add: [{ d: 'M8 3v10M3 8h10' }],
  remove: [{ d: 'M3 8h10' }],
  delete: [
    { d: 'M2.8 4.4h10.4' },
    { d: 'M6 4.4V2.8h4v1.6' },
    { d: 'M4.4 4.4l.7 9h5.8l.7-9' },
    { d: 'M6.8 6.8v4.4M9.2 6.8v4.4' },
  ],
  check: [{ d: 'M3 8.4l3.4 3.4L13 4.6' }],
  close: [{ d: 'M4 4l8 8M12 4l-8 8' }],
  search: [
    { d: 'M7 2.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8z' },
    { d: 'M10.4 10.4l3.2 3.2' },
  ],
  eye: [
    { d: 'M1.6 8S4.2 3.6 8 3.6 14.4 8 14.4 8 11.8 12.4 8 12.4 1.6 8 1.6 8z' },
    { d: 'M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z' },
  ],
  move: [
    { d: 'M2.2 8h8.6' },
    { d: 'M7.8 4.8L11 8l-3.2 3.2' },
    { d: 'M13.4 3v10' },
  ],
  patch: [
    { d: 'M4 1.6h5.4l3 3v9.8H4z' },
    { d: 'M9.4 1.6v3h3' },
    { d: 'M5.8 8h4.4M5.8 10.6h4.4' },
  ],
  jumpToSource: [
    { d: 'M9.2 2.4h4.4v4.4' },
    { d: 'M13.6 2.4L7.2 8.8' },
    { d: 'M6 3.6H2.8v9.6h9.6V10' },
  ],
  openFolder: [
    { d: 'M2.2 3.6h4.2l1.6 2h5.8v7.8H2.2z' },
    { d: 'M6 9.6h4.4M8.6 7.8l1.8 1.8-1.8 1.8' },
  ],
  push: [
    { d: 'M8 13.2V3' },
    { d: 'M4.2 6.4L8 2.6l3.8 3.8' },
  ],
  pull: [
    { d: 'M8 2.8V13' },
    { d: 'M4.2 9.6L8 13.4l3.8-3.8' },
  ],
  changelist: [{ d: 'M3 4.2h10M3 8h10M3 11.8h6' }],
  copy: [
    { d: 'M5.4 5.4h7.8v8.2H5.4z' },
    { d: 'M3 10.6V2.4h7.8' },
  ],
  more: [
    { d: 'M8 3.4v.4M8 7.8v.4M8 12.2v.4', fill: false },
  ],
} satisfies Record<string, IconPath[]>;

export type IconName = keyof typeof PATHS;
export const ICON_PATHS: Record<IconName, IconPath[]> = PATHS;