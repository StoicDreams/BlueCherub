/*!
 * Blue Cherub animator: keyframe a rigged character on a timeline.
 * Select a part, pose it at a frame (drag to move or rotate, or type values), and each change becomes a key.
 * Every pose shown comes from the Rust scene evaluator (evaluate_scene and pose_at), the same code that plays scenes.
 * Copyright © 2026 Stoic Dreams - https://www.stoicdreams.com
 */
"use strict"
{
    const PROPERTIES = [
        { name: 'x', label: 'X', step: 1 },
        { name: 'y', label: 'Y', step: 1 },
        { name: 'rotate', label: 'Rotate (°)', step: 1 },
        { name: 'scaleX', label: 'Scale X', step: 0.05 },
        { name: 'scaleY', label: 'Scale Y', step: 0.05 },
        { name: 'opacity', label: 'Opacity', step: 0.05, min: 0, max: 1 },
    ];
    const EASES = [
        { value: 'inOut', label: 'Smooth (ease in and out)' },
        { value: 'linear', label: 'Steady (linear)' },
        { value: 'in', label: 'Speed up (ease in)' },
        { value: 'out', label: 'Slow down (ease out)' },
        { value: 'step', label: 'Hold, then jump (step)' },
    ];
    const MAX_FRAMES = 60 * 60 * 10;
    const MAX_UNDO = 200;
    const SAMPLE = { svg: '/animations/blue-cherub.svg', rig: '/animations/blue-cherub.rig.json', scene: '/animations/blue-cherub-idle.scene.json' };

    const core = () => window.appCherub;

    function round(value, places = 2) {
        const f = 10 ** places;
        return Math.round(value * f) / f;
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
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
        return node;
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

    function newScene(name) {
        return { formatVersion: 1, rig: `${name}.rig.json`, fps: 24, frameCount: 48, holdFrames: 1, tracks: [], library: { poses: {}, actions: {} } };
    }

    /** Check an opened scene and keep the tracks for parts this rig has. */
    const hasSwaps = (rig, part) => !!(rig.parts[part] && Array.isArray(rig.parts[part].swaps) && rig.parts[part].swaps.length);

    /** The properties a part can key: the six values, plus `swap` when it has swap drawings. */
    function keyable(rig, part) {
        const names = PROPERTIES.map(p => p.name);
        return hasSwaps(rig, part) ? [...names, 'swap'] : names;
    }

    function cleanKeys(keys, property) {
        return (Array.isArray(keys) ? keys : [])
            .filter(k => k && Number.isInteger(k.frame) && k.frame >= 0 && k.frame <= MAX_FRAMES * 20 && Number.isFinite(k.value))
            .map(k => ({
                frame: k.frame,
                value: property === 'swap' ? Math.max(0, Math.round(k.value)) : k.value,
                // Swaps always hold until the next key.
                ease: property === 'swap' ? 'step' : EASES.some(e => e.value === k.ease) ? k.ease : 'inOut',
            }))
            .sort((a, b) => a.frame - b.frame)
            .filter((k, i, all) => i === 0 || all[i - 1].frame !== k.frame);
    }

    function cleanTracks(tracks, rig, dropped) {
        const seen = new Set();
        const out = [];
        for (const track of Array.isArray(tracks) ? tracks : []) {
            if (!track || !rig.parts[track.part]) {
                if (track && track.part && dropped) dropped.add(track.part);
                continue;
            }
            if (!keyable(rig, track.part).includes(track.property) || seen.has(`${track.part}|${track.property}`)) continue;
            const keys = cleanKeys(track.keys, track.property);
            if (!keys.length) continue;
            seen.add(`${track.part}|${track.property}`);
            out.push({ part: track.part, property: track.property, keys });
        }
        return out;
    }

    const NAME_LIMIT = 40;
    const cleanName = name => typeof name === 'string' ? name.trim().slice(0, NAME_LIMIT) : '';

    /** Saved poses and actions, kept to the parts this rig has. */
    function cleanLibrary(data, rig) {
        const library = { poses: {}, actions: {} };
        const source = data && typeof data === 'object' ? data : {};
        for (const [rawName, pose] of Object.entries(source.poses || {}).slice(0, 200)) {
            const name = cleanName(rawName);
            if (!name || !pose || typeof pose !== 'object') continue;
            const parts = {};
            for (const [part, values] of Object.entries(pose)) {
                if (!rig.parts[part] || !values || typeof values !== 'object') continue;
                const kept = {};
                keyable(rig, part).forEach(prop => { if (Number.isFinite(values[prop])) kept[prop] = values[prop]; });
                if (Object.keys(kept).length) parts[part] = kept;
            }
            if (Object.keys(parts).length) library.poses[name] = parts;
        }
        for (const [rawName, action] of Object.entries(source.actions || {}).slice(0, 200)) {
            const name = cleanName(rawName);
            const length = action && parseInt(action.length);
            if (!name || !(length >= 0 && length <= MAX_FRAMES)) continue;
            const tracks = cleanTracks(action.tracks, rig).map(tr => ({ ...tr, keys: tr.keys.filter(k => k.frame <= length) })).filter(tr => tr.keys.length);
            if (tracks.length) library.actions[name] = { length, tracks };
        }
        return library;
    }

    function cleanScene(data, rig, name) {
        if (!data || typeof data !== 'object' || data.formatVersion !== 1) throw new Error('This is not a version 1 Blue Cherub scene');
        const scene = newScene(name);
        const fps = parseInt(data.fps);
        const frames = parseInt(data.frameCount);
        if (fps >= 1 && fps <= 60) scene.fps = fps;
        if (frames >= 1 && frames <= MAX_FRAMES) scene.frameCount = frames;
        scene.holdFrames = parseInt(data.holdFrames) === 2 ? 2 : 1;
        const dropped = new Set();
        scene.tracks = cleanTracks(data.tracks, rig, dropped);
        scene.library = cleanLibrary(data.library, rig);
        return { scene, dropped: [...dropped] };
    }

    webui.define("app-cherub-animator", {
        preload: 'app:cherub-player app:cherub-export',
        props: {
            /** The scene as saved. */
            sceneData: {
                get() { return JSON.parse(JSON.stringify(this._scene)); }
            },
            /** The frame being edited. */
            frame: {
                get() { return this._frame; }
            },
            /** The selected part's id, or null. */
            selectedPart: {
                get() { return this._part; }
            },
            /** The latest values of every part at the current frame, from the Rust evaluator. */
            poses: {
                get() { return this._poses; }
            },
        },
        constructor() {
            const t = this;
            const q = selector => t.template.querySelector(selector);
            t._player = q('app-cherub-player');
            t._overlay = q('.overlay');
            t._empty = q('.empty');
            t._work = q('.work');
            t._partsList = q('.parts');
            t._panel = q('.panel');
            t._lanes = q('.lanes');
            t._slider = q('input[name="frame"]');
            t._frameText = q('.frame-text');
            t._status = q('.status');
            t._fps = q('input[name="fps"]');
            t._length = q('input[name="length"]');
            t._twos = q('input[name="twos"]');
            t._openInput = q('input[name="scene-file"]');
            t._export = q('app-cherub-export');
            t._export.source = () => t._rig ? { svg: t._svgText, rig: t._rig, scene: t.sceneData, name: t._name } : null;
            t._poseList = q('.pose-list');
            t._actionList = q('.action-list');
            t._form = {
                poseName: q('#pose-name'), poseScope: q('#pose-scope'),
                actionName: q('#action-name'), actionFrom: q('#action-from'), actionTo: q('#action-to'),
                actionScope: q('#action-scope'), actionRepeat: q('#action-repeat'),
            };
            t._buttons = {};
            t.template.querySelectorAll('button[data-action]').forEach(button => {
                t._buttons[button.dataset.action] = button;
                button.addEventListener('click', () => t._run(button.dataset.action));
            });
            t._toolButtons = [...t.template.querySelectorAll('button[data-tool]')];
            t._toolButtons.forEach(button => {
                button.addEventListener('click', () => t.setTool(button.dataset.tool));
            });
            t._svgText = '';
            t._rig = null;
            t._name = 'scene';
            t._scene = newScene('scene');
            t._frame = 0;
            t._part = null;
            t._poses = {};
            t._tool = 'move';
            t._undo = [];
            t._redo = [];
            t._dirty = false;
            t._poseToken = 0;
            t._slider.addEventListener('input', () => t.setFrame(parseInt(t._slider.value)));
            t._fps.addEventListener('change', () => t.setTiming({ fps: parseInt(t._fps.value) }));
            t._length.addEventListener('change', () => t.setTiming({ frameCount: parseInt(t._length.value) }));
            t._twos.addEventListener('change', () => t.setTiming({ holdFrames: t._twos.checked ? 2 : 1 }));
            t._openInput.addEventListener('change', () => t._openFromInput());
            t._player.addEventListener('framechange', ev => t._onPlayerFrame(ev.detail.frame));
            t._player.addEventListener('pointerdown', ev => t._stagePointerDown(ev));
            t._lanes.addEventListener('click', ev => {
                const key = ev.target.closest('button[data-frame]');
                if (key) {
                    t.selectPart(key.dataset.part);
                    t.setFrame(parseInt(key.dataset.frame));
                }
            });
            t.addEventListener('keydown', ev => t._keydown(ev));
            t._onBeforeUnload = ev => {
                if (!t._dirty) return;
                ev.preventDefault();
                ev.returnValue = '';
            };
        },
        connected() {
            window.addEventListener('beforeunload', this._onBeforeUnload);
            this._render();
        },
        disconnected() {
            window.removeEventListener('beforeunload', this._onBeforeUnload);
            this.pause();
        },
        reconnected() {
            window.addEventListener('beforeunload', this._onBeforeUnload);
        },
        // ----- Loading -----
        /**
         * Use a rigged character. The scene keeps its keys for parts the rig still has.
         * @param {object} data - `svg` (rigged SVG text), `rig` (rig data), and `name` (file name without extension).
         */
        async setRig({ svg, rig, name }) {
            const t = this;
            t.pause();
            t._svgText = svg;
            t._rig = { formatVersion: 1, parts: JSON.parse(JSON.stringify(rig.parts || {})) };
            t._name = name || 'scene';
            const { scene, dropped } = cleanScene(t._scene, t._rig, t._name);
            t._scene = scene;
            if (t._part && !t._rig.parts[t._part]) t._part = null;
            t._frame = Math.min(t._frame, scene.frameCount - 1);
            const result = await t._player.loadData({ svg, rig: t._rig, scene });
            if (!result.ok) {
                t._say(`Could not show this rig: ${result.error}`);
                return result;
            }
            t._player.showFrame(t._frame);
            await t._refreshPose();
            t._render();
            const count = Object.keys(t._rig.parts).length;
            t._say(dropped.length
                ? `Using ${t._name} with ${count} parts. Removed keys for parts it no longer has: ${dropped.join(', ')}.`
                : `Using ${t._name} with ${count} parts.`);
            return result;
        },
        /** Replace the scene, such as one opened from a file. Keys for parts the rig doesn't have are dropped. */
        async setScene(data) {
            const t = this;
            if (!t._rig) throw new Error('Choose a rig first');
            const { scene, dropped } = cleanScene(data, t._rig, t._name);
            t._checkpoint();
            t._scene = scene;
            t._frame = 0;
            await t._changed();
            return dropped;
        },
        async loadSample() {
            const t = this;
            try {
                const get = (url, kind) => fetch(url).then(r => { if (!r.ok) throw new Error(`${kind} ${r.status}`); return kind === 'svg' ? r.text() : r.json(); });
                const [svg, rig, scene] = await Promise.all([get(SAMPLE.svg, 'svg'), get(SAMPLE.rig, 'rig'), get(SAMPLE.scene, 'scene')]);
                t._scene = newScene('blue-cherub');
                await t.setRig({ svg, rig, name: 'blue-cherub' });
                t._scene = cleanScene(scene, t._rig, 'blue-cherub').scene;
                t._undo = [];
                t._redo = [];
                t._frame = 0;
                await t._changed(false);
                t._say('Loaded the Blue Cherub idle scene.');
            } catch (ex) {
                t._say(`Could not load the sample: ${ex.message}`);
            }
        },
        async _openFromInput() {
            const t = this;
            const file = t._openInput.files[0];
            t._openInput.value = '';
            if (!file) return;
            try {
                if (file.size > 5 * 1024 * 1024) throw new Error('it is larger than 5 MB');
                const dropped = await t.setScene(JSON.parse(await file.text()));
                t._say(dropped.length
                    ? `Opened ${file.name}. This rig has no ${dropped.join(', ')}, so those keys were removed.`
                    : `Opened ${file.name}.`);
            } catch (ex) {
                t._say(`Could not open ${file.name}: ${ex.message}`);
            }
        },
        downloadScene() {
            const t = this;
            const scene = { ...t.sceneData, rig: `${t._name}.rig.json` };
            download(`${t._name}.scene.json`, JSON.stringify(scene, null, 4), 'application/json');
            t._dirty = false;
            t._say(`Downloaded ${t._name}.scene.json. Keep it with ${t._name}.svg and ${t._name}.rig.json.`);
        },
        // ----- Undo -----
        _checkpoint() {
            const t = this;
            t._undo.push(JSON.stringify(t._scene));
            if (t._undo.length > MAX_UNDO) t._undo.shift();
            t._redo = [];
            t._dirty = true;
        },
        async undo() {
            const t = this;
            if (!t._undo.length) return;
            t._redo.push(JSON.stringify(t._scene));
            t._scene = JSON.parse(t._undo.pop());
            t._dirty = true;
            await t._changed(false);
            t._say('Undone.');
        },
        async redo() {
            const t = this;
            if (!t._redo.length) return;
            t._undo.push(JSON.stringify(t._scene));
            t._scene = JSON.parse(t._redo.pop());
            t._dirty = true;
            await t._changed(false);
            t._say('Redone.');
        },
        // ----- Editing -----
        selectPart(id) {
            const t = this;
            t._part = id && t._rig && t._rig.parts[id] ? id : null;
            t._render();
        },
        setTool(tool) {
            this._tool = tool === 'rotate' ? 'rotate' : 'move';
            this._render();
        },
        async setFrame(frame) {
            const t = this;
            if (!Number.isFinite(frame)) return;
            t._frame = Math.max(0, Math.min(t._scene.frameCount - 1, Math.round(frame)));
            t._player.showFrame(t._frame);
            await t._refreshPose();
            t._render();
        },
        _track(part, property, create) {
            const t = this;
            let track = t._scene.tracks.find(tr => tr.part === part && tr.property === property);
            if (!track && create) {
                track = { part, property, keys: [] };
                t._scene.tracks.push(track);
            }
            return track;
        },
        _putKey(part, property, value, frame = this._frame, ease = null) {
            const t = this;
            const track = t._track(part, property, true);
            const existing = track.keys.find(k => k.frame === frame);
            if (property === 'swap') ease = 'step';
            if (existing) {
                existing.value = value;
                if (ease) existing.ease = ease;
            } else {
                // A new key eases like the key before it, so a run of keys keeps one feel.
                const before = [...track.keys].reverse().find(k => k.frame < frame);
                track.keys.push({ frame, value, ease: ease || (before ? before.ease : 'inOut') });
                track.keys.sort((a, b) => a.frame - b.frame);
            }
        },
        /** Key one value for a part at the current frame. */
        async setValue(part, property, value) {
            const t = this;
            if (!t._rig || !t._rig.parts[part] || !keyable(t._rig, part).includes(property) || !Number.isFinite(value)) return;
            if (property === 'opacity') value = Math.max(0, Math.min(1, value));
            if (property === 'swap') value = Math.max(0, Math.min(t._rig.parts[part].swaps.length - 1, Math.round(value)));
            t._checkpoint();
            t._putKey(part, property, round(value, 4));
            await t._changed();
        },
        /** Key every value of the selected part at the current frame, holding its pose here. */
        async keyAll(part = this._part) {
            const t = this;
            const pose = t._poses[part];
            if (!pose) return;
            t._checkpoint();
            keyable(t._rig, part).forEach(prop => t._putKey(part, prop, prop === 'swap' ? pose.swap : round(pose[prop], 4)));
            await t._changed();
            t._say(`Keyed ${part} at frame ${t._frame}.`);
        },
        /** Remove a part's keys at the current frame. */
        async deleteKeys(part = this._part) {
            const t = this;
            const tracks = t._scene.tracks.filter(tr => tr.part === part && tr.keys.some(k => k.frame === t._frame));
            if (!tracks.length) return;
            t._checkpoint();
            tracks.forEach(tr => { tr.keys = tr.keys.filter(k => k.frame !== t._frame); });
            t._scene.tracks = t._scene.tracks.filter(tr => tr.keys.length);
            await t._changed();
            t._say(`Removed ${part}'s keys at frame ${t._frame}.`);
        },
        /** Set how a part moves from its keys at the current frame to its next keys. */
        async setEase(part, ease) {
            const t = this;
            if (!EASES.some(e => e.value === ease)) return;
            const keys = t._scene.tracks.filter(tr => tr.part === part && tr.property !== 'swap').flatMap(tr => tr.keys.filter(k => k.frame === t._frame));
            if (!keys.length) return;
            t._checkpoint();
            keys.forEach(k => { k.ease = ease; });
            await t._changed();
        },
        async setTiming({ fps, frameCount, holdFrames }) {
            const t = this;
            const next = { ...t._scene };
            if (fps !== undefined) {
                if (!(fps >= 1 && fps <= 60)) return t._sayAndRender('Frames per second must be from 1 to 60.');
                next.fps = fps;
            }
            if (frameCount !== undefined) {
                if (!(frameCount >= 1 && frameCount <= MAX_FRAMES)) return t._sayAndRender(`Length must be from 1 to ${MAX_FRAMES} frames.`);
                next.frameCount = frameCount;
            }
            if (holdFrames !== undefined) next.holdFrames = holdFrames === 2 ? 2 : 1;
            if (next.holdFrames > next.frameCount) next.holdFrames = 1;
            t._checkpoint();
            t._scene = next;
            t._frame = Math.min(t._frame, next.frameCount - 1);
            await t._changed();
        },
        _sayAndRender(message) {
            this._say(message);
            this._render();
        },
        /** After a change: re-evaluate, refresh the values, and redraw. */
        async _changed(keepSelection = true) {
            const t = this;
            if (!t._rig) return;
            if (!keepSelection && t._part && !t._rig.parts[t._part]) t._part = null;
            t._frame = Math.min(t._frame, t._scene.frameCount - 1);
            const result = await t._player.updateScene(t._scene);
            if (!result.ok && result.error !== 'Replaced by a newer scene') t._say(`The scene has a problem: ${result.error}`);
            t._player.showFrame(t._frame);
            await t._refreshPose();
            t._render();
        },
        async _refreshPose() {
            const t = this;
            if (!t._rig) return;
            const token = ++t._poseToken;
            try {
                await core().workerReady();
                const json = await webui.worker.pose_at(JSON.stringify({ rig: t._rig, scene: t._scene }), t._frame);
                if (token === t._poseToken) t._poses = JSON.parse(json);
            } catch (ex) {
                if (token === t._poseToken) t._say(`Could not read the pose: ${ex}`);
            }
        },
        // ----- Library -----
        /** A part and every part attached to it, or every part. */
        _scopeParts(scope) {
            const t = this;
            const all = Object.keys(t._rig.parts);
            if (scope !== 'part' || !t._part) return all;
            const out = new Set([t._part]);
            let grew = true;
            while (grew) {
                grew = false;
                for (const id of all) {
                    const parent = t._rig.parts[id].parent;
                    if (parent && out.has(parent) && !out.has(id)) {
                        out.add(id);
                        grew = true;
                    }
                }
            }
            return [...out];
        },
        async _posesAt(frame) {
            const t = this;
            await core().workerReady();
            return JSON.parse(await webui.worker.pose_at(JSON.stringify({ rig: t._rig, scene: t._scene }), frame));
        },
        _poseValues(id, pose) {
            const t = this;
            const values = {};
            keyable(t._rig, id).forEach(prop => { values[prop] = prop === 'swap' ? pose.swap : round(pose[prop], 4); });
            return values;
        },
        /** Save the pose at this frame under a name, for the whole character or the selected part and its attached parts. */
        savePose(name, scope = 'all') {
            const t = this;
            name = cleanName(name);
            if (!name) return t._say('Give the pose a name.');
            if (scope === 'part' && !t._part) return t._say('Select a part to save its pose.');
            const parts = {};
            t._scopeParts(scope).forEach(id => { if (t._poses[id]) parts[id] = t._poseValues(id, t._poses[id]); });
            const replaced = !!t._scene.library.poses[name];
            t._checkpoint();
            t._scene.library.poses[name] = parts;
            t._form.poseName.value = '';
            t._render();
            t._say(`${replaced ? 'Replaced' : 'Saved'} the pose “${name}” (${Object.keys(parts).length} parts).`);
        },
        /** Key a saved pose at the current frame. */
        async applyPose(name) {
            const t = this;
            const pose = t._scene.library.poses[name];
            if (!pose) return;
            t._checkpoint();
            for (const [part, values] of Object.entries(pose)) {
                if (!t._rig.parts[part]) continue;
                Object.entries(values).forEach(([prop, value]) => { if (keyable(t._rig, part).includes(prop)) t._putKey(part, prop, value); });
            }
            await t._changed();
            t._say(`Applied the pose “${name}” at frame ${t._frame}.`);
        },
        deletePose(name) {
            const t = this;
            if (!t._scene.library.poses[name]) return;
            t._checkpoint();
            delete t._scene.library.poses[name];
            t._render();
            t._say(`Deleted the pose “${name}”.`);
        },
        /** Save the motion between two frames as a named action that can be inserted anywhere. */
        async saveAction(name, from, to, scope = 'all') {
            const t = this;
            name = cleanName(name);
            if (!name) return t._say('Give the action a name.');
            if (scope === 'part' && !t._part) return t._say('Select a part to save its action.');
            const last = t._scene.frameCount - 1;
            if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > last || from >= to) {
                return t._say(`Choose frames from 0 to ${last}, with "from" before "to".`);
            }
            const parts = new Set(t._scopeParts(scope));
            let startPoses, endPoses;
            try {
                [startPoses, endPoses] = await Promise.all([t._posesAt(from), t._posesAt(to)]);
            } catch (ex) {
                return t._say(`Could not read the poses: ${ex}`);
            }
            const length = to - from;
            const tracks = [];
            for (const track of t._scene.tracks) {
                if (!parts.has(track.part)) continue;
                const value = (poses, prop) => prop === 'swap' ? poses[track.part].swap : round(poses[track.part][prop], 4);
                const governing = [...track.keys].reverse().find(k => k.frame <= from);
                // The start and end values are keyed too, so the action plays the same wherever its keys fell.
                const keys = [{ frame: 0, value: value(startPoses, track.property), ease: governing ? governing.ease : 'inOut' }];
                track.keys.filter(k => k.frame > from && k.frame < to).forEach(k => keys.push({ frame: k.frame - from, value: k.value, ease: k.ease }));
                keys.push({ frame: length, value: value(endPoses, track.property), ease: 'inOut' });
                if (track.property === 'swap') keys.forEach(k => { k.ease = 'step'; });
                tracks.push({ part: track.part, property: track.property, keys });
            }
            if (!tracks.length) return t._say('Nothing in that range moves yet, so there is no action to save.');
            const replaced = !!t._scene.library.actions[name];
            t._checkpoint();
            t._scene.library.actions[name] = { length, tracks };
            t._form.actionName.value = '';
            t._render();
            t._say(`${replaced ? 'Replaced' : 'Saved'} the action “${name}” (${length} frames).`);
        },
        /** Insert a saved action starting at the current frame, as many times as asked. Lengthens the scene if needed. */
        async insertAction(name, times = 1) {
            const t = this;
            const action = t._scene.library.actions[name];
            if (!action) return;
            times = Math.max(1, Math.min(50, parseInt(times) || 1));
            let end = t._frame;
            t._checkpoint();
            for (let r = 0; r < times; r++) {
                const base = t._frame + r * action.length;
                for (const track of action.tracks) {
                    if (!t._rig.parts[track.part] || !keyable(t._rig, track.part).includes(track.property)) continue;
                    track.keys.forEach(k => {
                        t._putKey(track.part, track.property, k.value, base + k.frame, k.ease);
                        end = Math.max(end, base + k.frame);
                    });
                }
            }
            let grew = '';
            if (end >= t._scene.frameCount) {
                t._scene.frameCount = Math.min(MAX_FRAMES, end + 1);
                grew = ` The scene is now ${t._scene.frameCount} frames long.`;
            }
            await t._changed();
            t._say(`Inserted “${name}”${times > 1 ? ` ${times} times` : ''} at frame ${t._frame}.${grew}`);
        },
        deleteAction(name) {
            const t = this;
            if (!t._scene.library.actions[name]) return;
            t._checkpoint();
            delete t._scene.library.actions[name];
            t._render();
            t._say(`Deleted the action “${name}”.`);
        },
        /** Tell the export panel the scene's shape and length, for its size readout. */
        _describeExport() {
            const t = this;
            if (typeof t._export.describe !== 'function') return;
            const box = (t._player.svgElement && t._player.svgElement.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
            const aspect = box.length === 4 && box[2] > 0 && box[3] > 0 ? box[2] / box[3] : 1;
            t._export.describe({ aspect, frameCount: t._scene.frameCount, fps: t._scene.fps });
        },
        _renderLibrary() {
            const t = this;
            const { poses, actions } = t._scene.library;
            const row = (name, detail, useLabel, use, remove) => el('li', {}, [
                el('span', { class: 'saved-name', text: detail ? `${name} (${detail})` : name }),
                el('button', { type: 'button', 'data-focus': `use-${useLabel}-${name}`, 'aria-label': `${useLabel} ${name}`, text: useLabel, on: { click: use } }),
                el('button', { type: 'button', 'data-focus': `delete-${useLabel}-${name}`, 'aria-label': `Delete ${name}`, text: 'Delete', on: { click: remove } }),
            ]);
            const poseNames = Object.keys(poses).sort();
            const actionNames = Object.keys(actions).sort();
            t._poseList.replaceChildren(...(poseNames.length
                ? poseNames.map(name => row(name, '', 'Apply', () => t.applyPose(name), () => t.deletePose(name)))
                : [el('li', { class: 'note', text: 'No saved poses yet.' })]));
            t._actionList.replaceChildren(...(actionNames.length
                ? actionNames.map(name => row(name, `${actions[name].length} frames`, 'Insert', () => t.insertAction(name, t._form.actionRepeat.value), () => t.deleteAction(name)))
                : [el('li', { class: 'note', text: 'No saved actions yet.' })]));
            [t._form.poseScope, t._form.actionScope].forEach(select => {
                select.querySelector('option[value="part"]').disabled = !t._part;
                if (!t._part) select.value = 'all';
            });
            t._form.actionTo.max = t._scene.frameCount - 1;
            const to = parseInt(t._form.actionTo.value);
            if (!(to >= 1) || to > t._scene.frameCount - 1) t._form.actionTo.value = Math.max(1, t._scene.frameCount - 1);
            t._form.actionFrom.max = t._scene.frameCount - 2;
        },
        // ----- Playback -----
        play() {
            const t = this;
            if (!t._rig) return;
            t._player.play();
            t._render();
        },
        pause() {
            const t = this;
            if (!t._player.playing) return;
            t._player.pause();
            t.setFrame(t._player.currentFrame);
        },
        _onPlayerFrame(frame) {
            const t = this;
            if (!t._player.playing) return;
            // While playing, only the frame readout moves. Values refresh when it stops.
            t._frame = frame;
            t._slider.value = frame;
            t._frameText.innerText = t._frameLabel();
        },
        _frameLabel() {
            const t = this;
            return `Frame ${t._frame} of ${t._scene.frameCount - 1} (${(t._frame / t._scene.fps).toFixed(2)} s)`;
        },
        // ----- Dragging on the stage -----
        _partAt(ev) {
            const t = this;
            for (const node of ev.composedPath()) {
                if (node === t._player) break;
                if (node instanceof Element && node.id && t._rig.parts[node.id]) return node.id;
            }
            return null;
        },
        _stagePointerDown(ev) {
            const t = this;
            if (!t._rig || ev.button !== 0) return;
            // Pressing on the drawing keeps keyboard shortcuts, such as Space and K, in the animator.
            t._player.parentElement.focus({ preventScroll: true });
            const part = t._partAt(ev);
            if (!part) return;
            ev.preventDefault();
            if (t._player.playing) t.pause();
            if (part !== t._part) {
                t.selectPart(part);
                return;
            }
            const svg = t._player.svgElement;
            const screen = svg && svg.getScreenCTM();
            const pose = t._poses[part];
            if (!screen || !pose) return;
            const toRoot = screen.inverse();
            const start = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(toRoot);
            const parent = new DOMMatrix(pose.parentWorld);
            const parentLinear = new DOMMatrix([parent.a, parent.b, parent.c, parent.d, 0, 0]);
            const pivot = t._rig.parts[part].pivot;
            const pivotRoot = new DOMMatrix(pose.world).transformPoint(new DOMPoint(pivot[0], pivot[1]));
            const mirrored = parent.a * parent.d - parent.b * parent.c < 0 ? -1 : 1;
            const startAngle = Math.atan2(start.y - pivotRoot.y, start.x - pivotRoot.x);
            const tool = t._tool;
            const from = { x: pose.x, y: pose.y, rotate: pose.rotate };
            let moved = false;
            let pending = false;
            const capture = ev.target;
            capture.setPointerCapture && capture.setPointerCapture(ev.pointerId);
            const move = e => {
                const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(toRoot);
                if (!moved) {
                    if (Math.hypot(p.x - start.x, p.y - start.y) < 0.5) return;
                    moved = true;
                    t._checkpoint();
                }
                if (tool === 'rotate') {
                    const angle = Math.atan2(p.y - pivotRoot.y, p.x - pivotRoot.x);
                    t._putKey(part, 'rotate', round(from.rotate + mirrored * (angle - startAngle) * 180 / Math.PI, 2));
                } else {
                    const local = parentLinear.inverse().transformPoint(new DOMPoint(p.x - start.x, p.y - start.y));
                    t._putKey(part, 'x', round(from.x + local.x, 2));
                    t._putKey(part, 'y', round(from.y + local.y, 2));
                }
                // One evaluation at a time keeps dragging smooth on big rigs.
                if (!pending) {
                    pending = true;
                    t._player.updateScene(t._scene).then(() => { pending = false; });
                }
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
                if (moved) t._changed();
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', up);
        },
        // ----- Keyboard -----
        _keydown(ev) {
            const t = this;
            const origin = ev.composedPath()[0];
            const tag = (origin && origin.localName) || '';
            if (/^(input|select|textarea)$/.test(tag)) return;
            const key = ev.key.toLowerCase();
            const mod = ev.ctrlKey || ev.metaKey;
            let action = null;
            if (mod && key === 'z') action = ev.shiftKey ? 'redo' : 'undo';
            else if (mod && key === 'y') action = 'redo';
            else if (!mod && key === ',') action = 'prev';
            else if (!mod && key === '.') action = 'next';
            else if (!mod && key === 'k') action = 'key';
            else if (!mod && key === 'delete') action = 'delete';
            else if (!mod && key === ' ' && tag !== 'button') action = 'play';
            if (!action) return;
            ev.preventDefault();
            t._run(action);
        },
        _run(action) {
            const t = this;
            switch (action) {
                case 'sample': t.loadSample(); return;
                case 'open': if (t._rig) t._openInput.click(); return;
                case 'undo': t.undo(); return;
                case 'redo': t.redo(); return;
            }
            if (!t._rig) return;
            switch (action) {
                case 'download': t.downloadScene(); break;
                case 'save-pose': t.savePose(t._form.poseName.value, t._form.poseScope.value); break;
                case 'save-action': t.saveAction(t._form.actionName.value, parseInt(t._form.actionFrom.value), parseInt(t._form.actionTo.value), t._form.actionScope.value); break;
                case 'play': if (t._player.playing) t.pause(); else t.play(); break;
                case 'first': t.pause(); t.setFrame(0); break;
                case 'last': t.pause(); t.setFrame(t._scene.frameCount - 1); break;
                case 'prev': t.pause(); t.setFrame(t._frame - 1); break;
                case 'next': t.pause(); t.setFrame(t._frame + 1); break;
                case 'key': if (t._part) t.keyAll(); break;
                case 'delete': if (t._part) t.deleteKeys(); break;
            }
        },
        // ----- Display -----
        _say(message) {
            this._status.innerText = message;
        },
        _keysAt(part, frame) {
            return this._scene.tracks.filter(tr => tr.part === part).flatMap(tr => tr.keys.filter(k => k.frame === frame).map(k => ({ ...k, property: tr.property })));
        },
        _render() {
            const t = this;
            const has = !!t._rig;
            t._empty.hidden = has;
            t._work.hidden = !has;
            const playing = t._player.playing;
            t._buttons.undo.disabled = !t._undo.length;
            t._buttons.redo.disabled = !t._redo.length;
            t._buttons.open.disabled = !has;
            t._buttons.download.disabled = !has;
            t._buttons.play.innerText = playing ? 'Pause' : 'Play';
            t._buttons.play.setAttribute('aria-pressed', playing ? 'true' : 'false');
            t._toolButtons.forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t._tool ? 'true' : 'false'));
            if (!has) return;
            t._fps.value = t._scene.fps;
            t._length.value = t._scene.frameCount;
            t._twos.checked = t._scene.holdFrames === 2;
            t._slider.max = t._scene.frameCount - 1;
            t._slider.value = t._frame;
            t._frameText.innerText = t._frameLabel();
            // Redrawing replaces controls, so put focus back on the same one, or keyboard users lose their place.
            const active = t.shadowRoot && t.shadowRoot.activeElement;
            const focusKey = active && (active.dataset.focus || active.id);
            t._renderParts();
            t._renderPanel();
            t._renderLibrary();
            t._describeExport();
            t._renderLanes();
            t._renderOverlay();
            if (focusKey && !(t.shadowRoot.activeElement && t.shadowRoot.activeElement.isConnected)) {
                const again = t.shadowRoot.querySelector(`[data-focus="${CSS.escape(focusKey)}"], [id="${CSS.escape(focusKey)}"]`);
                if (again) again.focus({ preventScroll: true });
            }
        },
        _partIds() {
            const t = this;
            const keyed = new Set(t._scene.tracks.map(tr => tr.part));
            return Object.keys(t._rig.parts).sort((a, b) => (keyed.has(b) - keyed.has(a)) || a.localeCompare(b));
        },
        _renderParts() {
            const t = this;
            t._partsList.replaceChildren(...t._partIds().map(id => el('li', {}, [
                el('button', { type: 'button', 'data-focus': `part-${id}`, 'aria-pressed': id === t._part ? 'true' : 'false', text: id, on: { click: () => t.selectPart(id) } }),
            ])));
        },
        _renderPanel() {
            const t = this;
            const part = t._part;
            if (!part) {
                t._panel.replaceChildren(el('p', { text: 'Select a part on the drawing or in the list. Drag it to pose it, and each change becomes a key at this frame.' }));
                return;
            }
            const pose = t._poses[part] || {};
            const keys = t._keysAt(part, t._frame);
            const keyed = new Set(keys.map(k => k.property));
            const fields = PROPERTIES.map(p => {
                const id = `value-${p.name}`;
                const input = el('input', { type: 'number', id, step: p.step, min: p.min, max: p.max, value: pose[p.name] === undefined ? '' : round(pose[p.name], 3) });
                input.addEventListener('change', () => t.setValue(part, p.name, parseFloat(input.value)));
                return el('div', { class: keyed.has(p.name) ? 'field keyed' : 'field' }, [
                    el('label', { for: id, text: keyed.has(p.name) ? `${p.label} ◆` : p.label }),
                    input,
                ]);
            });
            if (hasSwaps(t._rig, part)) {
                const svg = t._player.svgElement;
                const swapSelect = el('select', { id: 'value-swap' }, t._rig.parts[part].swaps.map((swapId, index) => {
                    const option = svg && svg.querySelector(`[id="${CSS.escape(swapId)}"]`);
                    const name = (option && option.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label')) || swapId;
                    return el('option', { value: index, text: name, selected: pose.swap === index });
                }));
                swapSelect.addEventListener('change', () => t.setValue(part, 'swap', parseInt(swapSelect.value)));
                fields.push(el('div', { class: keyed.has('swap') ? 'field keyed wide' : 'field wide' }, [
                    el('label', { for: 'value-swap', text: keyed.has('swap') ? 'Drawing ◆' : 'Drawing' }),
                    swapSelect,
                ]));
            }
            const eases = new Set(keys.filter(k => k.property !== 'swap').map(k => k.ease));
            const easeSelect = el('select', { id: 'key-ease', disabled: !keys.some(k => k.property !== 'swap') }, EASES.map(e => el('option', { value: e.value, text: e.label, selected: eases.size === 1 && eases.has(e.value) })));
            if (eases.size !== 1) easeSelect.prepend(el('option', { value: '', text: eases.size ? 'Mixed' : 'No keys here', selected: true }));
            easeSelect.addEventListener('change', () => t.setEase(part, easeSelect.value));
            t._panel.replaceChildren(
                el('h3', { text: part }),
                // These notes keep the same size on every frame, so scrubbing never moves the panel or the timeline.
                el('p', { class: 'note fixed', text: keys.length ? `◆ ${keys.length} key${keys.length === 1 ? '' : 's'} at frame ${t._frame}.` : `No keys at frame ${t._frame} yet. Changing a value adds one.` }),
                t._scene.holdFrames === 2
                    ? el('p', {
                        class: 'note fixed',
                        style: t._frame % 2 === 1 ? '' : 'visibility:hidden',
                        'aria-hidden': t._frame % 2 === 1 ? null : 'true',
                        text: `On twos, frame ${t._frame - (t._frame % 2 === 1 ? 0 : 1) || 1} shows the frame before it. Keys here appear one frame later.`,
                    })
                    : '',
                el('div', { class: 'fields' }, fields),
                el('label', { for: 'key-ease', text: 'From these keys to the next' }),
                easeSelect,
                el('div', { class: 'row' }, [
                    el('button', { type: 'button', class: 'primary', 'data-focus': 'key-pose', 'aria-keyshortcuts': 'K', text: 'Key pose', on: { click: () => t.keyAll(part) } }),
                    el('button', { type: 'button', 'data-focus': 'delete-keys', 'aria-keyshortcuts': 'Delete', disabled: !keys.length, text: 'Delete keys', on: { click: () => t.deleteKeys(part) } }),
                ]),
            );
        },
        _renderLanes() {
            const t = this;
            const last = Math.max(1, t._scene.frameCount - 1);
            const pos = frame => `${Math.min(100, (frame / last) * 100)}%`;
            const rows = t._partIds().map(id => {
                const frames = [...new Set(t._scene.tracks.filter(tr => tr.part === id).flatMap(tr => tr.keys.map(k => k.frame)))].sort((a, b) => a - b);
                const lane = el('div', { class: 'lane' }, frames.filter(f => f < t._scene.frameCount).map(f => el('button', {
                    type: 'button',
                    class: f === t._frame && id === t._part ? 'key current' : 'key',
                    'data-part': id,
                    'data-frame': f,
                    'data-focus': `key-${id}-${f}`,
                    'aria-label': `${id} key at frame ${f}`,
                    style: `left:${pos(f)}`,
                })));
                return el('div', { class: id === t._part ? 'track selected' : 'track' }, [el('span', { class: 'track-name', text: id }), lane]);
            });
            const marker = el('div', { class: 'playhead', style: `left:${pos(t._frame)}`, 'aria-hidden': 'true' });
            t._lanes.replaceChildren(...rows, el('div', { class: 'playhead-track' }, [marker]));
        },
        _renderOverlay() {
            const t = this;
            const svg = t._player.svgElement;
            const overlay = t._overlay;
            if (!svg || !t._part || !t._poses[t._part]) {
                overlay.replaceChildren();
                return;
            }
            const viewBox = svg.getAttribute('viewBox');
            if (viewBox) overlay.setAttribute('viewBox', viewBox);
            const pose = t._poses[t._part];
            const pivot = t._rig.parts[t._part].pivot;
            const p = new DOMMatrix(pose.world).transformPoint(new DOMPoint(pivot[0], pivot[1]));
            const box = (viewBox || '0 0 400 400').split(/[\s,]+/).map(Number);
            const size = Math.max(box[2], box[3]) / 100;
            const shapes = [svgEl('circle', { class: 'pivot', cx: p.x, cy: p.y, r: size * 1.2 })];
            if (t._tool === 'rotate') shapes.unshift(svgEl('circle', { class: 'ring', cx: p.x, cy: p.y, r: size * 8 }));
            overlay.replaceChildren(...shapes);
        },
        shadowTemplate: `
<div class="toolbar" role="toolbar" aria-label="Scene tools">
<button type="button" data-action="sample">Blue Cherub sample</button>
<button type="button" data-action="open">Open scene</button>
<span class="gap"></span>
<button type="button" data-action="undo" aria-keyshortcuts="Control+Z">Undo</button>
<button type="button" data-action="redo" aria-keyshortcuts="Control+Shift+Z Control+Y">Redo</button>
<span class="gap"></span>
<button type="button" data-tool="move" aria-pressed="true">Move</button>
<button type="button" data-tool="rotate" aria-pressed="false">Rotate</button>
<span class="gap"></span>
<button type="button" data-action="download" class="primary">Download scene</button>
<input type="file" name="scene-file" accept=".json,application/json" hidden>
</div>
<p class="empty">Rig a character on the Rig tab, or load the Blue Cherub sample, to start animating.</p>
<div class="work" hidden>
<div class="main">
<section aria-label="Parts"><h2>Parts</h2><ul class="parts"></ul></section>
<section class="canvas" aria-label="Scene">
<div class="stage-wrap" tabindex="-1"><app-cherub-player no-controls label="The scene being animated"></app-cherub-player><svg class="overlay" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg></div>
</section>
<div class="side">
<section aria-label="Selected part"><h2>Pose</h2><div class="panel"></div></section>
<details class="library"><summary>Library: saved poses and actions</summary>
<h3>Poses</h3>
<ul class="saved pose-list"></ul>
<div class="form">
<label for="pose-name">Pose name</label><input id="pose-name" type="text" maxlength="40" autocomplete="off" spellcheck="false">
<label for="pose-scope">Save</label><select id="pose-scope"><option value="all">Whole character</option><option value="part">Selected part and attached parts</option></select>
<button type="button" data-action="save-pose">Save pose</button>
</div>
<h3>Actions</h3>
<ul class="saved action-list"></ul>
<div class="form">
<label for="action-name">Action name</label><input id="action-name" type="text" maxlength="40" autocomplete="off" spellcheck="false">
<div class="pair"><label>From frame <input id="action-from" type="number" min="0" step="1" value="0"></label><label>To frame <input id="action-to" type="number" min="1" step="1" value="47"></label></div>
<label for="action-scope">Save</label><select id="action-scope"><option value="all">Whole character</option><option value="part">Selected part and attached parts</option></select>
<button type="button" data-action="save-action">Save action</button>
<label for="action-repeat">Insert it this many times</label><input id="action-repeat" type="number" min="1" max="50" step="1" value="1">
</div>
</details>
<details class="library export-box"><summary>Export: video or frames</summary>
<app-cherub-export></app-cherub-export>
</details>
</div>
</div>
<section class="timeline" aria-label="Timeline">
<div class="transport">
<button type="button" data-action="first" aria-label="First frame">⏮</button>
<button type="button" data-action="prev" aria-label="Previous frame" aria-keyshortcuts=",">◀</button>
<button type="button" data-action="play" aria-keyshortcuts="Space">Play</button>
<button type="button" data-action="next" aria-label="Next frame" aria-keyshortcuts=".">▶</button>
<button type="button" data-action="last" aria-label="Last frame">⏭</button>
<span class="frame-text" aria-live="off"></span>
<span class="gap"></span>
<label>Frames per second <input type="number" name="fps" min="1" max="60" step="1"></label>
<label>Length (frames) <input type="number" name="length" min="1" max="36000" step="1"></label>
<label class="check"><input type="checkbox" name="twos"> Animate on twos</label>
</div>
<div class="scrub"><span class="track-name"></span><input type="range" name="frame" min="0" max="47" step="1" value="0" aria-label="Frame"></div>
<div class="lanes"></div>
</section>
</div>
<p class="status" role="status" aria-live="polite"></p>
<style type="text/css">
:host {
display:block;
--anim-border:color-mix(in srgb, currentColor 25%, transparent);
--name-width:9rem;
}
[hidden] {
display:none !important;
}
h2 {
font-size:1rem;
margin:0 0 0.5rem;
}
h3 {
font-size:1rem;
margin:0;
}
button, input, select {
font:inherit;
}
button {
padding:0.35rem 0.75rem;
border:1px solid var(--anim-border);
border-radius:0.35rem;
background:var(--color-background, #333);
color:var(--color-background-offset, #fff);
cursor:pointer;
}
button.primary, button[aria-pressed="true"] {
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
input[type="number"], input[type="text"], select {
width:100%;
box-sizing:border-box;
padding:0.3rem 0.4rem;
border:1px solid var(--anim-border);
border-radius:0.3rem;
background:var(--color-background, #333);
color:var(--color-background-offset, #fff);
}
.toolbar, .transport {
display:flex;
flex-wrap:wrap;
gap:0.4rem;
align-items:center;
}
.toolbar {
margin-bottom:0.75rem;
}
.gap {
flex:0 0 0.5rem;
}
.main {
display:grid;
grid-template-columns:minmax(9rem, 1fr) minmax(16rem, 3fr) minmax(13rem, 1fr);
gap:0.75rem;
align-items:start;
}
@media (max-width: 900px) {
.main {
grid-template-columns:1fr;
}
}
section {
border:1px solid var(--anim-border);
border-radius:0.5rem;
padding:0.5rem;
min-width:0;
}
.parts {
list-style:none;
margin:0;
padding:0;
max-height:50vh;
overflow:auto;
}
.parts button {
width:100%;
text-align:start;
border:none;
background:transparent;
color:inherit;
}
.parts button[aria-pressed="true"] {
background:var(--color-primary, #0980a4);
color:var(--color-primary-offset, #fff);
}
.stage-wrap {
position:relative;
outline:none;
background:repeating-conic-gradient(#ffffff 0 25%, #e8e8e8 0 50%) 0 0 / 20px 20px;
border-radius:0.35rem;
touch-action:none;
}
.overlay {
position:absolute;
inset:0;
width:100%;
height:100%;
pointer-events:none;
overflow:visible;
}
.overlay .pivot {
fill:#ffcc00;
stroke:#111111;
stroke-width:2;
vector-effect:non-scaling-stroke;
}
.overlay .ring {
fill:none;
stroke:#7d0b77;
stroke-width:2;
stroke-dasharray:6 4;
vector-effect:non-scaling-stroke;
}
.panel {
display:grid;
gap:0.5rem;
}
.panel p {
margin:0;
}
.fields {
display:grid;
grid-template-columns:1fr 1fr;
gap:0.4rem;
}
.field label {
display:block;
font-size:0.9em;
}
.field.keyed label {
font-weight:bold;
}
.row {
display:flex;
flex-wrap:wrap;
gap:0.5rem;
}
.note {
font-size:0.9em;
opacity:0.85;
}
.note.fixed {
line-height:1.35;
min-height:calc(2 * 1.35em);
}
.main > *, .side > *, .fields > *, .form > * {
min-width:0;
}
.side {
display:grid;
gap:0.75rem;
min-width:0;
}
.library {
border:1px solid var(--anim-border);
border-radius:0.5rem;
padding:0.5rem;
}
.library summary {
cursor:pointer;
font-weight:bold;
}
.library[open] summary {
margin-bottom:0.5rem;
}
.library summary:focus-visible {
outline:3px solid var(--color-active, #0b78ce);
outline-offset:2px;
}
.field.wide {
grid-column:1 / -1;
}
.saved {
list-style:none;
margin:0 0 0.5rem;
padding:0;
display:grid;
gap:0.3rem;
}
.saved li {
display:flex;
flex-wrap:wrap;
gap:0.35rem;
align-items:center;
}
.saved-name {
flex:1;
min-width:0;
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
}
.saved button {
padding:0.2rem 0.5rem;
}
.form {
display:grid;
gap:0.35rem;
margin-bottom:0.75rem;
}
.pair {
display:grid;
grid-template-columns:1fr 1fr;
gap:0.4rem;
}
.pair label {
display:grid;
gap:0.2rem;
font-size:0.9em;
}
h3 + .saved, h3 {
margin-top:0.25rem;
}
.timeline {
margin-top:0.75rem;
display:grid;
gap:0.4rem;
}
.transport label {
display:flex;
align-items:center;
gap:0.35rem;
}
.transport input[type="number"] {
width:5rem;
}
.check input {
width:auto;
}
.frame-text {
min-width:12rem;
font-variant-numeric:tabular-nums;
}
.scrub, .track {
display:grid;
grid-template-columns:var(--name-width) 1fr;
gap:0.5rem;
align-items:center;
}
.scrub input {
width:100%;
margin:0;
}
.lanes {
position:relative;
display:grid;
gap:2px;
max-height:30vh;
overflow:auto;
}
.track-name {
overflow:hidden;
text-overflow:ellipsis;
white-space:nowrap;
font-size:0.9em;
}
.track.selected .track-name {
font-weight:bold;
}
.lane {
position:relative;
height:1.5rem;
margin-inline:0.5rem;
background:color-mix(in srgb, currentColor 8%, transparent);
border-radius:0.25rem;
}
.track.selected .lane {
background:color-mix(in srgb, var(--color-primary, #0980a4) 30%, transparent);
}
.key {
position:absolute;
top:50%;
width:0.9rem;
height:0.9rem;
padding:0;
transform:translate(-50%, -50%) rotate(45deg);
border-radius:0.1rem;
background:var(--color-background-offset, #fff);
border:2px solid var(--color-background, #333);
}
.key.current {
background:#ffcc00;
}
.playhead-track {
position:absolute;
inset:0 0 0 calc(var(--name-width) + 1rem);
margin-inline-end:0.5rem;
pointer-events:none;
}
.playhead {
position:absolute;
top:0;
bottom:0;
width:2px;
background:#ffcc00;
}
.status {
min-height:1.5em;
margin:0.5rem 0 0;
}
</style>
`
    });
}
