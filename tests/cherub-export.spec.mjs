import { test, expect, openPage, signIn, expectSignedIn } from './support/site.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function openExport(page) {
    await signIn(page, 1);
    await openPage(page, '/studio');
    await expectSignedIn(page, 1);
    const studio = page.locator('app-cherub-studio');
    await studio.getByRole('tab', { name: 'Animate' }).click();
    const animator = studio.locator('app-cherub-animator');
    await animator.getByRole('button', { name: 'Blue Cherub sample' }).click();
    await expect(animator.locator('.status')).toContainText('Loaded the Blue Cherub idle scene');
    await animator.getByText('Export: video or frames').click();
    return animator.locator('app-cherub-export');
}

async function downloadBytes(page, start) {
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await start();
    const download = await downloadPromise;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

/** The entries of a stored (uncompressed) zip. */
function readZip(bytes) {
    const entries = [];
    let at = 0;
    while (bytes.readUInt32LE(at) === 0x04034b50) {
        const size = bytes.readUInt32LE(at + 18);
        const nameLength = bytes.readUInt16LE(at + 26);
        const extra = bytes.readUInt16LE(at + 28);
        const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8');
        const start = at + 30 + nameLength + extra;
        entries.push({ name, data: bytes.subarray(start, start + size) });
        at = start + size;
    }
    return entries;
}

/** The top-level boxes of an MP4, and a lookup for nested ones by path such as moov/trak/mdia/minf/stbl/stsz. */
function mp4Boxes(bytes) {
    const list = (start, end) => {
        const out = [];
        for (let at = start; at + 8 <= end;) {
            const size = bytes.readUInt32BE(at);
            out.push({ type: bytes.subarray(at + 4, at + 8).toString('latin1'), start: at, end: at + size });
            if (size < 8) break;
            at += size;
        }
        return out;
    };
    const top = list(0, bytes.length);
    const find = path => {
        let boxes = top;
        let found = null;
        for (const type of path.split('/')) {
            found = boxes.find(b => b.type === type);
            if (!found) return null;
            boxes = list(found.start + 8, found.end);
        }
        return found;
    };
    return { top, find };
}

test.describe('app-cherub-export', () => {
    test('shows the output size and length for the chosen size', async ({ page }) => {
        const exporter = await openExport(page);
        await expect(exporter.locator('.size')).toHaveText('720 × 720 pixels, 48 frames, 2.00 seconds.');
        await exporter.getByLabel('Size').selectOption('1080');
        await expect(exporter.locator('.size')).toHaveText('1080 × 1080 pixels, 48 frames, 2.00 seconds.');
        // Transparency is only for PNG frames, since H.264 video has no transparency.
        await expect(exporter.getByLabel('Transparent (PNG frames only)')).toBeDisabled();
        await exporter.getByLabel('Format').selectOption('png');
        await expect(exporter.getByLabel('Transparent (PNG frames only)')).toBeEnabled();
    });

    test('exports every frame as a transparent PNG in a zip', async ({ page }) => {
        test.setTimeout(90000);
        const exporter = await openExport(page);
        await exporter.getByLabel('Format').selectOption('png');
        await exporter.getByLabel('Size').selectOption('360');
        await exporter.getByLabel('Transparent (PNG frames only)').check();
        const { name, bytes } = await downloadBytes(page, () => exporter.getByRole('button', { name: 'Export' }).click());
        expect(name).toBe('blue-cherub-frames.zip');
        const entries = readZip(bytes);
        expect(entries).toHaveLength(48);
        expect(entries[0].name).toBe('blue-cherub-0000.png');
        expect(entries[47].name).toBe('blue-cherub-0047.png');
        const png = entries[0].data;
        expect([...png.subarray(1, 4)].map(c => String.fromCharCode(c)).join('')).toBe('PNG');
        // The IHDR chunk: 360 by 360, with an alpha channel (color type 6).
        expect([png.readUInt32BE(16), png.readUInt32BE(20), png[25]]).toEqual([360, 360, 6]);
        // Frames differ, since the cherub moves.
        expect(Buffer.compare(entries[0].data, entries[24].data)).not.toBe(0);
        await expect(exporter.locator('.export-status')).toContainText('Exported blue-cherub-frames.zip (360 × 360, 48 frames)');
    });

    test('exports an H.264 MP4 that plays', async ({ page }) => {
        test.setTimeout(90000);
        const exporter = await openExport(page);
        await exporter.getByLabel('Size').selectOption('360');
        const { name, bytes } = await downloadBytes(page, () => exporter.getByRole('button', { name: 'Export' }).click());
        expect(name).toBe('blue-cherub.mp4');
        const { top, find } = mp4Boxes(bytes);
        // The index comes before the video data, so it can play while downloading.
        expect(top.map(b => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
        const stsz = find('moov/trak/mdia/minf/stbl/stsz');
        expect(bytes.readUInt32BE(stsz.start + 16)).toBe(48);
        const mvhd = find('moov/mvhd');
        expect([bytes.readUInt32BE(mvhd.start + 20), bytes.readUInt32BE(mvhd.start + 24)]).toEqual([1000, 2000]);
        expect(find('moov/trak/mdia/minf/stbl/stsd')).not.toBeNull();

        // When ffprobe is installed (it is on GitHub's runners), check that a real decoder reads every frame.
        const probe = spawnSync('ffprobe', ['-version']);
        if (probe.status === 0) {
            const dir = mkdtempSync(join(tmpdir(), 'cherub-'));
            try {
                const file = join(dir, name);
                writeFileSync(file, bytes);
                const result = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,avg_frame_rate', '-of', 'json', file], { encoding: 'utf8' });
                expect(result.stderr).toBe('');
                const stream = JSON.parse(result.stdout).streams[0];
                expect(stream).toEqual({ codec_name: 'h264', width: 360, height: 360, avg_frame_rate: '24/1', nb_read_frames: '48' });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    test('can be cancelled', async ({ page }) => {
        const exporter = await openExport(page);
        await exporter.getByLabel('Format').selectOption('png');
        const result = await exporter.evaluate(el => {
            const running = el.exportScene();
            el.cancel();
            return running;
        });
        expect(result).toBeNull();
        await expect(exporter.locator('.export-status')).toHaveText('Export cancelled.');
        await expect(exporter.getByRole('button', { name: 'Export' })).toBeEnabled();
    });

    test('explains when the browser cannot make videos', async ({ page }) => {
        const exporter = await openExport(page);
        await page.evaluate(() => { delete window.VideoEncoder; });
        await exporter.getByRole('button', { name: 'Export' }).click();
        await expect(exporter.locator('.export-status')).toContainText('This browser cannot make videos');
    });
});
