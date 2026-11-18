import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/protocol/messages';
import type { ProtocolError } from '../../src/protocol/errors';
import { createVscodeTransport } from '../../src/webview/transport/vscodeTransport';
import { createMemoryTransport } from '../../src/webview/transport/memoryTransport';

type MessageListener = (event: { data: unknown }) => void;

let posted: unknown[] = [];
let listener: MessageListener | undefined;

beforeEach(() => {
  posted = [];
  listener = undefined;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: (msg: unknown) => posted.push(msg),
    getState: () => undefined,
    setState: () => {},
  });
  (globalThis as Record<string, unknown>).window = {
    addEventListener: (_type: string, cb: MessageListener) => {
      listener = cb;
    },
    removeEventListener: () => {
      listener = undefined;
    },
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).acquireVsCodeApi;
  delete (globalThis as Record<string, unknown>).window;
});

function deliver(data: unknown): void {
  listener?.({ data });
}

describe('vscodeTransport', () => {
  it('sends versioned request envelopes and routes responses by id', async () => {
    const transport = createVscodeTransport();
    const pending = transport.request('status.get', {});
    expect(posted).toHaveLength(1);
    const envelope = posted[0] as { v: number; id: string; method: string };
    expect(envelope.v).toBe(PROTOCOL_VERSION);
    expect(envelope.method).toBe('status.get');
    deliver({ v: PROTOCOL_VERSION, id: envelope.id, ok: true, result: [] });
    await expect(pending).resolves.toEqual([]);
    transport.dispose();
  });

  it('rejects with the protocol error on failure responses', async () => {
    const transport = createVscodeTransport();
    const pending = transport.request('status.get', {});
    const envelope = posted[0] as { id: string };
    const error: ProtocolError = { code: 'GENERIC', message: 'boom', actions: [] };
    deliver({ v: PROTOCOL_VERSION, id: envelope.id, ok: false, error });
    await expect(pending).rejects.toEqual(error);
    transport.dispose();
  });

  it('drops events with stale or missing seq (retainContextWhenHidden replay guard)', () => {
    const transport = createVscodeTransport();
    const seen: number[] = [];
    transport.onEvent('status.changed', (payload) => seen.push((payload as unknown as { seq: number }).seq));
    deliver({ v: PROTOCOL_VERSION, event: 'status.changed', seq: 5, payload: { seq: 5 } });
    deliver({ v: PROTOCOL_VERSION, event: 'status.changed', seq: 3, payload: { seq: 3 } });
    deliver({ v: PROTOCOL_VERSION, event: 'status.changed', seq: 5, payload: { seq: 5 } });
    deliver({ v: PROTOCOL_VERSION, event: 'status.changed', payload: { seq: 99 } });
    deliver({ v: PROTOCOL_VERSION, event: 'status.changed', seq: 6, payload: { seq: 6 } });
    expect(seen).toEqual([5, 6]);
    transport.dispose();
  });

  it('ignores version-mismatched messages and unregisters on dispose', async () => {
    const transport = createVscodeTransport();
    const seen: unknown[] = [];
    transport.onEvent('status.changed', (p) => seen.push(p));
    deliver({ v: PROTOCOL_VERSION - 1, event: 'status.changed', seq: 100, payload: {} });
    expect(seen).toHaveLength(0);
    transport.dispose();
    expect(listener).toBeUndefined();
    await expect(transport.request('status.get', {})).rejects.toMatchObject({ message: 'Transport disposed' });
  });

  it('unsubscribes event listeners individually', () => {
    const transport = createVscodeTransport();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const offA = transport.onEvent('status.changed', (p) => a.push(p));
    transport.onEvent('status.changed', (p) => b.push(p));
    offA();
    deliver({ v: PROTOCOL_VERSION, event: 'status.changed', seq: 1, payload: { x: 1 } });
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
    transport.dispose();
  });
});

describe('memoryTransport', () => {
  it('serves default fixture handlers and honors overrides', async () => {
    const transport = createMemoryTransport({
      'history.list': async () => ['custom'],
    });
    const init = await transport.request('panel.init', undefined);
    expect(init.panelState).toBe('ready');
    expect(init.repos.length).toBeGreaterThan(0);
    expect(init.capabilities.stagedDiff).toBe(true);
    await expect(transport.request('history.list', undefined)).resolves.toEqual(['custom']);
    transport.dispose();
  });

  it('emit delivers to subscribers and stops after dispose/unsubscribe', () => {
    const transport = createMemoryTransport();
    const seen: unknown[] = [];
    const off = transport.onEvent('status.changed', (p) => seen.push(p));
    const init = { seq: 1 };
    transport.emit('status.changed', init as never);
    off();
    transport.emit('status.changed', init as never);
    expect(seen).toHaveLength(1);
    transport.dispose();
    transport.emit('status.changed', init as never);
    expect(seen).toHaveLength(1);
  });
});