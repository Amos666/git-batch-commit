import { PROTOCOL_VERSION, isHostEvent, isResponse } from '../../protocol/messages';
import type { EventMap, EventName, Method, RequestMap } from '../../protocol/messages';
import type { ProtocolError } from '../../protocol/errors';
import type { Transport } from './types';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export function createVscodeTransport(): Transport {
  const vscode = acquireVsCodeApi();
  let nextId = 0;
  let lastSeq = 0;
  let disposed = false;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: ProtocolError) => void }>();
  const listeners = new Map<EventName, Set<(payload: never) => void>>();

  const onMessage = (event: MessageEvent): void => {
    const msg = event.data;
    if (isResponse(msg)) {
      const entry = pending.get(msg.id);
      if (!entry) {
        return;
      }
      pending.delete(msg.id);
      if (msg.ok) {
        entry.resolve(msg.result);
      } else {
        entry.reject(msg.error);
      }
      return;
    }
    if (isHostEvent(msg)) {
      // seq guard: drop replayed/out-of-order events (retainContextWhenHidden re-delivery)
      if (typeof msg.seq !== 'number' || msg.seq <= lastSeq) {
        return;
      }
      lastSeq = msg.seq;
      const set = listeners.get(msg.event);
      if (set) {
        for (const cb of set) {
          (cb as (payload: unknown) => void)(msg.payload);
        }
      }
    }
  };
  window.addEventListener('message', onMessage);

  return {
    /** No unified timeout by design: every request must settle via a host response. */
    request<M extends Method>(method: M, params: RequestMap[M]['params']): Promise<RequestMap[M]['result']> {
      const id = `req-${++nextId}`;
      return new Promise((resolve, reject) => {
        if (disposed) {
          reject({ code: 'GENERIC', message: 'Transport disposed', actions: [] } satisfies ProtocolError);
          return;
        }
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        vscode.postMessage({ v: PROTOCOL_VERSION, id, method, params });
      });
    },
    onEvent<E extends EventName>(event: E, cb: (payload: EventMap[E]) => void): () => void {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb as (payload: never) => void);
      return () => {
        set.delete(cb as (payload: never) => void);
      };
    },
    dispose(): void {
      disposed = true;
      window.removeEventListener('message', onMessage);
      pending.clear();
      listeners.clear();
    },
  };
}