import { afterEach, describe, expect, test } from 'bun:test';
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

afterEach(async () => {
    await __resetCodeProviderSessionsForTests();
    if (tmp && fs.existsSync(tmp)) {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    delete process.env.ONLOOK_WORKSPACE_ROOT;
});

describe('assertAllowedRootDir', () => {
    test('rejects relative paths', async () => {
        await expect(assertAllowedRootDir('relative/path')).rejects.toThrow(/absolute/);
    });

    test('rejects missing directories', async () => {
        await expect(assertAllowedRootDir('/tmp/does-not-exist-nodefs-sid24')).rejects.toThrow(
            /not a directory/,
        );
    });

    test('enforces ONLOOK_WORKSPACE_ROOT when set', async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodefs-ws-'));
        const allowed = path.join(tmp, 'allowed');
        const outside = path.join(tmp, 'outside');
        fs.mkdirSync(allowed);
        fs.mkdirSync(outside);
        process.env.ONLOOK_WORKSPACE_ROOT = allowed;

        await expect(assertAllowedRootDir(outside)).rejects.toThrow(/ONLOOK_WORKSPACE_ROOT/);
        await expect(assertAllowedRootDir(allowed)).resolves.toBe(fs.realpathSync(allowed));
    });
});

describe('code provider sessions', () => {
    test('creates a session scoped to the user and rejects other users', async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodefs-sess-'));
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
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodefs-rw-'));
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
