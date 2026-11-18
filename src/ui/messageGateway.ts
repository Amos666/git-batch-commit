import * as vscode from 'vscode';
import { asGitErrorLike } from '../adapter/gitApiTypes';
import { mapGitErrorCode } from '../protocol/errors';
import type { ProtocolError } from '../protocol/errors';
import { PROTOCOL_VERSION, isRequest } from '../protocol/messages';
import type { EventMap, EventName, HostMessage, Method, RequestMap, Response } from '../protocol/messages';

type Handler = (params: never) => Promise<unknown>;

export class MessageGateway implements vscode.Disposable {
  private seq = 0;
  private readonly handlers = new Map<string, Handler>();
  private disposed = false;

  constructor(
    private readonly post: (msg: HostMessage) => Thenable<boolean>,
    private readonly log: (line: string) => void = () => {},
  ) {}

  register<M extends Method>(
    method: M,
    handler: (params: RequestMap[M]['params']) => Promise<RequestMap[M]['result']>,
  ): void {
    this.handlers.set(method, handler as Handler);
  }

  emit<E extends EventName>(event: E, payload: EventMap[E]): void {
    if (this.disposed) {
      return;
    }
    void this.post({ v: PROTOCOL_VERSION, event, seq: ++this.seq, payload });
  }

  async handle(msg: unknown): Promise<void> {
    if (!isRequest(msg)) {
      if (
        typeof msg === 'object' && msg !== null &&
        typeof (msg as { id?: unknown }).id === 'string' &&
        typeof (msg as { method?: unknown }).method === 'string' &&
        typeof (msg as { v?: unknown }).v === 'number'
      ) {
        void this.post({
          v: PROTOCOL_VERSION,
          id: (msg as { id: string }).id,
          ok: false,
          error: {
            code: 'PROTOCOL_MISMATCH',
            message: `Webview protocol v${(msg as { v: number }).v} does not match host v${PROTOCOL_VERSION}. Reload the window.`,
            actions: [],
          },
        });
      }
      return;
    }
    const handler = this.handlers.get(msg.method);
    let response: Response;
    if (!handler) {
      response = {
        v: PROTOCOL_VERSION,
        id: msg.id,
        ok: false,
        error: { code: 'GENERIC', message: `Unknown method: ${msg.method}`, actions: [] },
      };
    } else {
      const started = Date.now();
      try {
        const result = await handler(msg.params as never);
        response = { v: PROTOCOL_VERSION, id: msg.id, ok: true, result };
        this.log(`${msg.method} ok ${Date.now() - started}ms`);
      } catch (err) {
        const error = toProtocolError(err);
        response = { v: PROTOCOL_VERSION, id: msg.id, ok: false, error };
        this.log(`${msg.method} failed ${Date.now() - started}ms code=${error.code} git=${error.gitErrorCode ?? '-'}`);
      }
    }
    if (!this.disposed) {
      void this.post(response);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.handlers.clear();
  }
}

function toProtocolError(err: unknown): ProtocolError {
  if (typeof err === 'object' && err !== null && 'code' in err && 'actions' in err) {
    return err as ProtocolError;
  }
  const gitErr = asGitErrorLike(err);
  return mapGitErrorCode(gitErr.gitErrorCode, gitErr.stderr ?? gitErr.message ?? String(err));
}