## Getting started

The studio has two tabs. **Rig** turns a drawing into a character with moving parts. **Animate** poses those parts on a timeline. Sign in to open the studio at [/studio](/studio). Everything in it is free.

Not ready to bring your own drawing? Press **Blue Cherub sample** on either tab. He's used to it.

Nothing is saved in your browser yet. Download your rig and scene before you leave the page.

## Rig a drawing

<app-feature src="/img/screenshots/studio/rig-layers.png" alt="The Rig tab, with the Blue Cherub drawing and its layers listed beside it">
<h3>Import and pick shapes</h3>
<p>Press <strong>Import SVG</strong> and choose a drawing (up to 5 MB). Anything that could run code is removed. Every shape gets a name, from your drawing tool's labels where it has them.</p>
<p>Click a shape on the drawing or in <strong>Layers</strong>. Hold Shift or Ctrl to pick more than one. <strong>Select group</strong> moves up to the group that holds what you picked.</p>
</app-feature>

- **Group** (Ctrl+G) puts the picked shapes in a new group, and **Ungroup** (Ctrl+Shift+G) takes a group apart. Nothing moves either way. A group with a clip, mask, or filter can't be ungrouped, because that would change how it looks.
- **Clean up groups** removes empty groups and groups that only wrap one thing.
- Type a new **Name** and press Enter to rename a shape. Names start with a letter and use letters, numbers, - and _.

<app-feature src="/img/screenshots/studio/rig-pivots.png" video="/img/screenshots/studio/rig-pivots.mp4" alt="A selected arm with its pivot dot at the shoulder, and lines joining each part to the part it hangs from" reverse>
<h3>Parts, pivots, and attachments</h3>
<p>Select a shape or group and press <strong>Make this a part</strong>. Only parts can be animated.</p>
<p>The yellow dot is the part's <strong>pivot</strong>, the point it turns around. Drag it to the joint, type X and Y, or press <strong>Suggest pivot</strong>. Choose what the part is <strong>Attached to</strong>, so it moves with that part. The purple lines show the attachments.</p>
<p>Press <strong>Test</strong> to swing the part and check its pivot and attachments.</p>
</app-feature>

<app-feature src="/img/screenshots/studio/rig-swaps.png" video="/img/screenshots/studio/rig-swaps.mp4" alt="The eyes part with two swap drawings listed: eyes open and eyes closed">
<h3>Swap drawings</h3>
<p>For things that change instead of bend, like eyes open and closed, put each version in its own group inside one part. Select the part and press <strong>Use its groups as swaps</strong>.</p>
<p>The drawing marked <strong>At rest</strong> shows by default. Click a drawing's name to see it on the stage, use <strong>Use at rest</strong> to change the default, and <strong>Remove</strong> or <strong>Stop swapping</strong> to undo it.</p>
</app-feature>

When the rig is ready, press **Download rig**. You get two files, `name.svg` and `name.rig.json`. Keep them together. **Open rig** loads both again.

## Animate

<app-feature src="/img/screenshots/studio/animate-timeline.png" video="/img/screenshots/studio/animate-timeline.mp4" alt="The Animate tab, with a timeline of keys for each part below the drawing" reverse>
<h3>The timeline</h3>
<p>Open the <strong>Animate</strong> tab. It uses the rig from the Rig tab. Each part has a lane, and each diamond is a <strong>key</strong>: a value the part has at that frame. Between keys, the studio fills in the motion.</p>
<p>Drag the frame slider, use the arrow buttons, or click a key to jump to it. Set <strong>Frames per second</strong> and <strong>Length</strong>. <strong>Animate on twos</strong> holds each pose for two frames, for a hand-drawn look.</p>
</app-feature>

<app-feature src="/img/screenshots/studio/animate-pose.png" video="/img/screenshots/studio/animate-pose.mp4" alt="The rotate tool aiming Blue Cherub's bow arm, with a ring around its pivot">
<h3>Pose a part</h3>
<p>Click a part on the drawing or in <strong>Parts</strong>. Drag it to move it, or press <strong>Rotate</strong> and drag around its pivot. You can also type X, Y, Rotate, Scale, and Opacity. A part with swap drawings has a <strong>Drawing</strong> list too.</p>
<p>Every change becomes a key at the current frame, marked ◆. <strong>Key pose</strong> keys everything about the part here, and <strong>Delete keys</strong> removes its keys at this frame.</p>
</app-feature>

- **From these keys to the next** sets how the part moves toward its next key: smooth, steady, speeding up, slowing down, or hold then jump. Swap drawings always hold, then jump.
- On twos, an odd frame shows the frame before it, so a key on an odd frame appears one frame later.
- Press **Play** to watch. The values in the panel update when it stops.

<app-feature src="/img/screenshots/studio/animate-library.png" video="/img/screenshots/studio/animate-library.mp4" alt="The library with a saved pose called Aim and a saved action called Flap" reverse>
<h3>Reuse poses and actions</h3>
<p>Open <strong>Library</strong>. Name a pose and press <strong>Save pose</strong> to keep the pose at this frame, for the whole character or just the selected part and what's attached to it. <strong>Apply</strong> keys it at any frame.</p>
<p>An <strong>action</strong> is motion between two frames, like a wing flap. Set <strong>From frame</strong> and <strong>To frame</strong>, save it, then <strong>Insert</strong> it at the current frame as many times as you like. The scene gets longer if it needs to.</p>
</app-feature>

Press **Download scene** to save `name.scene.json`, which includes your library. **Open scene** loads it again on the same rig.

## Export

<app-feature src="/img/screenshots/studio/animate-export.png" alt="The export panel with MP4 video chosen at 720p, showing the size and length">
<h3>Video or frames</h3>
<p>Open <strong>Export: video or frames</strong> on the Animate tab. Choose <strong>MP4 video</strong> for YouTube, TikTok, and Instagram, or <strong>PNG frames</strong> for a zip with one image per frame. Pick a <strong>Size</strong> (360p to 4K), and a <strong>Background</strong> color. PNG frames can have a transparent background instead.</p>
<p>Press <strong>Export</strong>. Each frame is drawn in your browser, so nothing is uploaded. <strong>Cancel</strong> stops it.</p>
</app-feature>

- The video is the shape of your drawing. Wide (16:9) and tall (9:16) framing for each platform is on the way.
- MP4 export needs a browser that can make H.264 video, such as current Chrome, Edge, or Safari. PNG frames work everywhere.
- Videos have no sound yet.

## Keyboard shortcuts

| Keys | Where | Does |
|---|---|---|
| Ctrl+Z | Both tabs | Undo |
| Ctrl+Shift+Z or Ctrl+Y | Both tabs | Redo |
| Ctrl+G | Rig | Group the selection |
| Ctrl+Shift+G | Rig | Ungroup |
| Escape | Rig | Clear the selection |
| , and . | Animate | Previous and next frame |
| Space | Animate | Play or pause |
| K | Animate | Key the selected part's pose |
| Delete | Animate | Delete the selected part's keys at this frame |

Click the drawing first, so the shortcuts reach the studio.

## Files

| File | What it holds |
|---|---|
| `name.svg` | Your drawing, with the groups and names you gave it. Your original file is never changed. |
| `name.rig.json` | Parts, pivots, attachments, and swap drawings. |
| `name.scene.json` | Frame rate, length, every key, and your library of poses and actions. |
| `name.mp4`, `name-frames.zip` | Exports: the video, or one PNG per frame. |

## Good to know

- The Blue Cherub character is free for personal, non-monetized projects. Your own drawings and animations are yours.
- Keys past the last frame still shape the motion, but the timeline doesn't show them.
- Sound, saving in your browser, and cloud saving are on the way.
