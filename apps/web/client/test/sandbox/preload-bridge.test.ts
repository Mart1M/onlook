import { describe, expect, test } from 'bun:test';

import { bridgeTargetFromDetection } from '../../src/components/store/editor/sandbox/preload-script';
import { detectProjectFromPackageJson } from '@onlook/utility';
import { injectPreloadScriptIntoHtml } from '@onlook/vite-plugin';

describe('SID-26 bridge target', () => {
    test('routes Vite projects to the non-layout injection path', () => {
        const detection = detectProjectFromPackageJson({
            name: 'vite-app',
            scripts: { dev: 'vite' },
            devDependencies: { vite: '^6.0.0' },
        });
        expect(bridgeTargetFromDetection(detection)).toBe('vite');
    });

    test('keeps Next on the layout injection path', () => {
        const detection = detectProjectFromPackageJson({
            name: 'next-app',
            scripts: { dev: 'next dev' },
            dependencies: { next: '15.0.0' },
        });
        expect(bridgeTargetFromDetection(detection)).toBe('next');
    });

    test('HTML injection leaves the original string unchanged (no disk rewrite)', () => {
        const original = '<!doctype html><html><body><div id="app"></div></body></html>';
        const snapshot = original;
        const injected = injectPreloadScriptIntoHtml(original);
        expect(original).toBe(snapshot);
        expect(injected).toContain('onlook-preload-script');
        expect(injected).not.toBe(original);
    });
});
