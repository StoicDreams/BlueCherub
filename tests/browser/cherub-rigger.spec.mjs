import { test, expect, openPage, signIn, expectSignedIn } from '../support/site.mjs';

// A poorly rigged SVG: no ids, shapes inside a moved group, a script, and a gradient referenced by id.
const messySvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="200" height="100">
  <script>window.ranImportedScript = true</script>
  <defs><linearGradient id="shine"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
  <g transform="translate(20,10)" fill="#2f7fe8">
    <rect x="0" y="0" width="40" height="40"/>
    <rect x="60" y="0" width="40" height="40" inkscape:label="Right arm"/>
    <circle cx="140" cy="20" r="15" fill="url(#shine)"/>
  </g>
  <g><g><ellipse cx="30" cy="80" rx="10" ry="5"/></g></g>
</svg>`;

async function openStudio(page) {
    await signIn(page, 1);
    await openPage(page, '/studio');
    await expectSignedIn(page, 1);
    const rigger = page.locator('app-cherub-rigger');
    await expect(rigger.getByRole('button', { name: 'Import SVG' })).toBeVisible();
    return rigger;
}

async function importSvg(rigger, text, name = 'messy.svg') {
    await rigger.locator('input[name="svg-file"]').setInputFiles({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(text) });
    await expect(rigger.locator('.status')).toContainText(`Loaded ${name}`);
}

/**
 * Where each element is drawn on the page, to check that edits keep the drawing the same. The drawing is what this tool
 * makes, so its positions are its output, not styling, and tests check them.
 */
function boxes(rigger, ids) {
    return rigger.evaluate((el, ids) => ids.map(id => {
        const box = el.shadowRoot.querySelector(`.stage [id="${id}"]`).getBoundingClientRect();
        return [box.x, box.y, box.width, box.height].map(v => Math.round(v));
    }), ids);
}

test.describe('app-cherub-rigger', () => {

    test('groups and ungroups shapes without moving them, and undoes it', async ({ page }) => {
        const rigger = await openStudio(page);
        await importSvg(rigger, messySvg);
        const layers = rigger.locator('app-cherub-layers');
        const before = await boxes(rigger, ['bc-1-0', 'bc-1-1', 'bc-2-0-0']);
        await layers.getByRole('button', { name: /bc-1-0/ }).click();
        await layers.getByRole('button', { name: /bc-2-0-0/ }).click({ modifiers: ['Shift'] });
        await rigger.getByRole('button', { name: 'Group', exact: true }).click();
        await expect(rigger.locator('.status')).toContainText('Grouped 2 elements as group');
        await expect.poll(() => rigger.evaluate(el => el.selection)).toEqual(['group']);
        // Both shapes now sit in the new group, drawn where they were.
        await expect.poll(() => rigger.evaluate(el => [...el.shadowRoot.querySelectorAll('.stage #group > *')].map(e => e.id))).toEqual(['bc-1-0', 'bc-2-0-0']);
        await expect.poll(() => boxes(rigger, ['bc-1-0', 'bc-1-1', 'bc-2-0-0'])).toEqual(before);

        await rigger.getByRole('button', { name: 'Ungroup' }).click();
        await expect.poll(() => rigger.evaluate(el => !!el.shadowRoot.querySelector('.stage #group'))).toBe(false);
        await expect.poll(() => boxes(rigger, ['bc-1-0', 'bc-2-0-0'])).toEqual([before[0], before[2]]);

        await rigger.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => rigger.evaluate(el => !!el.shadowRoot.querySelector('.stage #group'))).toBe(true);
        await rigger.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => rigger.evaluate(el => !!el.shadowRoot.querySelector('.stage #group'))).toBe(false);
        await expect.poll(() => rigger.evaluate(el => el.shadowRoot.querySelector('.stage [id="bc-1-0"]').parentElement.id)).toBe('bc-1');
        await rigger.getByRole('button', { name: 'Redo' }).click();
        await expect.poll(() => rigger.evaluate(el => !!el.shadowRoot.querySelector('.stage #group'))).toBe(true);
    });

    test('ungrouping keeps the group\'s fill on its children', async ({ page }) => {
        const rigger = await openStudio(page);
        await importSvg(rigger, messySvg);
        await rigger.locator('app-cherub-layers').getByRole('button', { name: /^bc-1\s*Group/ }).click();
        await rigger.getByRole('button', { name: 'Ungroup' }).click();
        await expect.poll(() => rigger.evaluate(el => ['bc-1-0', 'bc-1-2'].map(id => el.shadowRoot.querySelector(`.stage [id="${id}"]`).getAttribute('fill'))))
            .toEqual(['#2f7fe8', 'url(#shine)']);
    });

    test('clean up removes groups that do nothing', async ({ page }) => {
        const rigger = await openStudio(page);
        await importSvg(rigger, messySvg);
        const before = await boxes(rigger, ['bc-2-0-0']);
        await rigger.getByRole('button', { name: 'Clean up groups' }).click();
        await expect(rigger.locator('.status')).toContainText('Removed 2 groups');
        await expect.poll(() => rigger.evaluate(el => el.shadowRoot.querySelector('.stage [id="bc-2-0-0"]').parentElement.localName)).toBe('svg');
        await expect.poll(() => boxes(rigger, ['bc-2-0-0'])).toEqual(before);
    });

    test('makes parts with pivots and parents, and never allows a parent loop', async ({ page }) => {
        const rigger = await openStudio(page);
        await importSvg(rigger, messySvg);
        const layers = rigger.locator('app-cherub-layers');
        await layers.getByRole('button', { name: /^bc-1\s*Group/ }).click();
        await rigger.getByRole('button', { name: 'Make this a part' }).click();
        await layers.getByRole('button', { name: /Right arm/ }).click();
        await rigger.getByRole('button', { name: 'Make this a part' }).click();
        // The suggested pivot is the middle of the shape, in root coordinates (the group is moved by 20, 10).
        await expect.poll(() => rigger.evaluate(el => el.rigData.parts['bc-1-1'].pivot)).toEqual([100, 30]);
        await rigger.getByLabel('Attached to').selectOption('bc-1');
        await rigger.getByLabel('X').fill('82');
        await rigger.getByLabel('X').press('Tab');
        await expect.poll(() => rigger.evaluate(el => el.rigData.parts['bc-1-1'])).toEqual({ pivot: [82, 30], parent: 'bc-1' });
        await layers.getByRole('button', { name: /Part/ }).first().click();
        // bc-1 can't be attached to its own child.
        await expect(rigger.getByLabel('Attached to').locator('option')).toHaveText(['None']);
        await expect(layers.getByRole('button', { name: /Part/ })).toHaveCount(2);
    });

    test('tests a part in the preview with the scene evaluator', async ({ page }) => {
        const rigger = await openStudio(page);
        await importSvg(rigger, messySvg);
        await rigger.locator('app-cherub-layers').getByRole('button', { name: /Right arm/ }).click();
        await rigger.getByRole('button', { name: 'Make this a part' }).click();
        await rigger.getByRole('button', { name: 'Test', exact: true }).click();
        await expect(rigger.locator('.status')).toContainText('Testing bc-1-1');
        await expect(rigger.locator('.preview app-cherub-player')).toHaveAttribute('loaded', '');
        await rigger.getByRole('button', { name: 'Stop test' }).click();
        await expect(rigger.locator('.preview')).toBeHidden();
    });

    test('downloads the rigged SVG and rig, and opens them again', async ({ page }) => {
        const rigger = await openStudio(page);
        await importSvg(rigger, messySvg, 'My Character.svg');
        await rigger.locator('app-cherub-layers').getByRole('button', { name: /Right arm/ }).click();
        await rigger.getByRole('button', { name: 'Make this a part' }).click();
        const downloads = [];
        page.on('download', download => downloads.push(download));
        await rigger.getByRole('button', { name: 'Download rig' }).click();
        await expect.poll(() => downloads.length).toBe(2);
        const files = {};
        for (const download of downloads) {
            const stream = await download.createReadStream();
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            files[download.suggestedFilename()] = Buffer.concat(chunks).toString('utf8');
        }
        expect(Object.keys(files).sort()).toEqual(['my-character.rig.json', 'my-character.svg']);
        const rig = JSON.parse(files['my-character.rig.json']);
        expect(rig).toEqual({ formatVersion: 1, svg: 'my-character.svg', parts: { 'bc-1-1': { pivot: [100, 30] } } });

        // Open them in a fresh page, with one part the SVG doesn't have.
        rig.parts.ghost = { pivot: [0, 0], parent: 'bc-1-1' };
        await openStudio(page);
        await expect(rigger.getByRole('button', { name: 'Open rig' })).toBeVisible();
        await rigger.locator('input[name="rig-files"]').setInputFiles([
            { name: 'my-character.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(files['my-character.svg']) },
            { name: 'my-character.rig.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rig)) },
        ]);
        await expect(rigger.locator('.status')).toContainText("ghost isn't in the SVG");
        await expect.poll(() => rigger.evaluate(el => Object.keys(el.rigData.parts))).toEqual(['bc-1-1']);
    });

});

