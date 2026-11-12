import { test, expect, openPage } from './support/site.mjs';

// app-cherub-player needs webapp/pkg (the Rust scene evaluator), built by RunLocal.ps1 or wasm-pack.
test.describe('app-cherub-player', () => {
    test('loads the Blue Cherub scene on the home page and animates its parts', async ({ page }) => {
        await openPage(page, '/');
        const player = page.locator('app-cherub-player');
        await expect(player).toHaveAttribute('loaded', '');
        await expect(player.locator('.stage > svg')).toBeVisible();
        const wing = player.locator('[id="wing-back"]');
        await expect(wing).toHaveAttribute('transform', /^matrix\(/);
        // The frame keeps moving while it plays.
        const first = await player.evaluate(el => el.currentFrame);
        await expect.poll(() => player.evaluate(el => el.currentFrame)).not.toBe(first);
        await expect(player.locator('.stage')).toHaveAttribute('role', 'img');
        await expect(player.locator('.stage')).toHaveAttribute('aria-label', /Blue Cherub/);
    });

    test('the pause button stops the animation and play resumes it', async ({ page }) => {
        await openPage(page, '/');
        const player = page.locator('app-cherub-player');
        await expect(player).toHaveAttribute('loaded', '');
        await player.getByRole('button', { name: 'Pause animation' }).click();
        expect(await player.evaluate(el => el.playing)).toBe(false);
        const paused = await player.evaluate(el => el.currentFrame);
        await page.waitForTimeout(300);
        expect(await player.evaluate(el => el.currentFrame)).toBe(paused);
        await player.getByRole('button', { name: 'Play animation' }).click();
        await expect.poll(() => player.evaluate(el => el.currentFrame)).not.toBe(paused);
    });

    test('does not autoplay when the visitor prefers reduced motion', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openPage(page, '/');
        const player = page.locator('app-cherub-player');
        await expect(player).toHaveAttribute('loaded', '');
        expect(await player.evaluate(el => el.playing)).toBe(false);
        expect(await player.evaluate(el => el.currentFrame)).toBe(0);
        await expect(player.getByRole('button', { name: 'Play animation' })).toBeVisible();
    });

    test('marks a scene that fails to load without throwing', async ({ page }) => {
        await openPage(page, '/');
        await page.evaluate(() => {
            const player = document.createElement('app-cherub-player');
            player.id = 'broken';
            player.setAttribute('src', '/animations/missing.scene.json');
            document.querySelector('app-cherub-player').after(player);
        });
        await expect(page.locator('#broken')).toHaveAttribute('error', '');
        await expect(page.locator('#broken').getByRole('button')).toBeHidden();
    });

    test('removes scripts, event handlers, and outside links from SVG', async ({ page }) => {
        await openPage(page, '/');
        await expect(page.locator('app-cherub-player')).toHaveAttribute('loaded', '');
        const clean = await page.evaluate(() => window.appCherub.sanitizeSvg(`
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(2)</script>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
  <g id="part" onclick="alert(3)" fill="url(https://example.com/x)"><rect width="5" height="5" style="fill:red"/></g>
  <use href="https://example.com/a.svg#x"/>
  <use xlink:href="#part"/>
  <image href="https://example.com/track.png"/>
  <a href="javascript:alert(4)"><circle r="1"/></a>
  <linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient>
  <rect fill="url(#grad)" width="1" height="1"/>
</svg>`).outerHTML);
        expect(clean).not.toMatch(/script|onload|onclick|foreignObject|example\.com|image|javascript|<a/i);
        expect(clean).toContain('id="part"');
        expect(clean).toContain('fill="url(#grad)"');
        expect(clean).toContain('linearGradient');
        expect(clean).toContain('xlink:href="#part"');
    });

    test('the Rust scene evaluator rejects bad scenes with a message', async ({ page }) => {
        await openPage(page, '/');
        await expect(page.locator('app-cherub-player')).toHaveAttribute('loaded', '');
        const message = await page.evaluate(async () => {
            try {
                await webui.worker.evaluate_scene(JSON.stringify({
                    rig: { formatVersion: 1, parts: { a: {} } },
                    scene: { formatVersion: 1, fps: 24, frameCount: 1, tracks: [{ part: 'b', property: 'x', keys: [{ frame: 0, value: 1 }] }] },
                }));
                return 'no error';
            } catch (ex) {
                return String(ex);
            }
        });
        expect(message).toContain('unknown part b');
    });
});

test.describe('app-cherub-player in moved groups', () => {
    test('turns a part inside a transformed group around its root-space pivot', async ({ page }) => {
        await openPage(page, '/');
        const player = page.locator('app-cherub-player');
        await expect(player).toHaveAttribute('loaded', '');
        const point = await player.evaluate(async el => {
            el.pause();
            const result = await el.loadData({
                svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><g transform="translate(100 0)"><rect id="arm" width="10" height="10"/></g></svg>',
                rig: { formatVersion: 1, parts: { arm: { pivot: [100, 0] } } },
                scene: { formatVersion: 1, fps: 24, frameCount: 1, tracks: [{ part: 'arm', property: 'rotate', keys: [{ frame: 0, value: 90 }] }] },
            });
            if (!result.ok) return result.error;
            const svg = el.shadowRoot.querySelector('.stage > svg');
            const arm = svg.querySelector('#arm');
            const m = window.appCherub.parentMatrix(arm, svg).multiply(window.appCherub.ownMatrix(arm));
            const p = m.transformPoint(new DOMPoint(10, 0));
            return [Math.round(p.x), Math.round(p.y)];
        });
        // The rect's far corner (110, 0) swings a quarter turn around (100, 0).
        expect(point).toEqual([100, 10]);
    });
});
