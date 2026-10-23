import type { FrameworkKind, PackageManagerKind, ProjectDetection } from './project-detection';

const DEFAULT_VITE_PORT = 5173;
const DEFAULT_NEXT_PORT = 3000;
const DEFAULT_PORT = 3000;

/** Extract an explicit port from a `scripts.dev` (or similar) command string. */
export function detectPortFromDevScript(script: string | null | undefined): number | null {
    if (!script) {
        return null;
    }
    const portRegex = /(?:PORT=|--port[=\s]|-p\s*)(\d+)/;
    const match = portRegex.exec(script);
    if (!match?.[1]) {
        return null;
    }
    const port = Number.parseInt(match[1], 10);
    if (port > 0 && port <= 65535) {
        return port;
    }
    return null;
}

/**
 * Parse the listening port from Vite / Next / similar ready banners.
 * Matches lines like `Local: http://localhost:5173/` and `http://127.0.0.1:3000`.
 */
export function parsePortFromDevServerLog(output: string): number | null {
    const patterns = [
        /Local:\s+https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
        /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i,
        /ready on (?:port )?(\d+)/i,
        /listening (?:on|at).*?:(\d+)/i,
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(output);
        if (match?.[1]) {
            const port = Number.parseInt(match[1], 10);
            if (port > 0 && port <= 65535) {
                return port;
            }
        }
    }
    return null;
}

export function defaultPortForFramework(framework: FrameworkKind): number {
    if (framework === 'vite') {
        return DEFAULT_VITE_PORT;
    }
    if (framework === 'next') {
        return DEFAULT_NEXT_PORT;
    }
    return DEFAULT_PORT;
}

/**
 * Prefer a port seen in server logs, then an explicit script flag, then framework default.
 */
export function resolveDevServerPort(input: {
    framework: FrameworkKind;
    script?: string | null;
    logOutput?: string | null;
}): number {
    const fromLog = input.logOutput ? parsePortFromDevServerLog(input.logOutput) : null;
    if (fromLog !== null) {
        return fromLog;
    }
    const fromScript = detectPortFromDevScript(input.script);
    if (fromScript !== null) {
        return fromScript;
    }
    return defaultPortForFramework(input.framework);
}

export function buildLocalPreviewUrl(
    port: number,
    options: { host?: string; protocol?: 'http' | 'https'; pathname?: string } = {},
): string {
    const host = options.host ?? 'localhost';
    const protocol = options.protocol ?? 'http';
    const pathname = options.pathname ?? '/';
    const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return `${protocol}://${host}:${port}${path === '/' ? '/' : path}`;
}

/** Shell command to run the detected `dev` script with the right package manager. */
export function buildDevTaskCommand(detection: ProjectDetection): string | null {
    if (!detection.scripts.dev) {
        return null;
    }
    return packageManagerRun(detection.packageManager, 'dev');
}

export function packageManagerRun(pm: PackageManagerKind, scriptName: string): string {
    switch (pm) {
        case 'bun':
            return `bun run ${scriptName}`;
        case 'pnpm':
            return `pnpm run ${scriptName}`;
        case 'yarn':
            return `yarn ${scriptName}`;
        case 'npm':
            return `npm run ${scriptName}`;
        default:
            return `npm run ${scriptName}`;
    }
}

export function tasksFromDetection(detection: ProjectDetection): Record<string, string> | null {
    const command = buildDevTaskCommand(detection);
    if (!command || !detection.defaultTask) {
        return null;
    }
    return { [detection.defaultTask]: command };
}
