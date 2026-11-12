import { test, expect, openPage, signIn, expectSignedIn } from './support/site.mjs';

async function openStudio(page) {
    await signIn(page, 1);
    await openPage(page, '/studio');
    await expectSignedIn(page, 1);
    const studio = page.locator('app-cherub-studio');
    await expect(studio.getByRole('tab', { name: 'Rig' })).toBeVisible();
    return studio;
}

async function openSample(page) {
    const studio = await openStudio(page);
    await studio.getByRole('tab', { name: 'Animate' }).click();
    const animator = studio.locator('app-cherub-animator');
    await animator.getByRole('button', { name: 'Blue Cherub sample' }).click();
    await expect(animator.locator('.status')).toContainText('Loaded the Blue Cherub idle scene');
    return animator;
}

const frameOf = animator => animator.evaluate(el => el.frame);
const scene = animator => animator.evaluate(el => el.sceneData);
const track = (data, part, property) => data.tracks.find(tr => tr.part === part && tr.property === property);

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

    test('hands the rig from the Rig tab to the Animate tab', async ({ page }) => {
        const studio = await openStudio(page);
        const rigger = studio.locator('app-cherub-rigger');
        await rigger.getByRole('button', { name: 'Blue Cherub sample' }).click();
        await expect(rigger.locator('.status')).toContainText('with 10 parts');
        await studio.getByRole('tab', { name: 'Animate' }).click();
        const animator = studio.locator('app-cherub-animator');
        await expect(animator.locator('.status')).toContainText('Using blue-cherub with 10 parts');
        await expect(animator.locator('.parts').getByRole('button')).toHaveCount(10);
        // A part removed on the Rig tab disappears from the Animate tab.
        await studio.getByRole('tab', { name: 'Rig' }).click();
        await rigger.evaluate(el => el.removePart('legs'));
        await studio.getByRole('tab', { name: 'Animate' }).click();
        await expect(animator.locator('.parts').getByRole('button')).toHaveCount(9);
    });
});

test.describe('app-cherub-animator', () => {
    test('loads the sample scene with its keys, and reads poses from the Rust evaluator', async ({ page }) => {
        const animator = await openSample(page);
        // The loop's last key is on frame 48, one past the end, so the timeline shows 8 of its 9 keys.
        await expect(animator.getByRole('button', { name: /^wing-back key at frame/ })).toHaveCount(8);
        await expect(animator.locator('.frame-text')).toHaveText('Frame 0 of 47 (0.00 s)');
        await animator.getByLabel('Frame', { exact: true }).fill('24');
        await expect.poll(() => frameOf(animator)).toBe(24);
        await expect.poll(() => animator.evaluate(el => el.poses.body && el.poses.body.y)).toBe(-8);
        await animator.locator('.parts').getByRole('button', { name: 'body' }).click();
        await expect(animator.getByLabel('Y ◆')).toHaveValue('-8');
    });

    test('typing a value keys it at the current frame and moves the children too', async ({ page }) => {
        const animator = await openSample(page);
        await animator.getByRole('button', { name: 'Next frame' }).click();
        await animator.getByRole('button', { name: 'Next frame' }).click();
        await animator.locator('.parts').getByRole('button', { name: 'arm-bow' }).click();
        const bowBefore = await animator.evaluate(el => el.shadowRoot.querySelector('app-cherub-player').shadowRoot.querySelector('#bow').getAttribute('transform'));
        await animator.getByLabel('Rotate (°)').fill('30');
        await animator.getByLabel('Rotate (°)').press('Enter');
        await expect(animator.getByLabel('Rotate (°) ◆')).toHaveValue('30');
        expect(track(await scene(animator), 'arm-bow', 'rotate').keys).toEqual([{ frame: 2, value: 30, ease: 'inOut' }]);
        await expect(animator.getByRole('button', { name: 'arm-bow key at frame 2' })).toBeVisible();
        // The bow is attached to the arm, so it turns with it.
        await expect.poll(() => animator.evaluate(el => el.shadowRoot.querySelector('app-cherub-player').shadowRoot.querySelector('#bow').getAttribute('transform'))).not.toBe(bowBefore);
        await animator.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(async () => track(await scene(animator), 'arm-bow', 'rotate')).toBeUndefined();
    });

    test('dragging a part moves it, and the rotate tool turns it around its pivot', async ({ page }) => {
        const animator = await openSample(page);
        const head = animator.locator('app-cherub-player').locator('[id="head"] > circle');
        const box = await head.boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // The first press selects the part, and the next drags it.
        await page.mouse.click(cx, cy);
        await expect.poll(() => animator.evaluate(el => el.selectedPart)).toBe('head');
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx + 30, cy + 10, { steps: 5 });
        await page.mouse.up();
        await expect.poll(async () => track(await scene(animator), 'head', 'x')?.keys[0].value).toBeGreaterThan(10);
        expect(track(await scene(animator), 'head', 'y').keys[0].frame).toBe(0);

        await animator.getByRole('button', { name: 'Rotate', exact: true }).click();
        await expect(animator.getByRole('button', { name: 'Rotate', exact: true })).toHaveAttribute('aria-pressed', 'true');
        const before = track(await scene(animator), 'head', 'rotate').keys[0].value;
        // Press on the moved head, below its middle, and swing sideways around the neck.
        await page.mouse.move(cx + 30, cy + 45);
        await page.mouse.down();
        await page.mouse.move(cx + 80, cy + 45, { steps: 5 });
        await page.mouse.up();
        await expect.poll(async () => track(await scene(animator), 'head', 'rotate').keys[0].value).not.toBe(before);
    });

    test('changes easing, deletes keys, and keys a whole pose', async ({ page }) => {
        const animator = await openSample(page);
        await animator.getByRole('button', { name: 'wing-back key at frame 6' }).click();
        expect(await frameOf(animator)).toBe(6);
        await expect(animator.getByLabel('From these keys to the next')).toHaveValue('inOut');
        await animator.getByLabel('From these keys to the next').selectOption('linear');
        await expect.poll(async () => track(await scene(animator), 'wing-back', 'rotate').keys[1].ease).toBe('linear');
        await animator.getByRole('button', { name: 'Delete keys' }).click();
        await expect(animator.getByRole('button', { name: /^wing-back key at frame/ })).toHaveCount(7);
        await animator.getByRole('button', { name: 'Key pose' }).click();
        await expect(animator.getByRole('button', { name: /^wing-back key at frame/ })).toHaveCount(8);
        // Key pose keys all six values.
        const keyed = (await scene(animator)).tracks.filter(tr => tr.part === 'wing-back' && tr.keys.some(k => k.frame === 6));
        expect(keyed.map(tr => tr.property).sort()).toEqual(['opacity', 'rotate', 'scaleX', 'scaleY', 'x', 'y']);
    });

    test('keyboard shortcuts step frames, key, delete, and play', async ({ page }) => {
        const animator = await openSample(page);
        await animator.locator('.parts').getByRole('button', { name: 'legs' }).click();
        await page.keyboard.press('.');
        await page.keyboard.press('.');
        await expect.poll(() => frameOf(animator)).toBe(2);
        await page.keyboard.press(',');
        await expect.poll(() => frameOf(animator)).toBe(1);
        await page.keyboard.press('k');
        await expect(animator.getByRole('button', { name: 'legs key at frame 1' })).toBeVisible();
        await page.keyboard.press('Delete');
        await expect(animator.getByRole('button', { name: 'legs key at frame 1' })).toHaveCount(0);
        // Press on an empty corner of the drawing, which keeps shortcuts in the animator.
        const stage = await animator.locator('.stage-wrap').boundingBox();
        await page.mouse.click(stage.x + 3, stage.y + 3);
        await page.keyboard.press(' ');
        await expect(animator.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press(' ');
        await expect(animator.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false');
    });

    test('sets frame rate, length, and animating on twos', async ({ page }) => {
        const animator = await openSample(page);
        await animator.getByLabel('Length (frames)').fill('24');
        await animator.getByLabel('Length (frames)').press('Enter');
        await animator.getByLabel('Frames per second').fill('12');
        await animator.getByLabel('Frames per second').press('Enter');
        await animator.getByLabel('Animate on twos').uncheck();
        await expect.poll(() => scene(animator).then(s => [s.frameCount, s.fps, s.holdFrames])).toEqual([24, 12, 1]);
        await expect(animator.locator('.frame-text')).toHaveText('Frame 0 of 23 (0.00 s)');
        await animator.getByLabel('Frames per second').fill('99');
        await animator.getByLabel('Frames per second').press('Enter');
        await expect(animator.locator('.status')).toContainText('Frames per second must be from 1 to 60');
    });

    test('downloads the scene and opens it again, dropping parts the rig lacks', async ({ page }) => {
        const animator = await openSample(page);
        const downloadPromise = page.waitForEvent('download');
        await animator.getByRole('button', { name: 'Download scene' }).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe('blue-cherub.scene.json');
        const chunks = [];
        for await (const chunk of await download.createReadStream()) chunks.push(chunk);
        const saved = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        expect(saved.rig).toBe('blue-cherub.rig.json');
        expect(saved.tracks).toEqual((await scene(animator)).tracks);
        saved.tracks.push({ part: 'tail', property: 'rotate', keys: [{ frame: 0, value: 5 }] });
        saved.frameCount = 30;
        await animator.locator('input[name="scene-file"]').setInputFiles({ name: 'edited.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
        await expect(animator.locator('.status')).toContainText('This rig has no tail');
        expect((await scene(animator)).frameCount).toBe(30);
    });
});
