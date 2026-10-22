import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs, watch as fsWatch } from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { FSWatcher } from 'node:fs';

import type {
    CopyFileOutput,
    CopyFilesInput,
    CreateDirectoryInput,
    CreateDirectoryOutput,
    CreateProjectInput,
    CreateProjectOutput,
    CreateSessionInput,
    CreateSessionOutput,
    CreateTerminalInput,
    CreateTerminalOutput,
    DeleteFilesInput,
    DeleteFilesOutput,
    DownloadFilesInput,
    DownloadFilesOutput,
    GetTaskInput,
    GetTaskOutput,
    GitStatusInput,
    GitStatusOutput,
    InitializeInput,
    InitializeOutput,
    ListFilesInput,
    ListFilesOutput,
    ListFilesOutputFile,
    ListProjectsInput,
    ListProjectsOutput,
    PauseProjectInput,
    PauseProjectOutput,
    ReadFileInput,
    ReadFileOutput,
    RenameFileInput,
    RenameFileOutput,
    SetupInput,
    SetupOutput,
    StatFileInput,
    StatFileOutput,
    StopProjectInput,
    StopProjectOutput,
    TerminalBackgroundCommandInput,
    TerminalBackgroundCommandOutput,
    TerminalCommandInput,
    TerminalCommandOutput,
    WatchEvent,
    WatchFilesInput,
    WatchFilesOutput,
    WriteFileInput,
    WriteFileOutput,
} from '../../types';
import {
    Provider,
    ProviderBackgroundCommand,
    ProviderFileWatcher,
    ProviderTask,
    ProviderTerminal,
} from '../../types';

/**
 * Provider backed by a directory on the local filesystem.
 *
 * This module imports Node built-ins and must only be loaded server-side. It is intentionally not
 * re-exported from the package index, which is bundled into the browser. Import it with
 * `@onlook/code-provider/src/providers/nodefs`.
 */
export interface NodeFsProviderOptions {
    /** Project directory. Every path handled by the provider is confined to it. */
    rootDir: string;
    /** Task id to shell command, e.g. `{ dev: 'bun run dev' }`. Served by `getTask`. */
    tasks?: Record<string, string>;
    /** Extra environment variables for spawned processes. */
    env?: Record<string, string>;
}

// Spawned processes run user-controlled code (npm scripts, dev servers). They must not inherit the
// backend's secrets, so only a minimal allowlist of the parent environment is forwarded.
const INHERITED_ENV_KEYS = ['PATH', 'HOME', 'SHELL', 'USER', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR'];
const MAX_BUFFERED_OUTPUT = 100_000;
const MAX_COMMAND_OUTPUT = 10 * 1024 * 1024;

function buildEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of INHERITED_ENV_KEYS) {
        const value = process.env[key];
        if (value !== undefined) {
            env[key] = value;
        }
    }
    return { ...env, ...extra };
}

function toPosix(p: string): string {
    return p.split(path.sep).join('/');
}

function isOutside(relative: string): boolean {
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function globToRegExp(pattern: string): RegExp {
    const cleaned = pattern
        .replace(/^\.\//, '')
        .replace(/^\//, '')
        .replace(/^\*\*\//, '')
        .replace(/\/\*\*$/, '')
        .replace(/\/$/, '');
    const source = cleaned
        .split('**')
        .map((part) =>
            part
                .split('*')
                .map((chunk) => chunk.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
                .join('[^/]*'),
        )
        .join('.*');
    return new RegExp(`^(?:.*/)?${source}(?:/.*)?$`);
}

export class NodeFsProvider extends Provider {
    private readonly root: string;
    private realRoot: string | null = null;
    private readonly tasks = new Map<string, NodeFsTask>();
    private readonly disposables = new Set<{ stop: () => Promise<void> }>();

    constructor(private readonly options: NodeFsProviderOptions) {
        super();
        if (!options.rootDir) {
            throw new Error('NodeFs provider requires a rootDir.');
        }
        this.root = path.resolve(options.rootDir);
    }

    async initialize(input: InitializeInput): Promise<InitializeOutput> {
        const stat = await fs.stat(this.root);
        if (!stat.isDirectory()) {
            throw new Error(`rootDir is not a directory: ${this.root}`);
        }
        this.realRoot = await fs.realpath(this.root);
        return {};
    }

    /**
     * Resolves a workspace path (relative to rootDir, a leading slash is the root) to an absolute
     * path, rejecting anything that leaves rootDir lexically or through a symlink.
     */
    private async resolve(inputPath: string): Promise<string> {
        const realRoot = this.realRoot;
        if (!realRoot) {
            throw new Error('NodeFs provider is not initialized.');
        }
        const abs = path.resolve(this.root, inputPath.replace(/^[/\\]+/, ''));
        if (isOutside(path.relative(this.root, abs))) {
            throw new Error(`Path escapes the project root: ${inputPath}`);
        }

        // Follow symlinks on the deepest existing ancestor; the target may not exist yet.
        let existing = abs;
        for (;;) {
            try {
                const real = await fs.realpath(existing);
                if (isOutside(path.relative(realRoot, real))) {
                    throw new Error(
                        `Path escapes the project root through a symlink: ${inputPath}`,
                    );
                }
                break;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }
                const parent = path.dirname(existing);
                if (parent === existing) {
                    break;
                }
                existing = parent;
            }
        }
        return abs;
    }

    private toRelative(abs: string): string {
        return toPosix(path.relative(this.root, abs)) || '.';
    }

    async writeFile({ args }: WriteFileInput): Promise<WriteFileOutput> {
        const abs = await this.resolve(args.path);
        try {
            if (typeof args.content !== 'string' && !(args.content instanceof Uint8Array)) {
                throw new Error(`Invalid content type ${typeof args.content}`);
            }
            if (args.overwrite === false && (await this.exists(abs))) {
                throw new Error('File already exists');
            }
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, args.content);
            return { success: true };
        } catch (error) {
            console.error(`Error writing file ${args.path}:`, error);
            return { success: false };
        }
    }

    async renameFile({ args }: RenameFileInput): Promise<RenameFileOutput> {
        const from = await this.resolve(args.oldPath);
        const to = await this.resolve(args.newPath);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to);
        return {};
    }

    async statFile({ args }: StatFileInput): Promise<StatFileOutput> {
        const abs = await this.resolve(args.path);
        const link = await fs.lstat(abs);
        const stat = link.isSymbolicLink() ? await fs.stat(abs) : link;
        return {
            type: stat.isDirectory() ? 'directory' : 'file',
            isSymlink: link.isSymbolicLink(),
            size: stat.size,
            mtime: stat.mtimeMs,
            ctime: stat.ctimeMs,
            atime: stat.atimeMs,
        };
    }

    async deleteFiles({ args }: DeleteFilesInput): Promise<DeleteFilesOutput> {
        const abs = await this.resolve(args.path);
        if (abs === this.root) {
            throw new Error('Refusing to delete the project root.');
        }
        await fs.rm(abs, { recursive: args.recursive ?? false });
        return {};
    }

    async listFiles({ args }: ListFilesInput): Promise<ListFilesOutput> {
        const abs = await this.resolve(args.path);
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const files: ListFilesOutputFile[] = await Promise.all(
            entries.map(async (entry) => {
                const isSymlink = entry.isSymbolicLink();
                let isDirectory = entry.isDirectory();
                if (isSymlink) {
                    isDirectory = await fs
                        .stat(path.join(abs, entry.name))
                        .then((s) => s.isDirectory())
                        .catch(() => false);
                }
                return {
                    name: entry.name,
                    type: isDirectory ? ('directory' as const) : ('file' as const),
                    isSymlink,
                };
            }),
        );
        return { files };
    }

    async readFile({ args }: ReadFileInput): Promise<ReadFileOutput> {
        const abs = await this.resolve(args.path);
        const buffer = await fs.readFile(abs);
        const isBinary = buffer.subarray(0, 8000).includes(0);
        if (!isBinary) {
            const content = buffer.toString('utf8');
            return { file: { path: args.path, content, type: 'text', toString: () => content } };
        }
        const content = new Uint8Array(buffer);
        return {
            file: {
                path: args.path,
                content,
                type: 'binary',
                toString: () => buffer.toString('base64'),
            },
        };
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        // Files are already local; there is nothing to publish a download URL for.
        return {};
    }

    async copyFiles({ args }: CopyFilesInput): Promise<CopyFileOutput> {
        const from = await this.resolve(args.sourcePath);
        const to = await this.resolve(args.targetPath);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.cp(from, to, {
            recursive: args.recursive ?? false,
            force: args.overwrite ?? false,
            errorOnExist: !args.overwrite,
        });
        return {};
    }

    async createDirectory({ args }: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        await fs.mkdir(await this.resolve(args.path), { recursive: true });
        return {};
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        const watcher = new NodeFsFileWatcher(this.root, (p) => this.resolve(p));
        await watcher.start(input);
        if (input.onFileChange) {
            watcher.registerEventCallback(input.onFileChange);
        }
        this.disposables.add(watcher);
        return { watcher };
    }

    async createTerminal(input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        const terminal = new NodeFsTerminal(this.root, this.options.env);
        this.disposables.add({ stop: () => terminal.kill() });
        return { terminal };
    }

    async getTask({ args }: GetTaskInput): Promise<GetTaskOutput> {
        let task = this.tasks.get(args.id);
        if (!task) {
            const command = this.options.tasks?.[args.id];
            if (!command) {
                throw new Error(`Task ${args.id} not found`);
            }
            task = new NodeFsTask(args.id, command, this.root, this.options.env);
            this.tasks.set(args.id, task);
            this.disposables.add(task);
        }
        return { task };
    }

    /** Resolves with stdout and stderr; rejects on a non-zero exit with the output attached. */
    async runCommand({ args }: TerminalCommandInput): Promise<TerminalCommandOutput> {
        return new Promise((resolve, reject) => {
            const child = spawn(args.command, {
                cwd: this.root,
                env: buildEnv(this.options.env),
                shell: true,
            });
            let output = '';
            const collect = (chunk: Buffer) => {
                if (output.length < MAX_COMMAND_OUTPUT) {
                    output += chunk.toString('utf8');
                }
            };
            child.stdout?.on('data', collect);
            child.stderr?.on('data', collect);
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ output });
                } else {
                    reject(
                        new Error(`Command exited with code ${code}: ${args.command}\n${output}`),
                    );
                }
            });
        });
    }

    async runBackgroundCommand({
        args,
    }: TerminalBackgroundCommandInput): Promise<TerminalBackgroundCommandOutput> {
        const command = new NodeFsCommand(args.command, this.root, this.options.env);
        command.start();
        this.disposables.add({ stop: () => command.kill() });
        return { command };
    }

    async gitStatus(input: GitStatusInput): Promise<GitStatusOutput> {
        const stdout = await new Promise<string>((resolve, reject) => {
            execFile(
                'git',
                ['status', '--porcelain', '-z'],
                { cwd: this.root, env: buildEnv() },
                (error, out) => (error ? reject(error) : resolve(out)),
            );
        });
        // Entries are `XY path` separated by NUL; renames and copies are followed by the old path.
        const entries = stdout.split('\0').filter(Boolean);
        const changedFiles: string[] = [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i] ?? '';
            changedFiles.push(entry.slice(3));
            if (
                entry.startsWith('R') ||
                entry.startsWith('C') ||
                entry[1] === 'R' ||
                entry[1] === 'C'
            ) {
                i++;
            }
        }
        return { changedFiles };
    }

    async setup(_input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async createSession(_input: CreateSessionInput): Promise<CreateSessionOutput> {
        // Local provider: there are no credentials to hand to the frontend.
        return {};
    }

    async reload(): Promise<boolean> {
        return this.ping();
    }

    async reconnect(): Promise<void> {}

    async ping(): Promise<boolean> {
        return fs
            .access(this.root)
            .then(() => true)
            .catch(() => false);
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        return { id: input.id };
    }

    static async createProjectFromGit(input: {
        repoUrl: string;
        branch: string;
    }): Promise<CreateProjectOutput> {
        throw new Error('createProjectFromGit not implemented for NodeFs provider');
    }

    async pauseProject(input: PauseProjectInput): Promise<PauseProjectOutput> {
        return this.stopProject(input);
    }

    async stopProject(input: StopProjectInput): Promise<StopProjectOutput> {
        await this.stopAll();
        return {};
    }

    async listProjects(input: ListProjectsInput): Promise<ListProjectsOutput> {
        return {};
    }

    async destroy(): Promise<void> {
        await this.stopAll();
        this.tasks.clear();
    }

    private async stopAll(): Promise<void> {
        const all = [...this.disposables];
        this.disposables.clear();
        await Promise.allSettled(all.map((d) => d.stop()));
    }

    private async exists(abs: string): Promise<boolean> {
        return fs
            .access(abs)
            .then(() => true)
            .catch(() => false);
    }
}

export class NodeFsFileWatcher extends ProviderFileWatcher {
    private watcher: FSWatcher | null = null;
    private callbacks: Array<(event: WatchEvent) => Promise<void>> = [];
    private readonly seen = new Set<string>();

    constructor(
        private readonly root: string,
        private readonly resolvePath: (p: string) => Promise<string>,
    ) {
        super();
    }

    async start(input: WatchFilesInput): Promise<void> {
        const dir = await this.resolvePath(input.args.path);
        const excludes = (input.args.excludes ?? []).map(globToRegExp);
        this.watcher = fsWatch(
            dir,
            { recursive: input.args.recursive ?? false },
            (eventType, filename) => {
                if (!filename) {
                    return;
                }
                const abs = path.join(dir, filename.toString());
                const relative = toPosix(path.relative(this.root, abs));
                if (excludes.some((re) => re.test(relative))) {
                    return;
                }
                void this.dispatch(eventType, abs, relative);
            },
        );
        // Without a listener, an error (e.g. the watched directory being removed) would crash the process.
        this.watcher.on('error', (error) => console.error('NodeFs watcher error:', error));
    }

    private async dispatch(_eventType: string, abs: string, relative: string): Promise<void> {
        // Bun/Node report creates, writes and deletes inconsistently as `rename` or `change`
        // depending on the platform (e.g. Bun on macOS tends to use `rename`; Linux often uses
        // `change` for creates/writes). Derive the semantic type from existence plus the paths
        // seen so far. A file that predates the watcher is reported as `add` on its first event.
        const exists = await fs
            .access(abs)
            .then(() => true)
            .catch(() => false);
        let type: WatchEvent['type'];
        if (!exists) {
            type = 'remove';
            this.seen.delete(relative);
        } else if (this.seen.has(relative)) {
            type = 'change';
        } else {
            type = 'add';
            this.seen.add(relative);
        }
        for (const callback of this.callbacks) {
            try {
                await callback({ type, paths: [relative] });
            } catch (error) {
                console.error('NodeFs watcher callback failed:', error);
            }
        }
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        if (!this.watcher) {
            throw new Error('Watcher not initialized');
        }
        this.callbacks.push(callback);
    }

    async stop(): Promise<void> {
        this.watcher?.close();
        this.watcher = null;
        this.callbacks = [];
    }
}

/**
 * A shell command owned by the provider: output is buffered so late subscribers can catch up and
 * the whole process group is killed on stop, since `shell: true` puts the real work in a child.
 */
class ManagedProcess {
    private child: ChildProcess | null = null;
    private buffer = '';
    private readonly listeners = new Set<(data: string) => void>();

    constructor(
        readonly command: string,
        private readonly cwd: string,
        private readonly env?: Record<string, string>,
    ) {}

    get running(): boolean {
        return this.child !== null;
    }

    start(): void {
        if (this.child) {
            return;
        }
        const child = spawn(this.command, {
            cwd: this.cwd,
            env: buildEnv(this.env),
            shell: true,
            detached: true,
        });
        this.child = child;
        child.stdout?.on('data', (chunk: Buffer) => this.emit(chunk.toString('utf8')));
        child.stderr?.on('data', (chunk: Buffer) => this.emit(chunk.toString('utf8')));
        child.on('error', (error) => this.emit(`${error.message}\n`));
        child.on('close', () => {
            if (this.child === child) {
                this.child = null;
            }
        });
    }

    write(input: string): void {
        this.child?.stdin?.write(input);
    }

    async stop(): Promise<void> {
        const child = this.child;
        if (!child) {
            return;
        }
        this.child = null;
        const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
        this.signal(child, 'SIGTERM');
        const forced = setTimeout(() => this.signal(child, 'SIGKILL'), 3000);
        await closed;
        clearTimeout(forced);
    }

    async restart(): Promise<void> {
        await this.stop();
        this.start();
    }

    read(): string {
        return this.buffer;
    }

    onOutput(callback: (data: string) => void): () => void {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }

    private signal(child: ChildProcess, signal: NodeJS.Signals): void {
        try {
            if (child.pid !== undefined) {
                process.kill(-child.pid, signal);
            }
        } catch {
            // The process group is already gone.
        }
    }

    private emit(data: string): void {
        this.buffer = (this.buffer + data).slice(-MAX_BUFFERED_OUTPUT);
        this.listeners.forEach((listener) => listener(data));
    }
}

export class NodeFsTerminal extends ProviderTerminal {
    private readonly _id = randomUUID();
    // No pty: output is plain pipes, so interactive programs and colors are not supported.
    private readonly process: ManagedProcess;

    constructor(cwd: string, env?: Record<string, string>) {
        super();
        this.process = new ManagedProcess(process.env.SHELL ?? 'sh', cwd, env);
    }

    get id(): string {
        return this._id;
    }

    get name(): string {
        return 'terminal';
    }

    async open(): Promise<string> {
        this.process.start();
        return this.process.read();
    }

    async write(input: string): Promise<void> {
        this.process.start();
        this.process.write(input);
    }

    async run(input: string): Promise<void> {
        await this.write(`${input}\n`);
    }

    async kill(): Promise<void> {
        await this.process.stop();
    }

    onOutput(callback: (data: string) => void): () => void {
        return this.process.onOutput(callback);
    }
}

export class NodeFsTask extends ProviderTask {
    private readonly process: ManagedProcess;

    constructor(
        private readonly _id: string,
        command: string,
        cwd: string,
        env?: Record<string, string>,
    ) {
        super();
        this.process = new ManagedProcess(command, cwd, env);
    }

    get id(): string {
        return this._id;
    }

    get name(): string {
        return this._id;
    }

    get command(): string {
        return this.process.command;
    }

    async open(): Promise<string> {
        return this.process.read();
    }

    async run(): Promise<void> {
        this.process.start();
    }

    async restart(): Promise<void> {
        await this.process.restart();
    }

    async stop(): Promise<void> {
        await this.process.stop();
    }

    onOutput(callback: (data: string) => void): () => void {
        return this.process.onOutput(callback);
    }
}

export class NodeFsCommand extends ProviderBackgroundCommand {
    private readonly process: ManagedProcess;

    constructor(command: string, cwd: string, env?: Record<string, string>) {
        super();
        this.process = new ManagedProcess(command, cwd, env);
    }

    start(): void {
        this.process.start();
    }

    get name(): string | undefined {
        return undefined;
    }

    get command(): string {
        return this.process.command;
    }

    async open(): Promise<string> {
        return this.process.read();
    }

    async restart(): Promise<void> {
        await this.process.restart();
    }

    async kill(): Promise<void> {
        await this.process.stop();
    }

    onOutput(callback: (data: string) => void): () => void {
        return this.process.onOutput(callback);
    }
}
