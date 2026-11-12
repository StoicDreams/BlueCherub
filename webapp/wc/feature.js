/*!
 * Blue Cherub feature: a screenshot beside a short description, for showing what the studio does.
 * The screenshot links to its full-size image. Put the heading and text inside the element.
 *   <app-feature src="/img/screenshots/studio/rig-layers.png" alt="..." reverse><h3>...</h3><p>...</p></app-feature>
 * Add `video` (an MP4 clip of the feature in use) to show the clip instead, with `src` as its still poster.
 * The clip plays only while on screen, never on its own for visitors who prefer reduced motion, and has a pause button.
 * Side by side when there's room, stacked (picture first) when the component is narrower than 720 pixels (a container query).
 * Copyright © 2026 Stoic Dreams - https://www.stoicdreams.com
 */
"use strict"
{
    webui.define("app-feature", {
        attr: ['src', 'alt', 'video'],
        flags: ['reverse'],
        watchVisibility: true,
        props: {
            /** True while the clip is set to play. */
            playing: {
                get() { return !!this._wantPlay; }
            },
        },
        constructor() {
            const t = this;
            t._link = t.template.querySelector('a');
            t._img = t.template.querySelector('img');
            t._clip = t.template.querySelector('.clip');
            t._video = t.template.querySelector('video');
            t._toggle = t.template.querySelector('.clip button');
            t._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
            t._wantPlay = !t._reducedMotion.matches;
            t._toggle.addEventListener('click', () => {
                t._wantPlay = !t._wantPlay;
                t._updateClip();
            });
        },
        _updateClip() {
            const t = this;
            const video = t._video;
            if (!t.getAttribute('video')) return;
            if (t._wantPlay && t.visible) {
                const playing = video.play();
                if (playing && playing.catch) playing.catch(() => { });
            } else {
                video.pause();
            }
            t._toggle.setAttribute('aria-label', t._wantPlay ? 'Pause clip' : 'Play clip');
            t._toggle.innerHTML = t._wantPlay
                ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
                : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
        },
        attrChanged(property, value) {
            const t = this;
            switch (property) {
                case 'src':
                    t._img.src = value || '';
                    t._link.href = value || '';
                    t._video.poster = value || '';
                    break;
                case 'alt':
                    t._img.alt = value || '';
                    t._link.setAttribute('aria-label', value ? `${value} (full size)` : 'Full-size screenshot');
                    t._video.setAttribute('aria-label', value || 'Clip');
                    break;
                case 'video':
                    t._link.hidden = !!value;
                    t._clip.hidden = !value;
                    if (value) t._video.src = value; else t._video.removeAttribute('src');
                    t._updateClip();
                    break;
                case 'visible':
                    t._updateClip();
                    break;
            }
        },
        shadowTemplate: `
<div class="wrap">
<a class="shot" target="_blank" rel="noopener"><img loading="lazy" decoding="async"></a>
<div class="shot clip" hidden><video muted loop playsinline preload="metadata"></video><button type="button" aria-label="Pause clip"></button></div>
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
[hidden] {
display:none !important;
}
.clip {
position:relative;
}
video {
display:block;
width:100%;
height:auto;
}
.clip button {
position:absolute;
right:0.5rem;
bottom:0.5rem;
width:2.5rem;
height:2.5rem;
padding:0.5rem;
border:none;
border-radius:50%;
background:rgba(0, 0, 0, 0.6);
color:#ffffff;
cursor:pointer;
}
.clip button:focus-visible {
outline:3px solid var(--color-active, #0b78ce);
outline-offset:2px;
}
.clip button svg {
display:block;
width:100%;
height:100%;
fill:currentColor;
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
