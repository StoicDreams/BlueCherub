import { test, expect, openPage } from './support/site.mjs';

// app-cherub-player needs webapp/pkg (the Rust scene evaluator), built by RunLocal.ps1 or wasm-pack.
test.describe('app-cherub-player', () => {

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

});

