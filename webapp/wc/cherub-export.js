/*!
 * Blue Cherub export: renders a scene to an MP4 video (H.264, with WebCodecs) or a zip of PNG frames.
 * Everything runs in the browser. Frames come from a hidden app-cherub-player, so the poses are the Rust
 * evaluator's, and the browser draws each frame's SVG to a canvas, so the export looks like the preview.
 * Set `source` to a function returning `{ svg, rig, scene, name }`, and call `describe()` when the scene changes.
 * Copyright © 2026 Stoic Dreams - https://www.stoicdreams.com
 */
"use strict"
{
    const HEIGHTS = [360, 720, 1080, 2160];

    // ----- Small binary writers -----
    const textBytes = text => new TextEncoder().encode(text);
    function u16(v) { return [(v >>> 8) & 255, v & 255]; }
    function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
    function concat(parts) {
        const arrays = parts.map(p => p instanceof Uint8Array ? p : new Uint8Array(p));
        const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
        let at = 0;
        arrays.forEach(a => { out.set(a, at); at += a.length; });
        return out;
    }

    // ----- ZIP (stored, no compression: PNGs are already compressed) -----
    const crcTable = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        return table;
    })();
    function crc32(bytes) {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }
    const le16 = v => [v & 255, (v >>> 8) & 255];
    const le32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    /** A zip file (as a Blob) of `{ name, data }` entries. */
    function makeZip(entries) {
        const parts = [];
        const central = [];
        let offset = 0;
        for (const { name, data } of entries) {
            const nameBytes = textBytes(name);
            const crc = crc32(data);
            // Version 2.0, UTF-8 names, stored, no date (1980-01-01).
            const fields = [...le16(20), ...le16(0x0800), ...le16(0), ...le16(0), ...le16(0x21), ...le32(crc), ...le32(data.length), ...le32(data.length), ...le16(nameBytes.length), ...le16(0)];
            parts.push(new Uint8Array([...le32(0x04034b50), ...fields]), nameBytes, data);
            central.push(concat([[...le32(0x02014b50), ...le16(20), ...fields, ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset)], nameBytes]));
            offset += 30 + nameBytes.length + data.length;
        }
        const centralSize = central.reduce((n, c) => n + c.length, 0);
        const end = [...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(entries.length), ...le16(entries.length), ...le32(centralSize), ...le32(offset), ...le16(0)];
        return new Blob([...parts, ...central, new Uint8Array(end)], { type: 'application/zip' });
    }

    // ----- MP4 (one H.264 video track, with the index first so it can play while downloading) -----
    function box(type, ...payload) {
        const body = concat(payload);
        return concat([u32(body.length + 8), textBytes(type), body]);
    }
    const fullBox = (type, version, flags, ...payload) => box(type, [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255], ...payload);
    const MATRIX = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

    /**
     * Build an MP4 from encoded H.264 samples (`{ data, key }` in order), the avcC description from the encoder,
     * the size, and the frame rate. Each sample lasts one frame.
     */
    function makeMp4({ samples, description, width, height, fps }) {
        const count = samples.length;
        const movieDuration = Math.round(count * 1000 / fps);
        const ftyp = box('ftyp', textBytes('isom'), u32(0x200), textBytes('isomiso2avc1mp41'));
        const moov = chunkOffset => {
            const avc1 = box('avc1',
                [0, 0, 0, 0, 0, 0], u16(1), new Uint8Array(16), u16(width), u16(height),
                u32(0x00480000), u32(0x00480000), u32(0), u16(1), new Uint8Array(32), u16(0x0018), u16(0xffff),
                box('avcC', description));
            const keyFrames = samples.map((s, i) => s.key ? i + 1 : 0).filter(Boolean);
            const stbl = box('stbl',
                fullBox('stsd', 0, 0, u32(1), avc1),
                fullBox('stts', 0, 0, u32(1), u32(count), u32(1)),
                fullBox('stss', 0, 0, u32(keyFrames.length), ...keyFrames.map(u32)),
                fullBox('stsc', 0, 0, u32(1), u32(1), u32(count), u32(1)),
                fullBox('stsz', 0, 0, u32(0), u32(count), ...samples.map(s => u32(s.data.length))),
                fullBox('stco', 0, 0, u32(1), u32(chunkOffset)));
            const minf = box('minf',
                fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
                box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
                stbl);
            const mdia = box('mdia',
                fullBox('mdhd', 0, 0, u32(0), u32(0), u32(fps), u32(count), u16(0x55c4), u16(0)),
                fullBox('hdlr', 0, 0, u32(0), textBytes('vide'), u32(0), u32(0), u32(0), textBytes('Blue Cherub video\0')),
                minf);
            const tkhd = fullBox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDuration), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16));
            const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDuration), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, new Uint8Array(24), u32(2));
            return box('moov', mvhd, box('trak', tkhd, mdia));
        };
        // The index's size doesn't depend on the offset, so build it once to measure, then again with the real offset.
        const moovSize = moov(0).length;
        const dataSize = samples.reduce((n, s) => n + s.data.length, 0);
        const mdatHeader = concat([u32(dataSize + 8), textBytes('mdat')]);
        const offset = ftyp.length + moovSize + 8;
        return new Blob([ftyp, moov(offset), mdatHeader, ...samples.map(s => s.data)], { type: 'video/mp4' });
    }

    function download(name, blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    /** H.264 profile and level for a size: High, level 4.0 up to 1080p and 5.1 above. */
    function avcCodecs(width, height) {
        const big = width * height > 1920 * 1088;
        return big ? ['avc1.640033', 'avc1.4d0033'] : ['avc1.640028', 'avc1.4d0028', 'avc1.42e01f'];
    }

    const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));

    webui.define("app-cherub-export", {
        preload: 'app:cherub-player',
        props: {
            /** True while an export is running. */
            busy: {
                get() { return !!this._job; }
            },
        },
        constructor() {
            const t = this;
            const q = selector => t.template.querySelector(selector);
            t._format = q('#export-format');
            t._height = q('#export-height');
            t._background = q('#export-background');
            t._transparent = q('#export-transparent');
            t._go = q('#export-go');
            t._cancel = q('#export-cancel');
            t._progress = q('progress');
            t._status = q('.export-status');
            t._size = q('.size');
            t._player = q('app-cherub-player');
            t._job = null;
            t._info = null;
            // The animator can set source before this element is upgraded, so keep a value that's already there.
            if (typeof t.source !== 'function') t.source = null;
            t._go.addEventListener('click', () => t.exportScene());
            t._cancel.addEventListener('click', () => t.cancel());
            [t._format, t._height, t._transparent].forEach(input => input.addEventListener('change', () => t._renderForm()));
        },
        connected() {
            this._renderForm();
        },
        /** Tell the panel about the scene, to show the output size and length. */
        describe({ aspect, frameCount, fps }) {
            this._info = { aspect, frameCount, fps };
            this._renderForm();
        },
        _dimensions() {
            const t = this;
            const height = parseInt(t._height.value) || 720;
            const aspect = t._info && t._info.aspect > 0 ? t._info.aspect : 1;
            // Video encoders need even sizes.
            const even = n => Math.max(2, Math.round(n / 2) * 2);
            return { width: even(height * aspect), height: even(height) };
        },
        _renderForm() {
            const t = this;
            const png = t._format.value === 'png';
            t._transparent.disabled = !png || !!t._job;
            if (!png) t._transparent.checked = false;
            t._background.disabled = t._transparent.checked || !!t._job;
            t._go.disabled = !!t._job || !t.source;
            [t._format, t._height].forEach(input => { input.disabled = !!t._job; });
            t._cancel.hidden = !t._job;
            t._progress.hidden = !t._job;
            const { width, height } = t._dimensions();
            const info = t._info;
            t._size.innerText = info
                ? `${width} × ${height} pixels, ${info.frameCount} frames, ${(info.frameCount / info.fps).toFixed(2)} seconds.`
                : `${width} × ${height} pixels.`;
        },
        _say(message) {
            this._status.innerText = message;
        },
        cancel() {
            if (this._job) this._job.cancelled = true;
        },
        /** Export the current scene in the chosen format. Resolves to the file's name, or null if it stopped. */
        async exportScene() {
            const t = this;
            if (t._job || typeof t.source !== 'function') return null;
            const data = t.source();
            if (!data || !data.svg || !data.rig || !data.scene) {
                t._say('There is no scene to export yet.');
                return null;
            }
            const job = t._job = { cancelled: false };
            t._renderForm();
            const format = t._format.value;
            const { width, height } = t._dimensions();
            const background = t._transparent.checked ? null : t._background.value;
            try {
                const loaded = await t._player.loadData({ svg: data.svg, rig: data.rig, scene: data.scene });
                if (!loaded.ok) throw new Error(loaded.error);
                const frames = t._player.frameCount;
                const fps = data.scene.fps;
                const canvas = new OffscreenCanvas(width, height);
                const ctx = canvas.getContext('2d', { alpha: true });
                const render = async frame => {
                    t._player.showFrame(frame);
                    await t._draw(ctx, width, height, background);
                    t._progress.value = (frame + 1) / frames;
                    t._say(`Rendering frame ${frame + 1} of ${frames}…`);
                    await nextFrame();
                    if (job.cancelled) throw new Error('cancelled');
                };
                let name;
                if (format === 'png') {
                    const entries = [];
                    const digits = Math.max(4, String(frames - 1).length);
                    for (let frame = 0; frame < frames; frame++) {
                        await render(frame);
                        const blob = await canvas.convertToBlob({ type: 'image/png' });
                        entries.push({ name: `${data.name}-${String(frame).padStart(digits, '0')}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
                    }
                    name = `${data.name}-frames.zip`;
                    download(name, makeZip(entries));
                } else {
                    name = `${data.name}.mp4`;
                    download(name, await t._encodeMp4({ frames, fps, width, height, canvas, render, job }));
                }
                t._say(`Exported ${name} (${width} × ${height}, ${frames} frames).`);
                t.dispatchEvent(new CustomEvent('exported', { detail: { name, format, width, height, frames } }));
                return name;
            } catch (ex) {
                t._say(ex && ex.message === 'cancelled' ? 'Export cancelled.' : `Export failed: ${ex && ex.message || ex}`);
                return null;
            } finally {
                t._job = null;
                t._progress.value = 0;
                t._renderForm();
            }
        },
        /** Draw the hidden player's current frame onto the canvas. */
        async _draw(ctx, width, height, background) {
            const t = this;
            const clone = t._player.svgElement.cloneNode(true);
            clone.setAttribute('width', width);
            clone.setAttribute('height', height);
            const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
            try {
                const img = new Image();
                img.src = url;
                await img.decode();
                ctx.clearRect(0, 0, width, height);
                if (background) {
                    ctx.fillStyle = background;
                    ctx.fillRect(0, 0, width, height);
                }
                ctx.drawImage(img, 0, 0, width, height);
            } finally {
                URL.revokeObjectURL(url);
            }
        },
        async _encodeMp4({ frames, fps, width, height, canvas, render, job }) {
            if (typeof VideoEncoder !== 'function') throw new Error('This browser cannot make videos. Try a current Chrome, Edge, or Safari, or export PNG frames.');
            let config = null;
            for (const codec of avcCodecs(width, height)) {
                const candidate = { codec, width, height, framerate: fps, bitrate: Math.round(width * height * fps * 0.12), avc: { format: 'avc' }, latencyMode: 'quality' };
                const support = await VideoEncoder.isConfigSupported(candidate);
                if (support.supported) {
                    config = candidate;
                    break;
                }
            }
            if (!config) throw new Error(`This browser cannot make an H.264 video at ${width} × ${height}. Try a smaller size, or export PNG frames.`);
            const samples = [];
            let description = null;
            let failure = null;
            const encoder = new VideoEncoder({
                output: (chunk, meta) => {
                    if (meta && meta.decoderConfig && meta.decoderConfig.description) description = new Uint8Array(meta.decoderConfig.description);
                    const data = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(data);
                    samples.push({ data, key: chunk.type === 'key', timestamp: chunk.timestamp });
                },
                error: ex => { failure = ex; },
            });
            encoder.configure(config);
            const frameDuration = 1e6 / fps;
            try {
                for (let frame = 0; frame < frames; frame++) {
                    await render(frame);
                    if (failure) throw failure;
                    const videoFrame = new VideoFrame(canvas, { timestamp: Math.round(frame * frameDuration), duration: Math.round(frameDuration) });
                    // A key frame every two seconds, so players can seek.
                    encoder.encode(videoFrame, { keyFrame: frame % (fps * 2) === 0 });
                    videoFrame.close();
                    // Don't let frames pile up faster than the encoder takes them.
                    while (encoder.encodeQueueSize > 4) await new Promise(resolve => setTimeout(resolve, 5));
                }
                await encoder.flush();
            } finally {
                if (encoder.state !== 'closed') encoder.close();
            }
            if (failure) throw failure;
            if (job.cancelled) throw new Error('cancelled');
            if (!description) throw new Error('The encoder gave no H.264 settings');
            if (samples.length !== frames) throw new Error(`The encoder returned ${samples.length} of ${frames} frames`);
            if (samples.some((s, i) => i && s.timestamp <= samples[i - 1].timestamp)) throw new Error('The encoder reordered frames, which this exporter does not support yet');
            return makeMp4({ samples, description, width, height, fps });
        },
        shadowTemplate: `
<div class="form">
<label for="export-format">Format</label>
<select id="export-format"><option value="mp4">MP4 video (H.264)</option><option value="png">PNG frames (zip)</option></select>
<label for="export-height">Size</label>
<select id="export-height">${HEIGHTS.map(h => `<option value="${h}"${h === 720 ? ' selected' : ''}>${h === 2160 ? '4K (2160p)' : `${h}p`}</option>`).join('')}</select>
<p class="note size"></p>
<label for="export-background">Background</label>
<input type="color" id="export-background" value="#ffffff">
<label class="check"><input type="checkbox" id="export-transparent"> Transparent (PNG frames only)</label>
<div class="row"><button type="button" id="export-go" class="primary">Export</button><button type="button" id="export-cancel" hidden>Cancel</button></div>
<progress max="1" value="0" hidden aria-label="Export progress"></progress>
<p class="export-status" role="status" aria-live="polite"></p>
</div>
<app-cherub-player hidden no-controls label="Export renderer"></app-cherub-player>
<style type="text/css">
:host {
display:block;
--export-border:color-mix(in srgb, currentColor 25%, transparent);
}
[hidden] {
display:none !important;
}
.form {
display:grid;
gap:0.35rem;
}
.form > * {
min-width:0;
}
button, select, input {
font:inherit;
}
select {
width:100%;
box-sizing:border-box;
padding:0.3rem 0.4rem;
border:1px solid var(--export-border);
border-radius:0.3rem;
background:var(--color-background, #333);
color:var(--color-background-offset, #fff);
}
input[type="color"] {
width:4rem;
height:2rem;
padding:0;
border:1px solid var(--export-border);
border-radius:0.3rem;
background:transparent;
}
button {
padding:0.35rem 0.75rem;
border:1px solid var(--export-border);
border-radius:0.35rem;
background:var(--color-background, #333);
color:var(--color-background-offset, #fff);
cursor:pointer;
}
button.primary {
background:var(--color-primary, #0980a4);
color:var(--color-primary-offset, #fff);
border-color:transparent;
}
button:disabled, input:disabled, select:disabled {
opacity:0.5;
cursor:default;
}
button:focus-visible, select:focus-visible, input:focus-visible {
outline:3px solid var(--color-active, #0b78ce);
outline-offset:2px;
}
.check {
display:flex;
gap:0.4rem;
align-items:center;
}
.row {
display:flex;
gap:0.5rem;
}
progress {
width:100%;
}
p {
margin:0;
}
.note {
font-size:0.9em;
opacity:0.85;
}
</style>
`
    });
}
