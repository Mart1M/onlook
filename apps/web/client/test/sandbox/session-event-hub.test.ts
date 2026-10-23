import { describe, expect, mock, test } from 'bun:test';

import type { WatchEvent } from '@onlook/code-provider';

import { SessionEventHub } from '../../src/components/store/editor/sandbox/session-event-hub';

const change = (path: string): WatchEvent => ({ type: 'change', paths: [path] });

describe('SessionEventHub', () => {
    test('routes output only to the process it belongs to', () => {
        const hub = new SessionEventHub();
        const a = mock((_: string) => {});
        const b = mock((_: string) => {});
        hub.onOutput('a', a);
        hub.onOutput('b', b);

        hub.dispatch({ kind: 'output', handleId: 'a', data: 'hello' });

        expect(a).toHaveBeenCalledWith('hello');
        expect(b).not.toHaveBeenCalled();
    });

    test('routes watch events only to the watcher they belong to', () => {
        const hub = new SessionEventHub();
        const w1 = mock((_: WatchEvent) => {});
        const w2 = mock((_: WatchEvent) => {});
        hub.onWatch('w1', w1);
        hub.onWatch('w2', w2);

        hub.dispatch({ kind: 'watch', watcherId: 'w2', event: change('src/App.jsx') });

        expect(w2).toHaveBeenCalledWith(change('src/App.jsx'));
        expect(w1).not.toHaveBeenCalled();
    });

    test('several listeners can follow the same process', () => {
        const hub = new SessionEventHub();
        const first = mock((_: string) => {});
        const second = mock((_: string) => {});
        hub.onOutput('dev', first);
        hub.onOutput('dev', second);

        hub.dispatch({ kind: 'output', handleId: 'dev', data: 'ready' });

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    test('unsubscribing stops delivery without affecting other listeners', () => {
        const hub = new SessionEventHub();
        const kept = mock((_: string) => {});
        const dropped = mock((_: string) => {});
        hub.onOutput('dev', kept);
        const off = hub.onOutput('dev', dropped);

        off();
        hub.dispatch({ kind: 'output', handleId: 'dev', data: 'x' });

        expect(dropped).not.toHaveBeenCalled();
        expect(kept).toHaveBeenCalledTimes(1);
    });

    test('events for an unknown handle are ignored', () => {
        const hub = new SessionEventHub();

        expect(() => hub.dispatch({ kind: 'output', handleId: 'nobody', data: 'x' })).not.toThrow();
        expect(() => hub.dispatch({ kind: 'ready' })).not.toThrow();
    });

    test('a throwing listener does not stop the others', () => {
        const hub = new SessionEventHub();
        const after = mock((_: string) => {});
        const errors = mock(() => {});
        const original = console.error;
        console.error = errors;
        try {
            hub.onOutput('dev', () => {
                throw new Error('boom');
            });
            hub.onOutput('dev', after);

            hub.dispatch({ kind: 'output', handleId: 'dev', data: 'x' });

            expect(after).toHaveBeenCalledTimes(1);
            expect(errors).toHaveBeenCalledTimes(1);
        } finally {
            console.error = original;
        }
    });

    test('a listener may unsubscribe itself while being notified', () => {
        const hub = new SessionEventHub();
        const other = mock((_: string) => {});
        const off = hub.onOutput('dev', () => off());
        hub.onOutput('dev', other);

        hub.dispatch({ kind: 'output', handleId: 'dev', data: '1' });
        hub.dispatch({ kind: 'output', handleId: 'dev', data: '2' });

        expect(other).toHaveBeenCalledTimes(2);
    });

    test('fail notifies error listeners, and clear drops everything', () => {
        const hub = new SessionEventHub();
        const onError = mock((_: Error) => {});
        const output = mock((_: string) => {});
        hub.onError(onError);
        hub.onOutput('dev', output);

        const error = new Error('stream closed');
        hub.fail(error);
        expect(onError).toHaveBeenCalledWith(error);

        hub.clear();
        hub.dispatch({ kind: 'output', handleId: 'dev', data: 'x' });
        hub.fail(error);
        expect(output).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
    });
});
