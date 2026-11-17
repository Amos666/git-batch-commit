import * as vscode from 'vscode';
import type { OperationPhase, OperationState } from '../protocol/models';

let nextId = 0;

export class OperationTracker implements vscode.Disposable {
  private readonly states = new Map<string, OperationState>();
  private readonly progress = new vscode.EventEmitter<OperationState>();

  readonly onProgress = this.progress.event;

  isRunning(repoId: string): boolean {
    const state = this.states.get(repoId);
    return state !== undefined && (state.phase === 'validating' || state.phase === 'committing' || state.phase === 'pushing');
  }

  anyRunning(): boolean {
    for (const state of this.states.values()) {
      if (state.phase === 'validating' || state.phase === 'committing' || state.phase === 'pushing') {
        return true;
      }
    }
    return false;
  }

  start(repoId: string, kind: OperationState['kind']): OperationState {
    const state: OperationState = {
      id: `op-${++nextId}`,
      repoId,
      kind,
      phase: 'validating',
      startedAt: Date.now(),
    };
    this.states.set(repoId, state);
    this.progress.fire(state);
    return state;
  }

  update(repoId: string, phase: OperationPhase, message?: string): void {
    const state = this.states.get(repoId);
    if (!state) {
      return;
    }
    const next = { ...state, phase, message };
    this.states.set(repoId, next);
    this.progress.fire(next);
  }

  end(repoId: string, phase: 'done' | 'failed' | 'cancelled', message?: string): void {
    this.update(repoId, phase, message);
    this.states.delete(repoId);
  }

  dispose(): void {
    this.progress.dispose();
  }
}