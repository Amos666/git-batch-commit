import { Emitter } from '../core/events';
import type { CommitOptionsState } from '../protocol/models';

export interface OptionsStorage {
  load(): Partial<CommitOptionsState> | undefined;
  save(options: CommitOptionsState): Promise<void>;
}

function defaults(): CommitOptionsState {
  return { signoff: false, runHooks: true, checks: {}, runAfterCommit: false };
}

/** Persisted commit options (gear panel state); author identity is project-level like IDEA. */
export class OptionsService {
  private options: CommitOptionsState;
  private readonly changed = new Emitter<CommitOptionsState>();

  readonly onChanged = this.changed.event;

  constructor(private readonly storage: OptionsStorage) {
    this.options = { ...defaults(), ...storage.load() };
  }

  get(): CommitOptionsState {
    return this.options;
  }

  set(patch: Partial<CommitOptionsState>): CommitOptionsState {
    const next: CommitOptionsState = { ...this.options };
    if (patch.signoff !== undefined) {
      next.signoff = patch.signoff;
    }
    if (patch.runHooks !== undefined) {
      next.runHooks = patch.runHooks;
    }
    if (patch.runAfterCommit !== undefined) {
      next.runAfterCommit = patch.runAfterCommit;
    }
    if (patch.checks !== undefined) {
      next.checks = { ...next.checks, ...patch.checks };
    }
    if (patch.author !== undefined) {
      // webview postMessage is JSON: an empty name+email pair is the "clear author" signal
      if (patch.author.name === '' && patch.author.email === '') {
        delete next.author;
      } else {
        next.author = patch.author;
      }
    }
    this.options = next;
    void this.storage.save(next).catch(() => {});
    this.changed.fire(next);
    return next;
  }

  dispose(): void {
    this.changed.dispose();
  }
}