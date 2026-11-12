import { test, expect, openPage, signIn, expectSignedIn, ROOT_FILES } from '../tests/support/site.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Blue Cherub only: screenshots of the studio at each stage of using it, for the home page and the guide.
// Saved to webapp/root_files/img/screenshots/studio (served at /img/screenshots/studio/).
// When the studio changes, update these steps, the home page (webapp/d/root.md), and the guide
// (webapp/root_files/guide/studio-guide.md) together. See claude/bluecherub/CLAUDE.md.
export const STUDIO_SHOTS = join(ROOT_FILES, 'img', 'screenshots', 'studio');

test('screenshots of the studio at each stage', async ({ page }) => {
    test.setTimeout(120000);
    await page.clock.setFixedTime(new Date('2026-11-02T15:00:00Z'));
    // The usual window size. A shot grows the window when the studio doesn't fit, so it is never scrolled under the header.
    await page.setViewportSize({ width: 1280, height: 900 });
    mkdirSync(STUDIO_SHOTS, { recursive: true });
    await signIn(page, 1);
    await openPage(page, '/studio');
    await expectSignedIn(page, 1);
    const studio = page.locator('app-cherub-studio');
    const rigger = studio.locator('app-cherub-rigger');
    const animator = studio.locator('app-cherub-animator');
    const layers = rigger.locator('app-cherub-layers');

    const shot = async name => {
        // Scroll everything back to the top, and grow the window if the studio still doesn't fit.
        await studio.evaluate(el => {
            // The page scrolls inside the app shell's shadow DOM, so follow slots and shadow hosts up, not just parents.
            for (let node = el; node; node = node.assignedSlot || node.parentElement || (node.getRootNode && node.getRootNode().host)) {
                if (node.scrollTop) node.scrollTop = 0;
            }
            window.scrollTo(0, 0);
            // The help bubble floats over the studio. It belongs in the guide, not in pictures of the studio.
            document.querySelectorAll('webui-page-help').forEach(help => { help.style.visibility = 'hidden'; });
        });
        const box = await studio.boundingBox();
        const height = Math.ceil(box.y + box.height + 60);
        if (height > page.viewportSize().height) await page.setViewportSize({ width: 1280, height });
        // Keep hover effects out of the picture, and let fonts and drawing settle.
        await page.mouse.move(640, page.viewportSize().height - 4);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        await studio.screenshot({ path: join(STUDIO_SHOTS, `${name}.png`) });
    };

    // Rig: the sample with a group selected in the layers.
    await rigger.getByRole('button', { name: 'Blue Cherub sample' }).click();
    await expect(rigger.locator('.status')).toContainText('with 10 parts');
    await layers.getByRole('button', { name: /^arrow\s*Group/ }).click();
    await shot('rig-layers');

    // Rig: a part with its pivot and the lines to its parent.
    await layers.getByRole('button', { name: /^arm-bow/ }).click();
    await shot('rig-pivots');

    // Rig: swap drawings for the eyes.
    await layers.getByRole('button', { name: /^eyes\s*Group/ }).click();
    await expect(rigger.getByRole('button', { name: 'Stop swapping' })).toBeVisible();
    await shot('rig-swaps');

    // Animate: the idle scene, with the wing's keys on the timeline.
    await studio.getByRole('tab', { name: 'Animate' }).click();
    await animator.getByRole('button', { name: 'Blue Cherub sample' }).click();
    await expect(animator.locator('.status')).toContainText('Loaded the Blue Cherub idle scene');
    await animator.getByRole('button', { name: 'wing-back key at frame 6' }).click();
    await expect.poll(() => animator.evaluate(el => el.frame)).toBe(6);
    await shot('animate-timeline');

    // Animate: the rotate tool, aiming the bow arm.
    await animator.locator('.parts').getByRole('button', { name: 'arm-bow' }).click();
    await animator.getByRole('button', { name: 'Rotate', exact: true }).click();
    await animator.getByLabel('Frame', { exact: true }).fill('12');
    await animator.getByLabel('Rotate (°)').fill('-20');
    await animator.getByLabel('Rotate (°)').press('Enter');
    await expect(animator.getByLabel('Rotate (°) ◆')).toHaveValue('-20');
    await shot('animate-pose');

    // Animate: a saved pose and a saved action in the library.
    await animator.getByText('Library: saved poses and actions').click();
    await animator.getByLabel('Pose name').fill('Aim');
    await animator.getByRole('button', { name: 'Save pose' }).click();
    await animator.locator('.parts').getByRole('button', { name: 'wing-back' }).click();
    await animator.getByLabel('Action name').fill('Flap');
    await animator.getByLabel('To frame').fill('12');
    await animator.getByLabel('Save', { exact: true }).last().selectOption('part');
    await animator.getByRole('button', { name: 'Save action' }).click();
    await expect(animator.locator('.status')).toContainText('Saved the action “Flap”');
    await shot('animate-library');
});
