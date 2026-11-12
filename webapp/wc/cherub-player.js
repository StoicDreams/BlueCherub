/*!
 * Blue Cherub player: plays a Blue Cherub scene (a rigged SVG character animated by keyframes).
 * The frame transforms come from the Rust scene evaluator in the web worker (webapp/src/scene.rs).
 * Copyright © 2026 Stoic Dreams - https://www.stoicdreams.com
 */
"use strict"
{
    const SVG_NS = 'http://www.w3.org/2000/svg';
    // Imported SVG is treated as hostile: only drawing elements are kept, and nothing that can run script or load files.
    const allowedElements = new Set([
        'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'symbol', 'use',
        'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'title', 'desc', 'text', 'tspan',
        'filter', 'fegaussianblur', 'feoffset', 'feblend', 'feflood', 'fecomposite', 'femerge', 'femergenode', 'fecolormatrix',
    ]);
    const textElements = new Set(['title', 'desc', 'text', 'tspan']);
    const unsafeValue = /javascript:|data:|vbscript:|expression\s*\(/i;
    const urlReference = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;

    function safeAttribute(name, value) {
        const lower = name.toLowerCase();
        if (lower.startsWith('on')) return false;
        if (unsafeValue.test(value)) return false;
        if (lower === 'href' || lower === 'xlink:href') return value.trim().startsWith('#');
        for (const match of value.matchAll(urlReference)) {
            if (!match[2].trim().startsWith('#')) return false;
        }
        return true;
    }

    function cleanCopy(source, doc) {
        const name = source.localName.toLowerCase();
        if (source.namespaceURI !== SVG_NS || !allowedElements.has(name)) return null;
        const copy = doc.createElementNS(SVG_NS, source.localName);
        for (const attr of source.attributes) {
            if (!safeAttribute(attr.name, attr.value)) continue;
            if (attr.namespaceURI) {
                copy.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
            } else {
                copy.setAttribute(attr.name, attr.value);
            }
        }
        for (const child of source.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const cleanChild = cleanCopy(child, doc);
                if (cleanChild) copy.appendChild(cleanChild);
            } else if (child.nodeType === Node.TEXT_NODE && textElements.has(name)) {
                copy.appendChild(doc.createTextNode(child.textContent));
            }
        }
        return copy;
    }

    /**
     * Parse SVG text and return a clean <svg> element, or throw if it isn't SVG.
     * Shared with the editor through window.appCherub.
     */
    function sanitizeSvg(text) {
        const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
        const root = parsed.documentElement;
        if (!root || root.localName !== 'svg' || parsed.querySelector('parsererror')) {
            throw new Error('The file is not valid SVG');
        }
        return cleanCopy(root, document);
    }

    // Components can load before the worker starts, so wait for it with an event, not a timer.
    function workerReady() {
        if (webui.worker) return Promise.resolve();
        return new Promise(resolve => {
            document.addEventListener('app-worker-ready', () => resolve(), { once: true });
        });
    }

    async function fetchFile(url, kind) {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Could not load ${kind} ${url} (${response.status})`);
        return response;
    }

    /** Load a scene, its rig, and its SVG, and evaluate it into a frame table. */
    async function loadScene(sceneUrl) {
        const sceneHref = new URL(sceneUrl, location.href);
        const scene = await (await fetchFile(sceneHref, 'scene')).json();
        const rigHref = new URL(scene.rig, sceneHref);
        const rig = await (await fetchFile(rigHref, 'rig')).json();
        const svgHref = new URL(rig.svg, rigHref);
        const svg = sanitizeSvg(await (await fetchFile(svgHref, 'SVG')).text());
        return { scene, rig, svg };
    }

    window.appCherub = window.appCherub || {};
    window.appCherub.sanitizeSvg = sanitizeSvg;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const icons = {
        pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
        play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    };

    webui.define("app-cherub-player", {
        attr: ['src', 'label', 'max-width'],
        flags: ['autoplay'],
        watchVisibility: true,
        props: {
            /** The frame on screen, or -1 before a scene loads. */
            currentFrame: {
                get() { return this._frame; }
            },
            /** True while the animation is set to play. */
            playing: {
                get() { return this._playing; }
            },
        },
        constructor() {
            const t = this;
            t._stage = t.template.querySelector('.stage');
            t._toggle = t.template.querySelector('button');
            t._loadToken = 0;
            t._playing = false;
            t._frame = -1;
            t._parts = [];
            t._table = null;
            t._raf = 0;
            t._tick = t._tick.bind(t);
            t._toggle.addEventListener('click', () => {
                if (t._playing) {
                    t.pause();
                } else {
                    t.play();
                }
            });
        },
        attrChanged(property, value) {
            const t = this;
            switch (property) {
                case 'src':
                    t._load(value);
                    break;
                case 'label':
                    t._stage.setAttribute('aria-label', value || 'Animation');
                    break;
                case 'maxWidth':
                    t.style.maxWidth = webui.pxIfNumber(value);
                    break;
                case 'visible':
                    t._updateRunning();
                    break;
            }
        },
        connected() {
            const t = this;
            if (!t._stage.hasAttribute('aria-label')) t._stage.setAttribute('aria-label', t.getAttribute('label') || 'Animation');
        },
        disconnected() {
            this._stopLoop();
        },
        reconnected() {
            this._updateRunning();
        },
        /** Start playing. */
        play() {
            const t = this;
            t._playing = true;
            t._startTime = null;
            t._updateToggle();
            t._updateRunning();
        },
        /** Stop playing and hold the current frame. */
        pause() {
            const t = this;
            t._playing = false;
            t._updateToggle();
            t._stopLoop();
        },
        /** Show one frame, by number. */
        showFrame(frame) {
            const t = this;
            const table = t._table;
            if (!table) return;
            frame = ((Math.floor(frame) % table.frameCount) + table.frameCount) % table.frameCount;
            if (frame === t._frame) return;
            t._frame = frame;
            const values = table.values;
            const stride = table.parts.length * 7;
            for (const part of t._parts) {
                const at = frame * stride + part.index * 7;
                const matrix = `matrix(${values.slice(at, at + 6).map(v => +v.toFixed(4)).join(' ')})`;
                const transform = part.original ? `${matrix} ${part.original}` : matrix;
                if (transform !== part.lastTransform) {
                    part.lastTransform = transform;
                    part.el.setAttribute('transform', transform);
                }
                const opacity = +(values[at + 6] * part.opacity).toFixed(3);
                if (opacity !== part.lastOpacity) {
                    part.lastOpacity = opacity;
                    part.el.setAttribute('opacity', opacity);
                }
            }
        },
        _updateToggle() {
            const t = this;
            t._toggle.innerHTML = t._playing ? icons.pause : icons.play;
            t._toggle.setAttribute('aria-label', t._playing ? 'Pause animation' : 'Play animation');
            t._toggle.hidden = !t._table;
        },
        _updateRunning() {
            const t = this;
            if (t._playing && t._table && t.visible && t.isConnected) {
                if (!t._raf) t._raf = requestAnimationFrame(t._tick);
            } else {
                t._stopLoop();
            }
        },
        _stopLoop() {
            const t = this;
            if (t._raf) cancelAnimationFrame(t._raf);
            t._raf = 0;
            t._startTime = null;
        },
        _tick(now) {
            const t = this;
            t._raf = 0;
            if (!t._playing || !t._table) return;
            if (t._startTime === null) {
                // Resume from the frame on screen rather than jumping back to the start.
                t._startTime = now - Math.max(t._frame, 0) * 1000 / t._table.fps;
            }
            t.showFrame((now - t._startTime) * t._table.fps / 1000);
            t._raf = requestAnimationFrame(t._tick);
        },
        async _load(src) {
            const t = this;
            const token = ++t._loadToken;
            t.pause();
            t._table = null;
            t._parts = [];
            t._frame = -1;
            t.removeAttribute('error');
            t.removeAttribute('loaded');
            t._updateToggle();
            if (!src) {
                t._stage.replaceChildren();
                return;
            }
            try {
                const { scene, rig, svg } = await loadScene(src);
                if (token !== t._loadToken) return;
                const elements = {};
                const domParents = {};
                const partIds = Object.keys(rig.parts || {});
                for (const id of partIds) {
                    const el = svg.querySelector(`[id="${CSS.escape(id)}"]`);
                    if (el) elements[id] = el;
                }
                // An element inside another part's element already moves with it, so the evaluator takes that back out.
                for (const [id, el] of Object.entries(elements)) {
                    for (let node = el.parentElement; node && node !== svg; node = node.parentElement) {
                        if (node.id && elements[node.id]) {
                            domParents[id] = node.id;
                            break;
                        }
                    }
                }
                await workerReady();
                const tableJson = await webui.worker.evaluate_scene(JSON.stringify({ rig, scene, domParents }));
                if (token !== t._loadToken) return;
                const table = JSON.parse(tableJson);
                t._parts = table.parts
                    .map((id, index) => ({ id, index, el: elements[id] }))
                    .filter(part => part.el)
                    .map(part => ({
                        ...part,
                        original: part.el.getAttribute('transform') || '',
                        opacity: parseFloat(part.el.getAttribute('opacity') || '1'),
                    }));
                t._table = table;
                const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
                t._stage.style.aspectRatio = viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 ? `${viewBox[2]} / ${viewBox[3]}` : '';
                t._stage.replaceChildren(svg);
                t.showFrame(0);
                t.setAttribute('loaded', '');
                t.dispatchEvent(new CustomEvent('loaded', { detail: { frameCount: table.frameCount, fps: table.fps } }));
                if (t.autoplay && !reducedMotion.matches) {
                    t.play();
                } else {
                    t._updateToggle();
                }
            } catch (ex) {
                if (token !== t._loadToken) return;
                t.setAttribute('error', '');
                console.warn('app-cherub-player could not load', src, ex);
            }
        },
        shadowTemplate: `
<div class="stage" role="img"></div>
<button type="button" hidden></button>
<style type="text/css">
:host {
display:block;
position:relative;
width:100%;
margin-inline:auto;
}
.stage {
width:100%;
aspect-ratio:1;
}
.stage > svg {
display:block;
width:100%;
height:100%;
}
button {
position:absolute;
right:0.25rem;
bottom:0.25rem;
width:2.25rem;
height:2.25rem;
padding:0.4rem;
border:none;
border-radius:50%;
background:color-mix(in srgb, var(--color-background, #333) 70%, transparent);
color:var(--color-background-offset, #fff);
cursor:pointer;
opacity:0.6;
}
button:hover, button:focus-visible {
opacity:1;
}
button:focus-visible {
outline:3px solid var(--color-active, #0b78ce);
outline-offset:2px;
}
button svg {
display:block;
width:100%;
height:100%;
fill:currentColor;
}
</style>
`
    });
}
