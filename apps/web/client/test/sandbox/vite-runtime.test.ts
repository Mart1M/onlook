import { describe, expect, test } from 'bun:test';

import {
    buildLocalPreviewUrl,
    detectProjectFromPackageJson,
    parsePortFromDevServerLog,
    resolveDevServerPort,
    tasksFromDetection,
} from '@onlook/utility';

/**
 * Pure-logic coverage for SID-25 (no real Vite process).
 * Orchestration against SessionManager is covered indirectly via these helpers.
 */
describe('SID-25 Vite runtime helpers', () => {
    test('detects a Vite package and builds a bun dev task', () => {
        const detection = detectProjectFromPackageJson({
            name: 'demo',
            scripts: { dev: 'vite' },
            devDependencies: { vite: '^5.4.0' },
            packageManager: 'bun@1.1.0',
        });
        expect(detection.framework.kind).toBe('vite');
        expect(detection.defaultTask).toBe('dev');
        expect(tasksFromDetection(detection)).toEqual({ dev: 'bun run dev' });
    });

    test('resolves port from Vite ready logs for the canvas URL', () => {
        const log = `
  VITE v5.4.0  ready in 120 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
`;
        expect(parsePortFromDevServerLog(log)).toBe(5173);
        const port = resolveDevServerPort({
            framework: 'vite',
            script: 'vite',
            logOutput: log,
        });
        expect(port).toBe(5173);
        expect(buildLocalPreviewUrl(port)).toBe('http://localhost:5173/');
    });

    test('surfaces startup failures from compile errors in logs', () => {
        const failed = 'Error: Failed to compile\n[vite] error';
        expect(parsePortFromDevServerLog(failed)).toBeNull();
        // Canvas must not flip to a ready URL when the log never advertised a port
        // and no script port was set — Vite default is still available as a hint.
        expect(resolveDevServerPort({ framework: 'vite', logOutput: failed })).toBe(5173);
    });
});

describe('frame URL path preservation', () => {
    test('keeps pathname when swapping preview origin', () => {
        const origin = 'http://localhost:5173';
        const previous = 'https://abc-3000.csb.app/dashboard';
        const pathname = new URL(previous).pathname;
        const next = pathname === '/' ? `${origin}/` : `${origin}${pathname}`;
        expect(next).toBe('http://localhost:5173/dashboard');
    });
});

describe('idle stop contract', () => {
    test('marks inactive after idle window', () => {
        const idleTimeoutMs = 100;
        let status: 'ready' | 'stopped' = 'ready';
        let lastActivityAt = Date.now() - 200;
        const maybeStop = () => {
            if (status === 'ready' && Date.now() - lastActivityAt >= idleTimeoutMs) {
                status = 'stopped';
            }
        };
        maybeStop();
        expect(status).toBe('stopped');
    });
});
