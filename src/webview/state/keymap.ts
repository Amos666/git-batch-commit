/**
 * Panel-local keymap (IDEA Commit tool window bindings). Pure resolver so
 * unit tests can assert every chord without a DOM. Host-level keybindings
 * forward the same commands through ui.command.
 */
export type KeyCommand =
  | 'commit'
  | 'commitAndPush'
  | 'push'
  | 'diff'
  | 'addToVcs'
  | 'moveChangelist'
  | 'toggleOptions'
  | 'pickChangelist'
  | 'delete'
  | 'toggleIncluded'
  | 'refresh';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function resolveKey(e: KeyLike): KeyCommand | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && e.altKey && e.shiftKey && key === 'k') {
    return 'commitAndPush';
  }
  if (mod && e.altKey && e.shiftKey && key === 'p') {
    return 'push';
  }
  if (mod && e.altKey && !e.shiftKey) {
    switch (key) {
      case 'd':
        return 'diff';
      case 's':
        return 'addToVcs';
      case 'o':
        return 'toggleOptions';
      case 'c':
        return 'commit';
      case 'r':
        return 'refresh';
    }
  }
  if (mod && !e.altKey && !e.shiftKey && e.key === 'Enter') {
    return 'commit';
  }
  if (mod && !e.altKey && !e.shiftKey && e.key === ' ') {
    return 'pickChangelist';
  }
  if (!mod && e.altKey && e.shiftKey && key === 'm') {
    return 'moveChangelist';
  }
  if (!mod && !e.altKey && !e.shiftKey && e.key === 'Delete') {
    return 'delete';
  }
  if (!mod && !e.altKey && !e.shiftKey && e.key === ' ') {
    return 'toggleIncluded';
  }
  return null;
}

/** Chords that must work while the commit message textarea has focus. */
export const TEXTAREA_ALLOWED: ReadonlySet<KeyCommand> = new Set(['commit', 'commitAndPush', 'toggleOptions', 'refresh']);

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}