/**
 * Detect framework, scripts, and package manager from package.json (PRD §5.3 / SID-27).
 * Pure helpers for local runtime task setup (default task: `dev`).
 */

export type FrameworkKind = 'vite' | 'next' | 'unknown';

export type PackageManagerKind = 'bun' | 'npm' | 'pnpm' | 'yarn' | 'unknown';

export interface DetectedFramework {
    kind: FrameworkKind;
    /** Raw version range from package.json (e.g. `^5.4.0`), or null if missing. */
    version: string | null;
    /** Dependency package name when known (`vite` | `next`). */
    packageName: 'vite' | 'next' | null;
}

export interface ProjectScripts {
    /** All string scripts from package.json. */
    available: Record<string, string>;
    hasDev: boolean;
    hasBuild: boolean;
    dev: string | null;
    build: string | null;
}

export interface ProjectDetection {
    name: string | null;
    framework: DetectedFramework;
    scripts: ProjectScripts;
    packageManager: PackageManagerKind;
    /**
     * Suggested provider task id. Prefer `dev` when a `scripts.dev` entry exists.
     */
    defaultTask: 'dev' | null;
}

export interface DetectProjectOptions {
    /**
     * Lockfile basenames present next to package.json
     * (e.g. `bun.lock`, `pnpm-lock.yaml`). Used when `packageManager` is unset.
     */
    lockfileNames?: readonly string[];
}

const UNKNOWN_FRAMEWORK: DetectedFramework = {
    kind: 'unknown',
    version: null,
    packageName: null,
};

const EMPTY_SCRIPTS: ProjectScripts = {
    available: {},
    hasDev: false,
    hasBuild: false,
    dev: null,
    build: null,
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function stringScripts(scripts: unknown): Record<string, string> {
    const record = asRecord(scripts);
    if (!record) {
        return {};
    }

    const available: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'string' && value.length > 0) {
            available[key] = value;
        }
    }
    return available;
}

function depVersion(
    dependencies: Record<string, unknown> | null,
    devDependencies: Record<string, unknown> | null,
    name: string,
): string | null {
    const fromDeps = dependencies?.[name];
    if (typeof fromDeps === 'string' && fromDeps.length > 0) {
        return fromDeps;
    }
    const fromDev = devDependencies?.[name];
    if (typeof fromDev === 'string' && fromDev.length > 0) {
        return fromDev;
    }
    return null;
}

function detectFramework(
    dependencies: Record<string, unknown> | null,
    devDependencies: Record<string, unknown> | null,
): DetectedFramework {
    const nextVersion = depVersion(dependencies, devDependencies, 'next');
    if (nextVersion) {
        return {
            kind: 'next',
            version: nextVersion,
            packageName: 'next',
        };
    }

    const viteVersion = depVersion(dependencies, devDependencies, 'vite');
    if (viteVersion) {
        return {
            kind: 'vite',
            version: viteVersion,
            packageName: 'vite',
        };
    }

    return UNKNOWN_FRAMEWORK;
}

function parsePackageManagerField(value: unknown): PackageManagerKind | null {
    if (typeof value !== 'string' || value.length === 0) {
        return null;
    }

    const name = value.split('@')[0]?.trim().toLowerCase();
    switch (name) {
        case 'bun':
            return 'bun';
        case 'npm':
            return 'npm';
        case 'pnpm':
            return 'pnpm';
        case 'yarn':
            return 'yarn';
        default:
            return null;
    }
}

function detectPackageManagerFromLockfiles(
    lockfileNames: readonly string[] | undefined,
): PackageManagerKind | null {
    if (!lockfileNames?.length) {
        return null;
    }

    const names = new Set(lockfileNames.map((n) => n.toLowerCase()));

    // Prefer Bun when both Bun and npm lockfiles exist (common after `bun install`).
    if (names.has('bun.lock') || names.has('bun.lockb')) {
        return 'bun';
    }
    if (names.has('pnpm-lock.yaml')) {
        return 'pnpm';
    }
    if (names.has('yarn.lock')) {
        return 'yarn';
    }
    if (names.has('package-lock.json')) {
        return 'npm';
    }

    return null;
}

function detectPackageManager(
    pkg: Record<string, unknown>,
    lockfileNames: readonly string[] | undefined,
): PackageManagerKind {
    return (
        parsePackageManagerField(pkg.packageManager) ??
        detectPackageManagerFromLockfiles(lockfileNames) ??
        'unknown'
    );
}

function buildScripts(available: Record<string, string>): ProjectScripts {
    const dev = available.dev ?? null;
    const build = available.build ?? null;
    return {
        available,
        hasDev: dev !== null,
        hasBuild: build !== null,
        dev,
        build,
    };
}

function parsePackageJson(
    packageJson: string | Record<string, unknown>,
): Record<string, unknown> | null {
    if (typeof packageJson === 'string') {
        try {
            const parsed: unknown = JSON.parse(packageJson);
            return asRecord(parsed);
        } catch {
            return null;
        }
    }
    return asRecord(packageJson);
}

/**
 * Inspect package.json (and optional lockfile names) to choose framework,
 * scripts, package manager, and the default `dev` task.
 */
export function detectProjectFromPackageJson(
    packageJson: string | Record<string, unknown>,
    options: DetectProjectOptions = {},
): ProjectDetection {
    const pkg = parsePackageJson(packageJson);
    if (!pkg) {
        return {
            name: null,
            framework: UNKNOWN_FRAMEWORK,
            scripts: EMPTY_SCRIPTS,
            packageManager: detectPackageManagerFromLockfiles(options.lockfileNames) ?? 'unknown',
            defaultTask: null,
        };
    }

    const dependencies = asRecord(pkg.dependencies);
    const devDependencies = asRecord(pkg.devDependencies);
    const scripts = buildScripts(stringScripts(pkg.scripts));
    const framework = detectFramework(dependencies, devDependencies);
    const packageManager = detectPackageManager(pkg, options.lockfileNames);
    const name = typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : null;

    return {
        name,
        framework,
        scripts,
        packageManager,
        defaultTask: scripts.hasDev ? 'dev' : null,
    };
}
