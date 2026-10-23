import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { RemoteSessionEvent } from '@onlook/code-provider';

import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { verifyProjectAccess } from '../project/helper';
import {
    createBackgroundHandle,
    createCodeProviderSession,
    createTaskHandle,
    createTerminalHandle,
    createWatchHandle,
    destroyCodeProviderSession,
    destroyProcessHandle,
    getCodeProviderSession,
    getProcessHandle,
    iterateEmitter,
    stopWatchHandle,
} from '../../../code-provider/session-store';

const sessionIdInput = z.object({
    sessionId: z.string().uuid(),
});

function asTrpcError(error: unknown): never {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'Unauthorized or not found') {
        throw new TRPCError({ code: 'NOT_FOUND', message });
    }
    throw new TRPCError({ code: 'BAD_REQUEST', message });
}

async function requireSession(sessionId: string, userId: string) {
    try {
        return getCodeProviderSession(sessionId, userId);
    } catch (error) {
        asTrpcError(error);
    }
}

const fileContentSchema = z.union([z.string(), z.instanceof(Uint8Array)]);

/**
 * Browser ↔ server bridge for {@link NodeFsProvider}.
 *
 * Every procedure authenticates the caller and scopes work to a session created
 * under a project the user belongs to. Paths never leave the session rootDir
 * (enforced by NodeFsProvider).
 */
export const codeProviderRouter = createTRPCRouter({
    createSession: protectedProcedure
        .input(
            z.object({
                projectId: z.string().uuid(),
                rootDir: z.string().min(1),
                tasks: z.record(z.string(), z.string()).optional(),
                env: z.record(z.string(), z.string()).optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            try {
                await verifyProjectAccess(ctx.db, ctx.user.id, input.projectId);
                const session = await createCodeProviderSession({
                    userId: ctx.user.id,
                    projectId: input.projectId,
                    rootDir: input.rootDir,
                    tasks: input.tasks,
                    env: input.env,
                });
                return {
                    sessionId: session.id,
                    rootDir: session.rootDir,
                    projectId: session.projectId,
                };
            } catch (error) {
                asTrpcError(error);
            }
        }),

    destroySession: protectedProcedure.input(sessionIdInput).mutation(async ({ input, ctx }) => {
        try {
            await destroyCodeProviderSession(input.sessionId, ctx.user.id);
            return { ok: true as const };
        } catch (error) {
            asTrpcError(error);
        }
    }),

    // —— File system ————————————————————————————————————————————————————————

    writeFile: protectedProcedure
        .input(
            sessionIdInput.extend({
                path: z.string(),
                content: fileContentSchema,
                overwrite: z.boolean().optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            return session.provider.writeFile({
                args: { path: input.path, content: input.content, overwrite: input.overwrite },
            });
        }),

    readFile: protectedProcedure
        .input(sessionIdInput.extend({ path: z.string() }))
        .query(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            const { file } = await session.provider.readFile({ args: { path: input.path } });
            // Drop `toString` — functions are not serializable; the client rebuilds it.
            return {
                file: {
                    path: file.path,
                    content: file.content,
                    type: file.type,
                },
            };
        }),

    renameFile: protectedProcedure
        .input(sessionIdInput.extend({ oldPath: z.string(), newPath: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            return session.provider.renameFile({
                args: { oldPath: input.oldPath, newPath: input.newPath },
            });
        }),

    statFile: protectedProcedure
        .input(sessionIdInput.extend({ path: z.string() }))
        .query(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            return session.provider.statFile({ args: { path: input.path } });
        }),

    deleteFiles: protectedProcedure
        .input(
            sessionIdInput.extend({
                path: z.string(),
                recursive: z.boolean().optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            try {
                return await session.provider.deleteFiles({
                    args: { path: input.path, recursive: input.recursive },
                });
            } catch (error) {
                asTrpcError(error);
            }
        }),

    listFiles: protectedProcedure
        .input(sessionIdInput.extend({ path: z.string() }))
        .query(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            return session.provider.listFiles({ args: { path: input.path } });
        }),

    copyFiles: protectedProcedure
        .input(
            sessionIdInput.extend({
                sourcePath: z.string(),
                targetPath: z.string(),
                recursive: z.boolean().optional(),
                overwrite: z.boolean().optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            return session.provider.copyFiles({
                args: {
                    sourcePath: input.sourcePath,
                    targetPath: input.targetPath,
                    recursive: input.recursive,
                    overwrite: input.overwrite,
                },
            });
        }),

    createDirectory: protectedProcedure
        .input(sessionIdInput.extend({ path: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            return session.provider.createDirectory({ args: { path: input.path } });
        }),

    downloadFiles: protectedProcedure
        .input(sessionIdInput.extend({ path: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            return session.provider.downloadFiles({ args: { path: input.path } });
        }),

    // —— Commands / git ——————————————————————————————————————————————————————

    runCommand: protectedProcedure
        .input(sessionIdInput.extend({ command: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            try {
                return await session.provider.runCommand({ args: { command: input.command } });
            } catch (error) {
                asTrpcError(error);
            }
        }),

    gitStatus: protectedProcedure.input(sessionIdInput).query(async ({ input, ctx }) => {
        const session = await requireSession(input.sessionId, ctx.user.id);
        return session.provider.gitStatus({});
    }),

    ping: protectedProcedure.input(sessionIdInput).query(async ({ input, ctx }) => {
        const session = await requireSession(input.sessionId, ctx.user.id);
        return { ok: await session.provider.ping() };
    }),

    // —— Watch ———————————————————————————————————————————————————————————————

    startWatch: protectedProcedure
        .input(
            sessionIdInput.extend({
                path: z.string(),
                recursive: z.boolean().optional(),
                excludes: z.array(z.string()).optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            const watcherId = await createWatchHandle(session, {
                path: input.path,
                recursive: input.recursive,
                excludes: input.excludes,
            });
            return { watcherId };
        }),

    stopWatch: protectedProcedure
        .input(sessionIdInput.extend({ watcherId: z.string().uuid() }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            await stopWatchHandle(session, input.watcherId);
            return { ok: true as const };
        }),

    /**
     * The only streaming procedure: every watcher and process of the session shares this one
     * connection. Browsers allow six HTTP/1.1 connections per host, so a stream per watcher or
     * process starved every other request, including page navigation.
     */
    sessionEvents: protectedProcedure.input(sessionIdInput).subscription(async function* ({
        input,
        ctx,
        signal,
    }) {
        const session = await requireSession(input.sessionId, ctx.user.id);
        yield* iterateEmitter<RemoteSessionEvent>(session.events, 'event', signal, [
            { kind: 'ready' },
        ]);
    }),

    // —— Terminal / task / background ————————————————————————————————————————

    createTerminal: protectedProcedure.input(sessionIdInput).mutation(async ({ input, ctx }) => {
        const session = await requireSession(input.sessionId, ctx.user.id);
        return createTerminalHandle(session);
    }),

    getTask: protectedProcedure
        .input(sessionIdInput.extend({ id: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            try {
                return await createTaskHandle(session, input.id);
            } catch (error) {
                asTrpcError(error);
            }
        }),

    runBackgroundCommand: protectedProcedure
        .input(sessionIdInput.extend({ command: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            return createBackgroundHandle(session, input.command);
        }),

    processOpen: protectedProcedure
        .input(sessionIdInput.extend({ handleId: z.string().uuid() }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            const handle = getProcessHandle(session, input.handleId);
            if (handle.terminal) {
                return { output: await handle.terminal.open() };
            }
            if (handle.task) {
                return { output: await handle.task.open() };
            }
            if (handle.background) {
                return { output: await handle.background.open() };
            }
            return { output: handle.buffer };
        }),

    processWrite: protectedProcedure
        .input(sessionIdInput.extend({ handleId: z.string().uuid(), data: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            const handle = getProcessHandle(session, input.handleId);
            if (!handle.terminal) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'Handle is not a terminal' });
            }
            await handle.terminal.write(input.data);
            return { ok: true as const };
        }),

    processRun: protectedProcedure
        .input(sessionIdInput.extend({ handleId: z.string().uuid(), data: z.string().optional() }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            const handle = getProcessHandle(session, input.handleId);
            if (handle.terminal) {
                await handle.terminal.run(input.data ?? '');
            } else if (handle.task) {
                await handle.task.run();
            } else {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Handle does not support run()',
                });
            }
            return { ok: true as const };
        }),

    processRestart: protectedProcedure
        .input(sessionIdInput.extend({ handleId: z.string().uuid() }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            const handle = getProcessHandle(session, input.handleId);
            if (handle.task) {
                await handle.task.restart();
            } else if (handle.background) {
                await handle.background.restart();
            } else {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Handle does not support restart()',
                });
            }
            return { ok: true as const };
        }),

    processStop: protectedProcedure
        .input(sessionIdInput.extend({ handleId: z.string().uuid() }))
        .mutation(async ({ input, ctx }) => {
            const session = await requireSession(input.sessionId, ctx.user.id);
            await destroyProcessHandle(session, input.handleId);
            return { ok: true as const };
        }),
});
