import { test, expect, openPage, signIn, expectSignedIn, ROOT_FILES } from '../tests/support/site.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Blue Cherub only: screenshots of the studio at each stage of using it, for the home page and the guide.
// Saved to webapp/root_files/img/screenshots/studio (served at /img/screenshots/studio/).
// When the studio changes, update these steps, the home page (webapp/d/root.md), and the guide
// (webapp/root_files/guide/studio-guide.md) together. See claude/bluecherub/CLAUDE.md.
// CHERUB_SHOTS_DIR sends them somewhere else, such as a temporary folder when running these many times to check them.
// Each worker gets its own folder there, so parallel runs never write the same file at once.
export const STUDIO_SHOTS = process.env.CHERUB_SHOTS_DIR
    ? join(process.env.CHERUB_SHOTS_DIR, `worker-${process.env.TEST_WORKER_INDEX || 0}`)
    : join(ROOT_FILES, 'img', 'screenshots', 'studio');

/**
 * Waits for everything that changes a picture: fonts, icons, images, and fades. Nothing here waits for an amount of time.
 * The same steps as pictureReady in pages.shots.mjs, which does not export it.
 */
async function pictureReady(page) {
    await page.evaluate(async () => {
        const all = (root, found = []) => {
            for (const el of root.querySelectorAll('*')) {
                found.push(el);
                if (el.shadowRoot) all(el.shadowRoot, found);
            }
            return found;
        };
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const elements = all(document);
        await document.fonts.ready;
        // Icons draw themselves once their definition has downloaded. This asks for the same cached download each
        // icon is waiting on, so when it answers, and a frame has passed, every icon has been given its drawing.
        const icons = new Set(elements.filter(el => el.localName === 'webui-icon' && el._iconRequest).map(el => el._iconRequest));
        await Promise.all([...icons].map(name => webui.fetchWithCache(`${webui.cdnRoot}icons/${name}.webui`).catch(() => { })));
        // An image that is out of view and loads lazily has not started, and will not until it is scrolled to.
        const images = elements.filter(el => el.localName === 'img' && el.currentSrc && !(el.loading === 'lazy' && !el.complete));
        await Promise.all(images.map(img => img.complete ? null : new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        })));
        // A broken image rejects decode, and still shows the same every time.
        await Promise.all(images.map(img => img.decode().catch(() => { })));
        // Transitions start when the browser next works out styles, so let two frames pass before looking for them.
        await frame();
        await frame();
        // Fades, icon morphs, and other transitions that end. A looping animation never finishes, so it is left running.
        // document.getAnimations leaves out shadow roots, where the components keep theirs, so each root is asked.
        const roots = () => [document, ...all(document).map(el => el.shadowRoot).filter(Boolean)];
        const ending = () => roots().flatMap(root => root.getAnimations()).filter(animation => animation.playState === 'running'
            && Number.isFinite(animation.effect?.getComputedTiming().endTime));
        for (let running = ending(); running.length; running = ending()) {
            await Promise.all(running.map(animation => animation.finished.catch(() => { })));
        }
        await document.fonts.ready;
        // Two frames, so the browser has painted the finished page before the picture is taken.
        await frame();
        await frame();
    });
}

/**
 * A picture of a page or an element once it has stopped changing: it is taken again until two in a row are the same.
 * The browser redraws text more sharply a few frames after a fade ends, and nothing says when it has, so this is how
 * the picture comes out the same on every run without waiting for an amount of time.
 */
async function stillPicture(target, options = {}) {
    let last = await target.screenshot(options);
    for (let tries = 0; tries < 30; tries++) {
        const next = await target.screenshot(options);
        if (next.equals(last)) return next;
        last = next;
    }
    throw new Error('The picture never stopped changing, so something on the page is still moving.');
}

// Each picture is its own test that opens its own studio, so a slow machine only has to finish one picture in a test's time,
// and a failure names the picture. Each test renders the studio and takes the picture until it stops changing, which is
// heavy work on a busy machine, so each gets triple the usual time (test.slow).

/** Opens the studio signed in, with the help bubble hidden, at the usual window size. */
async function openStudio(page, height = 900) {
    await page.clock.setFixedTime(new Date('2026-11-02T15:00:00Z'));
    await page.setViewportSize({ width: 1280, height });
    mkdirSync(STUDIO_SHOTS, { recursive: true });
    await signIn(page, 1);
    await openPage(page, '/studio');
    await expectSignedIn(page, 1);
    const studio = page.locator('app-cherub-studio');
    const rigger = studio.locator('app-cherub-rigger');
    const animator = studio.locator('app-cherub-animator');
    const layers = rigger.locator('app-cherub-layers');
    // The help bubble floats over the studio. It belongs in the guide, not in pictures of the studio.
    await page.evaluate(() => document.querySelectorAll('webui-page-help').forEach(help => { help.style.visibility = 'hidden'; }));
    return { studio, rigger, animator, layers };
}

/** The Rig tab with the Blue Cherub sample loaded. */
async function rigSample(page, height) {
    const parts = await openStudio(page, height);
    await parts.rigger.getByRole('button', { name: 'Blue Cherub sample' }).click();
    await expect(parts.rigger.locator('.status')).toContainText('with 10 parts');
    return parts;
}

/** The Animate tab with the Blue Cherub idle scene loaded. */
async function animateSample(page, height) {
    const parts = await openStudio(page, height);
    await parts.studio.getByRole('tab', { name: 'Animate' }).click();
    await parts.animator.getByRole('button', { name: 'Blue Cherub sample' }).click();
    await expect(parts.animator.locator('.status')).toContainText('Loaded the Blue Cherub idle scene');
    return parts;
}

/** Saves a picture of the whole studio, scrolled to the top, with the window grown to fit it. */
async function shot(page, studio, name) {
    await studio.evaluate(el => {
        // The page scrolls inside the app shell's shadow DOM, so follow slots and shadow hosts up, not just parents.
        for (let node = el; node; node = node.assignedSlot || node.parentElement || (node.getRootNode && node.getRootNode().host)) {
            if (node.scrollTop) node.scrollTop = 0;
        }
        window.scrollTo(0, 0);
    });
    const box = await studio.boundingBox();
    const height = Math.ceil(box.y + box.height + 60);
    if (height > page.viewportSize().height) await page.setViewportSize({ width: 1280, height });
    // Keep hover effects out of the picture, then wait for fonts, icons, and fades to finish.
    await page.mouse.move(640, page.viewportSize().height - 4);
    await pictureReady(page);
    writeFileSync(join(STUDIO_SHOTS, `${name}.png`), await stillPicture(studio));
}

test.describe('studio stills', () => {
    test('rig-layers: the sample with a group selected in the layers', async ({ page }) => {
        test.slow();
        const { studio, layers } = await rigSample(page);
        await layers.getByRole('button', { name: /^arrow\s*Group/ }).click();
        await expect(layers.getByRole('button', { name: /^arrow\s*Group/ })).toHaveAttribute('aria-pressed', 'true');
        await shot(page, studio, 'rig-layers');
    });

    test('rig-pivots: a part with its pivot and the lines to its parent', async ({ page }) => {
        test.slow();
        const { studio, rigger, layers } = await rigSample(page);
        await layers.getByRole('button', { name: /^arm-bow/ }).click();
        await expect(rigger.getByLabel('Attached to')).toHaveValue('body');
        await shot(page, studio, 'rig-pivots');
    });

    test('rig-swaps: swap drawings for the eyes', async ({ page }) => {
        test.slow();
        const { studio, rigger, layers } = await rigSample(page);
        await layers.getByRole('button', { name: /^eyes\s*Group/ }).click();
        await expect(rigger.getByRole('button', { name: 'Stop swapping' })).toBeVisible();
        await shot(page, studio, 'rig-swaps');
    });

    test('animate-timeline: the idle scene, with the wing\'s keys on the timeline', async ({ page }) => {
        test.slow();
        const { studio, animator } = await animateSample(page);
        await animator.getByRole('button', { name: 'wing-back key at frame 6' }).click();
        await expect.poll(() => animator.evaluate(el => el.frame)).toBe(6);
        await shot(page, studio, 'animate-timeline');
    });

    test('animate-pose: the rotate tool, aiming the bow arm', async ({ page }) => {
        test.slow();
        const { studio, animator } = await animateSample(page);
        await animator.locator('.parts').getByRole('button', { name: 'arm-bow' }).click();
        await animator.getByRole('button', { name: 'Rotate', exact: true }).click();
        await animator.getByLabel('Frame', { exact: true }).fill('12');
        await expect.poll(() => animator.evaluate(el => el.frame)).toBe(12);
        await animator.getByLabel('Rotate (°)').fill('-20');
        await animator.getByLabel('Rotate (°)').press('Enter');
        await expect(animator.getByLabel('Rotate (°) ◆')).toHaveValue('-20');
        await shot(page, studio, 'animate-pose');
    });

    test('animate-library: a saved pose and a saved action in the library', async ({ page }) => {
        test.slow();
        const { studio, animator } = await animateSample(page);
        await animator.locator('.parts').getByRole('button', { name: 'arm-bow' }).click();
        await animator.getByText('Library: saved poses and actions').click();
        await animator.getByLabel('Pose name').fill('Aim');
        await animator.getByRole('button', { name: 'Save pose' }).click();
        await expect(animator.getByRole('button', { name: 'Apply Aim' })).toBeVisible();
        await animator.locator('.parts').getByRole('button', { name: 'wing-back' }).click();
        await animator.getByLabel('Action name').fill('Flap');
        await animator.getByLabel('To frame').fill('12');
        await animator.getByLabel('Save', { exact: true }).last().selectOption('part');
        await animator.getByRole('button', { name: 'Save action' }).click();
        await expect(animator.locator('.status')).toContainText('Saved the action “Flap”');
        await shot(page, studio, 'animate-library');
    });

    test('animate-export: the export panel', async ({ page }) => {
        test.slow();
        const { studio, animator } = await animateSample(page);
        await animator.locator('.parts').getByRole('button', { name: 'wing-back' }).click();
        await animator.getByText('Export: video or frames').click();
        await expect(animator.locator('app-cherub-export').locator('.size')).toContainText('720 × 720 pixels');
        await shot(page, studio, 'animate-export');
    });
});

// ----- Clips -----
// Short MP4 clips of the studio in use, for features that are actions. Each clip is captured stop-motion: the script
// takes one step, screenshots a fixed area, and repeats, so the clip is sharp and the same on every run. ffmpeg
// encodes the frames twice: H.264 MP4 (for Safari and most browsers) and AV1 WebM (for browsers built without H.264,
// such as some Linux Chromium builds and the one on GitHub's runners). The PNG of the same name is the clip's poster.
// Needs ffmpeg on the PATH. Without it, the clips are skipped and the PNG stills are used.
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** Collects frames of one area of the page, then writes them as an MP4. */
async function recorder(page, locator, name, fps = 12) {
    let box = await locator.boundingBox();
    // Grow the window when the area doesn't fit, as the stills do, so a frame is never cut off at the bottom.
    const needed = Math.ceil(box.y + box.height + 20);
    if (needed > page.viewportSize().height) {
        await page.setViewportSize({ width: page.viewportSize().width, height: needed });
        box = await locator.boundingBox();
    }
    const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.floor(box.width / 2) * 2, height: Math.floor(box.height / 2) * 2 };
    const dir = mkdtempSync(join(tmpdir(), `cherub-${name}-`));
    // Park the mouse out of the way, so hover effects and tooltips stay out of the clip.
    const park = () => page.mouse.move(clip.x + clip.width - 2, clip.y + clip.height - 2);
    await park();
    let count = 0;
    let last = null;
    const write = buffer => writeFileSync(join(dir, `${String(count++).padStart(4, '0')}.png`), buffer);
    return {
        /** Move the mouse out of the picture again, after a click leaves it over a button. Never call it mid-drag. */
        park,
        /** Take a frame now. It never moves the mouse, so it can be used in the middle of a drag. */
        async snap() {
            last = await page.screenshot({ clip });
            write(last);
        },
        /** Repeat the last frame, to pause on it. */
        hold(frames) {
            for (let i = 0; i < frames; i++) write(last);
        },
        finish() {
            const input = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, '%04d.png'), '-pix_fmt', 'yuv420p'];
            const encodings = [
                // Presets that encode quickly. These clips are short and mostly still, so slower presets save little and
                // tie up every core while other pictures are being taken.
                ['mp4', ['-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-movflags', '+faststart']],
                ['webm', ['-c:v', 'libsvtav1', '-preset', '8', '-crf', '40']],
            ];
            try {
                for (const [extension, codec] of encodings) {
                    const result = spawnSync('ffmpeg', [...input, ...codec, join(STUDIO_SHOTS, `${name}.${extension}`)], { encoding: 'utf8' });
                    if (result.status !== 0) throw new Error(`ffmpeg failed for ${name}.${extension}: ${result.stderr}`);
                }
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
    };
}

// Each clip is its own test, for the same reasons as the stills. A clip takes dozens of pictures and encodes them twice,
// which is heavy work on a busy machine, so each gets triple the usual time (test.slow).
test.describe('studio clips', () => {
    test.skip(!hasFfmpeg, 'ffmpeg is not installed, so the clips keep their PNG stills');

    test('rig-pivots: Test swings the bow arm around the shoulder, carrying the bow', async ({ page }) => {
        test.slow();
        const { rigger, layers } = await rigSample(page, 1300);
        await layers.getByRole('button', { name: /^arm-bow/ }).click();
        await rigger.getByRole('button', { name: 'Test', exact: true }).click();
        const preview = rigger.locator('.preview app-cherub-player');
        await expect(preview).toHaveAttribute('loaded', '');
        // One handle for every frame, so a busy machine doesn't look the element up again each time.
        const player = await preview.elementHandle();
        await player.evaluate(el => el.pause());
        const rec = await recorder(page, rigger, 'rig-pivots');
        for (let frame = 0; frame < 36; frame++) {
            await player.evaluate((el, f) => el.showFrame(f), frame);
            await rec.snap();
        }
        rec.finish();
    });

    test('rig-swaps: the eyes flip between their drawings', async ({ page }) => {
        test.slow();
        const { rigger, layers } = await rigSample(page, 1300);
        await layers.getByRole('button', { name: /^eyes\s*Group/ }).click();
        await expect(rigger.getByRole('button', { name: 'Stop swapping' })).toBeVisible();
        const rec = await recorder(page, rigger, 'rig-swaps', 4);
        await rec.snap();
        rec.hold(3);
        // Selecting a drawing shows it on the stage.
        for (const drawing of ['eyes-closed', 'eyes-open', 'eyes-closed', 'eyes-open']) {
            const item = layers.getByRole('button', { name: new RegExp(`^${drawing}\\s*Group`) });
            await item.click();
            await rec.park();
            await expect(item).toHaveAttribute('aria-pressed', 'true');
            await rec.snap();
            rec.hold(2);
        }
        rec.finish();
    });

    test('animate-timeline: scrubbing through the idle scene, frame by frame, at its own speed', async ({ page }) => {
        test.slow();
        const { animator } = await animateSample(page, 1300);
        await animator.locator('.parts').getByRole('button', { name: 'wing-back' }).click();
        const editor = await animator.elementHandle();
        const rec = await recorder(page, animator, 'animate-timeline', 24);
        for (let frame = 0; frame < 48; frame++) {
            await editor.evaluate((el, f) => el.setFrame(f), frame);
            await rec.snap();
        }
        rec.finish();
    });

    test('animate-pose: dragging the head, then rotating it', async ({ page }) => {
        test.slow();
        const { animator } = await animateSample(page, 1300);
        const editor = await animator.elementHandle();
        await editor.evaluate(el => el.setFrame(12));
        const head = animator.locator('app-cherub-player').locator('[id="head"] > circle');
        const box = await head.boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.click(cx, cy);
        await expect.poll(() => editor.evaluate(el => el.selectedPart)).toBe('head');
        const rec = await recorder(page, animator, 'animate-pose', 12);
        await rec.snap();
        rec.hold(4);
        // Each step of a drag is drawn after the worker works out the new pose, so wait for the head to be drawn in its new
        // place before taking the frame. Letting go reads the pose again, and the animator shows it once that is done.
        const drawn = () => animator.locator('app-cherub-player').locator('[id="head"]').getAttribute('transform');
        const keyed = property => editor.evaluate((el, property) => el.sceneData.tracks.find(tr => tr.part === 'head' && tr.property === property)?.keys.find(key => key.frame === 12)?.value, property);
        const posed = property => editor.evaluate((el, property) => el.poses.head?.[property], property);
        const drag = async (from, to, steps, property) => {
            await page.mouse.move(from[0], from[1]);
            await page.mouse.down();
            for (let i = 1; i <= steps; i++) {
                const before = await drawn();
                await page.mouse.move(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps);
                await expect.poll(drawn).not.toBe(before);
                await rec.snap();
            }
            await page.mouse.up();
            await expect.poll(async () => (await posed(property)) === (await keyed(property))).toBe(true);
            await rec.snap();
            rec.hold(5);
        };
        await drag([cx, cy], [cx + 40, cy - 15], 10, 'x');
        await animator.getByRole('button', { name: 'Rotate', exact: true }).click();
        await rec.park();
        await expect(animator.getByRole('button', { name: 'Rotate', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await rec.snap();
        rec.hold(3);
        // Press on the moved head, below its middle, and swing it around the neck.
        await drag([cx + 40, cy + 20], [cx + 100, cy + 20], 12, 'rotate');
        rec.finish();
    });

    test('animate-library: saving the wing\'s flap as an action, inserting it three times, and playing the result', async ({ page }) => {
        test.slow();
        const { animator } = await animateSample(page, 1300);
        const editor = await animator.elementHandle();
        await animator.locator('.parts').getByRole('button', { name: 'wing-back' }).click();
        await animator.getByText('Library: saved poses and actions').click();
        await expect(animator.getByLabel('Action name')).toBeVisible();
        const rec = await recorder(page, animator, 'animate-library', 12);
        await rec.snap();
        await animator.getByLabel('Action name').fill('Flap');
        await animator.getByLabel('To frame').fill('12');
        await animator.getByLabel('Save', { exact: true }).last().selectOption('part');
        await rec.park();
        await rec.snap();
        rec.hold(4);
        await animator.getByRole('button', { name: 'Save action' }).click();
        await rec.park();
        await expect(animator.getByRole('button', { name: 'Insert Flap' })).toBeVisible();
        await rec.snap();
        rec.hold(6);
        await editor.evaluate(el => el.setFrame(40));
        await animator.getByLabel('Insert it this many times').fill('3');
        await rec.park();
        await rec.snap();
        rec.hold(4);
        await animator.getByRole('button', { name: 'Insert Flap' }).click();
        await rec.park();
        await expect(animator.locator('.status')).toContainText('Inserted “Flap” 3 times');
        await rec.snap();
        rec.hold(8);
        for (let frame = 40; frame < 77; frame += 2) {
            await editor.evaluate((el, f) => el.setFrame(f), frame);
            await rec.snap();
        }
        rec.hold(6);
        rec.finish();
    });
});
