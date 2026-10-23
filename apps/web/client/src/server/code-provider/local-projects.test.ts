import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { inspectLocalProject, listLocalProjects } from './local-projects';

let workspace: string;

function writeProject(name: string, packageJson: object, extraFiles: string[] = []) {
    const dir = path.join(workspace, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson));
    for (const file of extraFiles) {
        fs.writeFileSync(path.join(dir, file), '');
    }
    return dir;
}

beforeEach(() => {
    workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-projects-')));
    process.env.ONLOOK_WORKSPACE_ROOT = workspace;
});

afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    delete process.env.ONLOOK_WORKSPACE_ROOT;
});

describe('listLocalProjects', () => {
    test('reports an unconfigured workspace instead of throwing', async () => {
        delete process.env.ONLOOK_WORKSPACE_ROOT;

        expect(await listLocalProjects()).toEqual({ workspaceRoot: null, projects: [] });
    });

    test('lists projects with their framework, sorted by name', async () => {
        writeProject('zeta-next', {
            dependencies: { next: '15.1.0' },
            scripts: { dev: 'next dev' },
        });
        writeProject('alpha-vite', {
            devDependencies: { vite: '^6.0.0' },
            scripts: { dev: 'vite' },
        });

        const { workspaceRoot, projects } = await listLocalProjects();

        expect(workspaceRoot).toBe(workspace);
        expect(projects.map((p) => p.name)).toEqual(['alpha-vite', 'zeta-next']);
        expect(projects[0]).toMatchObject({
            framework: 'vite',
            version: '^6.0.0',
            hasDev: true,
            port: 5173,
            url: 'http://localhost:5173/',
            rootDir: path.join(workspace, 'alpha-vite'),
        });
        expect(projects[1]).toMatchObject({ framework: 'next', port: 3000 });
    });

    test('uses a port declared in the dev script', async () => {
        writeProject('custom-port', {
            devDependencies: { vite: '^6.0.0' },
            scripts: { dev: 'vite --port 4321' },
        });

        const { projects } = await listLocalProjects();

        expect(projects[0]?.port).toBe(4321);
    });

    test('skips folders without package.json, hidden folders and node_modules', async () => {
        fs.mkdirSync(path.join(workspace, 'empty'));
        writeProject('.hidden', { scripts: { dev: 'vite' } });
        writeProject('node_modules', { scripts: { dev: 'vite' } });
        writeProject('real', { scripts: { dev: 'vite' } });
        fs.writeFileSync(path.join(workspace, 'loose-file.txt'), 'x');

        const { projects } = await listLocalProjects();

        expect(projects.map((p) => p.name)).toEqual(['real']);
    });

    test('does not list a symlink that points outside the workspace', async () => {
        const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-')));
        try {
            fs.writeFileSync(path.join(outside, 'package.json'), '{"scripts":{"dev":"vite"}}');
            fs.symlinkSync(outside, path.join(workspace, 'escape'));
            writeProject('inside', { scripts: { dev: 'vite' } });

            const { projects } = await listLocalProjects();

            expect(projects.map((p) => p.name)).toEqual(['inside']);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    test('does not return the contents of package.json', async () => {
        writeProject('app', { scripts: { dev: 'vite' } });

        const { projects } = await listLocalProjects();

        expect(projects[0]).not.toHaveProperty('packageJson');
        expect(projects[0]).not.toHaveProperty('lockfileNames');
    });
});

describe('inspectLocalProject', () => {
    test('returns package.json and the lockfiles that exist', async () => {
        const dir = writeProject(
            'app',
            { devDependencies: { vite: '^6.0.0' }, scripts: { dev: 'vite' } },
            ['bun.lock', 'package-lock.json'],
        );

        const result = await inspectLocalProject(dir);

        expect(JSON.parse(result.packageJson).scripts.dev).toBe('vite');
        expect(result.lockfileNames).toEqual(['bun.lock', 'package-lock.json']);
        expect(result.rootDir).toBe(dir);
    });

    test('rejects a folder outside the workspace', async () => {
        const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-')));
        try {
            fs.writeFileSync(path.join(outside, 'package.json'), '{}');

            await expect(inspectLocalProject(outside)).rejects.toThrow(
                /outside ONLOOK_WORKSPACE_ROOT/,
            );
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    test('rejects a folder without package.json', async () => {
        const dir = path.join(workspace, 'bare');
        fs.mkdirSync(dir);

        await expect(inspectLocalProject(dir)).rejects.toThrow(/No package.json/);
    });

    test('rejects a package.json that is a symlink to a file outside the folder', async () => {
        const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-')));
        try {
            const secret = path.join(outside, 'secret.json');
            fs.writeFileSync(secret, '{"secret":true}');
            const dir = path.join(workspace, 'linked');
            fs.mkdirSync(dir);
            fs.symlinkSync(secret, path.join(dir, 'package.json'));

            await expect(inspectLocalProject(dir)).rejects.toThrow(/No package.json/);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    test('refuses everything while ONLOOK_WORKSPACE_ROOT is unset', async () => {
        const dir = writeProject('app', { scripts: { dev: 'vite' } });
        delete process.env.ONLOOK_WORKSPACE_ROOT;

        await expect(inspectLocalProject(dir)).rejects.toThrow(/ONLOOK_WORKSPACE_ROOT must be set/);
    });
});
