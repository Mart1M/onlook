'use client';

import type { RemoteCodeProviderRpc } from '@onlook/code-provider';

import { api } from '@/trpc/client';
import { SessionEventHub } from './session-event-hub';

/** How long to wait for the server to start listening before giving up on a session. */
const STREAM_READY_TIMEOUT_MS = 15_000;

interface SessionStream {
    hub: SessionEventHub;
    close: () => void;
}

// One stream per session. Browsers allow six HTTP/1.1 connections per host, so a stream per
// watcher or process left every other request waiting behind them.
const streams = new Map<string, SessionStream>();

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function closeSessionStream(sessionId: string): void {
    const stream = streams.get(sessionId);
    if (!stream) {
        return;
    }
    streams.delete(sessionId);
    stream.close();
    stream.hub.clear();
}

/** Opens the session's event stream and resolves once the server is listening. */
function openSessionStream(sessionId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const hub = new SessionEventHub();
        let ready = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;

        const subscription = api.codeProvider.sessionEvents.subscribe(
            { sessionId },
            {
                onData: (event) => {
                    if (event.kind === 'ready') {
                        ready = true;
                        clearTimeout(timeout);
                        resolve();
                        return;
                    }
                    hub.dispatch(event);
                },
                onError: (error) => {
                    const failure = toError(error);
                    if (!ready) {
                        clearTimeout(timeout);
                        closeSessionStream(sessionId);
                        reject(failure);
                        return;
                    }
                    hub.fail(failure);
                },
            },
        );
        streams.set(sessionId, { hub, close: () => subscription.unsubscribe() });

        timeout = setTimeout(() => {
            if (!ready) {
                closeSessionStream(sessionId);
                reject(new Error('Timed out waiting for the session event stream.'));
            }
        }, STREAM_READY_TIMEOUT_MS);
    });
}

/** Registers a listener on the session's shared stream; the returned function removes it. */
function listen(
    sessionId: string,
    onError: ((error: Error) => void) | undefined,
    register: (hub: SessionEventHub) => () => void,
): () => void {
    const stream = streams.get(sessionId);
    if (!stream) {
        onError?.(new Error(`No event stream for session ${sessionId}`));
        return () => {};
    }
    const offError = onError ? stream.hub.onError(onError) : () => {};
    const off = register(stream.hub);
    return () => {
        off();
        offError();
    };
}

/**
 * tRPC adapter that implements {@link RemoteCodeProviderRpc} for the browser.
 * Unary calls use mutations/queries; watch and process output share one SSE stream per session.
 */
export function createTrpcRemoteCodeProviderRpc(): RemoteCodeProviderRpc {
    return {
        createSession: async (input) => {
            const session = await api.codeProvider.createSession.mutate(input);
            try {
                await openSessionStream(session.sessionId);
            } catch (error) {
                await api.codeProvider.destroySession
                    .mutate({ sessionId: session.sessionId })
                    .catch(() => {});
                throw error;
            }
            return session;
        },
        destroySession: async (input) => {
            closeSessionStream(input.sessionId);
            await api.codeProvider.destroySession.mutate(input);
        },
        writeFile: (input) =>
            api.codeProvider.writeFile.mutate({
                ...input,
                // Normalize to a concrete ArrayBuffer-backed view for SuperJSON/tRPC.
                content:
                    typeof input.content === 'string'
                        ? input.content
                        : new Uint8Array(input.content),
            }),
        readFile: async (input) => {
            const result = await api.codeProvider.readFile.query(input);
            return {
                file: {
                    path: result.file.path,
                    type: result.file.type,
                    content:
                        result.file.type === 'binary'
                            ? result.file.content instanceof Uint8Array
                                ? result.file.content
                                : new Uint8Array()
                            : typeof result.file.content === 'string'
                              ? result.file.content
                              : '',
                },
            };
        },
        renameFile: (input) => api.codeProvider.renameFile.mutate(input),
        statFile: (input) => api.codeProvider.statFile.query(input),
        deleteFiles: (input) => api.codeProvider.deleteFiles.mutate(input),
        listFiles: (input) => api.codeProvider.listFiles.query(input),
        copyFiles: (input) => api.codeProvider.copyFiles.mutate(input),
        createDirectory: (input) => api.codeProvider.createDirectory.mutate(input),
        downloadFiles: (input) => api.codeProvider.downloadFiles.mutate(input),
        runCommand: (input) => api.codeProvider.runCommand.mutate(input),
        gitStatus: (input) => api.codeProvider.gitStatus.query(input),
        ping: (input) => api.codeProvider.ping.query(input),
        startWatch: (input) => api.codeProvider.startWatch.mutate(input),
        stopWatch: async (input) => {
            await api.codeProvider.stopWatch.mutate(input);
        },
        subscribeWatch: (input, onEvent, onError) =>
            listen(input.sessionId, onError, (hub) => hub.onWatch(input.watcherId, onEvent)),
        createTerminal: (input) => api.codeProvider.createTerminal.mutate(input),
        getTask: (input) => api.codeProvider.getTask.mutate(input),
        runBackgroundCommand: (input) => api.codeProvider.runBackgroundCommand.mutate(input),
        processOpen: (input) => api.codeProvider.processOpen.mutate(input),
        processWrite: async (input) => {
            await api.codeProvider.processWrite.mutate(input);
        },
        processRun: async (input) => {
            await api.codeProvider.processRun.mutate(input);
        },
        processRestart: async (input) => {
            await api.codeProvider.processRestart.mutate(input);
        },
        processStop: async (input) => {
            await api.codeProvider.processStop.mutate(input);
        },
        subscribeOutput: (input, onData, onError) =>
            listen(input.sessionId, onError, (hub) => hub.onOutput(input.handleId, onData)),
    };
}
