import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
    buildLocalPreviewUrl,
    detectProjectFromPackageJson,
    resolveDevServerPort,
    type FrameworkKind,
} from '@onlook/utility';

import { assertAllowedRootDir } from './session-store';

const LOCKFILE_NAMES = ['bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];
const MAX_ENTRIES = 200;

export interface LocalProjectSummary {
    /** Folder name, shown in the picker. */
    name: string;
    /** Real absolute path, guaranteed to be inside ONLOOK_WORKSPACE_ROOT. */
    rootDir: string;
    framework: FrameworkKind;
    version: string | null;
    hasDev: boolean;
    /** Expected dev server port before the server reports its real one. */
    port: number;
    url: string;
}

export interface LocalProjectInspection extends LocalProjectSummary {
    packageJson: string;
    lockfileNames: string[];
}

function isInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Reads package.json and lockfile names from a folder under ONLOOK_WORKSPACE_ROOT.
 * Throws if the folder is outside the workspace or has no package.json.
 */
export async function inspectLocalProject(rootDir: string): Promise<LocalProjectInspection> {
    const real = await assertAllowedRootDir(rootDir);

    // A package.json that is a symlink to a file outside the folder must not be readable.
    const packageJsonPath = await fs.realpath(path.join(real, 'package.json')).catch(() => null);
    if (!packageJsonPath || !isInside(real, packageJsonPath)) {
        throw new Error(`No package.json found in ${path.basename(real)}`);
    }
    const packageJson = await fs.readFile(packageJsonPath, 'utf8');

    const lockfileNames: string[] = [];
    for (const name of LOCKFILE_NAMES) {
        const exists = await fs
            .access(path.join(real, name))
            .then(() => true)
            .catch(() => false);
        if (exists) {
            lockfileNames.push(name);
        }
    }

    const detection = detectProjectFromPackageJson(packageJson, { lockfileNames });
    const port = resolveDevServerPort({
        framework: detection.framework.kind,
        script: detection.scripts.dev,
    });

    return {
        name: path.basename(real),
        rootDir: real,
        framework: detection.framework.kind,
        version: detection.framework.version,
        hasDev: detection.scripts.hasDev,
        port,
        url: buildLocalPreviewUrl(port),
        packageJson,
        lockfileNames,
    };
}

/**
 * Lists the direct subfolders of ONLOOK_WORKSPACE_ROOT that look like JavaScript projects.
 * `workspaceRoot` is null when the variable is not configured, so the UI can say so.
 */
export async function listLocalProjects(): Promise<{
    workspaceRoot: string | null;
    projects: LocalProjectSummary[];
}> {
    const raw = process.env.ONLOOK_WORKSPACE_ROOT;
    if (!raw) {
        return { workspaceRoot: null, projects: [] };
    }
    const workspaceRoot = path.resolve(raw);
    const entries = await fs.readdir(workspaceRoot, { withFileTypes: true }).catch(() => []);

    const projects: LocalProjectSummary[] = [];
    for (const entry of entries) {
        if (projects.length >= MAX_ENTRIES) {
            break;
        }
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
        }
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
            continue;
        }
        try {
            const { packageJson: _packageJson, lockfileNames: _lockfileNames, ...summary } =
                await inspectLocalProject(path.join(workspaceRoot, entry.name));
            projects.push(summary);
        } catch {
            // Not a project, or outside the workspace (a symlink pointing elsewhere): not listed.
        }
    }

    projects.sort((a, b) => a.name.localeCompare(b.name));
    return { workspaceRoot, projects };
}
