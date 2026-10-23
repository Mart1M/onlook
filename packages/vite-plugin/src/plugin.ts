import { ONLOOK_DEV_PRELOAD_SCRIPT_SRC } from '@onlook/constants';

import { injectPreloadScriptIntoHtml } from './html';

export interface OnlookVitePluginOptions {
    /** Public URL of the preload script (default `/onlook-preload-script.js`). */
    scriptSrc?: string;
}

/**
 * Injects the penpal preload bridge via `transformIndexHtml` so Vite apps
 * never need a layout rewrite (ADR-005 / SID-26). User `index.html` on disk
 * stays untouched.
 */
export function onlookPreloadPlugin(options: OnlookVitePluginOptions = {}) {
    const scriptSrc = options.scriptSrc ?? ONLOOK_DEV_PRELOAD_SCRIPT_SRC;
    return {
        name: 'onlook-preload',
        enforce: 'pre' as const,
        transformIndexHtml(html: string) {
            return injectPreloadScriptIntoHtml(html, scriptSrc);
        },
    };
}

export default onlookPreloadPlugin;
