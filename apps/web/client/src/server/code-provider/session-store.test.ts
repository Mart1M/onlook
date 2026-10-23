import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RemoteSessionEvent } from '@onlook/code-provider';

import {
    __resetCodeProviderSessionsForTests,
    assertAllowedRootDir,
    createCodeProviderSession,
    createTaskHandle,
    createWatchHandle,
    destroyCodeProviderSession,
    getCodeProviderSession,
    iterateEmitter,
} from './session-store';

let tmp: string;

beforeEach(() => {
    // Sessions are refused without a workspace boundary, so every test works inside one.
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nodefs-ws-')));
    process.env.ONLOOK_WORKSPACE_ROOT = tmp;
});

afterEach(async () => {
    await __resetCodeProviderSessionsForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.ONLOOK_WORKSPACE_ROOT;
});

describe('assertAllowedRootDir', () => {
    test('rejects relative paths', async () => {
        await expect(assertAllowedRootDir('relative/path')).rejects.toThrow(/absolute/);
    });

    test('rejects missing directories', async () => {
        await expect(assertAllowedRootDir(path.join(tmp, 'does-not-exist'))).rejects.toThrow(
            /not a directory/,
        );
    });

    test('refuses every rootDir while ONLOOK_WORKSPACE_ROOT is unset', async () => {
        delete process.env.ONLOOK_WORKSPACE_ROOT;
        const dir = path.join(tmp, 'project');
        fs.mkdirSync(dir);

        await expect(assertAllowedRootDir(dir)).rejects.toThrow(/ONLOOK_WORKSPACE_ROOT must be set/);
        await expect(assertAllowedRootDir('/')).rejects.toThrow(/ONLOOK_WORKSPACE_ROOT must be set/);
        await expect(
            createCodeProviderSession({ userId: 'user-a', projectId: 'p', rootDir: dir }),
        ).rejects.toThrow(/ONLOOK_WORKSPACE_ROOT must be set/);
    });

    test('enforces ONLOOK_WORKSPACE_ROOT', async () => {
        const allowed = path.join(tmp, 'allowed');
        const outside = path.join(tmp, 'outside');
        fs.mkdirSync(allowed);
        fs.mkdirSync(outside);
        process.env.ONLOOK_WORKSPACE_ROOT = allowed;

        await expect(assertAllowedRootDir(outside)).rejects.toThrow(/outside ONLOOK_WORKSPACE_ROOT/);
        await expect(assertAllowedRootDir(allowed)).resolves.toBe(fs.realpathSync(allowed));
    });

    test('rejects the filesystem root and a parent of the workspace', async () => {
        const allowed = path.join(tmp, 'allowed');
        fs.mkdirSync(allowed);
        process.env.ONLOOK_WORKSPACE_ROOT = allowed;

        await expect(assertAllowedRootDir('/')).rejects.toThrow(/outside ONLOOK_WORKSPACE_ROOT/);
        await expect(assertAllowedRootDir(tmp)).rejects.toThrow(/outside ONLOOK_WORKSPACE_ROOT/);
    });

    test('rejects a symlink inside the workspace that points outside it', async () => {
        const allowed = path.join(tmp, 'allowed');
        const outside = path.join(tmp, 'outside');
        fs.mkdirSync(allowed);
        fs.mkdirSync(outside);
        fs.symlinkSync(outside, path.join(allowed, 'link'));
        process.env.ONLOOK_WORKSPACE_ROOT = allowed;

        await expect(assertAllowedRootDir(path.join(allowed, 'link'))).rejects.toThrow(
            /outside ONLOOK_WORKSPACE_ROOT/,
        );
    });

    test('accepts a directory whose name merely starts with two dots', async () => {
        const dotted = path.join(tmp, '..dotted');
        fs.mkdirSync(dotted);

        await expect(assertAllowedRootDir(dotted)).resolves.toBe(fs.realpathSync(dotted));
    });
});

describe('code provider sessions', () => {
    test('creates a session scoped to the user and rejects other users', async () => {
        const root = path.join(tmp, 'project');
        fs.mkdirSync(root);

        const session = await createCodeProviderSession({
            userId: 'user-a',
            projectId: '11111111-1111-1111-1111-111111111111',
            rootDir: root,
        });

        expect(getCodeProviderSession(session.id, 'user-a').id).toBe(session.id);
        expect(() => getCodeProviderSession(session.id, 'user-b')).toThrow(
            /Unauthorized or not found/,
        );

        await destroyCodeProviderSession(session.id, 'user-a');
        expect(() => getCodeProviderSession(session.id, 'user-a')).toThrow(
            /Unauthorized or not found/,
        );
    });

    test('provider read/write stays inside the session root', async () => {
        const root = path.join(tmp, 'project');
        fs.mkdirSync(root);

        const session = await createCodeProviderSession({
            userId: 'user-a',
            projectId: '11111111-1111-1111-1111-111111111111',
            rootDir: root,
        });

        await session.provider.writeFile({ args: { path: 'hello.txt', content: 'hi' } });
        const { file } = await session.provider.readFile({ args: { path: 'hello.txt' } });
        expect(file.content).toBe('hi');
        await expect(
            session.provider.readFile({ args: { path: '../secret.txt' } }),
        ).rejects.toThrow(/escapes/);
    });
});

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

describe('session event stream', () => {
    const projectId = '11111111-1111-1111-1111-111111111111';

    test('process output is emitted on the session stream, tagged with its handle', async () => {
        const root = path.join(tmp, 'project');
        fs.mkdirSync(root);
        const session = await createCodeProviderSession({
            userId: 'user-a',
            projectId,
            rootDir: root,
            tasks: { say: 'echo hello-from-task' },
        });
        const events: RemoteSessionEvent[] = [];
        session.events.on('event', (event: RemoteSessionEvent) => events.push(event));

        const { handleId } = await createTaskHandle(session, 'say');
        await session.processes.get(handleId)?.task?.run();

        await waitFor(() =>
            events.some(
                (e) => e.kind === 'output' && e.handleId === handleId && e.data.includes('hello-from-task'),
            ),
        );
    });

    test('watch events are emitted on the session stream, tagged with their watcher', async () => {
        const root = path.join(tmp, 'project');
        fs.mkdirSync(root);
        const session = await createCodeProviderSession({ userId: 'user-a', projectId, rootDir: root });
        const events: RemoteSessionEvent[] = [];
        session.events.on('event', (event: RemoteSessionEvent) => events.push(event));

        const watcherId = await createWatchHandle(session, { path: '.', recursive: true });
        // Native watchers (FSEvents) need a moment to start before they see changes.
        await new Promise((resolve) => setTimeout(resolve, 200));
        fs.writeFileSync(path.join(root, 'App.jsx'), 'x');

        await waitFor(() =>
            events.some(
                (e) => e.kind === 'watch' && e.watcherId === watcherId && e.event.paths[0] === 'App.jsx',
            ),
        );
    });

    test('a session does not see the events of another session', async () => {
        const rootA = path.join(tmp, 'a');
        const rootB = path.join(tmp, 'b');
        fs.mkdirSync(rootA);
        fs.mkdirSync(rootB);
        const a = await createCodeProviderSession({
            userId: 'user-a',
            projectId,
            rootDir: rootA,
            tasks: { say: 'echo only-for-a' },
        });
        const b = await createCodeProviderSession({ userId: 'user-b', projectId, rootDir: rootB });
        const seenByB: RemoteSessionEvent[] = [];
        b.events.on('event', (event: RemoteSessionEvent) => seenByB.push(event));
        const seenByA: RemoteSessionEvent[] = [];
        a.events.on('event', (event: RemoteSessionEvent) => seenByA.push(event));

        const { handleId } = await createTaskHandle(a, 'say');
        await a.processes.get(handleId)?.task?.run();
        await waitFor(() => seenByA.length > 0);

        expect(seenByB).toEqual([]);
    });

    test('many processes and watchers share the one emitter', async () => {
        const root = path.join(tmp, 'project');
        fs.mkdirSync(root);
        const session = await createCodeProviderSession({
            userId: 'user-a',
            projectId,
            rootDir: root,
            tasks: { one: 'echo 1', two: 'echo 2' },
        });

        await createTaskHandle(session, 'one');
        await createTaskHandle(session, 'two');
        await createWatchHandle(session, { path: '.', recursive: true });

        expect(session.processes.size).toBe(2);
        expect(session.watchers.size).toBe(1);
        // A stream per process or watcher would be a connection each; listeners stay at what the
        // router attaches (one per subscribed client), not one per handle.
        expect(session.events.listenerCount('event')).toBe(0);
    });
});

describe('iterateEmitter', () => {
    test('yields the initial items first, then live events', async () => {
        const emitter = new EventEmitter();
        const controller = new AbortController();
        const received: string[] = [];

        const consumer = (async () => {
            for await (const item of iterateEmitter<string>(emitter, 'e', controller.signal, ['ready'])) {
                received.push(item);
                if (received.length === 3) {
                    controller.abort();
                }
            }
        })();

        await waitFor(() => received.length === 1);
        emitter.emit('e', 'one');
        emitter.emit('e', 'two');
        await consumer;

        expect(received).toEqual(['ready', 'one', 'two']);
    });

    test('detaches its listener when the signal aborts', async () => {
        const emitter = new EventEmitter();
        const controller = new AbortController();

        const consumer = (async () => {
            for await (const _item of iterateEmitter<string>(emitter, 'e', controller.signal)) {
                // nothing
            }
        })();

        await waitFor(() => emitter.listenerCount('e') === 1);
        controller.abort();
        await consumer;

        expect(emitter.listenerCount('e')).toBe(0);
    });
});
