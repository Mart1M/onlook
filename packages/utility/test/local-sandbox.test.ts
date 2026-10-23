import { describe, expect, test } from 'bun:test';

import {
    isLocalSandboxId,
    LOCAL_SANDBOX_PREFIX,
    rootDirFromLocalSandboxId,
    toLocalSandboxId,
} from '../src/local-sandbox';

describe('local sandbox ids', () => {
    test('round-trips an absolute folder', () => {
        const id = toLocalSandboxId('/Users/me/onlook-workspace/app');

        expect(id).toBe(`${LOCAL_SANDBOX_PREFIX}/Users/me/onlook-workspace/app`);
        expect(isLocalSandboxId(id)).toBe(true);
        expect(rootDirFromLocalSandboxId(id)).toBe('/Users/me/onlook-workspace/app');
    });

    test('hosted sandbox ids are not local', () => {
        expect(isLocalSandboxId('abc123')).toBe(false);
        expect(rootDirFromLocalSandboxId('abc123')).toBeNull();
    });

    test('missing ids are not local', () => {
        expect(isLocalSandboxId(null)).toBe(false);
        expect(isLocalSandboxId(undefined)).toBe(false);
        expect(isLocalSandboxId('')).toBe(false);
    });

    test('a prefixed id without an absolute folder is rejected', () => {
        expect(rootDirFromLocalSandboxId('local:')).toBeNull();
        expect(rootDirFromLocalSandboxId('local:relative/path')).toBeNull();
        expect(isLocalSandboxId('local:../escape')).toBe(false);
    });

    test('the prefix must be at the start', () => {
        expect(isLocalSandboxId('notlocal:/tmp/app')).toBe(false);
    });
});
