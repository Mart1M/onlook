'use client';

import type { Provider, ProviderTask } from '@onlook/code-provider';
import {
    buildLocalPreviewUrl,
    detectProjectFromPackageJson,
    isErrorMessage,
    isSuccessMessage,
    packageManagerRun,
    parsePortFromDevServerLog,
    resolveDevServerPort,
    tasksFromDetection,
    type ProjectDetection,
} from '@onlook/utility';
import { viteDevCommandWithOnlookConfig } from '@onlook/vite-plugin';
import { makeAutoObservable } from 'mobx';

import { ensureVitePreloadBridge } from './preload-script';
import type { SessionManager, StartNodeFsOptions } from './session';

/** Prefer Onlook's Vite config wrapper so the preload bridge injects without layout edits. */
function tasksForDetection(detection: ProjectDetection): Record<string, string> | null {
    if (detection.framework.kind === 'vite' && detection.defaultTask) {
        const runPrefix = packageManagerRun(detection.packageManager, 'dev').replace(/\s+dev$/, '');
        return { [detection.defaultTask]: viteDevCommandWithOnlookConfig(runPrefix) };
    }
    return tasksFromDetection(detection);
}

export type ViteRuntimeStatus = 'idle' | 'starting' | 'ready' | 'error' | 'stopped';

export type StartViteRuntimeInput = {
    projectId: string;
    rootDir: string;
    /** When omitted, package.json is read from the provider after the session starts. */
    packageJson?: string;
    lockfileNames?: readonly string[];
    env?: Record<string, string>;
    host?: string;
    /** Max wait for a ready banner / port in logs. */
    readyTimeoutMs?: number;
    /** Stop the dev task after this much inactivity (default 15 min). */
    idleTimeoutMs?: number;
};

const DEFAULT_IDLE_MS = 15 * 60 * 1000;
const DEFAULT_READY_MS = 60_000;

/**
 * Orchestrates a local Vite/Next `dev` task through {@link SessionManager.startNodeFs}
 * (SID-24 bridge): start → detect port → canvas URL → logs → restart → idle stop.
 */
export class ViteRuntime {
    status: ViteRuntimeStatus = 'idle';
    port: number | null = null;
    url: string | null = null;
    logs = '';
    error: string | null = null;
    detection: ProjectDetection | null = null;
    lastActivityAt = Date.now();

    private task: ProviderTask | null = null;
    private unsubscribeOutput: (() => void) | null = null;
    private idleTimer: ReturnType<typeof setInterval> | null = null;
    private visibilityHandler: (() => void) | null = null;
    private idleTimeoutMs = DEFAULT_IDLE_MS;
    private host = 'localhost';
    private readyWaiters: Array<() => void> = [];

    constructor(private readonly session: SessionManager) {
        makeAutoObservable(this);
    }

    get canvasUrl(): string | null {
        return this.url;
    }

    touch(): void {
        this.lastActivityAt = Date.now();
    }

    async start(input: StartViteRuntimeInput): Promise<{ url: string; port: number }> {
        if (this.status === 'starting' || this.status === 'ready') {
            if (this.url && this.port !== null) {
                return { url: this.url, port: this.port };
            }
        }

        this.status = 'starting';
        this.error = null;
        this.logs = '';
        this.port = null;
        this.url = null;
        this.idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_IDLE_MS;
        this.host = input.host ?? 'localhost';
        this.touch();

        try {
            let packageJson = input.packageJson;
            const lockfileNames = input.lockfileNames ? [...input.lockfileNames] : undefined;

            // Bootstrap session with a placeholder task map; refine after we can read package.json.
            const bootstrapDetection = packageJson
                ? detectProjectFromPackageJson(packageJson, { lockfileNames })
                : null;
            let tasks = bootstrapDetection ? tasksForDetection(bootstrapDetection) : null;

            if (!tasks) {
                // Need a session to read package.json — start with a temporary echo task then replace.
                tasks = { dev: 'npm run dev' };
            }

            const nodeFsOptions: StartNodeFsOptions = {
                projectId: input.projectId,
                rootDir: input.rootDir,
                tasks,
                env: input.env,
            };

            if (this.session.provider) {
                await this.session.clear();
            }
            await this.session.startNodeFs(nodeFsOptions);
            const provider = this.requireProvider();

            if (!packageJson) {
                packageJson = await this.readPackageJson(provider);
            }
            this.detection = detectProjectFromPackageJson(packageJson, { lockfileNames });
            const detectedTasks = tasksForDetection(this.detection);
            if (!detectedTasks || !this.detection.defaultTask) {
                throw new Error('No `dev` script found in package.json');
            }

            if (this.detection.framework.kind === 'vite') {
                await ensureVitePreloadBridge(this.requireProvider());
            }

            // Rebuild the session with the correct package-manager command when the bootstrap differed.
            const desiredCommand = detectedTasks.dev;
            if (desiredCommand && tasks.dev !== desiredCommand) {
                await this.session.clear();
                await this.session.startNodeFs({
                    ...nodeFsOptions,
                    tasks: detectedTasks,
                });
                if (this.detection.framework.kind === 'vite') {
                    await ensureVitePreloadBridge(this.requireProvider());
                }
            }

            const { task } = await this.requireProvider().getTask({
                args: { id: this.detection.defaultTask },
            });
            this.task = task;
            this.unsubscribeOutput = task.onOutput((chunk) => {
                this.appendLog(chunk);
            });

            // Seed expected port before the process is ready (canvas can poll).
            this.port = resolveDevServerPort({
                framework: this.detection.framework.kind,
                script: this.detection.scripts.dev,
            });
            this.url = buildLocalPreviewUrl(this.port, { host: this.host });

            await task.run();
            await this.waitUntilReady(input.readyTimeoutMs ?? DEFAULT_READY_MS);

            this.port = resolveDevServerPort({
                framework: this.detection.framework.kind,
                script: this.detection.scripts.dev,
                logOutput: this.logs,
            });
            this.url = buildLocalPreviewUrl(this.port, { host: this.host });
            this.status = 'ready';
            this.startIdleWatch();
            return { url: this.url, port: this.port };
        } catch (error) {
            this.status = 'error';
            this.error = error instanceof Error ? error.message : String(error);
            this.stopIdleWatch();
            throw error;
        }
    }

    async restart(): Promise<boolean> {
        this.touch();
        if (!this.task) {
            const ok = await this.session.restartDevServer();
            return ok;
        }
        this.status = 'starting';
        this.error = null;
        try {
            await this.task.restart();
            await this.waitUntilReady(DEFAULT_READY_MS);
            if (this.detection) {
                this.port = resolveDevServerPort({
                    framework: this.detection.framework.kind,
                    script: this.detection.scripts.dev,
                    logOutput: this.logs,
                });
                this.url = buildLocalPreviewUrl(this.port, { host: this.host });
            }
            this.status = 'ready';
            return true;
        } catch (error) {
            this.status = 'error';
            this.error = error instanceof Error ? error.message : String(error);
            return false;
        }
    }

    async stop(): Promise<void> {
        this.stopIdleWatch();
        this.unsubscribeOutput?.();
        this.unsubscribeOutput = null;
        try {
            if (this.task) {
                await this.task.stop();
            }
        } finally {
            this.task = null;
            this.status = 'stopped';
            this.readyWaiters.forEach((wake) => wake());
            this.readyWaiters = [];
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.logs = '';
        this.port = null;
        this.url = null;
        this.detection = null;
        this.status = 'idle';
    }

    private requireProvider(): Provider {
        if (!this.session.provider) {
            throw new Error('No code provider session');
        }
        return this.session.provider;
    }

    private async readPackageJson(provider: Provider): Promise<string> {
        const { file } = await provider.readFile({ args: { path: 'package.json' } });
        if (file.type !== 'text' || typeof file.content !== 'string') {
            throw new Error('package.json is missing or not text');
        }
        return file.content;
    }

    private appendLog(chunk: string): void {
        this.touch();
        this.logs = (this.logs + chunk).slice(-200_000);
        if (isErrorMessage(chunk) && this.status === 'starting') {
            // Keep streaming; waitUntilReady still times out if never ready.
            this.error = chunk.trim();
        }
        if (isSuccessMessage(chunk) || parsePortFromDevServerLog(chunk) !== null) {
            this.readyWaiters.forEach((wake) => wake());
            this.readyWaiters = [];
        }
    }

    private async waitUntilReady(timeoutMs: number): Promise<void> {
        if (isSuccessMessage(this.logs) || parsePortFromDevServerLog(this.logs) !== null) {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                if (this.error) {
                    reject(new Error(`Dev server failed to start:\n${this.error}`));
                } else {
                    reject(new Error(`Dev server did not become ready within ${timeoutMs}ms`));
                }
            }, timeoutMs);

            const wake = () => {
                cleanup();
                resolve();
            };
            const cleanup = () => {
                clearTimeout(timer);
                this.readyWaiters = this.readyWaiters.filter((w) => w !== wake);
            };
            this.readyWaiters.push(wake);
        });
    }

    private startIdleWatch(): void {
        this.stopIdleWatch();
        this.idleTimer = setInterval(() => {
            if (this.status !== 'ready') {
                return;
            }
            if (Date.now() - this.lastActivityAt >= this.idleTimeoutMs) {
                void this.stop().catch((error) =>
                    console.error('[ViteRuntime] idle stop failed:', error),
                );
            }
        }, Math.min(30_000, this.idleTimeoutMs));

        if (typeof document !== 'undefined') {
            this.visibilityHandler = () => {
                if (document.visibilityState === 'visible') {
                    this.touch();
                }
            };
            document.addEventListener('visibilitychange', this.visibilityHandler);
        }
    }

    private stopIdleWatch(): void {
        if (this.idleTimer) {
            clearInterval(this.idleTimer);
            this.idleTimer = null;
        }
        if (this.visibilityHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
    }
}
