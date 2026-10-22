'use client';

import type { RemoteCodeProviderRpc, WatchEvent } from '@onlook/code-provider';

import { api } from '@/trpc/client';

/**
 * tRPC adapter that implements {@link RemoteCodeProviderRpc} for the browser.
 * Unary calls use mutations/queries; watch/process streams use SSE subscriptions.
 */
export function createTrpcRemoteCodeProviderRpc(): RemoteCodeProviderRpc {
    return {
        createSession: (input) => api.codeProvider.createSession.mutate(input),
        destroySession: async (input) => {
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
        subscribeWatch: (input, onEvent, onError) => {
            const sub = api.codeProvider.watchEvents.subscribe(input, {
                onData: (event) => onEvent(event as WatchEvent),
                onError: (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
            });
            return () => {
                void sub.unsubscribe();
            };
        },
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
        subscribeOutput: (input, onData, onError) => {
            const sub = api.codeProvider.processOutput.subscribe(input, {
                onData: (chunk) => onData(chunk),
                onError: (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
            });
            return () => {
                void sub.unsubscribe();
            };
        },
    };
}
