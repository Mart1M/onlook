import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { WatchEvent } from '../src/types';
import { NodeFsProvider } from '../src/providers/nodefs';

let tmp: string;
let root: string;
let provider: NodeFsProvider;

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nodefs-')));
    root = path.join(tmp, 'project');
    fs.mkdirSync(root);
    provider = new NodeFsProvider({ rootDir: root, tasks: { dev: 'echo dev-started; sleep 30' } });
    await provider.initialize({});
});

afterEach(async () => {
    await provider.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('files', () => {
    test('writes and reads text, creating parent directories', async () => {
        const res = await provider.writeFile({
            args: { path: 'src/app/page.tsx', content: 'hello' },
        });
        expect(res.success).toBe(true);
        expect(fs.readFileSync(path.join(root, 'src/app/page.tsx'), 'utf8')).toBe('hello');

        const { file } = await provider.readFile({ args: { path: 'src/app/page.tsx' } });
        expect(file.type).toBe('text');
        expect(file.content).toBe('hello');
        expect(file.toString()).toBe('hello');
    });

    test('treats a leading slash as the project root', async () => {
        await provider.writeFile({ args: { path: '/a.txt', content: 'x' } });
        expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(true);
    });

    test('round-trips binary content', async () => {
        const bytes = new Uint8Array([0, 1, 2, 255]);
        await provider.writeFile({ args: { path: 'img.bin', content: bytes } });
        const { file } = await provider.readFile({ args: { path: 'img.bin' } });
        expect(file.type).toBe('binary');
        expect(Array.from(file.content as Uint8Array)).toEqual([0, 1, 2, 255]);
        expect(file.toString()).toBe(Buffer.from(bytes).toString('base64'));
    });

    test('overwrite: false does not replace an existing file', async () => {
        await provider.writeFile({ args: { path: 'a.txt', content: 'one' } });
        const res = await provider.writeFile({
            args: { path: 'a.txt', content: 'two', overwrite: false },
        });
        expect(res.success).toBe(false);
        expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('one');
    });

    test('lists, stats, renames, copies and deletes', async () => {
        await provider.writeFile({ args: { path: 'dir/a.txt', content: 'a' } });

        const { files } = await provider.listFiles({ args: { path: '.' } });
        expect(files).toEqual([{ name: 'dir', type: 'directory', isSymlink: false }]);

        const stat = await provider.statFile({ args: { path: 'dir/a.txt' } });
        expect(stat.type).toBe('file');
        expect(stat.size).toBe(1);

        await provider.renameFile({ args: { oldPath: 'dir/a.txt', newPath: 'other/b.txt' } });
        expect(fs.existsSync(path.join(root, 'dir/a.txt'))).toBe(false);

        await provider.copyFiles({
            args: { sourcePath: 'other', targetPath: 'copy', recursive: true },
        });
        expect(fs.readFileSync(path.join(root, 'copy/b.txt'), 'utf8')).toBe('a');

        await provider.deleteFiles({ args: { path: 'copy', recursive: true } });
        expect(fs.existsSync(path.join(root, 'copy'))).toBe(false);
    });

    test('does not delete a non-empty directory without recursive', async () => {
        await provider.writeFile({ args: { path: 'dir/a.txt', content: 'a' } });
        await expect(provider.deleteFiles({ args: { path: 'dir' } })).rejects.toThrow();
        expect(fs.existsSync(path.join(root, 'dir/a.txt'))).toBe(true);
    });
});

describe('confinement', () => {
    test('rejects paths that leave the root', async () => {
        await expect(provider.readFile({ args: { path: '../outside.txt' } })).rejects.toThrow(
            /escapes/,
        );
        await expect(
            provider.writeFile({ args: { path: 'a/../../outside.txt', content: 'x' } }),
        ).rejects.toThrow(/escapes/);
        expect(fs.existsSync(path.join(tmp, 'outside.txt'))).toBe(false);
    });

    test('accepts names that merely start with two dots', async () => {
        await provider.writeFile({ args: { path: '..hidden', content: 'x' } });
        expect(fs.existsSync(path.join(root, '..hidden'))).toBe(true);
    });

    test('rejects symlinks pointing outside the root, including for new files', async () => {
        fs.writeFileSync(path.join(tmp, 'secret.txt'), 'secret');
        fs.mkdirSync(path.join(tmp, 'outside-dir'));
        fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(root, 'link.txt'));
        fs.symlinkSync(path.join(tmp, 'outside-dir'), path.join(root, 'linkdir'));

        await expect(provider.readFile({ args: { path: 'link.txt' } })).rejects.toThrow(/symlink/);
        await expect(
            provider.writeFile({ args: { path: 'linkdir/new.txt', content: 'x' } }),
        ).rejects.toThrow(/symlink/);
        expect(fs.existsSync(path.join(tmp, 'outside-dir/new.txt'))).toBe(false);
    });

    test('refuses to delete the project root', async () => {
        await expect(
            provider.deleteFiles({ args: { path: '.', recursive: true } }),
        ).rejects.toThrow(/root/);
        expect(fs.existsSync(root)).toBe(true);
    });

    test('requires initialize before use', async () => {
        const fresh = new NodeFsProvider({ rootDir: root });
        await expect(fresh.readFile({ args: { path: 'a' } })).rejects.toThrow(/not initialized/);
    });

    test('initialize fails when the root does not exist', async () => {
        const missing = new NodeFsProvider({ rootDir: path.join(tmp, 'missing') });
        await expect(missing.initialize({})).rejects.toThrow();
    });
});

describe('watching', () => {
    test('reports add, change and remove with root-relative paths, honoring excludes', async () => {
        fs.mkdirSync(path.join(root, 'node_modules'));
        const events: WatchEvent[] = [];
        const { watcher } = await provider.watchFiles({
            args: { path: './', recursive: true, excludes: ['node_modules', '**/*.log'] },
            onFileChange: async (event) => {
                events.push(event);
            },
        });

        // Native watchers (FSEvents) need a moment to start before they see changes.
        await new Promise((resolve) => setTimeout(resolve, 200));

        fs.writeFileSync(path.join(root, 'node_modules/ignored.js'), 'x');
        fs.writeFileSync(path.join(root, 'debug.log'), 'x');
        fs.writeFileSync(path.join(root, 'page.tsx'), 'one');
        await waitFor(() => events.some((e) => e.type === 'add' && e.paths[0] === 'page.tsx'));

        fs.writeFileSync(path.join(root, 'page.tsx'), 'two');
        await waitFor(() => events.some((e) => e.type === 'change' && e.paths[0] === 'page.tsx'));

        fs.rmSync(path.join(root, 'page.tsx'));
        await waitFor(() => events.some((e) => e.type === 'remove' && e.paths[0] === 'page.tsx'));

        expect(events.some((e) => e.paths[0]?.startsWith('node_modules'))).toBe(false);
        expect(events.some((e) => e.paths[0] === 'debug.log')).toBe(false);

        await watcher.stop();
    });
});

describe('commands', () => {
    test('runs in the project root and returns output', async () => {
        const { output } = await provider.runCommand({ args: { command: 'pwd' } });
        expect(output.trim()).toBe(root);
    });

    test('rejects with the output on a non-zero exit', async () => {
        await expect(
            provider.runCommand({ args: { command: 'echo boom; exit 3' } }),
        ).rejects.toThrow(/code 3[\s\S]*boom/);
    });

    test('does not leak the parent environment', async () => {
        process.env.NODEFS_TEST_SECRET = 'leak';
        try {
            const { output } = await provider.runCommand({
                args: { command: 'echo "[$NODEFS_TEST_SECRET]"' },
            });
            expect(output.trim()).toBe('[]');
        } finally {
            delete process.env.NODEFS_TEST_SECRET;
        }
    });

    test('passes configured env to commands', async () => {
        const withEnv = new NodeFsProvider({ rootDir: root, env: { FOO: 'bar' } });
        await withEnv.initialize({});
        const { output } = await withEnv.runCommand({ args: { command: 'echo $FOO' } });
        expect(output.trim()).toBe('bar');
    });

    test('background commands stream output and are killed with their process group', async () => {
        const { command } = await provider.runBackgroundCommand({
            args: { command: 'echo started; sleep 30' },
        });
        let output = '';
        command.onOutput((data) => {
            output += data;
        });
        await waitFor(() => output.includes('started'));
        expect(await command.open()).toContain('started');
        await command.kill();
    });

    test('tasks come from options and can be run, restarted and stopped', async () => {
        const { task } = await provider.getTask({ args: { id: 'dev' } });
        expect(task.command).toBe('echo dev-started; sleep 30');
        let output = '';
        task.onOutput((data) => {
            output += data;
        });
        await task.run();
        await waitFor(() => output.includes('dev-started'));
        expect(await task.open()).toContain('dev-started');
        await task.restart();
        await task.stop();
        await expect(provider.getTask({ args: { id: 'missing' } })).rejects.toThrow(/not found/);
    });

    test('terminal runs input in a shell', async () => {
        const { terminal } = await provider.createTerminal({});
        let output = '';
        terminal.onOutput((data) => {
            output += data;
        });
        await terminal.open();
        await terminal.run('echo from-terminal');
        await waitFor(() => output.includes('from-terminal'));
        await terminal.kill();
    });
});

describe('git', () => {
    test('lists changed files, including untracked, modified and renamed', async () => {
        const git = (...args: string[]) =>
            execFileSync('git', args, {
                cwd: root,
                stdio: 'ignore',
                env: {
                    ...process.env,
                    GIT_CONFIG_GLOBAL: '/dev/null',
                    GIT_CONFIG_SYSTEM: '/dev/null',
                },
            });
        git('init', '-q');
        git('config', 'user.email', 'test@example.com');
        git('config', 'user.name', 'Test');
        fs.writeFileSync(path.join(root, 'a.txt'), 'a');
        fs.writeFileSync(path.join(root, 'b.txt'), 'b');
        git('add', '.');
        git('commit', '-qm', 'init');

        fs.writeFileSync(path.join(root, 'a.txt'), 'changed');
        git('mv', 'b.txt', 'c.txt');
        fs.writeFileSync(path.join(root, 'new file.txt'), 'n');

        const { changedFiles } = await provider.gitStatus({});
        expect(changedFiles.sort()).toEqual(['a.txt', 'c.txt', 'new file.txt']);
    });
});
