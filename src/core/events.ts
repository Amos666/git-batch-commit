/** Minimal vscode-free event emitter for host services. */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  readonly event = (cb: (value: T) => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  fire(value: T): void {
    for (const cb of [...this.listeners]) {
      cb(value);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}