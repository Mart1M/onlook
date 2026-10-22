import { describe, expect, test } from 'bun:test';

import {
    buildDevTaskCommand,
    buildLocalPreviewUrl,
    detectPortFromDevScript,
    parsePortFromDevServerLog,
    resolveDevServerPort,
    tasksFromDetection,
} from '../src/dev-server';
import type { ProjectDetection } from '../src/project-detection';

describe('detectPortFromDevScript', () => {
    test('reads --port, -p and PORT=', () => {
        expect(detectPortFromDevScript('vite --port 4173')).toBe(4173);
        expect(detectPortFromDevScript('vite -p 4000')).toBe(4000);
        expect(detectPortFromDevScript('PORT=8080 next dev')).toBe(8080);
        expect(detectPortFromDevScript('vite')).toBeNull();
    });
});

describe('parsePortFromDevServerLog', () => {
    test('parses Vite and Next Local banners', () => {
        expect(
            parsePortFromDevServerLog('  ➜  Local:   http://localhost:5173/\n'),
        ).toBe(5173);
        expect(
            parsePortFromDevServerLog('  - Local:        http://localhost:3000\n'),
        ).toBe(3000);
        expect(parsePortFromDevServerLog('still starting...')).toBeNull();
    });
});

describe('resolveDevServerPort', () => {
    test('prefers log, then script, then framework default', () => {
        expect(
            resolveDevServerPort({
                framework: 'vite',
                script: 'vite --port 4000',
                logOutput: 'Local: http://localhost:5177/',
            }),
        ).toBe(5177);
        expect(resolveDevServerPort({ framework: 'vite', script: 'vite --port 4000' })).toBe(4000);
        expect(resolveDevServerPort({ framework: 'vite' })).toBe(5173);
        expect(resolveDevServerPort({ framework: 'next' })).toBe(3000);
    });
});

describe('buildLocalPreviewUrl / tasksFromDetection', () => {
    test('builds canvas URL and package-manager task map', () => {
        expect(buildLocalPreviewUrl(5173)).toBe('http://localhost:5173/');
        expect(buildLocalPreviewUrl(3000, { pathname: '/about' })).toBe(
            'http://localhost:3000/about',
        );

        const detection: ProjectDetection = {
            name: 'demo',
            framework: { kind: 'vite', version: '^5', packageName: 'vite' },
            scripts: {
                available: { dev: 'vite' },
                hasDev: true,
                hasBuild: false,
                dev: 'vite',
                build: null,
            },
            packageManager: 'bun',
            defaultTask: 'dev',
        };
        expect(buildDevTaskCommand(detection)).toBe('bun run dev');
        expect(tasksFromDetection(detection)).toEqual({ dev: 'bun run dev' });
    });
});
