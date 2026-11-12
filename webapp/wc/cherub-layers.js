/*!
 * Blue Cherub layers: the element tree of an SVG being rigged, for selecting shapes and groups.
 * Used by app-cherub-rigger. Fires `layer-select` with { id, additive } when an item is chosen.
 * Copyright © 2026 Stoic Dreams - https://www.stoicdreams.com
 */
"use strict"
{
    const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
    // The elements that draw something, and so can be selected, grouped, and rigged.
    const GRAPHIC = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use', 'text']);
    const kinds = {
        g: 'Group', path: 'Path', rect: 'Rectangle', circle: 'Circle', ellipse: 'Ellipse', line: 'Line',
        polyline: 'Polyline', polygon: 'Polygon', use: 'Copy', text: 'Text',
    };

    /** The name to show for an element: its drawing tool label, then its id. */
    function layerName(el) {
        return el.getAttributeNS(INKSCAPE_NS, 'label') || el.getAttribute('id') || el.localName;
    }

    window.appCherub = window.appCherub || {};
    Object.assign(window.appCherub, { GRAPHIC, layerName });

    webui.define("app-cherub-layers", {
        constructor() {
            const t = this;
            t._list = t.template.querySelector('ul');
            t._empty = t.template.querySelector('.empty');
            t._list.addEventListener('click', ev => {
                const button = ev.target.closest('button[data-id]');
                if (!button) return;
                t.dispatchEvent(new CustomEvent('layer-select', {
                    bubbles: true,
                    composed: true,
                    detail: { id: button.dataset.id, additive: ev.shiftKey || ev.ctrlKey || ev.metaKey },
                }));
            });
        },
        /**
         * Show the tree of an SVG element.
         * @param {SVGSVGElement} svg - The SVG being rigged.
         * @param {object} options - `parts` (ids that are rig parts) and `selection` (selected ids).
         */
        setTree(svg, { parts = [], selection = [] } = {}) {
            const t = this;
            const partSet = new Set(parts);
            const selected = new Set(selection);
            const fragment = document.createDocumentFragment();
            let focusId = null;
            const active = t.shadowRoot && t.shadowRoot.activeElement;
            if (active && active.dataset) focusId = active.dataset.id;
            let focusButton = null;
            const walk = (parent, depth) => {
                for (const el of parent.children) {
                    if (!GRAPHIC.has(el.localName)) continue;
                    const id = el.getAttribute('id');
                    const item = document.createElement('li');
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.dataset.id = id;
                    button.style.paddingInlineStart = `${0.5 + depth * 1}rem`;
                    button.setAttribute('aria-pressed', selected.has(id) ? 'true' : 'false');
                    const name = document.createElement('span');
                    name.className = 'name';
                    name.innerText = layerName(el);
                    const kind = document.createElement('span');
                    kind.className = 'kind';
                    kind.innerText = kinds[el.localName] || el.localName;
                    button.append(name, kind);
                    if (partSet.has(id)) {
                        const badge = document.createElement('span');
                        badge.className = 'part';
                        badge.innerText = 'Part';
                        button.append(badge);
                    }
                    if (id === focusId) focusButton = button;
                    item.append(button);
                    fragment.append(item);
                    if (el.localName === 'g') walk(el, depth + 1);
                }
            };
            if (svg) walk(svg, 0);
            t._empty.hidden = fragment.childNodes.length > 0;
            t._list.replaceChildren(fragment);
            if (focusButton) focusButton.focus();
        },
        /** Scroll an item into view, such as one just selected on the stage. */
        reveal(id) {
            const button = this._list.querySelector(`button[data-id="${CSS.escape(id)}"]`);
            if (button) button.scrollIntoView({ block: 'nearest' });
        },
        shadowTemplate: `
<p class="empty">Import an SVG to see its layers.</p>
<ul aria-label="Layers"></ul>
<style type="text/css">
:host {
display:block;
overflow:auto;
}
ul {
list-style:none;
margin:0;
padding:0;
}
.empty {
margin:0.5rem;
opacity:0.8;
}
button {
display:flex;
align-items:center;
gap:0.5rem;
width:100%;
padding:0.3rem 0.5rem;
border:none;
border-radius:0.25rem;
background:transparent;
color:inherit;
font:inherit;
text-align:start;
cursor:pointer;
}
button:hover {
background:color-mix(in srgb, currentColor 10%, transparent);
}
button[aria-pressed="true"] {
background:var(--color-primary, #0980a4);
color:var(--color-primary-offset, #fff);
}
button:focus-visible {
outline:3px solid var(--color-active, #0b78ce);
outline-offset:-3px;
}
.name {
flex:1;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}
.kind {
font-size:0.8em;
opacity:0.75;
}
.part {
font-size:0.75em;
padding:0 0.4em;
border:1px solid currentColor;
border-radius:1em;
}
</style>
`
    });
}
