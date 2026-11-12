/*!
 * Blue Cherub studio: the editor, with a Rig tab (app-cherub-rigger) and an Animate tab (app-cherub-animator).
 * Opening the Animate tab hands it the rig from the Rig tab whenever the rig has changed.
 * Copyright © 2026 Stoic Dreams - https://www.stoicdreams.com
 */
"use strict"
{
    webui.define("app-cherub-studio", {
        preload: 'app:cherub-rigger app:cherub-animator',
        constructor() {
            const t = this;
            t._tabs = [...t.template.querySelectorAll('[role="tab"]')];
            t._panels = [...t.template.querySelectorAll('[role="tabpanel"]')];
            t._rigger = t.template.querySelector('app-cherub-rigger');
            t._animator = t.template.querySelector('app-cherub-animator');
            t._lastRig = '';
            t._tabs.forEach((tab, index) => {
                tab.addEventListener('click', () => t.showTab(tab.dataset.tab));
                tab.addEventListener('keydown', ev => {
                    const step = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
                    if (ev.key === 'Home' || ev.key === 'End' || step) {
                        ev.preventDefault();
                        const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? t._tabs.length - 1 : (index + step + t._tabs.length) % t._tabs.length;
                        t.showTab(t._tabs[next].dataset.tab);
                        t._tabs[next].focus();
                    }
                });
            });
        },
        /** Show the "rig" or "animate" tab. */
        async showTab(name) {
            const t = this;
            t._tabs.forEach(tab => {
                const active = tab.dataset.tab === name;
                tab.setAttribute('aria-selected', active ? 'true' : 'false');
                tab.tabIndex = active ? 0 : -1;
            });
            t._panels.forEach(panel => { panel.hidden = panel.dataset.tab !== name; });
            if (name !== 'animate') {
                t._animator.pause();
                return;
            }
            const svg = t._rigger.svgText;
            if (!svg) return;
            const rig = t._rigger.rigData;
            const current = svg + JSON.stringify(rig.parts);
            if (current === t._lastRig) return;
            t._lastRig = current;
            if (!Object.keys(rig.parts).length) return;
            await t._animator.setRig({ svg, rig, name: rig.svg.replace(/\.svg$/i, '') });
        },
        shadowTemplate: `
<div class="tabs" role="tablist" aria-label="Studio">
<button type="button" role="tab" id="tab-rig" data-tab="rig" aria-selected="true" aria-controls="panel-rig">Rig</button>
<button type="button" role="tab" id="tab-animate" data-tab="animate" aria-selected="false" aria-controls="panel-animate" tabindex="-1">Animate</button>
</div>
<div role="tabpanel" id="panel-rig" data-tab="rig" aria-labelledby="tab-rig"><app-cherub-rigger></app-cherub-rigger></div>
<div role="tabpanel" id="panel-animate" data-tab="animate" aria-labelledby="tab-animate" hidden><app-cherub-animator></app-cherub-animator></div>
<style type="text/css">
:host {
display:block;
}
[hidden] {
display:none !important;
}
.tabs {
display:flex;
gap:0.25rem;
margin-bottom:0.75rem;
border-bottom:2px solid color-mix(in srgb, currentColor 25%, transparent);
}
[role="tab"] {
font:inherit;
padding:0.45rem 1.25rem;
border:none;
border-radius:0.4rem 0.4rem 0 0;
background:transparent;
color:inherit;
cursor:pointer;
}
[role="tab"][aria-selected="true"] {
background:var(--color-primary, #0980a4);
color:var(--color-primary-offset, #fff);
}
[role="tab"]:focus-visible {
outline:3px solid var(--color-active, #0b78ce);
outline-offset:2px;
}
</style>
`
    });
}
