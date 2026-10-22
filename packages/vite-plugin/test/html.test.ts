import { describe, expect, test } from 'bun:test';

import {
    hasOnlookPreloadScript,
    injectPreloadScriptIntoHtml,
    ONLOOK_PRELOAD_SCRIPT_ID,
} from '../src/html';
import {
    buildOnlookViteConfigSource,
    ONLOOK_VITE_CONFIG_PATH,
    viteDevCommandWithOnlookConfig,
} from '../src/config-wrapper';

describe('injectPreloadScriptIntoHtml', () => {
    test('injects before </body> without touching the rest of the document', () => {
        const html = `<!doctype html>
<html>
  <head><title>demo</title></head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
        const next = injectPreloadScriptIntoHtml(html);
        expect(next).toContain(`id="${ONLOOK_PRELOAD_SCRIPT_ID}"`);
        expect(next).toContain('src="/onlook-preload-script.js"');
        expect(next).toContain('<div id="root"></div>');
        expect(next.indexOf('onlook-preload-script')).toBeLessThan(next.indexOf('</body>'));
        // Original document still present — injection is string-level, disk file unchanged by design.
        expect(html).not.toContain('onlook-preload-script');
    });

    test('is idempotent', () => {
        const html = `<html><body><h1>x</h1></body></html>`;
        const once = injectPreloadScriptIntoHtml(html);
        const twice = injectPreloadScriptIntoHtml(once);
        expect(twice).toBe(once);
        expect(hasOnlookPreloadScript(twice)).toBe(true);
    });
});

describe('onlook vite config wrapper', () => {
    test('embeds transformIndexHtml plugin and points at .onlook path', () => {
        const source = buildOnlookViteConfigSource();
        expect(source).toContain('onlook-preload');
        expect(source).toContain('transformIndexHtml');
        expect(source).toContain('/onlook-preload-script.js');
        expect(ONLOOK_VITE_CONFIG_PATH).toBe('.onlook/vite.config.mjs');
        expect(viteDevCommandWithOnlookConfig('bun run')).toBe(
            'bunx vite --config .onlook/vite.config.mjs',
        );
    });
});
