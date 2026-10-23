import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    __resetCodeProviderSessionsForTests,
    assertAllowedRootDir,
    createCodeProviderSession,
    destroyCodeProviderSession,
    getCodeProviderSession,
} from './session-store';

let tmp: string;

beforeEach(() => {
    // Sessions are refused without a workspace boundary, so every test works inside one.
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nodefs-ws-')));
    process.env.ONLOOK_WORKSPACE_ROOT = tmp;
});

afterEach(async () => {
    await __resetCodeProviderSessionsForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.ONLOOK_WORKSPACE_ROOT;
});

describe('assertAllowedRootDir', () => {
    test('rejects relative paths', async () => {
        await expect(assertAllowedRootDir('relative/path')).rejects.toThrow(/absolute/);
    });

    test('rejects missing directories', async () => {
        await expect(assertAllowedRootDir(path.join(tmp, 'does-not-exist'))).rejects.toThrow(
            /not a directory/,
        );
    });

    test('refuses every rootDir while ONLOOK_WORKSPACE_ROOT is unset', async () => {
        delete process.env.ONLOOK_WORKSPACE_ROOT;
        const dir = path.join(tmp, 'project');
        fs.mkdirSync(dir);

        await expect(assertAllowedRootDir(dir)).rejects.toThrow(/ONLOOK_WORKSPACE_ROOT must be set/);
        await expect(assertAllowedRootDir('/')).rejects.toThrow(/ONLOOK_WORKSPACE_ROOT must be set/);
        await expect(
            createCodeProviderSession({ userId: 'user-a', projectId: 'p', rootDir: dir }),
        ).rejects.toThrow(/ONLOOK_WORKSPACE_ROOT must be set/);
    });

    test('enforces ONLOOK_WORKSPACE_ROOT', async () => {
        const allowed = path.join(tmp, 'allowed');
        const outside = path.join(tmp, 'outside');
        fs.mkdirSync(allowed);
        fs.mkdirSync(outside);
        process.env.ONLOOK_WORKSPACE_ROOT = allowed;

        await expect(assertAllowedRootDir(outside)).rejects.toThrow(/outside ONLOOK_WORKSPACE_ROOT/);
        await expect(assertAllowedRootDir(allowed)).resolves.toBe(fs.realpathSync(allowed));
    });

    test('rejects the filesystem root and a parent of the workspace', async () => {
        const allowed = path.join(tmp, 'allowed');
        fs.mkdirSync(allowed);
        process.env.ONLOOK_WORKSPACE_ROOT = allowed;

        await expect(assertAllowedRootDir('/')).rejects.toThrow(/outside ONLOOK_WORKSPACE_ROOT/);
        await expect(assertAllowedRootDir(tmp)).rejects.toThrow(/outside ONLOOK_WORKSPACE_ROOT/);
    });

    test('rejects a symlink inside the workspace that points outside it', async () => {
        const allowed = path.join(tmp, 'allowed');
        const outside = path.join(tmp, 'outside');
        fs.mkdirSync(allowed);
        fs.mkdirSync(outside);
        fs.symlinkSync(outside, path.join(allowed, 'link'));
        process.env.ONLOOK_WORKSPACE_ROOT = allowed;

        await expect(assertAllowedRootDir(path.join(allowed, 'link'))).rejects.toThrow(
            /outside ONLOOK_WORKSPACE_ROOT/,
        );
    });

    test('accepts a directory whose name merely starts with two dots', async () => {
        const dotted = path.join(tmp, '..dotted');
        fs.mkdirSync(dotted);

        await expect(assertAllowedRootDir(dotted)).resolves.toBe(fs.realpathSync(dotted));
    });
});

describe('code provider sessions', () => {
    test('creates a session scoped to the user and rejects other users', async () => {
        const root = path.join(tmp, 'project');
        fs.mkdirSync(root);

        const session = await createCodeProviderSession({
            userId: 'user-a',
            projectId: '11111111-1111-1111-1111-111111111111',
            rootDir: root,
        });

        expect(getCodeProviderSession(session.id, 'user-a').id).toBe(session.id);
        expect(() => getCodeProviderSession(session.id, 'user-b')).toThrow(
            /Unauthorized or not found/,
        );

        await destroyCodeProviderSession(session.id, 'user-a');
        expect(() => getCodeProviderSession(session.id, 'user-a')).toThrow(
            /Unauthorized or not found/,
        );
    });

    test('provider read/write stays inside the session root', async () => {
        const root = path.join(tmp, 'project');
        fs.mkdirSync(root);

        const session = await createCodeProviderSession({
            userId: 'user-a',
            projectId: '11111111-1111-1111-1111-111111111111',
            rootDir: root,
        });

        await session.provider.writeFile({ args: { path: 'hello.txt', content: 'hi' } });
        const { file } = await session.provider.readFile({ args: { path: 'hello.txt' } });
        expect(file.content).toBe('hi');
        await expect(
            session.provider.readFile({ args: { path: '../secret.txt' } }),
        ).rejects.toThrow(/escapes/);
    });
});
