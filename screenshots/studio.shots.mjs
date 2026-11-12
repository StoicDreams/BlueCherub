import { test, expect, openPage, signIn, expectSignedIn, ROOT_FILES } from '../tests/support/site.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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

    // Animate: the export panel, with the library closed again.
    await animator.getByText('Library: saved poses and actions').click();
    await animator.getByText('Export: video or frames').click();
    await expect(animator.locator('app-cherub-export').locator('.size')).toContainText('720 × 720 pixels');
    await shot('animate-export');
});

// ----- Clips -----
// Short MP4 clips of the studio in use, for features that are actions. Each clip is captured stop-motion: the script
// takes one step, screenshots a fixed area, and repeats, so the clip is sharp and the same on every run. ffmpeg
// encodes the frames (H.264, yuv420p, faststart). The PNG of the same name is the clip's poster.
// Needs ffmpeg on the PATH. Without it, the clips are skipped and the PNG stills are used.
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** Collects frames of one area of the page, then writes them as an MP4. */
async function recorder(page, locator, name, fps = 12) {
    const box = await locator.boundingBox();
    const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.floor(box.width / 2) * 2, height: Math.floor(box.height / 2) * 2 };
    const dir = mkdtempSync(join(tmpdir(), `cherub-${name}-`));
    // Park the mouse out of the way, so hover effects stay out of the clip.
    await page.mouse.move(clip.x + clip.width - 2, clip.y + clip.height - 2);
    let count = 0;
    let last = null;
    const write = buffer => writeFileSync(join(dir, `${String(count++).padStart(4, '0')}.png`), buffer);
    return {
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
            const out = join(STUDIO_SHOTS, `${name}.mp4`);
            const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, '%04d.png'),
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { encoding: 'utf8' });
            rmSync(dir, { recursive: true, force: true });
            if (result.status !== 0) throw new Error(`ffmpeg failed for ${name}: ${result.stderr}`);
        },
    };
}

test('clips of the studio in use', async ({ page }) => {
    test.skip(!hasFfmpeg, 'ffmpeg is not installed, so the clips keep their PNG stills');
    test.setTimeout(240000);
    await page.clock.setFixedTime(new Date('2026-11-02T15:00:00Z'));
    await page.setViewportSize({ width: 1280, height: 1300 });
    await signIn(page, 1);
    await openPage(page, '/studio');
    await expectSignedIn(page, 1);
    await page.evaluate(() => document.querySelectorAll('webui-page-help').forEach(help => { help.style.visibility = 'hidden'; }));
    const studio = page.locator('app-cherub-studio');
    const rigger = studio.locator('app-cherub-rigger');
    const animator = studio.locator('app-cherub-animator');
    const layers = rigger.locator('app-cherub-layers');
    await rigger.getByRole('button', { name: 'Blue Cherub sample' }).click();
    await expect(rigger.locator('.status')).toContainText('with 10 parts');

    // Pivots: select the bow arm, then Test swings it around the shoulder, carrying the bow.
    await layers.getByRole('button', { name: /^arm-bow/ }).click();
    await rigger.getByRole('button', { name: 'Test', exact: true }).click();
    const preview = rigger.locator('.preview app-cherub-player');
    await expect(preview).toHaveAttribute('loaded', '');
    await preview.evaluate(el => el.pause());
    let rec = await recorder(page, rigger, 'rig-pivots');
    for (let frame = 0; frame < 36; frame++) {
        await preview.evaluate((el, f) => el.showFrame(f), frame);
        await rec.snap();
    }
    rec.finish();
    await rigger.getByRole('button', { name: 'Stop test' }).click();

    // Swaps: flip the eyes between their drawings.
    await layers.getByRole('button', { name: /^eyes\s*Group/ }).click();
    rec = await recorder(page, rigger, 'rig-swaps', 4);
    await rec.snap();
    rec.hold(3);
    // Selecting a drawing shows it on the stage.
    for (const drawing of ['eyes-closed', 'eyes-open', 'eyes-closed', 'eyes-open']) {
        await layers.getByRole('button', { name: new RegExp(`^${drawing}\\s*Group`) }).click();
        await rec.snap();
        rec.hold(2);
    }
    rec.finish();

    // Timeline: scrub through the idle scene, frame by frame, at its own speed.
    await studio.getByRole('tab', { name: 'Animate' }).click();
    await animator.getByRole('button', { name: 'Blue Cherub sample' }).click();
    await expect(animator.locator('.status')).toContainText('Loaded the Blue Cherub idle scene');
    await animator.locator('.parts').getByRole('button', { name: 'wing-back' }).click();
    rec = await recorder(page, animator, 'animate-timeline', 24);
    for (let frame = 0; frame < 48; frame++) {
        await animator.evaluate((el, f) => el.setFrame(f), frame);
        await rec.snap();
    }
    rec.finish();

    // Posing: drag the head, then rotate it.
    await animator.evaluate(el => el.setFrame(12));
    const head = animator.locator('app-cherub-player').locator('[id="head"] > circle');
    let box = await head.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.click(cx, cy);
    rec = await recorder(page, animator, 'animate-pose', 12);
    await rec.snap();
    rec.hold(4);
    const drag = async (from, to, steps) => {
        await page.mouse.move(from[0], from[1]);
        await page.mouse.down();
        for (let i = 1; i <= steps; i++) {
            await page.mouse.move(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps);
            await page.waitForTimeout(30);
            await rec.snap();
        }
        await page.mouse.up();
        await page.waitForTimeout(100);
        await rec.snap();
        rec.hold(5);
    };
    await drag([cx, cy], [cx + 40, cy - 15], 10);
    await animator.getByRole('button', { name: 'Rotate', exact: true }).click();
    await rec.snap();
    rec.hold(3);
    // Press on the moved head, below its middle, and swing it around the neck.
    await drag([cx + 40, cy + 20], [cx + 100, cy + 20], 12);
    rec.finish();

    // Library: save the wing's flap as an action, insert it three times, and play the result.
    // Start again from the untouched sample.
    await animator.getByRole('button', { name: 'Blue Cherub sample' }).click();
    await expect(animator.locator('.status')).toContainText('Loaded the Blue Cherub idle scene');
    await animator.getByRole('button', { name: 'Move', exact: true }).click();
    await animator.locator('.parts').getByRole('button', { name: 'wing-back' }).click();
    await animator.getByText('Library: saved poses and actions').click();
    await animator.evaluate(el => el.setFrame(0));
    rec = await recorder(page, animator, 'animate-library', 12);
    await rec.snap();
    await animator.getByLabel('Action name').fill('Flap');
    await animator.getByLabel('To frame').fill('12');
    await animator.getByLabel('Save', { exact: true }).last().selectOption('part');
    await rec.snap();
    rec.hold(4);
    await animator.getByRole('button', { name: 'Save action' }).click();
    await rec.snap();
    rec.hold(6);
    await animator.evaluate(el => el.setFrame(40));
    await animator.getByLabel('Insert it this many times').fill('3');
    await rec.snap();
    rec.hold(4);
    await animator.getByRole('button', { name: 'Insert Flap' }).click();
    await expect(animator.locator('.status')).toContainText('Inserted “Flap” 3 times');
    await rec.snap();
    rec.hold(8);
    for (let frame = 40; frame < 77; frame += 2) {
        await animator.evaluate((el, f) => el.setFrame(f), frame);
        await rec.snap();
    }
    rec.hold(6);
    rec.finish();
});
