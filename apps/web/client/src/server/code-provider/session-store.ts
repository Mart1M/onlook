import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
    NodeFsProvider,
    type NodeFsProviderOptions,
} from '@onlook/code-provider/src/providers/nodefs';
import type {
    ProviderBackgroundCommand,
    ProviderFileWatcher,
    ProviderTask,
    ProviderTerminal,
    RemoteSessionEvent,
    WatchEvent,
} from '@onlook/code-provider';

export type ProcessKind = 'terminal' | 'task' | 'background';

interface ProcessHandle {
    kind: ProcessKind;
    terminal?: ProviderTerminal;
    task?: ProviderTask;
    background?: ProviderBackgroundCommand;
    /** Buffered output so late subscribers catch up. */
    buffer: string;
}

interface WatchHandle {
    watcher: ProviderFileWatcher;
}

export interface CodeProviderSession {
    id: string;
    userId: string;
    projectId: string;
    rootDir: string;
    provider: NodeFsProvider;
    createdAt: number;
    processes: Map<string, ProcessHandle>;
    watchers: Map<string, WatchHandle>;
    /** Single outlet for everything the session streams; see {@link RemoteSessionEvent}. */
    events: EventEmitter;
}

const sessions = new Map<string, CodeProviderSession>();

/**
 * Every session rootDir must resolve under this directory (realpath).
 *
 * Fails closed: rootDir is chosen by the client and a session can run commands, so without a
 * configured boundary any project member could open an arbitrary directory on the host.
 */
function workspaceRoot(): string {
    const raw = process.env.ONLOOK_WORKSPACE_ROOT;
    if (!raw) {
        throw new Error('ONLOOK_WORKSPACE_ROOT must be set to enable local NodeFs sessions.');
    }
    return path.resolve(raw);
}

export async function assertAllowedRootDir(rootDir: string): Promise<string> {
    const allowed = workspaceRoot();
    if (!path.isAbsolute(rootDir)) {
        throw new Error('rootDir must be an absolute path.');
    }
    const resolved = path.resolve(rootDir);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) {
        throw new Error(`rootDir is not a directory: ${resolved}`);
    }
    const real = await fs.realpath(resolved);
    const realAllowed = await fs.realpath(allowed).catch(() => allowed);
    const relative = path.relative(realAllowed, real);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('rootDir is outside ONLOOK_WORKSPACE_ROOT.');
    }
    return real;
}

export async function createCodeProviderSession(input: {
    userId: string;
    projectId: string;
    rootDir: string;
    tasks?: NodeFsProviderOptions['tasks'];
    env?: NodeFsProviderOptions['env'];
}): Promise<CodeProviderSession> {
    const rootDir = await assertAllowedRootDir(input.rootDir);
    const provider = new NodeFsProvider({
        rootDir,
        tasks: input.tasks,
        env: input.env,
    });
    await provider.initialize({});

    const session: CodeProviderSession = {
        id: randomUUID(),
        userId: input.userId,
        projectId: input.projectId,
        rootDir,
        provider,
        createdAt: Date.now(),
        processes: new Map(),
        watchers: new Map(),
        events: new EventEmitter(),
    };
    sessions.set(session.id, session);
    return session;
}

export function getCodeProviderSession(sessionId: string, userId: string): CodeProviderSession {
    const session = sessions.get(sessionId);
    if (!session || session.userId !== userId) {
        throw new Error('Unauthorized or not found');
    }
    return session;
}

export async function destroyCodeProviderSession(sessionId: string, userId: string): Promise<void> {
    const session = getCodeProviderSession(sessionId, userId);
    for (const watch of session.watchers.values()) {
        await watch.watcher.stop().catch(() => {});
    }
    session.watchers.clear();
    for (const handle of session.processes.values()) {
        await stopProcess(handle).catch(() => {});
    }
    session.processes.clear();
    session.events.removeAllListeners();
    await session.provider.destroy().catch(() => {});
    sessions.delete(sessionId);
}

async function stopProcess(handle: ProcessHandle): Promise<void> {
    if (handle.terminal) {
        await handle.terminal.kill();
    } else if (handle.task) {
        await handle.task.stop();
    } else if (handle.background) {
        await handle.background.kill();
    }
}

function emitSessionEvent(session: CodeProviderSession, event: RemoteSessionEvent): void {
    session.events.emit('event', event);
}

function attachOutput(
    session: CodeProviderSession,
    handleId: string,
    handle: ProcessHandle,
    onOutput: (cb: (data: string) => void) => () => void,
): void {
    onOutput((data) => {
        handle.buffer = (handle.buffer + data).slice(-100_000);
        emitSessionEvent(session, { kind: 'output', handleId, data });
    });
}

export async function createWatchHandle(
    session: CodeProviderSession,
    args: {
        path: string;
        recursive?: boolean;
        excludes?: string[];
    },
): Promise<string> {
    const watcherId = randomUUID();

    const { watcher } = await session.provider.watchFiles({
        args,
        onFileChange: async (event) => {
            emitSessionEvent(session, { kind: 'watch', watcherId, event });
        },
    });

    session.watchers.set(watcherId, { watcher });
    return watcherId;
}

export async function stopWatchHandle(
    session: CodeProviderSession,
    watcherId: string,
): Promise<void> {
    const handle = session.watchers.get(watcherId);
    if (!handle) {
        return;
    }
    await handle.watcher.stop().catch(() => {});
    session.watchers.delete(watcherId);
}

export async function createTerminalHandle(session: CodeProviderSession): Promise<{
    handleId: string;
    id: string;
    name: string;
}> {
    const { terminal } = await session.provider.createTerminal({});
    const handleId = randomUUID();
    const handle: ProcessHandle = {
        kind: 'terminal',
        terminal,
        buffer: '',
    };
    attachOutput(session, handleId, handle, (cb) => terminal.onOutput(cb));
    session.processes.set(handleId, handle);
    return { handleId, id: terminal.id, name: terminal.name };
}

export async function createTaskHandle(
    session: CodeProviderSession,
    taskId: string,
): Promise<{ handleId: string; id: string; name: string; command: string }> {
    const { task } = await session.provider.getTask({ args: { id: taskId } });
    const handleId = randomUUID();
    const handle: ProcessHandle = {
        kind: 'task',
        task,
        buffer: '',
    };
    attachOutput(session, handleId, handle, (cb) => task.onOutput(cb));
    session.processes.set(handleId, handle);
    return { handleId, id: task.id, name: task.name, command: task.command };
}

export async function createBackgroundHandle(
    session: CodeProviderSession,
    command: string,
): Promise<{ handleId: string; command: string }> {
    const { command: bg } = await session.provider.runBackgroundCommand({
        args: { command },
    });
    const handleId = randomUUID();
    const handle: ProcessHandle = {
        kind: 'background',
        background: bg,
        buffer: '',
    };
    attachOutput(session, handleId, handle, (cb) => bg.onOutput(cb));
    session.processes.set(handleId, handle);
    return { handleId, command: bg.command };
}

export function getProcessHandle(session: CodeProviderSession, handleId: string): ProcessHandle {
    const handle = session.processes.get(handleId);
    if (!handle) {
        throw new Error(`Process handle ${handleId} not found`);
    }
    return handle;
}

export async function destroyProcessHandle(
    session: CodeProviderSession,
    handleId: string,
): Promise<void> {
    const handle = session.processes.get(handleId);
    if (!handle) {
        return;
    }
    await stopProcess(handle).catch(() => {});
    session.processes.delete(handleId);
}

/**
 * Async iterator over EventEmitter events until `signal` aborts.
 * `initial` items are yielded first, queued once the listener is attached, so an item such as a
 * `ready` marker can promise that nothing emitted after it is missed.
 */
export async function* iterateEmitter<T>(
    emitter: EventEmitter,
    eventName: string,
    signal?: AbortSignal,
    initial: readonly T[] = [],
): AsyncGenerator<T> {
    const queue: T[] = [];
    let wake: (() => void) | null = null;
    let done = false;

    const onData = (data: T) => {
        queue.push(data);
        wake?.();
    };
    const onAbort = () => {
        done = true;
        wake?.();
    };

    emitter.on(eventName, onData);
    queue.push(...initial);
    signal?.addEventListener('abort', onAbort);

    try {
        while (!done && !signal?.aborted) {
            if (queue.length === 0) {
                await new Promise<void>((resolve) => {
                    wake = resolve;
                });
                wake = null;
                continue;
            }
            while (queue.length > 0) {
                yield queue.shift() as T;
            }
        }
    } finally {
        emitter.off(eventName, onData);
        signal?.removeEventListener('abort', onAbort);
    }
}

export type { WatchEvent };

/** Test helper — clears all in-memory sessions. */
export async function __resetCodeProviderSessionsForTests(): Promise<void> {
    const ids = [...sessions.keys()];
    for (const id of ids) {
        const session = sessions.get(id);
        if (!session) continue;
        await destroyCodeProviderSession(id, session.userId).catch(() => {
            sessions.delete(id);
        });
    }
}
