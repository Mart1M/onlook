import {
    DEPRECATED_PRELOAD_SCRIPT_SRCS,
    ONLOOK_DEV_PRELOAD_SCRIPT_SRC,
    ONLOOK_PRELOAD_SCRIPT_FILE,
} from '@onlook/constants';

export const ONLOOK_PRELOAD_SCRIPT_ID = 'onlook-preload-script';

export function preloadScriptTag(
    src: string = ONLOOK_DEV_PRELOAD_SCRIPT_SRC,
): string {
    return `<script type="module" src="${src}" id="${ONLOOK_PRELOAD_SCRIPT_ID}"></script>`;
}

/**
 * Inject the Onlook preload bridge into an HTML document string.
 * Idempotent; does not require Next.js layout or `next/script`.
 */
export function injectPreloadScriptIntoHtml(
    html: string,
    src: string = ONLOOK_DEV_PRELOAD_SCRIPT_SRC,
): string {
    let next = html;
    for (const deprecated of DEPRECATED_PRELOAD_SCRIPT_SRCS) {
        // Do not strip the src we are about to inject (env flips which CDN/local is "deprecated").
        if (deprecated === src) {
            continue;
        }
        next = next.replace(
            new RegExp(
                `<script\\b[^>]*\\bsrc=["']${escapeRegExp(deprecated)}["'][^>]*>\\s*</script>`,
                'gi',
            ),
            '',
        );
    }

    if (
        next.includes(`id="${ONLOOK_PRELOAD_SCRIPT_ID}"`) ||
        next.includes(`id='${ONLOOK_PRELOAD_SCRIPT_ID}'`) ||
        next.includes(`src="${src}"`) ||
        next.includes(`src='${src}'`)
    ) {
        return next;
    }

    const tag = preloadScriptTag(src);
    if (/<\/body>/i.test(next)) {
        return next.replace(/<\/body>/i, `  ${tag}\n</body>`);
    }
    if (/<\/html>/i.test(next)) {
        return next.replace(/<\/html>/i, `  ${tag}\n</html>`);
    }
    return `${next}\n${tag}\n`;
}

export function hasOnlookPreloadScript(html: string): boolean {
    return (
        html.includes(ONLOOK_PRELOAD_SCRIPT_ID) ||
        html.includes(ONLOOK_PRELOAD_SCRIPT_FILE) ||
        html.includes(ONLOOK_DEV_PRELOAD_SCRIPT_SRC)
    );
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
