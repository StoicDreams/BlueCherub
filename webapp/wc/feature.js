/*!
 * Blue Cherub feature: a screenshot beside a short description, for showing what the studio does.
 * The screenshot links to its full-size image. Put the heading and text inside the element.
 *   <app-feature src="/img/screenshots/studio/rig-layers.png" alt="..." reverse><h3>...</h3><p>...</p></app-feature>
 * Side by side when there's room, stacked (picture first) when the component is narrower than 720 pixels (a container query).
 * Copyright © 2026 Stoic Dreams - https://www.stoicdreams.com
 */
"use strict"
{
    webui.define("app-feature", {
        attr: ['src', 'alt'],
        flags: ['reverse'],
        constructor() {
            const t = this;
            t._link = t.template.querySelector('a');
            t._img = t.template.querySelector('img');
        },
        attrChanged(property, value) {
            const t = this;
            switch (property) {
                case 'src':
                    t._img.src = value || '';
                    t._link.href = value || '';
                    break;
                case 'alt':
                    t._img.alt = value || '';
                    t._link.setAttribute('aria-label', value ? `${value} (full size)` : 'Full-size screenshot');
                    break;
            }
        },
        shadowTemplate: `
<div class="wrap">
<a class="shot" target="_blank" rel="noopener"><img loading="lazy" decoding="async"></a>
<div class="text"><slot></slot></div>
</div>
<style type="text/css">
:host {
display:block;
container-type:inline-size;
margin-block:2rem;
}
.wrap {
display:grid;
grid-template-columns:3fr 2fr;
gap:1.5rem;
align-items:start;
}
:host([reverse]) .shot {
order:2;
}
/* Stack the picture above the text when the component itself is narrow, such as in the help panel. */
@container (max-width: 719px) {
.wrap {
grid-template-columns:1fr;
gap:0.75rem;
}
:host([reverse]) .shot {
order:0;
}
}
.shot {
display:block;
border-radius:0.5rem;
overflow:hidden;
box-shadow:0 4px 18px rgba(0, 0, 0, 0.35);
}
.shot:focus-visible {
outline:3px solid var(--color-active, #0b78ce);
outline-offset:3px;
}
img {
display:block;
width:100%;
height:auto;
}
.text {
min-width:0;
}
::slotted(h2), ::slotted(h3) {
margin-top:0;
}
</style>
`
    });
}
