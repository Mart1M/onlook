/**
 * A branch backed by a folder on the host rather than a hosted sandbox stores
 * `local:<absolute path>` in its sandbox id. The prefix is how the editor decides
 * between the local NodeFs runtime and a CodeSandbox session.
 */
export const LOCAL_SANDBOX_PREFIX = 'local:';

export function toLocalSandboxId(rootDir: string): string {
    return `${LOCAL_SANDBOX_PREFIX}${rootDir}`;
}

export function isLocalSandboxId(sandboxId: string | null | undefined): boolean {
    return rootDirFromLocalSandboxId(sandboxId) !== null;
}

/** Returns the folder of a local sandbox id, or null for hosted ids and malformed local ids. */
export function rootDirFromLocalSandboxId(sandboxId: string | null | undefined): string | null {
    if (!sandboxId?.startsWith(LOCAL_SANDBOX_PREFIX)) {
        return null;
    }
    const rootDir = sandboxId.slice(LOCAL_SANDBOX_PREFIX.length);
    // The server rejects anything that is not absolute; refuse it here so a hosted id that happens
    // to start with the prefix, or a truncated value, never reaches the local runtime.
    return rootDir.startsWith('/') ? rootDir : null;
}
