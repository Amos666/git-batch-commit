import * as path from 'node:path';
import * as vscode from 'vscode';
import type { CheckFile, EditorCheckPort } from '../services/checksService';

const FILE_CAP = 200;

/**
 * Editor-command based commit checks. Provider-dependent commands report
 * skipped when they fail; the active editor is switched per file with
 * preserveFocus so the Commit panel keeps keyboard focus.
 */
export class EditorActions implements EditorCheckPort {
  async reformat(files: CheckFile[]): Promise<'ok' | 'skipped'> {
    return this.runCommand(files, 'editor.action.formatDocument');
  }

  async optimizeImports(files: CheckFile[]): Promise<'ok' | 'skipped'> {
    return this.runCommand(files, 'editor.action.organizeImports');
  }

  async cleanup(files: CheckFile[]): Promise<'ok' | 'skipped'> {
    return this.runCommand(files, 'editor.action.sourceAction', { kind: 'source.fixAll', apply: 'first' });
  }

  async analyze(files: CheckFile[]): Promise<{ problems: number; detail: string }> {
    const locations: string[] = [];
    let problems = 0;
    for (const file of files.slice(0, FILE_CAP)) {
      const uri = vscode.Uri.file(path.join(file.rootPath, file.path));
      try {
        await vscode.workspace.openTextDocument(uri);
      } catch {
        continue;
      }
      const diags = vscode.languages.getDiagnostics(uri).filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning);
      problems += diags.length;
      for (const d of diags.slice(0, 3)) {
        if (locations.length < 3) {
          locations.push(`${file.path}:${d.range.start.line + 1} ${d.message}`);
        }
      }
    }
    return { problems, detail: locations.join('; ') };
  }

  private async runCommand(files: CheckFile[], command: string, args?: unknown): Promise<'ok' | 'skipped'> {
    let ran = false;
    for (const file of files.slice(0, FILE_CAP)) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(file.rootPath, file.path)));
        await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
        await vscode.commands.executeCommand(command, args);
        ran = true;
      } catch {
        // deleted/binary/unopenable file: skip
      }
    }
    return ran ? 'ok' : 'skipped';
  }
}