import { CodeProviderSync } from '@/services/sync-engine/sync-engine';
import { api } from '@/trpc/client';
import type { Provider } from '@onlook/code-provider';
import { EXCLUDED_SYNC_PATHS } from '@onlook/constants';
import type { CodeFileSystem } from '@onlook/file-system';
import { type FileEntry } from '@onlook/file-system';
import type { Branch, RouterConfig } from '@onlook/models';
import { rootDirFromLocalSandboxId } from '@onlook/utility';
import { makeAutoObservable, reaction } from 'mobx';
import type { EditorEngine } from '../engine';
import type { ErrorManager } from '../error';
import { GitManager } from '../git';
import { detectRouterConfig } from '../pages/helper';
import {
    copyPreloadScriptToPublic,
    detectBridgeTarget,
    ensureVitePreloadBridge,
    getLayoutPath as detectLayoutPath,
} from './preload-script';
import { SessionManager } from './session';
import { ViteRuntime, type StartViteRuntimeInput } from './vite-runtime';

export enum PreloadScriptState {
    NOT_INJECTED = 'not-injected',
    LOADING = 'loading',
    INJECTED = 'injected'
}
export class SandboxManager {
    readonly session: SessionManager;
    readonly gitManager: GitManager;
    readonly viteRuntime: ViteRuntime;
    private providerReactionDisposer?: () => void;
    private sync: CodeProviderSync | null = null;
    preloadScriptState: PreloadScriptState = PreloadScriptState.NOT_INJECTED
    routerConfig: RouterConfig | null = null;

    constructor(
        private branch: Branch,
        private readonly editorEngine: EditorEngine,
        private readonly errorManager: ErrorManager,
        private readonly fs: CodeFileSystem,
    ) {
        this.session = new SessionManager(this.branch, this.errorManager);
        this.gitManager = new GitManager(this);
        this.viteRuntime = new ViteRuntime(this.session);
        makeAutoObservable(this);
    }

    async init() {
        // Start connection asynchronously (don't wait)
        if (!this.session.provider) {
            // A branch backed by a host folder runs through the local NodeFs runtime; any other
            // branch is a hosted CodeSandbox session.
            const localRootDir = rootDirFromLocalSandboxId(this.branch.sandbox.id);
            const connection = localRootDir
                ? this.startLocalProject(localRootDir)
                : this.session.start(this.branch.sandbox.id);
            connection.catch(err => {
                console.error('[SandboxManager] Initial connection failed:', err);
                // Don't throw - let reaction handle retries/reconnects
            });
        }

        // React to provider becoming available (now or later)
        this.providerReactionDisposer = reaction(
            () => this.session.provider,
            async (provider) => {
                if (provider) {
                    await this.initializeSyncEngine(provider);
                    await this.gitManager.init();
                } else if (this.sync) {
                    // If the provider is null, release the sync engine reference
                    this.sync.release();
                    this.sync = null;
                }
            },
            { fireImmediately: true },
        );
    }

    /**
     * Opens a branch whose sandbox id points at a folder: the server reads package.json (so the
     * runtime starts with the right dev command straight away), then the dev server is started
     * and the branch frames are pointed at it.
     */
    private async startLocalProject(rootDir: string): Promise<void> {
        const { packageJson, lockfileNames } = await api.codeProvider.inspectLocalProject.query({
            rootDir,
        });
        await this.startLocalVite({ rootDir, packageJson, lockfileNames });
    }

    async getRouterConfig(): Promise<RouterConfig | null> {
        if (!!this.routerConfig) {
            return this.routerConfig;
        }
        if (!this.session.provider) {
            throw new Error('Provider not initialized');
        }
        this.routerConfig = await detectRouterConfig(this.session.provider);
        return this.routerConfig;
    }

    async initializeSyncEngine(provider: Provider) {
        if (this.sync) {
            this.sync.release();
            this.sync = null;
        }

        this.sync = CodeProviderSync.getInstance(provider, this.fs, this.branch.sandbox.id, {
            exclude: EXCLUDED_SYNC_PATHS,
        });

        await this.sync.start();
        await this.ensurePreloadScriptExists();
        await this.fs.rebuildIndex();
    }

    private async ensurePreloadScriptExists(): Promise<void> {
        try {
            if (this.preloadScriptState !== PreloadScriptState.NOT_INJECTED) {
                return;
            }

            this.preloadScriptState = PreloadScriptState.LOADING;

            if (!this.session.provider) {
                throw new Error('No provider available for preload script injection');
            }

            const { target } = await detectBridgeTarget(this.session.provider);

            // Vite (SID-26): inject via transformIndexHtml wrapper — no layout rewrite.
            if (target === 'vite') {
                await ensureVitePreloadBridge(this.session.provider);
                this.preloadScriptState = PreloadScriptState.INJECTED;
                return;
            }

            // Next.js: keep existing root-layout Script injection.
            const routerConfig = await this.getRouterConfig();
            if (!routerConfig) {
                throw new Error('No router config found for preload script injection');
            }

            await copyPreloadScriptToPublic(this.session.provider, routerConfig);
            this.preloadScriptState = PreloadScriptState.INJECTED;
        } catch (error) {
            console.error('[SandboxManager] Failed to ensure preload script exists:', error);
            // Frames will handle the missing preload script gracefully
            this.preloadScriptState = PreloadScriptState.NOT_INJECTED;
        }
    }

    async getLayoutPath(): Promise<string | null> {
        const routerConfig = await this.getRouterConfig();
        if (!routerConfig) {
            return null;
        }
        return detectLayoutPath(routerConfig, (path) => this.fileExists(path));
    }

    get errors() {
        return this.errorManager.errors;
    }

    get syncEngine() {
        return this.sync;
    }

    async readFile(path: string): Promise<string | Uint8Array> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.readFile(path);
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.writeFile(path, content);
    }

    listAllFiles() {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.listAll();
    }

    async readDir(dir: string): Promise<FileEntry[]> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.readDirectory(dir);
    }

    async listFilesRecursively(dir: string): Promise<string[]> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.listFiles(dir);
    }

    async fileExists(path: string): Promise<boolean> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs?.exists(path);
    }

    async copyFile(path: string, targetPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.copyFile(path, targetPath);
    }

    async copyDirectory(path: string, targetPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.copyDirectory(path, targetPath);
    }

    async deleteFile(path: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.deleteFile(path);
    }

    async deleteDirectory(path: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.deleteDirectory(path);
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.moveFile(oldPath, newPath);
    }

    /**
     * Start a local Vite/Next `dev` task via the SID-24 NodeFs bridge, detect the
     * listening port, and point this branch's canvas frames at `http://localhost:<port>`.
     */
    async startLocalVite(
        input: Omit<StartViteRuntimeInput, 'projectId'> & { projectId?: string },
    ): Promise<{ url: string; port: number }> {
        const projectId = input.projectId ?? this.branch.projectId;
        if (!projectId) {
            throw new Error('projectId is required to start a local Vite runtime');
        }
        const result = await this.viteRuntime.start({ ...input, projectId });
        await this.applyPreviewUrlToBranchFrames(result.url);
        return result;
    }

    async applyPreviewUrlToBranchFrames(previewOrigin: string): Promise<void> {
        const origin = previewOrigin.replace(/\/$/, '');
        const frames = this.editorEngine.frames
            .getAll()
            .filter((frameData) => frameData.frame.branchId === this.branch.id);

        await Promise.all(
            frames.map(async (frameData) => {
                let pathname = '/';
                try {
                    pathname = new URL(frameData.frame.url).pathname || '/';
                } catch {
                    pathname = '/';
                }
                const nextUrl = pathname === '/' ? `${origin}/` : `${origin}${pathname}`;
                if (frameData.frame.url === nextUrl) {
                    return;
                }
                await this.editorEngine.frames.updateAndSaveToStorage(frameData.frame.id, {
                    url: nextUrl,
                });
            }),
        );
    }

    // Download the code as a zip
    async downloadFiles(
        projectName?: string,
    ): Promise<{ downloadUrl: string; fileName: string } | null> {
        if (!this.session.provider) {
            console.error('No sandbox provider found for download');
            return null;
        }
        try {
            const { url } = await this.session.provider.downloadFiles({
                args: {
                    path: './',
                },
            });
            return {
                // in case there is no URL provided then the code must be updated
                // to handle this case
                downloadUrl: url ?? '',
                fileName: `${projectName ?? 'onlook-project'}-${Date.now()}.zip`,
            };
        } catch (error) {
            console.error('Error generating download URL:', error);
            return null;
        }
    }

    clear() {
        this.providerReactionDisposer?.();
        this.providerReactionDisposer = undefined;
        this.sync?.release();
        this.sync = null;
        this.preloadScriptState = PreloadScriptState.NOT_INJECTED
        void this.viteRuntime.dispose();
        this.session.clear();
    }
}
