import {
    Provider,
    ProviderBackgroundCommand,
    ProviderFileWatcher,
    ProviderTask,
    ProviderTerminal,
    type CopyFileOutput,
    type CopyFilesInput,
    type CreateDirectoryInput,
    type CreateDirectoryOutput,
    type CreateProjectInput,
    type CreateProjectOutput,
    type CreateSessionInput,
    type CreateSessionOutput,
    type CreateTerminalInput,
    type CreateTerminalOutput,
    type DeleteFilesInput,
    type DeleteFilesOutput,
    type DownloadFilesInput,
    type DownloadFilesOutput,
    type GetTaskInput,
    type GetTaskOutput,
    type GitStatusInput,
    type GitStatusOutput,
    type InitializeInput,
    type InitializeOutput,
    type ListFilesInput,
    type ListFilesOutput,
    type ListProjectsInput,
    type ListProjectsOutput,
    type PauseProjectInput,
    type PauseProjectOutput,
    type ReadFileInput,
    type ReadFileOutput,
    type RenameFileInput,
    type RenameFileOutput,
    type SetupInput,
    type SetupOutput,
    type StatFileInput,
    type StatFileOutput,
    type StopProjectInput,
    type StopProjectOutput,
    type TerminalBackgroundCommandInput,
    type TerminalBackgroundCommandOutput,
    type TerminalCommandInput,
    type TerminalCommandOutput,
    type WatchEvent,
    type WatchFilesInput,
    type WatchFilesOutput,
    type WriteFileInput,
    type WriteFileOutput,
} from '../../types';
import type { RemoteCodeProviderRpc } from './types';

export type { RemoteCodeProviderRpc, RemoteSessionEvent } from './types';

/**
 * Browser-side {@link Provider} that forwards every call to a server-held
 * `NodeFsProvider` through an injected RPC transport (tRPC over HTTP + SSE).
 *
 * Safe to import from the package index — no Node built-ins.
 */
export interface RemoteProviderOptions {
    projectId: string;
    rootDir: string;
    tasks?: Record<string, string>;
    env?: Record<string, string>;
    rpc: RemoteCodeProviderRpc;
}

export class RemoteProvider extends Provider {
    private sessionId: string | null = null;

    constructor(private readonly options: RemoteProviderOptions) {
        super();
        if (!options.projectId || !options.rootDir || !options.rpc) {
            throw new Error('RemoteProvider requires projectId, rootDir, and rpc.');
        }
    }

    private requireSessionId(): string {
        if (!this.sessionId) {
            throw new Error('RemoteProvider is not initialized.');
        }
        return this.sessionId;
    }

    async initialize(_input: InitializeInput): Promise<InitializeOutput> {
        const session = await this.options.rpc.createSession({
            projectId: this.options.projectId,
            rootDir: this.options.rootDir,
            tasks: this.options.tasks,
            env: this.options.env,
        });
        this.sessionId = session.sessionId;
        return {};
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        return this.options.rpc.writeFile({
            sessionId: this.requireSessionId(),
            path: input.args.path,
            content: input.args.content,
            overwrite: input.args.overwrite,
        });
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        return this.options.rpc.renameFile({
            sessionId: this.requireSessionId(),
            oldPath: input.args.oldPath,
            newPath: input.args.newPath,
        });
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        return this.options.rpc.statFile({
            sessionId: this.requireSessionId(),
            path: input.args.path,
        });
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        return this.options.rpc.deleteFiles({
            sessionId: this.requireSessionId(),
            path: input.args.path,
            recursive: input.args.recursive,
        });
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        return this.options.rpc.listFiles({
            sessionId: this.requireSessionId(),
            path: input.args.path,
        });
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const { file } = await this.options.rpc.readFile({
            sessionId: this.requireSessionId(),
            path: input.args.path,
        });
        if (file.type === 'binary') {
            const content =
                file.content instanceof Uint8Array ? file.content : new Uint8Array();
            return {
                file: {
                    path: file.path,
                    content,
                    type: 'binary',
                    toString: () => uint8ToBase64(content),
                },
            };
        }
        const content = typeof file.content === 'string' ? file.content : '';
        return {
            file: {
                path: file.path,
                content,
                type: 'text',
                toString: () => content,
            },
        };
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        return this.options.rpc.downloadFiles({
            sessionId: this.requireSessionId(),
            path: input.args.path,
        });
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        return this.options.rpc.copyFiles({
            sessionId: this.requireSessionId(),
            sourcePath: input.args.sourcePath,
            targetPath: input.args.targetPath,
            recursive: input.args.recursive,
            overwrite: input.args.overwrite,
        });
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        return this.options.rpc.createDirectory({
            sessionId: this.requireSessionId(),
            path: input.args.path,
        });
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        const sessionId = this.requireSessionId();
        const { watcherId } = await this.options.rpc.startWatch({
            sessionId,
            path: input.args.path,
            recursive: input.args.recursive,
            excludes: input.args.excludes,
        });
        const watcher = new RemoteFileWatcher(this.options.rpc, sessionId, watcherId);
        if (input.onFileChange) {
            watcher.registerEventCallback(input.onFileChange);
        }
        await watcher.start(input);
        return { watcher };
    }

    async createTerminal(_input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        const sessionId = this.requireSessionId();
        const meta = await this.options.rpc.createTerminal({ sessionId });
        return {
            terminal: new RemoteTerminal(this.options.rpc, sessionId, meta),
        };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        const sessionId = this.requireSessionId();
        const meta = await this.options.rpc.getTask({ sessionId, id: input.args.id });
        return {
            task: new RemoteTask(this.options.rpc, sessionId, meta),
        };
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        return this.options.rpc.runCommand({
            sessionId: this.requireSessionId(),
            command: input.args.command,
        });
    }

    async runBackgroundCommand(
        input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        const sessionId = this.requireSessionId();
        const meta = await this.options.rpc.runBackgroundCommand({
            sessionId,
            command: input.args.command,
        });
        return {
            command: new RemoteBackgroundCommand(this.options.rpc, sessionId, meta),
        };
    }

    async gitStatus(_input: GitStatusInput): Promise<GitStatusOutput> {
        return this.options.rpc.gitStatus({ sessionId: this.requireSessionId() });
    }

    async setup(_input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async createSession(_input: CreateSessionInput): Promise<CreateSessionOutput> {
        return {};
    }

    async reload(): Promise<boolean> {
        return this.ping();
    }

    async reconnect(): Promise<void> {
        // Session is server-side; ping is enough to verify liveness.
        await this.ping();
    }

    async ping(): Promise<boolean> {
        if (!this.sessionId) {
            return false;
        }
        const { ok } = await this.options.rpc.ping({ sessionId: this.sessionId });
        return ok;
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        return { id: input.id };
    }

    static async createProjectFromGit(_input: {
        repoUrl: string;
        branch: string;
    }): Promise<CreateProjectOutput> {
        throw new Error('createProjectFromGit not implemented for Remote provider');
    }

    async pauseProject(_input: PauseProjectInput): Promise<PauseProjectOutput> {
        return this.stopProject({});
    }

    async stopProject(_input: StopProjectInput): Promise<StopProjectOutput> {
        if (this.sessionId) {
            await this.options.rpc.destroySession({ sessionId: this.sessionId });
            this.sessionId = null;
        }
        return {};
    }

    async listProjects(_input: ListProjectsInput): Promise<ListProjectsOutput> {
        return {};
    }

    async destroy(): Promise<void> {
        await this.stopProject({});
    }
}

class RemoteFileWatcher extends ProviderFileWatcher {
    private unsubscribe: (() => void) | null = null;
    private callbacks: Array<(event: WatchEvent) => Promise<void>> = [];
    private started = false;

    constructor(
        private readonly rpc: RemoteCodeProviderRpc,
        private readonly sessionId: string,
        private readonly watcherId: string,
    ) {
        super();
    }

    async start(_input: WatchFilesInput): Promise<void> {
        if (this.started) {
            return;
        }
        this.started = true;
        this.unsubscribe = this.rpc.subscribeWatch(
            { sessionId: this.sessionId, watcherId: this.watcherId },
            (event) => {
                for (const cb of this.callbacks) {
                    void cb(event).catch((error) =>
                        console.error('Remote watcher callback failed:', error),
                    );
                }
            },
            (error) => console.error('Remote watcher subscription error:', error),
        );
    }

    async stop(): Promise<void> {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.callbacks = [];
        await this.rpc.stopWatch({ sessionId: this.sessionId, watcherId: this.watcherId });
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callbacks.push(callback);
    }
}

class RemoteTerminal extends ProviderTerminal {
    constructor(
        private readonly rpc: RemoteCodeProviderRpc,
        private readonly sessionId: string,
        private readonly meta: { handleId: string; id: string; name: string },
    ) {
        super();
    }

    get id(): string {
        return this.meta.id;
    }

    get name(): string {
        return this.meta.name;
    }

    async open(): Promise<string> {
        const { output } = await this.rpc.processOpen({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
        });
        return output;
    }

    async write(input: string): Promise<void> {
        await this.rpc.processWrite({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
            data: input,
        });
    }

    async run(input: string): Promise<void> {
        await this.rpc.processRun({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
            data: input,
        });
    }

    async kill(): Promise<void> {
        await this.rpc.processStop({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
        });
    }

    onOutput(callback: (data: string) => void): () => void {
        return this.rpc.subscribeOutput(
            { sessionId: this.sessionId, handleId: this.meta.handleId },
            callback,
        );
    }
}

class RemoteTask extends ProviderTask {
    constructor(
        private readonly rpc: RemoteCodeProviderRpc,
        private readonly sessionId: string,
        private readonly meta: { handleId: string; id: string; name: string; command: string },
    ) {
        super();
    }

    get id(): string {
        return this.meta.id;
    }

    get name(): string {
        return this.meta.name;
    }

    get command(): string {
        return this.meta.command;
    }

    async open(): Promise<string> {
        const { output } = await this.rpc.processOpen({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
        });
        return output;
    }

    async run(): Promise<void> {
        await this.rpc.processRun({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
        });
    }

    async restart(): Promise<void> {
        await this.rpc.processRestart({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
        });
    }

    async stop(): Promise<void> {
        await this.rpc.processStop({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
        });
    }

    onOutput(callback: (data: string) => void): () => void {
        return this.rpc.subscribeOutput(
            { sessionId: this.sessionId, handleId: this.meta.handleId },
            callback,
        );
    }
}

class RemoteBackgroundCommand extends ProviderBackgroundCommand {
    constructor(
        private readonly rpc: RemoteCodeProviderRpc,
        private readonly sessionId: string,
        private readonly meta: { handleId: string; command: string },
    ) {
        super();
    }

    get name(): string | undefined {
        return undefined;
    }

    get command(): string {
        return this.meta.command;
    }

    async open(): Promise<string> {
        const { output } = await this.rpc.processOpen({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
        });
        return output;
    }

    async restart(): Promise<void> {
        await this.rpc.processRestart({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
        });
    }

    async kill(): Promise<void> {
        await this.rpc.processStop({
            sessionId: this.sessionId,
            handleId: this.meta.handleId,
        });
    }

    onOutput(callback: (data: string) => void): () => void {
        return this.rpc.subscribeOutput(
            { sessionId: this.sessionId, handleId: this.meta.handleId },
            callback,
        );
    }
}

function uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
}
