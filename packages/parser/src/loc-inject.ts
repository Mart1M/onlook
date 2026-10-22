/**
 * ADR-005 prototype — inject source locations into JSX at transform time.
 * Does not write to disk; callers apply this on the in-memory build graph only.
 *
 * @see adr/005-dom-source-mapping.md
 */
import type { NodePath, T } from './packages';
import { isReactFragment } from './helpers';
import { t, traverse } from './packages';

/** Dev-only DOM attribute carrying `file:line:column`. Never persisted to user sources. */
export const DATA_ONLOOK_LOC = 'data-onlook-loc';

function formatLoc(filename: string, loc: T.SourceLocation | null | undefined): string | null {
    if (!loc?.start) {
        return null;
    }
    return `${filename}:${loc.start.line}:${loc.start.column}`;
}

function hasLocAttribute(attributes: (T.JSXAttribute | T.JSXSpreadAttribute)[]): boolean {
    return attributes.some(
        (attr) => t.isJSXAttribute(attr) && attr.name.name === DATA_ONLOOK_LOC,
    );
}

/**
 * Annotate JSX opening elements with `data-onlook-loc="<filename>:<line>:<column>"`.
 * Intended for build-pipeline use (Vite/Babel, later SWC) — not for CodeFileSystem writes.
 */
export function addSourceLocToAst(
    ast: T.File,
    filename: string,
): { ast: T.File; modified: boolean; count: number } {
    let modified = false;
    let count = 0;

    traverse(ast, {
        JSXOpeningElement(path: NodePath<T.JSXOpeningElement>) {
            if (isReactFragment(path.node)) {
                return;
            }
            if (hasLocAttribute(path.node.attributes)) {
                return;
            }

            const value = formatLoc(filename, path.node.loc);
            if (!value) {
                return;
            }

            path.node.attributes.push(
                t.jSXAttribute(t.jSXIdentifier(DATA_ONLOOK_LOC), t.stringLiteral(value)),
            );
            modified = true;
            count += 1;
        },
    });

    return { ast, modified, count };
}
