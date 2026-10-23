import { describe, expect, test } from 'bun:test';

import type { WatchEvent } from '../src/types';
import { RemoteProvider, type RemoteCodeProviderRpc } from '../src/providers/remote';

function createMockRpc(overrides: Partial<RemoteCodeProviderRpc> = {}): RemoteCodeProviderRpc {
    const files = new Map<string, string>();
    return {
        createSession: async () => ({
            sessionId: '11111111-1111-4111-8111-111111111111',
            rootDir: '/tmp/project',
            projectId: '22222222-2222-4222-8222-222222222222',
        }),
        destroySession: async () => {},
        writeFile: async ({ path, content }) => {
            files.set(path, typeof content === 'string' ? content : 'bin');
            return { success: true };
        },
        readFile: async ({ path }) => {
            const content = files.get(path) ?? '';
            return { file: { path, content, type: 'text' as const } };
        },
        renameFile: async () => ({}),
        statFile: async () => ({ type: 'file' as const }),
        deleteFiles: async () => ({}),
        listFiles: async () => ({ files: [] }),
        copyFiles: async () => ({}),
        createDirectory: async () => ({}),
        downloadFiles: async () => ({}),
        runCommand: async () => ({ output: 'ok' }),
        gitStatus: async () => ({ changedFiles: [] }),
        ping: async () => ({ ok: true }),
        startWatch: async () => ({ watcherId: '33333333-3333-4333-8333-333333333333' }),
        stopWatch: async () => {},
        subscribeWatch: (_input, onEvent) => {
            void onEvent({ type: 'add', paths: ['a.ts'] } satisfies WatchEvent);
            return () => {};
        },
        createTerminal: async () => ({
            handleId: '44444444-4444-4444-8444-444444444444',
            id: 'term-1',
            name: 'terminal',
        }),
        getTask: async () => ({
            handleId: '55555555-5555-4555-8555-555555555555',
            id: 'dev',
            name: 'dev',
            command: 'echo hi',
        }),
        runBackgroundCommand: async () => ({
            handleId: '66666666-6666-4666-8666-666666666666',
            command: 'sleep 1',
        }),
        processOpen: async () => ({ output: 'buffered' }),
        processWrite: async () => {},
        processRun: async () => {},
        processRestart: async () => {},
        processStop: async () => {},
        subscribeOutput: (_input, onData) => {
            onData('chunk');
            return () => {};
        },
        ...overrides,
    };
}

describe('RemoteProvider', () => {
    test('initialize opens a server session and proxies file ops', async () => {
        const rpc = createMockRpc();
        const provider = new RemoteProvider({
            projectId: '22222222-2222-4222-8222-222222222222',
            rootDir: '/tmp/project',
            rpc,
        });
        await provider.initialize({});
        await provider.writeFile({ args: { path: 'a.txt', content: 'hello' } });
        const { file } = await provider.readFile({ args: { path: 'a.txt' } });
        expect(file.content).toBe('hello');
        expect(file.toString()).toBe('hello');
        expect(await provider.ping()).toBe(true);
        await provider.destroy();
    });

    test('requires initialize before use', async () => {
        const provider = new RemoteProvider({
            projectId: '22222222-2222-4222-8222-222222222222',
            rootDir: '/tmp/project',
            rpc: createMockRpc(),
        });
        await expect(provider.readFile({ args: { path: 'a' } })).rejects.toThrow(
            /not initialized/,
        );
    });

    test('watchFiles wires subscription callbacks', async () => {
        const events: WatchEvent[] = [];
        const provider = new RemoteProvider({
            projectId: '22222222-2222-4222-8222-222222222222',
            rootDir: '/tmp/project',
            rpc: createMockRpc(),
        });
        await provider.initialize({});
        const { watcher } = await provider.watchFiles({
            args: { path: './', recursive: true },
            onFileChange: async (event) => {
                events.push(event);
            },
        });
        expect(events).toEqual([{ type: 'add', paths: ['a.ts'] }]);
        await watcher.stop();
        await provider.destroy();
    });
});
