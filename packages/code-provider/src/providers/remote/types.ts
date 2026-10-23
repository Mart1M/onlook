import type {
    CopyFileOutput,
    CreateDirectoryOutput,
    DeleteFilesOutput,
    DownloadFilesOutput,
    GitStatusOutput,
    ListFilesOutput,
    ReadFileOutput,
    RenameFileOutput,
    StatFileOutput,
    TerminalCommandOutput,
    WatchEvent,
    WriteFileOutput,
} from '../../types';

/** Serializable file payload returned by the bridge (no `toString`). */
export type RemoteReadFileResult = {
    file: {
        path: string;
        content: string | Uint8Array;
        type: 'text' | 'binary';
    };
};

export interface RemoteWatchStartResult {
    watcherId: string;
}

export interface RemoteTerminalResult {
    handleId: string;
    id: string;
    name: string;
}

export interface RemoteTaskResult {
    handleId: string;
    id: string;
    name: string;
    command: string;
}

export interface RemoteBackgroundResult {
    handleId: string;
    command: string;
}

export interface RemoteSessionResult {
    sessionId: string;
    rootDir: string;
    projectId: string;
}

/**
 * Everything a session streams to the browser, over a single connection.
 *
 * Browsers cap HTTP/1.1 at six connections per host. One stream per watcher or process used to
 * exhaust that cap, which left every other request to the server queued behind them.
 * `ready` is sent once the server is listening, so nothing emitted after it is missed.
 */
export type RemoteSessionEvent =
    | { kind: 'ready' }
    | { kind: 'watch'; watcherId: string; event: WatchEvent }
    | { kind: 'output'; handleId: string; data: string };

/**
 * Transport injected by the host app (tRPC, fetch, …).
 * Keeps `@onlook/code-provider` free of Next/tRPC imports so it stays browser-safe.
 */
export interface RemoteCodeProviderRpc {
    createSession(input: {
        projectId: string;
        rootDir: string;
        tasks?: Record<string, string>;
        env?: Record<string, string>;
    }): Promise<RemoteSessionResult>;

    destroySession(input: { sessionId: string }): Promise<void>;

    writeFile(input: {
        sessionId: string;
        path: string;
        content: string | Uint8Array;
        overwrite?: boolean;
    }): Promise<WriteFileOutput>;

    readFile(input: { sessionId: string; path: string }): Promise<RemoteReadFileResult>;

    renameFile(input: {
        sessionId: string;
        oldPath: string;
        newPath: string;
    }): Promise<RenameFileOutput>;

    statFile(input: { sessionId: string; path: string }): Promise<StatFileOutput>;

    deleteFiles(input: {
        sessionId: string;
        path: string;
        recursive?: boolean;
    }): Promise<DeleteFilesOutput>;

    listFiles(input: { sessionId: string; path: string }): Promise<ListFilesOutput>;

    copyFiles(input: {
        sessionId: string;
        sourcePath: string;
        targetPath: string;
        recursive?: boolean;
        overwrite?: boolean;
    }): Promise<CopyFileOutput>;

    createDirectory(input: { sessionId: string; path: string }): Promise<CreateDirectoryOutput>;

    downloadFiles(input: { sessionId: string; path: string }): Promise<DownloadFilesOutput>;

    runCommand(input: { sessionId: string; command: string }): Promise<TerminalCommandOutput>;

    gitStatus(input: { sessionId: string }): Promise<GitStatusOutput>;

    ping(input: { sessionId: string }): Promise<{ ok: boolean }>;

    startWatch(input: {
        sessionId: string;
        path: string;
        recursive?: boolean;
        excludes?: string[];
    }): Promise<RemoteWatchStartResult>;

    stopWatch(input: { sessionId: string; watcherId: string }): Promise<void>;

    /** Returns an unsubscribe function. */
    subscribeWatch(
        input: { sessionId: string; watcherId: string },
        onEvent: (event: WatchEvent) => void,
        onError?: (error: Error) => void,
    ): () => void;

    createTerminal(input: { sessionId: string }): Promise<RemoteTerminalResult>;

    getTask(input: { sessionId: string; id: string }): Promise<RemoteTaskResult>;

    runBackgroundCommand(input: {
        sessionId: string;
        command: string;
    }): Promise<RemoteBackgroundResult>;

    processOpen(input: { sessionId: string; handleId: string }): Promise<{ output: string }>;

    processWrite(input: { sessionId: string; handleId: string; data: string }): Promise<void>;

    processRun(input: { sessionId: string; handleId: string; data?: string }): Promise<void>;

    processRestart(input: { sessionId: string; handleId: string }): Promise<void>;

    processStop(input: { sessionId: string; handleId: string }): Promise<void>;

    subscribeOutput(
        input: { sessionId: string; handleId: string },
        onData: (data: string) => void,
        onError?: (error: Error) => void,
    ): () => void;
}
