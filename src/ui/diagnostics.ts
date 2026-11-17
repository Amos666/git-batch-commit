/** Sanitized ring buffer for the "copy diagnostics" support bundle. */
export class Diagnostics {
  private readonly lines: string[] = [];

  constructor(private readonly max = 200) {}

  record(line: string): void {
    const stamp = new Date().toISOString();
    this.lines.push(`${stamp} ${line}`);
    if (this.lines.length > this.max) {
      this.lines.splice(0, this.lines.length - this.max);
    }
  }

  snapshot(): string[] {
    return [...this.lines];
  }
}