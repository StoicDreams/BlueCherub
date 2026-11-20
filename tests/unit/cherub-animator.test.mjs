import { test, expect, openPage, signIn, expectSignedIn } from './support/site.mjs';

async function openStudio(page) {
    await signIn(page, 1);
    await openPage(page, '/studio');
    await expectSignedIn(page, 1);
    const studio = page.locator('app-cherub-studio');
    await expect(studio.getByRole('tab', { name: 'Rig' })).toBeVisible();
    return studio;
}

test.describe('app-cherub-studio', () => {
    test('switches between Rig and Animate tabs with the mouse and arrow keys', async ({ page }) => {
        const studio = await openStudio(page);
        const rigTab = studio.getByRole('tab', { name: 'Rig' });
        const animateTab = studio.getByRole('tab', { name: 'Animate' });
        await expect(rigTab).toHaveAttribute('aria-selected', 'true');
        await animateTab.click();
        await expect(animateTab).toHaveAttribute('aria-selected', 'true');
        await expect(studio.getByText('Rig a character on the Rig tab')).toBeVisible();
        await expect(studio.locator('app-cherub-rigger')).toBeHidden();
        await animateTab.press('ArrowLeft');
        await expect(rigTab).toHaveAttribute('aria-selected', 'true');
        await expect(rigTab).toBeFocused();
        await expect(studio.locator('app-cherub-rigger')).toBeVisible();
    });

});

