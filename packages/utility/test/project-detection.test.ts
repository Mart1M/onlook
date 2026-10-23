import { describe, expect, test } from 'bun:test';
import { detectProjectFromPackageJson } from '../src/project-detection';

describe('detectProjectFromPackageJson', () => {
    test('returns unknowns for invalid JSON string', () => {
        const result = detectProjectFromPackageJson('{ invalid');
        expect(result.framework.kind).toBe('unknown');
        expect(result.scripts.hasDev).toBe(false);
        expect(result.packageManager).toBe('unknown');
        expect(result.defaultTask).toBeNull();
    });

    test('returns unknowns for empty object', () => {
        const result = detectProjectFromPackageJson({});
        expect(result.name).toBeNull();
        expect(result.framework).toEqual({
            kind: 'unknown',
            version: null,
            packageName: null,
        });
        expect(result.scripts.available).toEqual({});
        expect(result.defaultTask).toBeNull();
    });

    test('detects Vite from dependencies with version and scripts', () => {
        const result = detectProjectFromPackageJson({
            name: 'vite-app',
            dependencies: {
                react: '^19.0.0',
            },
            devDependencies: {
                vite: '^5.4.2',
            },
            scripts: {
                dev: 'vite',
                build: 'vite build',
                preview: 'vite preview',
            },
        });

        expect(result.name).toBe('vite-app');
        expect(result.framework).toEqual({
            kind: 'vite',
            version: '^5.4.2',
            packageName: 'vite',
        });
        expect(result.scripts.hasDev).toBe(true);
        expect(result.scripts.hasBuild).toBe(true);
        expect(result.scripts.dev).toBe('vite');
        expect(result.scripts.build).toBe('vite build');
        expect(result.scripts.available.preview).toBe('vite preview');
        expect(result.defaultTask).toBe('dev');
    });

    test('detects Next.js and prefers it over Vite when both are present', () => {
        const result = detectProjectFromPackageJson({
            dependencies: {
                next: '15.1.0',
                react: '^19.0.0',
            },
            devDependencies: {
                vite: '^6.0.0',
            },
            scripts: {
                dev: 'next dev',
                build: 'next build',
            },
        });

        expect(result.framework).toEqual({
            kind: 'next',
            version: '15.1.0',
            packageName: 'next',
        });
        expect(result.defaultTask).toBe('dev');
    });

    test('parses package.json string content', () => {
        const result = detectProjectFromPackageJson(
            JSON.stringify({
                dependencies: { next: '^14.2.0' },
                scripts: { dev: 'next dev -p 3000' },
            }),
        );

        expect(result.framework.kind).toBe('next');
        expect(result.framework.version).toBe('^14.2.0');
        expect(result.scripts.dev).toBe('next dev -p 3000');
        expect(result.defaultTask).toBe('dev');
    });

    test('defaultTask is null when scripts.dev is missing', () => {
        const result = detectProjectFromPackageJson({
            dependencies: { vite: '5.0.0' },
            scripts: { build: 'vite build' },
        });

        expect(result.framework.kind).toBe('vite');
        expect(result.scripts.hasBuild).toBe(true);
        expect(result.scripts.hasDev).toBe(false);
        expect(result.defaultTask).toBeNull();
    });

    test('ignores non-string script values', () => {
        const result = detectProjectFromPackageJson({
            scripts: {
                dev: 'vite',
                build: { nested: true },
            } as Record<string, unknown>,
        });

        expect(result.scripts.dev).toBe('vite');
        expect(result.scripts.build).toBeNull();
        expect(result.scripts.hasBuild).toBe(false);
        expect(result.defaultTask).toBe('dev');
    });

    test('detects packageManager field (bun)', () => {
        const result = detectProjectFromPackageJson({
            packageManager: 'bun@1.2.5',
            scripts: { dev: 'vite' },
            devDependencies: { vite: '6.0.0' },
        });

        expect(result.packageManager).toBe('bun');
    });

    test('detects packageManager field variants', () => {
        expect(
            detectProjectFromPackageJson({ packageManager: 'pnpm@9.12.0' }).packageManager,
        ).toBe('pnpm');
        expect(detectProjectFromPackageJson({ packageManager: 'yarn@4.0.0' }).packageManager).toBe(
            'yarn',
        );
        expect(detectProjectFromPackageJson({ packageManager: 'npm@10.0.0' }).packageManager).toBe(
            'npm',
        );
    });

    test('falls back to lockfile names when packageManager is absent', () => {
        expect(
            detectProjectFromPackageJson(
                { name: 'app' },
                { lockfileNames: ['bun.lock'] },
            ).packageManager,
        ).toBe('bun');
        expect(
            detectProjectFromPackageJson(
                { name: 'app' },
                { lockfileNames: ['bun.lockb'] },
            ).packageManager,
        ).toBe('bun');
        expect(
            detectProjectFromPackageJson(
                { name: 'app' },
                { lockfileNames: ['pnpm-lock.yaml'] },
            ).packageManager,
        ).toBe('pnpm');
        expect(
            detectProjectFromPackageJson(
                { name: 'app' },
                { lockfileNames: ['yarn.lock'] },
            ).packageManager,
        ).toBe('yarn');
        expect(
            detectProjectFromPackageJson(
                { name: 'app' },
                { lockfileNames: ['package-lock.json'] },
            ).packageManager,
        ).toBe('npm');
    });

    test('packageManager field takes precedence over lockfiles', () => {
        const result = detectProjectFromPackageJson(
            { packageManager: 'pnpm@9.0.0' },
            { lockfileNames: ['bun.lock', 'package-lock.json'] },
        );
        expect(result.packageManager).toBe('pnpm');
    });

    test('prefers bun lockfile over package-lock.json', () => {
        const result = detectProjectFromPackageJson(
            {},
            { lockfileNames: ['package-lock.json', 'bun.lock'] },
        );
        expect(result.packageManager).toBe('bun');
    });

    test('vite in dependencies (not only devDependencies)', () => {
        const result = detectProjectFromPackageJson({
            dependencies: { vite: '5.3.1' },
        });
        expect(result.framework.kind).toBe('vite');
        expect(result.framework.version).toBe('5.3.1');
    });
});
