import type { EventMap, EventName, Method, RequestMap } from '../../protocol/messages';

/**
 * The only seam the webview state layer talks to. Types come exclusively
 * from src/protocol/* so the whole UI stack stays vscode-free and can run
 * against the VS Code host, an in-memory mock, or a future remote kernel.
 */
export interface Transport {
  request<M extends Method>(method: M, params: RequestMap[M]['params']): Promise<RequestMap[M]['result']>;
  onEvent<E extends EventName>(event: E, cb: (payload: EventMap[E]) => void): () => void;
  dispose(): void;
}