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

    test('scrubbing through every frame never moves the panel or the timeline', async ({ page }) => {
        const animator = await openSample(page);
        // The wing has keys on some frames and not others, and the scene animates on twos, so the notes change.
        await animator.locator('.parts').getByRole('button', { name: 'wing-back' }).click();
        const layout = () => animator.evaluate(el => {
            const root = el.shadowRoot;
            const place = node => {
                const r = node.getBoundingClientRect();
                return [Math.round(r.top), Math.round(r.left), Math.round(r.height), Math.round(r.width)].join(',');
            };
            return {
                timeline: place(root.querySelector('.timeline')),
                keyPose: place(root.querySelector('[data-focus="key-pose"]')),
                ease: place(root.querySelector('#key-ease')),
                library: place(root.querySelector('.library summary')),
                stage: place(root.querySelector('.stage-wrap')),
            };
        });
        const moved = [];
        // Run with this browser's font, then with wider letters, standing in for a wider fallback font on other systems.
        for (const spacing of ['normal', '0.15em']) {
            await animator.evaluate((el, value) => { el.style.letterSpacing = value; }, spacing);
            await animator.evaluate(el => el.setFrame(0));
            const first = await layout();
            for (let frame = 1; frame < 48; frame++) {
                await animator.evaluate((el, f) => el.setFrame(f), frame);
                const now = await layout();
                for (const [name, place] of Object.entries(now)) {
                    if (place !== first[name]) moved.push(`${spacing} spacing, ${name} at frame ${frame}: ${first[name]} → ${place}`);
                }
            }
        }
        expect(moved).toEqual([]);
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

test.describe('app-cherub-animator swaps and library', () => {
    test('keys a swap drawing, which always holds until the next key', async ({ page }) => {
        const animator = await openSample(page);
        await animator.getByLabel('Frame', { exact: true }).fill('6');
        await animator.locator('.parts').getByRole('button', { name: 'eyes' }).click();
        await expect(animator.getByLabel('Drawing')).toHaveValue('0');
        await animator.getByLabel('Drawing').selectOption({ label: 'eyes-closed' });
        await expect(animator.getByLabel('Drawing ◆')).toHaveValue('1');
        const keys = track(await scene(animator), 'eyes', 'swap').keys;
        expect(keys.find(k => k.frame === 6)).toEqual({ frame: 6, value: 1, ease: 'step' });
        const closedShows = await animator.evaluate(el => el.shadowRoot.querySelector('app-cherub-player').svgElement.querySelector('#eyes-closed').getAttribute('display') !== 'none');
        expect(closedShows).toBe(true);
    });

    test('saves a pose and applies it at another frame', async ({ page }) => {
        const animator = await openSample(page);
        await animator.locator('.parts').getByRole('button', { name: 'head' }).click();
        await animator.getByLabel('Rotate (°)').fill('15');
        await animator.getByLabel('Rotate (°)').press('Enter');
        await animator.getByText('Library: saved poses and actions').click();
        await animator.getByLabel('Pose name').fill('Tilted');
        await animator.getByLabel('Save', { exact: true }).first().selectOption('part');
        await animator.getByRole('button', { name: 'Save pose' }).click();
        await expect(animator.locator('.status')).toContainText('Saved the pose “Tilted”');
        const saved = (await scene(animator)).library.poses.Tilted;
        // The head and the parts attached to it.
        expect(Object.keys(saved).sort()).toEqual(['eyes', 'hair-curl', 'head']);
        expect(saved.head.rotate).toBe(15);
        await animator.getByLabel('Frame', { exact: true }).fill('30');
        await animator.getByRole('button', { name: 'Apply Tilted' }).click();
        await expect.poll(() => animator.evaluate(el => el.poses.head.rotate)).toBe(15);
        expect(track(await scene(animator), 'head', 'rotate').keys.some(k => k.frame === 30 && k.value === 15)).toBe(true);
        await animator.getByRole('button', { name: 'Delete Tilted' }).click();
        expect((await scene(animator)).library.poses).toEqual({});
    });

    test('saves an action and inserts it repeatedly, lengthening the scene', async ({ page }) => {
        const animator = await openSample(page);
        await animator.locator('.parts').getByRole('button', { name: 'wing-back' }).click();
        await animator.getByText('Library: saved poses and actions').click();
        await animator.getByLabel('Action name').fill('Flap');
        await animator.getByLabel('From frame').fill('0');
        await animator.getByLabel('To frame').fill('12');
        await animator.getByLabel('Save', { exact: true }).last().selectOption('part');
        await animator.getByRole('button', { name: 'Save action' }).click();
        await expect(animator.locator('.status')).toContainText('Saved the action “Flap” (12 frames)');
        // On twos, an odd frame shows the frame before it, and the panel says so.
        await animator.getByLabel('Frame', { exact: true }).fill('7');
        await expect(animator.getByText('On twos: shows frame 6')).toBeVisible();
        const flap = (await scene(animator)).library.actions.Flap;
        expect(flap.tracks.map(tr => tr.part)).toEqual(['wing-back']);
        expect(flap.tracks[0].keys.map(k => [k.frame, k.value])).toEqual([[0, 0], [6, -18], [12, 0]]);

        await animator.getByLabel('Frame', { exact: true }).fill('40');
        await animator.getByLabel('Insert it this many times').fill('3');
        await animator.getByRole('button', { name: 'Insert Flap' }).click();
        await expect(animator.locator('.status')).toContainText('Inserted “Flap” 3 times at frame 40. The scene is now 77 frames long.');
        const frames = track(await scene(animator), 'wing-back', 'rotate').keys.map(k => k.frame);
        expect(frames).toEqual(expect.arrayContaining([40, 46, 52, 58, 64, 70, 76]));
        await animator.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(async () => (await scene(animator)).frameCount).toBe(48);
    });

    test('keeps the library in the downloaded scene', async ({ page }) => {
        const animator = await openSample(page);
        await animator.getByText('Library: saved poses and actions').click();
        await animator.getByLabel('Pose name').fill('Rest');
        await animator.getByRole('button', { name: 'Save pose' }).click();
        const downloadPromise = page.waitForEvent('download');
        await animator.getByRole('button', { name: 'Download scene' }).click();
        const chunks = [];
        for await (const chunk of await (await downloadPromise).createReadStream()) chunks.push(chunk);
        const saved = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        expect(Object.keys(saved.library.poses)).toEqual(['Rest']);
        expect(Object.keys(saved.library.poses.Rest)).toHaveLength(10);
        expect(saved.library.poses.Rest.eyes.swap).toBe(0);
    });
});
