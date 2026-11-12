import { test, expect, openPage, signIn, expectSignedIn, readText, WEBAPP, ROOT_FILES } from './support/site.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const GUIDE = join(ROOT_FILES, 'guide', 'studio-guide.md');

/** Every studio screenshot a file refers to, such as /img/screenshots/studio/rig-layers.png. */
function screenshotRefs(file) {
    return [...readText(file).matchAll(/\/img\/screenshots\/studio\/[\w-]+\.png/g)].map(match => match[0]);
}

test.describe('app-feature', () => {
    test('shows each studio feature on the home page with a screenshot that loads', async ({ page }) => {
        await openPage(page, '/');
        const features = page.locator('app-feature');
        await expect(features).toHaveCount(6);
        await expect(features.first().getByRole('heading', { name: 'Rig any drawing' })).toBeVisible();
        for (const feature of await features.all()) {
            await feature.scrollIntoViewIfNeeded();
            const img = feature.locator('img');
            await expect(img).toHaveAttribute('alt', /\w/);
            await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth)).toBeGreaterThan(0);
            // The screenshot links to its full-size image.
            await expect(feature.getByRole('link')).toHaveAttribute('href', await img.getAttribute('src'));
        }
        // Every other feature puts its picture on the right.
        await expect(features.nth(1)).toHaveAttribute('reverse', '');
    });

    test('stacks the picture above the text on narrow screens', async ({ page }) => {
        await page.setViewportSize({ width: 420, height: 900 });
        await openPage(page, '/');
        // The second feature puts its picture on the right when there's room.
        const feature = page.locator('app-feature').nth(1);
        await feature.scrollIntoViewIfNeeded();
        const [shot, text] = await feature.evaluate(el => ['.shot', '.text'].map(s => el.shadowRoot.querySelector(s).getBoundingClientRect().top));
        expect(shot).toBeLessThan(text);
    });

    test('every screenshot the home page and guide use exists', () => {
        const refs = [...screenshotRefs(join(WEBAPP, 'd', 'root.md')), ...screenshotRefs(GUIDE)];
        expect(refs.length).toBeGreaterThan(5);
        const missing = refs.filter(ref => !existsSync(join(ROOT_FILES, ref)));
        expect(missing, 'Run PowerShell/screenshots.ps1, or fix the image path').toEqual([]);
    });
});

test.describe('guide', () => {
    test('the Guide page shows the studio guide', async ({ page }) => {
        await openPage(page, '/guide');
        await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
        await expect(page.locator('app-feature')).toHaveCount(6);
    });

    test('the studio has a Help bubble with the same guide', async ({ page }) => {
        await signIn(page, 1);
        await openPage(page, '/studio');
        await expectSignedIn(page, 1);
        const help = page.locator('webui-page-help');
        await expect(help).toHaveCount(1);
        await help.evaluate(el => el.open());
        await expect.poll(() => help.evaluate(el => el.isOpen())).toBe(true);
        await expect(help.getByRole('heading', { name: 'Getting started' })).toBeVisible();
        await expect(help.getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '/guide');
    });
});

test.describe('page metadata', () => {
    test('describes the animation studio and shares a real image', () => {
        const html = readText(join(WEBAPP, 'index.html'));
        expect(html).toContain('<title>Blue Cherub: Free Animation Studio</title>');
        expect(html).not.toMatch(/early development|Online dating|#FF2E46/i);
        expect(html).toMatch(/<meta property="og:image" content="https:\/\/www\.bluecherub\.com\/blue-cherub-share\.jpg">/);
        expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
        // Social sites need a 1200 by 630 JPEG or PNG, not SVG.
        const image = readFileSync(join(ROOT_FILES, 'blue-cherub-share.jpg'));
        expect([image[0], image[1]]).toEqual([0xff, 0xd8]);
        const manifest = JSON.parse(readText(join(ROOT_FILES, 'app.webmanifest')));
        expect(manifest.description).toMatch(/free animation studio/i);
    });
});
