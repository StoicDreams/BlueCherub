import { test, expect, openPage } from '../support/site.mjs';

test.describe('app-feature', () => {
    test('shows each studio feature on the home page with a picture or clip that loads', async ({ page }) => {
        await openPage(page, '/');
        const features = page.locator('app-feature');
        await expect(features).toHaveCount(7);
        await expect(features.first().getByRole('heading', { name: 'Rig any drawing' })).toBeVisible();
        for (const feature of await features.all()) {
            await feature.scrollIntoViewIfNeeded();
            const src = await feature.getAttribute('src');
            const video = await feature.getAttribute('video');
            if (video) {
                // A clip, with the still as its poster.
                const clip = feature.locator('video');
                await expect(clip).toBeVisible();
                await expect(clip).toHaveAttribute('poster', src);
                await expect(clip).toHaveAttribute('aria-label', /\w/);
                await expect.poll(() => clip.evaluate(el => el.readyState)).toBeGreaterThan(0);
                await expect(clip.locator('source')).toHaveCount(2);
                await expect(feature.getByRole('link')).toHaveCount(0);
            } else {
                const img = feature.locator('img');
                await expect(img).toHaveAttribute('alt', /\w/);
                await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth)).toBeGreaterThan(0);
                // The screenshot links to its full-size image.
                await expect(feature.getByRole('link')).toHaveAttribute('href', src);
            }
        }
        // Every other feature puts its picture on the right.
        await expect(features.nth(1)).toHaveAttribute('reverse', '');
    });

    test('plays clips on screen, with a button to pause them', async ({ page }) => {
        await openPage(page, '/');
        const feature = page.locator('app-feature[video]').first();
        await feature.scrollIntoViewIfNeeded();
        const clip = feature.locator('video');
        await expect.poll(() => clip.evaluate(el => !el.paused)).toBe(true);
        await feature.getByRole('button', { name: 'Pause clip' }).click();
        await expect.poll(() => clip.evaluate(el => el.paused)).toBe(true);
        await feature.getByRole('button', { name: 'Play clip' }).click();
        await expect.poll(() => clip.evaluate(el => !el.paused)).toBe(true);
    });

    test('falls back to the WebM clip when the MP4 cannot play', async ({ page }) => {
        // Stand in for a browser without H.264 by making every MP4 fail.
        await page.route('**/*.mp4', route => route.abort());
        await openPage(page, '/');
        const feature = page.locator('app-feature[video]').first();
        await feature.scrollIntoViewIfNeeded();
        const clip = feature.locator('video');
        await expect.poll(() => clip.evaluate(el => el.currentSrc)).toMatch(/\.webm$/);
        await expect.poll(() => clip.evaluate(el => el.readyState)).toBeGreaterThan(0);
    });

});

