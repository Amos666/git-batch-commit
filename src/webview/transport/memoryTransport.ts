import type { EventMap, EventName, Method, RequestMap } from '../../protocol/messages';
import { defaultHandlers } from './fixtures';
import type { MemoryHandlers } from './fixtures';
import type { Transport } from './types';

export interface MemoryTransport extends Transport {
  emit<E extends EventName>(event: E, payload: EventMap[E]): void;
  readonly handlers: MemoryHandlers;
}

/** In-memory Transport for standalone development and component tests. */
export function createMemoryTransport(overrides: Partial<MemoryHandlers> = {}): MemoryTransport {
  let seq = 0;
  let disposed = false;
  const listeners = new Map<EventName, Set<(payload: never) => void>>();

  const emit = <E extends EventName>(event: E, payload: EventMap[E]): void => {
    if (disposed) {
      return;
    }
    seq += 1;
    const set = listeners.get(event);
    if (set) {
      for (const cb of set) {
        (cb as (payload: EventMap[E]) => void)(payload);
      }
    }
  };

  const handlers: MemoryHandlers = { ...defaultHandlers(emit), ...overrides };

  return {
    handlers,
    emit,
    request<M extends Method>(method: M, params: RequestMap[M]['params']): Promise<RequestMap[M]['result']> {
      return handlers[method](params);
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
      listeners.clear();
    },
  };
}