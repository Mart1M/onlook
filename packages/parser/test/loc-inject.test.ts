import { describe, expect, test } from 'bun:test';
import { addSourceLocToAst, DATA_ONLOOK_LOC, getAstFromContent, getContentFromAst } from 'src';

const CARD_SOURCE = [
    'export function Card() {',
    '  return (',
    '    <div className="card">',
    '      <h2>Title</h2>',
    '      <p>Body</p>',
    '    </div>',
    '  );',
    '}',
    '',
].join('\n');

const LIST_SOURCE = [
    'export function List() {',
    '  return (',
    '    <>',
    '      <li data-onlook-loc="src/list.tsx:4:6">One</li>',
    '      <li>Two</li>',
    '    </>',
    '  );',
    '}',
    '',
].join('\n');

const PAGE_SOURCE = [
    "import { Button } from './button';",
    'export function Page() {',
    '  return <Button label="Go" />;',
    '}',
    '',
].join('\n');

describe('addSourceLocToAst (ADR-005 prototype)', () => {
    test('injects file:line:column without mutating the original source string', async () => {
        const sourceOnDisk = CARD_SOURCE;
        const frozenCopy = sourceOnDisk;

        const ast = getAstFromContent(sourceOnDisk);
        expect(ast).not.toBeNull();

        const { modified, count } = addSourceLocToAst(ast!, 'src/card.tsx');
        expect(modified).toBe(true);
        expect(count).toBe(3);

        const transformed = await getContentFromAst(ast!, sourceOnDisk);

        // Disk source must stay byte-identical (plugin never writes back).
        expect(sourceOnDisk).toBe(frozenCopy);
        expect(sourceOnDisk).not.toContain(DATA_ONLOOK_LOC);

        expect(transformed).toContain(DATA_ONLOOK_LOC + '="src/card.tsx:');
        expect(transformed).toMatch(/data-onlook-loc="src\/card\.tsx:\d+:\d+"/);
    });

    test('skips React fragments and does not duplicate existing loc attrs', async () => {
        const ast = getAstFromContent(LIST_SOURCE);
        expect(ast).not.toBeNull();

        const { count } = addSourceLocToAst(ast!, 'src/list.tsx');
        // Fragment skipped; first li already annotated; only second li added.
        expect(count).toBe(1);

        const out = await getContentFromAst(ast!, LIST_SOURCE);
        const matches = out.match(/data-onlook-loc=/g) ?? [];
        expect(matches).toHaveLength(2);
    });

    test('annotates custom component openings for instance-resolution index', async () => {
        const ast = getAstFromContent(PAGE_SOURCE);
        expect(ast).not.toBeNull();

        const { count } = addSourceLocToAst(ast!, 'src/page.tsx');
        expect(count).toBe(1);

        const out = await getContentFromAst(ast!, PAGE_SOURCE);
        expect(out).toMatch(/<Button[^>]*data-onlook-loc="src\/page\.tsx:\d+:\d+"/);
    });
});
