/*!
 * Blue Cherub rigger: turns any SVG into a rig. Select shapes, group and name them, mark parts,
 * set pivots and parents, test them, and download the rigged SVG and its rig JSON.
 * Imported SVGs are assumed to be poorly rigged, so every tool here works on any SVG.
 * Copyright © 2026 Stoic Dreams - https://www.stoicdreams.com
 */
"use strict"
{
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
    const GRAPHIC = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use', 'text']);
    const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
    const MAX_SVG_BYTES = 5 * 1024 * 1024;
    const MAX_UNDO = 100;
    const SAMPLE_SVG = '/animations/blue-cherub.svg';
    const SAMPLE_RIG = '/animations/blue-cherub.rig.json';
    // Inherited styles a group passes to its children, copied onto them when the group is removed.
    const INHERITED = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
        'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'color', 'visibility',
        'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor'];
    // Attributes that change how a whole group looks, so it can't be removed without changing the drawing.
    const GROUP_EFFECTS = ['clip-path', 'mask', 'filter'];

    const core = () => window.appCherub;

    function rootMatrix(el, svg) {
        return core().parentMatrix(el, svg).multiply(core().ownMatrix(el));
    }

    function setMatrix(el, matrix) {
        if (core().isIdentity(matrix)) {
            el.removeAttribute('transform');
        } else {
            el.setAttribute('transform', core().matrixText(matrix));
        }
    }

    /** Move an element to a new parent without changing where it's drawn. */
    function moveKeepingLook(el, newParent, before, svg) {
        const total = GRAPHIC.has(el.localName) ? rootMatrix(el, svg) : null;
        newParent.insertBefore(el, before);
        if (total) setMatrix(el, core().parentMatrix(el, svg).inverse().multiply(total));
    }

    function byId(svg, id) {
        return svg.querySelector(`[id="${CSS.escape(id)}"]`);
    }

    function isInside(el, ancestor) {
        for (let node = el.parentElement; node; node = node.parentElement) {
            if (node === ancestor) return true;
        }
        return false;
    }

    function uniqueId(svg, base) {
        let id = base;
        let n = 2;
        while (byId(svg, id)) id = `${base}-${n++}`;
        return id;
    }

    /**
     * Give every drawing element an id, so the rig can refer to it. Ids come from the element's place in the tree,
     * so importing the same file again gives the same ids. Duplicate ids (already broken in the file) get a suffix.
     */
    function assignIds(svg) {
        const seen = new Set();
        const walk = (parent, path) => {
            [...parent.children].forEach((el, index) => {
                const here = `${path}-${index}`;
                if (GRAPHIC.has(el.localName)) {
                    let id = el.getAttribute('id');
                    if (!id || seen.has(id)) {
                        const base = id || `bc${here}`;
                        let candidate = base;
                        let n = 2;
                        while (seen.has(candidate) || (candidate !== id && byId(svg, candidate))) candidate = `${base}-${n++}`;
                        el.setAttribute('id', candidate);
                        id = candidate;
                    }
                    seen.add(id);
                }
                if (el.localName === 'g') walk(el, here);
            });
        };
        walk(svg, '');
    }

    /** Make sure the SVG has a viewBox, which the stage and overlay share. */
    function ensureViewBox(svg) {
        if (svg.getAttribute('viewBox')) return;
        const width = parseFloat(svg.getAttribute('width'));
        const height = parseFloat(svg.getAttribute('height'));
        if (width > 0 && height > 0) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    function viewBoxOf(svg) {
        const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        return box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0 ? box : null;
    }

    /** An element's bounding box in root coordinates, or null when it has no size. */
    function rootBox(el, svg) {
        let box;
        try {
            box = el.getBBox();
        } catch {
            return null;
        }
        if (!box || (box.width === 0 && box.height === 0)) return null;
        const m = rootMatrix(el, svg);
        const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
            .map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
        const xs = corners.map(p => p.x);
        const ys = corners.map(p => p.y);
        return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }

    function escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function round(value) {
        return Math.round(value * 100) / 100;
    }

    function fileBase(name) {
        return (name || 'rig').replace(/\.rig\.json$|\.json$|\.svg$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rig';
    }

    function readFile(file) {
        if (file.size > MAX_SVG_BYTES) return Promise.reject(new Error(`${file.name} is larger than 5 MB`));
        return file.text();
    }

    /** Check an opened rig against its SVG, keeping what's valid. Returns the rig and a list of problems. */
    function cleanRig(data, svg) {
        const problems = [];
        const parts = {};
        if (!data || typeof data !== 'object' || data.formatVersion !== 1 || typeof data.parts !== 'object') {
            throw new Error('This is not a version 1 Blue Cherub rig');
        }
        for (const [id, part] of Object.entries(data.parts)) {
            if (!byId(svg, id)) {
                problems.push(`${id} isn't in the SVG`);
                continue;
            }
            const pivot = Array.isArray(part && part.pivot) && part.pivot.length === 2 && part.pivot.every(Number.isFinite) ? part.pivot : [0, 0];
            parts[id] = { pivot: [...pivot] };
            if (part && typeof part.parent === 'string') parts[id].parent = part.parent;
        }
        for (const [id, part] of Object.entries(parts)) {
            if (part.parent && !parts[part.parent]) {
                problems.push(`${id}'s parent ${part.parent} isn't a part`);
                delete part.parent;
            }
        }
        // Drop the link that closes any parent loop.
        for (const [id, part] of Object.entries(parts)) {
            const seen = new Set([id]);
            for (let p = part.parent; p; p = parts[p] && parts[p].parent) {
                if (seen.has(p)) {
                    problems.push(`${id} was its own ancestor`);
                    delete part.parent;
                    break;
                }
                seen.add(p);
            }
        }
        return { rig: { formatVersion: 1, parts }, problems };
    }

    function download(name, text, type) {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function el(tag, props = {}, children = []) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (key === 'text') node.innerText = value;
            else if (key === 'on') Object.entries(value).forEach(([event, handler]) => node.addEventListener(event, handler));
            else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
        }
        node.append(...children);
        return node;
    }

    function svgEl(tag, attrs = {}) {
        const node = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
        return node;
    }

    webui.define("app-cherub-rigger", {
        preload: 'app:cherub-player app:cherub-layers',
        props: {
            /** The rig as saved: the SVG file name and its parts. */
            rigData: {
                get() { return { formatVersion: 1, svg: `${this._fileName}.svg`, parts: this._rig.parts }; }
            },
            /** The rigged SVG as text. */
            svgText: {
                get() { return this._svg ? new XMLSerializer().serializeToString(this._svg) : ''; }
            },
            /** The ids of the selected elements. */
            selection: {
                get() { return [...this._selection]; }
            },
        },
        constructor() {
            const t = this;
            const q = selector => t.template.querySelector(selector);
            t._stage = q('.stage');
            t._overlay = q('.overlay');
            t._layers = q('app-cherub-layers');
            t._props = q('.props');
            t._status = q('.status');
            t._preview = q('app-cherub-player');
            t._previewBox = q('.preview');
            t._svgInput = q('input[name="svg-file"]');
            t._openInput = q('input[name="rig-files"]');
            t._buttons = {};
            q('.toolbar').querySelectorAll('button[data-action]').forEach(button => {
                t._buttons[button.dataset.action] = button;
                button.addEventListener('click', () => t._run(button.dataset.action));
            });
            q('.preview button').addEventListener('click', () => t._stopTest());
            t._svg = null;
            t._original = null;
            t._fileName = 'rig';
            t._rig = { formatVersion: 1, parts: {} };
            t._selection = [];
            t._undo = [];
            t._redo = [];
            t._dirty = false;
            t._svgInput.addEventListener('change', () => t._importFromInput());
            t._openInput.addEventListener('change', () => t._openFromInput());
            t._layers.addEventListener('layer-select', ev => t._select(ev.detail.id, ev.detail.additive));
            t._stage.addEventListener('click', ev => t._stageClick(ev));
            t.addEventListener('keydown', ev => t._keydown(ev));
            t._onBeforeUnload = ev => {
                if (!t._dirty) return;
                ev.preventDefault();
                ev.returnValue = '';
            };
        },
        connected() {
            window.addEventListener('beforeunload', this._onBeforeUnload);
            this._update();
        },
        disconnected() {
            window.removeEventListener('beforeunload', this._onBeforeUnload);
        },
        reconnected() {
            window.addEventListener('beforeunload', this._onBeforeUnload);
        },
        // ----- Loading -----
        /** Load SVG text to rig, with an optional rig to continue from. */
        loadSvg(text, fileName, rigData) {
            const t = this;
            const svg = core().sanitizeSvg(text);
            ensureViewBox(svg);
            assignIds(svg);
            let problems = [];
            let rig = { formatVersion: 1, parts: {} };
            if (rigData) ({ rig, problems } = cleanRig(rigData, svg));
            t._original = text;
            t._fileName = fileBase(fileName);
            t._undo = [];
            t._redo = [];
            t._dirty = false;
            t._setSvg(svg);
            t._rig = rig;
            t._selection = [];
            t._stopTest();
            t._update();
            const parts = Object.keys(rig.parts).length;
            t._say(problems.length
                ? `Opened with ${problems.length} problem${problems.length === 1 ? '' : 's'}: ${problems.join('; ')}.`
                : `Loaded ${fileName}${parts ? ` with ${parts} parts` : ''}.`);
        },
        async _importFromInput() {
            const t = this;
            const file = t._svgInput.files[0];
            t._svgInput.value = '';
            if (!file) return;
            try {
                t.loadSvg(await readFile(file), file.name);
            } catch (ex) {
                t._say(`Could not import ${file.name}: ${ex.message}`);
            }
        },
        async _openFromInput() {
            const t = this;
            const files = [...t._openInput.files];
            t._openInput.value = '';
            const svgFile = files.find(f => /\.svg$/i.test(f.name));
            const rigFile = files.find(f => /\.json$/i.test(f.name));
            if (!svgFile || !rigFile) {
                t._say('Choose both the rigged .svg file and its .rig.json file.');
                return;
            }
            try {
                const rigData = JSON.parse(await readFile(rigFile));
                t.loadSvg(await readFile(svgFile), svgFile.name, rigData);
            } catch (ex) {
                t._say(`Could not open the rig: ${ex.message}`);
            }
        },
        async _loadSample() {
            const t = this;
            try {
                const [svgText, rigData] = await Promise.all([
                    fetch(SAMPLE_SVG).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }),
                    fetch(SAMPLE_RIG).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
                ]);
                t.loadSvg(svgText, 'blue-cherub.svg', rigData);
            } catch (ex) {
                t._say(`Could not load the Blue Cherub sample: ${ex.message}`);
            }
        },
        _setSvg(svg) {
            const t = this;
            t._svg = svg;
            svg.removeAttribute('width');
            svg.removeAttribute('height');
            t._stage.replaceChildren(svg);
            const box = viewBoxOf(svg);
            if (box) {
                t._overlay.setAttribute('viewBox', box.join(' '));
                t._stage.style.aspectRatio = `${box[2]} / ${box[3]}`;
            }
            const preserve = svg.getAttribute('preserveAspectRatio');
            if (preserve) {
                t._overlay.setAttribute('preserveAspectRatio', preserve);
            } else {
                t._overlay.removeAttribute('preserveAspectRatio');
            }
        },
        // ----- Undo -----
        _snapshot() {
            const t = this;
            return { svg: new XMLSerializer().serializeToString(t._svg), rig: JSON.stringify(t._rig), selection: [...t._selection] };
        },
        /** Save the state before a change, so it can be undone. */
        _checkpoint() {
            const t = this;
            t._undo.push(t._snapshot());
            if (t._undo.length > MAX_UNDO) t._undo.shift();
            t._redo = [];
            t._dirty = true;
        },
        _restore(state) {
            const t = this;
            t._setSvg(core().sanitizeSvg(state.svg));
            t._rig = JSON.parse(state.rig);
            t._selection = state.selection.filter(id => byId(t._svg, id));
            t._update();
        },
        undo() {
            const t = this;
            if (!t._undo.length) return;
            t._redo.push(t._snapshot());
            t._restore(t._undo.pop());
            t._dirty = true;
            t._say('Undone.');
        },
        redo() {
            const t = this;
            if (!t._redo.length) return;
            t._undo.push(t._snapshot());
            t._restore(t._redo.pop());
            t._dirty = true;
            t._say('Redone.');
        },
        // ----- Selection -----
        _select(id, additive) {
            const t = this;
            if (!id) {
                t._selection = [];
            } else if (additive) {
                t._selection = t._selection.includes(id) ? t._selection.filter(s => s !== id) : [...t._selection, id];
            } else {
                t._selection = [id];
            }
            t._update();
            if (id) t._layers.reveal(id);
        },
        _stageClick(ev) {
            const t = this;
            if (!t._svg) return;
            // Clicking the drawing keeps keyboard shortcuts, such as Escape and Ctrl+G, in the rigger.
            t._stage.parentElement.focus({ preventScroll: true });
            const target = ev.composedPath().find(node => node instanceof Element && GRAPHIC.has(node.localName) && t._svg.contains(node) && node !== t._svg);
            t._select(target ? target.id : null, ev.shiftKey || ev.ctrlKey || ev.metaKey);
        },
        _selectedElements() {
            const t = this;
            return t._selection.map(id => byId(t._svg, id)).filter(Boolean);
        },
        _keydown(ev) {
            const t = this;
            // Text fields keep their own undo and shortcuts.
            const origin = ev.composedPath()[0];
            if (origin && /^(input|select|textarea)$/i.test(origin.localName || '')) return;
            const key = ev.key.toLowerCase();
            const mod = ev.ctrlKey || ev.metaKey;
            let action = null;
            if (mod && key === 'z') action = ev.shiftKey ? 'redo' : 'undo';
            else if (mod && key === 'y') action = 'redo';
            else if (mod && key === 'g') action = ev.shiftKey ? 'ungroup' : 'group';
            else if (key === 'escape' && t._selection.length) action = 'clear';
            if (!action) return;
            ev.preventDefault();
            t._run(action);
        },
        _run(action) {
            const t = this;
            switch (action) {
                case 'import': t._svgInput.click(); return;
                case 'open': t._openInput.click(); return;
                case 'sample': t._loadSample(); return;
                case 'undo': t.undo(); return;
                case 'redo': t.redo(); return;
                case 'clear': t._select(null); return;
            }
            if (!t._svg) return;
            switch (action) {
                case 'group': t.group(); break;
                case 'ungroup': t.ungroup(); break;
                case 'parent': t.selectParent(); break;
                case 'cleanup': t.cleanUpGroups(); break;
                case 'download': t.downloadRig(); break;
            }
        },
        // ----- Editing -----
        /** Put the selected elements in a new group, keeping how they look. */
        group() {
            const t = this;
            let els = t._selectedElements().filter(e => e !== t._svg);
            // An element inside another selected element moves with it.
            els = els.filter(e => !els.some(other => other !== e && isInside(e, other)));
            if (!els.length) {
                t._say('Select the shapes to group first.');
                return;
            }
            els.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
            // The new group goes in the lowest group that holds them all, where the first one was.
            let common = els[0].parentElement;
            while (common !== t._svg && !els.every(e => isInside(e, common))) common = common.parentElement;
            let anchor = els[0];
            while (anchor.parentElement !== common) anchor = anchor.parentElement;
            t._checkpoint();
            const group = svgEl('g', { id: uniqueId(t._svg, 'group') });
            common.insertBefore(group, anchor);
            els.forEach(e => moveKeepingLook(e, group, null, t._svg));
            t._selection = [group.id];
            t._update();
            t._say(`Grouped ${els.length} element${els.length === 1 ? '' : 's'} as ${group.id}.`);
        },
        /** Remove the selected groups, moving their contents up and keeping how they look. */
        ungroup() {
            const t = this;
            const groups = t._selectedElements().filter(e => e.localName === 'g');
            if (!groups.length) {
                t._say('Select a group to ungroup.');
                return;
            }
            const blocked = groups.filter(g => GROUP_EFFECTS.some(name => g.hasAttribute(name)));
            if (blocked.length) {
                t._say(`${blocked.map(g => g.id).join(', ')} has a clip, mask, or filter, so ungrouping would change how it looks.`);
                return;
            }
            t._checkpoint();
            const freed = [];
            groups.forEach(g => freed.push(...t._unwrap(g)));
            t._selection = freed.filter(e => GRAPHIC.has(e.localName)).map(e => e.id);
            t._update();
            t._say(`Ungrouped ${groups.length} group${groups.length === 1 ? '' : 's'}.`);
        },
        /** Move a group's children up a level, copying its inherited styles onto them, then remove it. */
        _unwrap(g) {
            const t = this;
            const children = [...g.children];
            const groupStyle = (g.getAttribute('style') || '').trim();
            const groupOpacity = parseFloat(g.getAttribute('opacity') || '1');
            for (const child of children) {
                if (GRAPHIC.has(child.localName)) {
                    INHERITED.forEach(name => {
                        if (g.hasAttribute(name) && !child.hasAttribute(name)) child.setAttribute(name, g.getAttribute(name));
                    });
                    if (groupStyle) child.setAttribute('style', `${groupStyle};${child.getAttribute('style') || ''}`.replace(/;+$/, ''));
                    if (groupOpacity !== 1) child.setAttribute('opacity', round(groupOpacity * parseFloat(child.getAttribute('opacity') || '1')));
                }
                moveKeepingLook(child, g.parentElement, g, t._svg);
            }
            // A part that's removed passes its children on to its own parent.
            const part = t._rig.parts[g.id];
            if (part) {
                Object.values(t._rig.parts).forEach(other => {
                    if (other.parent === g.id) {
                        if (part.parent) other.parent = part.parent; else delete other.parent;
                    }
                });
                delete t._rig.parts[g.id];
            }
            g.remove();
            return children;
        },
        /** Select the groups that hold the selected elements. */
        selectParent() {
            const t = this;
            const parents = [...new Set(t._selectedElements().map(e => e.parentElement).filter(p => p && p !== t._svg && p.localName === 'g'))];
            if (!parents.length) {
                t._say('Nothing selected is inside a group.');
                return;
            }
            t._selection = parents.map(p => p.id);
            t._update();
        },
        /** Remove groups that do nothing: empty ones, and ones with a single child and no styles of their own. */
        cleanUpGroups() {
            const t = this;
            const isPlain = g => [...g.attributes].every(a => a.name === 'id' || a.name === 'transform' || a.namespaceURI);
            const candidates = () => [...t._svg.querySelectorAll('g')].filter(g => !t._rig.parts[g.id] && (g.children.length === 0 || (g.children.length === 1 && isPlain(g))));
            if (!candidates().length) {
                t._say('There are no empty or single-item groups to clean up.');
                return;
            }
            t._checkpoint();
            let removed = 0;
            for (let pass = 0; pass < 50; pass++) {
                const found = candidates();
                if (!found.length) break;
                found.forEach(g => {
                    if (g.isConnected) {
                        t._unwrap(g);
                        removed++;
                    }
                });
            }
            t._selection = t._selection.filter(id => byId(t._svg, id));
            t._update();
            t._say(`Removed ${removed} group${removed === 1 ? '' : 's'} that did nothing.`);
        },
        /** Rename an element. Its rig part and any references to it follow. */
        rename(oldId, newId) {
            const t = this;
            newId = (newId || '').trim();
            if (newId === oldId) return true;
            if (!NAME_PATTERN.test(newId)) {
                t._say('Names start with a letter and use only letters, numbers, - and _ (up to 64).');
                return false;
            }
            if (byId(t._svg, newId)) {
                t._say(`${newId} is already used.`);
                return false;
            }
            const target = byId(t._svg, oldId);
            if (!target) return false;
            t._checkpoint();
            target.setAttribute('id', newId);
            // Keep references such as fill="url(#old)" and href="#old" working.
            const pattern = new RegExp(`url\\(\\s*(['"]?)#${escapeRegex(oldId)}\\1\\s*\\)`, 'g');
            t._svg.querySelectorAll('*').forEach(node => {
                for (const attr of [...node.attributes]) {
                    if ((attr.localName === 'href') && attr.value === `#${oldId}`) node.setAttributeNS(attr.namespaceURI, attr.name, `#${newId}`);
                    else if (attr.value.includes(`#${oldId}`) && pattern.test(attr.value)) {
                        pattern.lastIndex = 0;
                        node.setAttributeNS(attr.namespaceURI, attr.name, attr.value.replace(pattern, `url(#${newId})`));
                    }
                    pattern.lastIndex = 0;
                }
            });
            if (t._rig.parts[oldId]) {
                t._rig.parts[newId] = t._rig.parts[oldId];
                delete t._rig.parts[oldId];
                Object.values(t._rig.parts).forEach(p => { if (p.parent === oldId) p.parent = newId; });
            }
            t._selection = t._selection.map(id => id === oldId ? newId : id);
            t._update();
            t._say(`Renamed ${oldId} to ${newId}.`);
            return true;
        },
        /** Make an element a rig part, with a suggested pivot. */
        makePart(id) {
            const t = this;
            const target = byId(t._svg, id);
            if (!target || t._rig.parts[id]) return;
            t._checkpoint();
            t._rig.parts[id] = { pivot: t._suggestPivot(id) };
            t._update();
            t._say(`${id} is now a part.`);
        },
        removePart(id) {
            const t = this;
            const part = t._rig.parts[id];
            if (!part) return;
            t._checkpoint();
            Object.values(t._rig.parts).forEach(other => {
                if (other.parent === id) {
                    if (part.parent) other.parent = part.parent; else delete other.parent;
                }
            });
            delete t._rig.parts[id];
            t._update();
            t._say(`${id} is no longer a part.`);
        },
        setPivot(id, x, y, checkpoint = true) {
            const t = this;
            const part = t._rig.parts[id];
            if (!part || !Number.isFinite(x) || !Number.isFinite(y)) return;
            if (checkpoint) t._checkpoint();
            part.pivot = [round(x), round(y)];
            t._update();
        },
        setParent(id, parentId) {
            const t = this;
            const part = t._rig.parts[id];
            if (!part) return;
            if (parentId && !t._allowedParents(id).includes(parentId)) {
                t._say(`${parentId} can't be the parent of ${id}.`);
                t._update();
                return;
            }
            t._checkpoint();
            if (parentId) part.parent = parentId; else delete part.parent;
            t._update();
        },
        /** Parts that can be this part's parent: any part except itself and its descendants. */
        _allowedParents(id) {
            const t = this;
            const parts = t._rig.parts;
            const descendant = other => {
                for (let p = parts[other].parent; p; p = parts[p] && parts[p].parent) if (p === id) return true;
                return false;
            };
            return Object.keys(parts).filter(other => other !== id && !descendant(other)).sort();
        },
        /** The middle of where a part overlaps its parent (a joint), or the middle of the part. */
        _suggestPivot(id) {
            const t = this;
            const box = rootBox(byId(t._svg, id), t._svg);
            if (!box) return [0, 0];
            const parentId = t._rig.parts[id] && t._rig.parts[id].parent;
            const parentEl = parentId && byId(t._svg, parentId);
            const parentBox = parentEl && rootBox(parentEl, t._svg);
            if (parentBox) {
                const x1 = Math.max(box.x, parentBox.x), y1 = Math.max(box.y, parentBox.y);
                const x2 = Math.min(box.x + box.width, parentBox.x + parentBox.width), y2 = Math.min(box.y + box.height, parentBox.y + parentBox.height);
                if (x2 > x1 && y2 > y1) return [round((x1 + x2) / 2), round((y1 + y2) / 2)];
            }
            return [round(box.x + box.width / 2), round(box.y + box.height / 2)];
        },
        // ----- Output -----
        downloadRig() {
            const t = this;
            download(`${t._fileName}.svg`, t.svgText, 'image/svg+xml');
            download(`${t._fileName}.rig.json`, JSON.stringify(t.rigData, null, 4), 'application/json');
            t._dirty = false;
            t._say(`Downloaded ${t._fileName}.svg and ${t._fileName}.rig.json. Keep them together.`);
        },
        // ----- Testing a part -----
        /** Swing a part back and forth in the preview, so its pivot and children can be checked. */
        async testPart(id) {
            const t = this;
            if (!t._rig.parts[id]) return;
            const scene = {
                formatVersion: 1, fps: 24, frameCount: 36,
                tracks: [{ part: id, property: 'rotate', keys: [{ frame: 0, value: 0 }, { frame: 9, value: -20 }, { frame: 27, value: 20 }, { frame: 36, value: 0 }] }],
            };
            t._previewBox.hidden = false;
            const result = await t._preview.loadData({ svg: t.svgText, rig: { formatVersion: 1, parts: t._rig.parts }, scene });
            if (!result.ok) {
                t._say(`The test didn't run: ${result.error}`);
                return;
            }
            t._preview.setAttribute('label', `${id} swinging around its pivot`);
            t._preview.play();
            t._say(`Testing ${id}. Its children should swing with it.`);
        },
        _stopTest() {
            const t = this;
            t._preview.pause();
            t._previewBox.hidden = true;
        },
        // ----- Display -----
        _say(message) {
            this._status.innerText = message;
        },
        _update() {
            const t = this;
            const has = !!t._svg;
            const els = has ? t._selectedElements() : [];
            t._buttons.undo.disabled = !t._undo.length;
            t._buttons.redo.disabled = !t._redo.length;
            t._buttons.group.disabled = !els.length;
            t._buttons.ungroup.disabled = !els.some(e => e.localName === 'g');
            t._buttons.parent.disabled = !els.some(e => e.parentElement && e.parentElement !== t._svg);
            t._buttons.cleanup.disabled = !has;
            t._buttons.download.disabled = !has;
            if (typeof t._layers.setTree === 'function') t._layers.setTree(t._svg, { parts: Object.keys(t._rig.parts), selection: t._selection });
            t._renderProps(els);
            t._renderOverlay(els);
        },
        _renderProps(els) {
            const t = this;
            const content = [];
            if (!t._svg) {
                content.push(el('p', { text: 'Import an SVG, open a rig you saved, or start from the Blue Cherub sample.' }));
            } else if (!els.length) {
                const count = Object.keys(t._rig.parts).length;
                content.push(el('p', { text: `Select a shape or group on the drawing or in the layers. ${count} part${count === 1 ? '' : 's'} so far.` }));
            } else if (els.length > 1) {
                content.push(el('p', { text: `${els.length} elements selected. Group them to make one part.` }));
            } else {
                content.push(...t._propsFor(els[0]));
            }
            const active = t.shadowRoot && t.shadowRoot.activeElement;
            const focusId = active && t._props.contains(active) ? active.id || active.dataset.focus : null;
            t._props.replaceChildren(...content);
            // Put focus back on the same control, so keyboard users keep their place.
            if (focusId) {
                const again = t._props.querySelector(`[id="${CSS.escape(focusId)}"], [data-focus="${CSS.escape(focusId)}"]`);
                if (again) again.focus({ preventScroll: true });
            }
        },
        _propsFor(target) {
            const t = this;
            const id = target.id;
            const part = t._rig.parts[id];
            const label = target.getAttributeNS(INKSCAPE_NS, 'label');
            const nameInput = el('input', { type: 'text', id: 'part-name', value: id, spellcheck: 'false', autocomplete: 'off' });
            const commitName = () => {
                if (!t.rename(id, nameInput.value)) nameInput.value = id;
            };
            nameInput.addEventListener('change', commitName);
            nameInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') commitName(); });
            const nodes = [
                el('label', { for: 'part-name', text: 'Name' }),
                nameInput,
            ];
            if (label && label !== id) nodes.push(el('p', { class: 'note', text: `Labeled “${label}” in the drawing tool.` }));
            if (!part) {
                nodes.push(el('button', { type: 'button', class: 'primary', text: 'Make this a part', on: { click: () => t.makePart(id) } }));
                return nodes;
            }
            const pivotInput = axis => {
                const input = el('input', { type: 'number', id: `pivot-${axis}`, step: '1', value: part.pivot[axis === 'x' ? 0 : 1] });
                input.addEventListener('change', () => {
                    const x = axis === 'x' ? parseFloat(input.value) : part.pivot[0];
                    const y = axis === 'y' ? parseFloat(input.value) : part.pivot[1];
                    t.setPivot(id, x, y);
                });
                return input;
            };
            const parentSelect = el('select', { id: 'part-parent' }, [
                el('option', { value: '', text: 'None' }),
                ...t._allowedParents(id).map(p => el('option', { value: p, text: p, selected: part.parent === p })),
            ]);
            parentSelect.addEventListener('change', () => t.setParent(id, parentSelect.value));
            nodes.push(
                el('fieldset', {}, [
                    el('legend', { text: 'Pivot (drag the dot on the drawing)' }),
                    el('label', { for: 'pivot-x', text: 'X' }), pivotInput('x'),
                    el('label', { for: 'pivot-y', text: 'Y' }), pivotInput('y'),
                ]),
                el('button', { type: 'button', text: 'Suggest pivot', on: { click: () => { const [x, y] = t._suggestPivot(id); t.setPivot(id, x, y); } } }),
                el('label', { for: 'part-parent', text: 'Attached to' }),
                parentSelect,
                el('div', { class: 'row' }, [
                    el('button', { type: 'button', class: 'primary', text: 'Test', on: { click: () => t.testPart(id) } }),
                    el('button', { type: 'button', text: 'Not a part', on: { click: () => t.removePart(id) } }),
                ]),
            );
            return nodes;
        },
        _renderOverlay(els) {
            const t = this;
            const overlay = t._overlay;
            const shapes = [];
            if (t._svg) {
                const box = viewBoxOf(t._svg);
                const size = box ? Math.max(box[2], box[3]) / 100 : 4;
                for (const e of els) {
                    const b = rootBox(e, t._svg);
                    if (b) shapes.push(svgEl('rect', { class: 'selected', x: b.x, y: b.y, width: b.width, height: b.height, 'stroke-width': size / 4 }));
                }
                const parts = t._rig.parts;
                for (const [id, part] of Object.entries(parts)) {
                    if (part.parent && parts[part.parent]) {
                        const [x2, y2] = parts[part.parent].pivot;
                        shapes.push(svgEl('line', { class: 'bone', x1: part.pivot[0], y1: part.pivot[1], x2, y2, 'stroke-width': size / 5 }));
                    }
                }
                for (const [id, part] of Object.entries(parts)) {
                    const active = t._selection.length === 1 && t._selection[0] === id;
                    const dot = svgEl('circle', { class: active ? 'pivot active' : 'pivot', cx: part.pivot[0], cy: part.pivot[1], r: active ? size * 1.4 : size * 0.8, 'stroke-width': size / 4 });
                    if (active) t._dragPivot(dot, id);
                    shapes.push(dot);
                }
            }
            overlay.replaceChildren(...shapes);
        },
        _dragPivot(dot, id) {
            const t = this;
            const toSvg = ev => {
                const m = t._overlay.getScreenCTM();
                return m ? new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()) : null;
            };
            dot.addEventListener('pointerdown', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                dot.setPointerCapture(ev.pointerId);
                t._checkpoint();
                const move = e => {
                    const p = toSvg(e);
                    if (!p) return;
                    t._rig.parts[id].pivot = [round(p.x), round(p.y)];
                    dot.setAttribute('cx', round(p.x));
                    dot.setAttribute('cy', round(p.y));
                };
                const up = () => {
                    dot.removeEventListener('pointermove', move);
                    dot.removeEventListener('pointerup', up);
                    dot.removeEventListener('pointercancel', up);
                    t._update();
                };
                dot.addEventListener('pointermove', move);
                dot.addEventListener('pointerup', up);
                dot.addEventListener('pointercancel', up);
            });
        },
        shadowTemplate: `
<div class="toolbar" role="toolbar" aria-label="Rig tools">
<button type="button" data-action="import">Import SVG</button>
<button type="button" data-action="open">Open rig</button>
<button type="button" data-action="sample">Blue Cherub sample</button>
<span class="gap"></span>
<button type="button" data-action="undo" aria-keyshortcuts="Control+Z">Undo</button>
<button type="button" data-action="redo" aria-keyshortcuts="Control+Shift+Z Control+Y">Redo</button>
<button type="button" data-action="group" aria-keyshortcuts="Control+G">Group</button>
<button type="button" data-action="ungroup" aria-keyshortcuts="Control+Shift+G">Ungroup</button>
<button type="button" data-action="parent">Select group</button>
<button type="button" data-action="cleanup">Clean up groups</button>
<span class="gap"></span>
<button type="button" data-action="download" class="primary">Download rig</button>
<input type="file" name="svg-file" accept=".svg,image/svg+xml" hidden>
<input type="file" name="rig-files" accept=".svg,.json,image/svg+xml,application/json" multiple hidden>
</div>
<div class="main">
<section class="layers" aria-label="Layers"><h2>Layers</h2><app-cherub-layers></app-cherub-layers></section>
<section class="canvas" aria-label="Drawing">
<div class="stage-wrap" tabindex="-1"><div class="stage"></div><svg class="overlay" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg></div>
<div class="preview" hidden><app-cherub-player max-width="320"></app-cherub-player><button type="button">Stop test</button></div>
</section>
<section class="props-wrap" aria-label="Selected"><h2>Selected</h2><div class="props"></div></section>
</div>
<p class="status" role="status" aria-live="polite"></p>
<style type="text/css">
:host {
display:block;
--rig-border:color-mix(in srgb, currentColor 25%, transparent);
}
h2 {
font-size:1rem;
margin:0 0 0.5rem;
}
button, input, select {
font:inherit;
}
button {
padding:0.35rem 0.75rem;
border:1px solid var(--rig-border);
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
button:disabled {
opacity:0.5;
cursor:default;
}
button:focus-visible, input:focus-visible, select:focus-visible {
outline:3px solid var(--color-active, #0b78ce);
outline-offset:2px;
}
input, select {
width:100%;
box-sizing:border-box;
padding:0.3rem 0.4rem;
border:1px solid var(--rig-border);
border-radius:0.3rem;
background:var(--color-background, #333);
color:var(--color-background-offset, #fff);
}
.toolbar {
display:flex;
flex-wrap:wrap;
gap:0.4rem;
align-items:center;
margin-bottom:0.75rem;
}
.gap {
flex:0 0 0.5rem;
}
.main {
display:grid;
grid-template-columns:minmax(12rem, 1fr) minmax(16rem, 3fr) minmax(13rem, 1fr);
gap:0.75rem;
align-items:start;
}
@media (max-width: 900px) {
.main {
grid-template-columns:1fr;
}
}
section {
border:1px solid var(--rig-border);
border-radius:0.5rem;
padding:0.5rem;
min-width:0;
}
app-cherub-layers {
max-height:60vh;
}
.stage-wrap {
position:relative;
outline:none;
background:repeating-conic-gradient(#ffffff 0 25%, #e8e8e8 0 50%) 0 0 / 20px 20px;
border-radius:0.35rem;
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
.overlay {
position:absolute;
inset:0;
width:100%;
height:100%;
pointer-events:none;
overflow:visible;
}
.overlay .selected {
fill:none;
stroke:#0b78ce;
stroke-dasharray:4 3;
vector-effect:non-scaling-stroke;
stroke-width:2;
}
.overlay .bone {
stroke:#7d0b77;
opacity:0.7;
vector-effect:non-scaling-stroke;
stroke-width:2;
}
.overlay .pivot {
fill:#ffffff;
stroke:#7d0b77;
vector-effect:non-scaling-stroke;
stroke-width:2;
}
.overlay .pivot.active {
fill:#ffcc00;
stroke:#111111;
pointer-events:all;
cursor:grab;
touch-action:none;
}
.preview {
display:flex;
align-items:center;
gap:0.75rem;
margin-top:0.5rem;
}
.preview[hidden] {
display:none;
}
.preview app-cherub-player {
flex:1;
background:#ffffff;
border-radius:0.35rem;
}
.props {
display:grid;
gap:0.5rem;
}
.props p {
margin:0;
}
fieldset {
display:grid;
grid-template-columns:auto 1fr auto 1fr;
gap:0.4rem;
align-items:center;
border:1px solid var(--rig-border);
border-radius:0.35rem;
margin:0;
}
.row {
display:flex;
gap:0.5rem;
}
.note {
font-size:0.9em;
opacity:0.8;
}
.status {
min-height:1.5em;
margin:0.5rem 0 0;
}
</style>
`
    });
}
