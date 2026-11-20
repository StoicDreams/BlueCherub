import { test, expect, openPage, signIn, expectSignedIn } from './support/site.mjs';

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

test.describe('app-cherub-rigger', () => {
    test('asks visitors to sign in', async ({ page }) => {
        await openPage(page, '/studio');
        await expect(page.getByText('Sign in to use the Blue Cherub studio')).toBeVisible();
        await expect(page.locator('app-cherub-rigger')).toHaveCount(0);
    });

    test('imports a poorly rigged SVG: it gets ids, a viewBox, and no script', async ({ page }) => {
        const rigger = await openStudio(page);
        await importSvg(rigger, messySvg);
        const svg = await rigger.evaluate(el => el.svgText);
        expect(svg).not.toContain('script');
        expect(svg).toContain('viewBox="0 0 200 100"');
        expect(svg).toContain('id="bc-1"');
        expect(svg).toContain('id="bc-1-0"');
        await expect.poll(() => page.evaluate(() => window.ranImportedScript)).toBeUndefined();
        // The layers show the drawing tool's label rather than the generated id.
        const layers = rigger.locator('app-cherub-layers');
        await expect(layers.getByRole('button', { name: /Right arm/ })).toBeVisible();
        await expect(layers.getByRole('button', { name: /bc-2-0-0/ })).toBeVisible();
    });

    test('renames an element and keeps references to it working', async ({ page }) => {
        const rigger = await openStudio(page);
        await importSvg(rigger, messySvg.replace('<circle', '<use href="#bc-1-0" x="0" y="50"/><circle'));
        await rigger.locator('app-cherub-layers').getByRole('button', { name: /^bc-1-0/ }).click();
        const name = rigger.getByLabel('Name');
        await name.fill('left-arm');
        await name.press('Enter');
        await expect(rigger.locator('.status')).toContainText('Renamed bc-1-0 to left-arm');
        const svg = await rigger.evaluate(el => el.svgText);
        expect(svg).toContain('id="left-arm"');
        expect(svg).toContain('href="#left-arm"');
        // Names that aren't valid ids are refused.
        await name.fill('2 arms');
        await name.press('Enter');
        await expect(rigger.locator('.status')).toContainText('Names start with a letter');
        await expect(name).toHaveValue('left-arm');
    });

    test('loads the Blue Cherub sample with its parts', async ({ page }) => {
        const rigger = await openStudio(page);
        await rigger.getByRole('button', { name: 'Blue Cherub sample' }).click();
        await expect(rigger.locator('.status')).toContainText('Loaded blue-cherub.svg with 10 parts');
        await expect(rigger.locator('app-cherub-layers').getByRole('button', { name: /Part/ })).toHaveCount(10);
        // Selecting on the drawing selects the shape that was clicked.
        await rigger.locator('.stage [id="arm-bow"]').click({ force: true });
        await expect.poll(() => rigger.evaluate(el => el.selection)).toEqual(['arm-bow']);
        await expect(rigger.getByLabel('Attached to')).toHaveValue('body');
        await page.keyboard.press('Escape');
        await expect.poll(() => rigger.evaluate(el => el.selection)).toEqual([]);
    });
});

test.describe('app-cherub-layers', () => {
    test('lists drawing elements as buttons and marks the selection', async ({ page }) => {
        const rigger = await openStudio(page);
        await importSvg(rigger, messySvg);
        const layers = rigger.locator('app-cherub-layers');
        // Two groups and their children: defs and the script aren't listed.
        await expect(layers.getByRole('button')).toHaveCount(7);
        const item = layers.getByRole('button', { name: /Right arm/ });
        await expect(item).toHaveAttribute('aria-pressed', 'false');
        await item.focus();
        await page.keyboard.press('Enter');
        await expect(layers.getByRole('button', { name: /Right arm/ })).toHaveAttribute('aria-pressed', 'true');
    });
});

test.describe('app-cherub-rigger swaps', () => {
    const faceSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g id="face"><g id="happy"><circle cx="50" cy="50" r="20"/></g><g id="sad"><rect x="30" y="30" width="40" height="40"/></g><g id="shock"><ellipse cx="50" cy="50" rx="10" ry="25"/></g></g>
</svg>`;

    test('sets up swap drawings, shows only the one at rest, and saves them in the rig', async ({ page }) => {
        const rigger = await openStudio(page);
        await importSvg(rigger, faceSvg, 'face.svg');
        await rigger.locator('app-cherub-layers').getByRole('button', { name: /^face\s*Group/ }).click();
        await rigger.getByRole('button', { name: 'Make this a part' }).click();
        await rigger.getByRole('button', { name: 'Use its groups as swaps' }).click();
        await expect.poll(() => rigger.evaluate(el => el.rigData.parts.face.swaps)).toEqual(['happy', 'sad', 'shock']);
        // Which drawings show on the stage, checked as a person sees them.
        const drawing = id => rigger.locator(`.stage #${id}`);
        await expect(drawing('happy')).toBeVisible();
        await expect(drawing('sad')).toBeHidden();
        await expect(drawing('shock')).toBeHidden();
        await rigger.getByRole('button', { name: 'Use shock at rest' }).click();
        await expect.poll(() => rigger.evaluate(el => el.rigData.parts.face.swaps)).toEqual(['shock', 'happy', 'sad']);
        await rigger.getByRole('button', { name: 'Remove sad from swaps' }).click();
        await expect.poll(() => rigger.evaluate(el => el.rigData.parts.face.swaps)).toEqual(['shock', 'happy']);
        // Selecting a drawing shows it, so it can be checked and edited.
        await rigger.getByRole('button', { name: 'Show happy' }).click();
        await expect(drawing('happy')).toBeVisible();
        await expect(drawing('sad')).toBeVisible();
        await expect(drawing('shock')).toBeHidden();
        // Swaps stay in the SVG output untouched: hiding is only on the stage.
        await expect.poll(() => rigger.evaluate(el => el.svgText)).not.toContain('display');
        // Renaming a drawing keeps the swap list in step.
        await rigger.getByLabel('Name').fill('grin');
        await rigger.getByLabel('Name').press('Enter');
        await expect.poll(() => rigger.evaluate(el => el.rigData.parts.face.swaps)).toEqual(['shock', 'grin']);
        await rigger.locator('app-cherub-layers').getByRole('button', { name: /^face\s*Group/ }).click();
        await rigger.getByRole('button', { name: 'Stop swapping' }).click();
        await expect.poll(() => rigger.evaluate(el => el.rigData.parts.face.swaps)).toBeUndefined();
        await rigger.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => rigger.evaluate(el => el.rigData.parts.face.swaps)).toEqual(['shock', 'grin']);
    });
});
