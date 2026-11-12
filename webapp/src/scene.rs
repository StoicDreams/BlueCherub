//! Scene evaluation for the Blue Cherub animation tool.
//!
//! A rig names the parts of an SVG and gives each one a pivot and an optional parent.
//! A scene keyframes each part's position, rotation, scale, and opacity.
//! Evaluating a scene works out every part's transform for every frame, once,
//! so the player only has to look values up while it plays.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Highest rig and scene format this code reads.
pub const FORMAT_VERSION: u32 = 1;
const MAX_FPS: u32 = 60;
/// Ten minutes at the highest frame rate.
const MAX_FRAMES: u32 = MAX_FPS * 60 * 10;
const MAX_PARTS: usize = 500;
const MAX_KEYS: usize = 20_000;
/// Numbers in one evaluated frame table, so a scene can't use up the browser's memory.
const MAX_OUTPUT_VALUES: usize = 8_000_000;
/// Values written for each part in each frame: the six numbers of an SVG matrix, then opacity.
pub const VALUES_PER_PART: usize = 7;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rig {
    pub format_version: u32,
    pub parts: HashMap<String, RigPart>,
}

#[derive(Deserialize, Default)]
pub struct RigPart {
    #[serde(default)]
    pub pivot: [f64; 2],
    #[serde(default)]
    pub parent: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub format_version: u32,
    pub fps: u32,
    pub frame_count: u32,
    /// Hold each pose for this many frames. 2 animates "on twos".
    #[serde(default = "one")]
    pub hold_frames: u32,
    #[serde(default)]
    pub tracks: Vec<Track>,
}

fn one() -> u32 {
    1
}

#[derive(Deserialize)]
pub struct Track {
    pub part: String,
    pub property: Property,
    pub keys: Vec<Key>,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Property {
    X,
    Y,
    Rotate,
    ScaleX,
    ScaleY,
    Opacity,
}

#[derive(Deserialize, Clone)]
pub struct Key {
    pub frame: u32,
    pub value: f64,
    /// How the value moves from this key to the next one.
    #[serde(default)]
    pub ease: Ease,
}

#[derive(Deserialize, Clone, Copy, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Ease {
    Linear,
    In,
    Out,
    #[default]
    InOut,
    /// Hold this key's value until the next key.
    Step,
}

impl Ease {
    fn apply(self, t: f64) -> f64 {
        match self {
            Ease::Linear => t,
            Ease::In => t * t,
            Ease::Out => t * (2.0 - t),
            Ease::InOut => t * t * (3.0 - 2.0 * t),
            Ease::Step => 0.0,
        }
    }
}

/// The request the player sends: the rig, the scene, and which part element sits inside which in the SVG.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateRequest {
    pub rig: Rig,
    pub scene: Scene,
    /// For each part, the nearest part element that contains it in the SVG, if any.
    /// That element's transform already applies to it, so it's taken back out.
    #[serde(default)]
    pub dom_parents: HashMap<String, String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FrameTable {
    pub fps: u32,
    pub frame_count: u32,
    /// Part ids, in the order their values appear in each frame.
    pub parts: Vec<String>,
    /// `frame_count * parts.len() * 7` values: for each frame, for each part, `a b c d e f opacity`.
    pub values: Vec<f64>,
}

/// A 2D affine matrix in SVG order: `matrix(a b c d e f)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Matrix {
    pub const IDENTITY: Matrix = Matrix { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };

    fn translate(x: f64, y: f64) -> Matrix {
        Matrix { e: x, f: y, ..Matrix::IDENTITY }
    }

    fn rotate(degrees: f64) -> Matrix {
        let (sin, cos) = degrees.to_radians().sin_cos();
        Matrix { a: cos, b: sin, c: -sin, d: cos, e: 0.0, f: 0.0 }
    }

    fn scale(x: f64, y: f64) -> Matrix {
        Matrix { a: x, d: y, ..Matrix::IDENTITY }
    }

    /// `self` applied after `other`, as in SVG's `transform="self other"`.
    pub fn then(self, other: Matrix) -> Matrix {
        Matrix {
            a: self.a * other.a + self.c * other.b,
            b: self.b * other.a + self.d * other.b,
            c: self.a * other.c + self.c * other.d,
            d: self.b * other.c + self.d * other.d,
            e: self.a * other.e + self.c * other.f + self.e,
            f: self.b * other.e + self.d * other.f + self.f,
        }
    }

    pub fn inverse(self) -> Option<Matrix> {
        let det = self.a * self.d - self.b * self.c;
        if det.abs() < 1e-12 {
            return None;
        }
        Some(Matrix {
            a: self.d / det,
            b: -self.b / det,
            c: -self.c / det,
            d: self.a / det,
            e: (self.c * self.f - self.d * self.e) / det,
            f: (self.b * self.e - self.a * self.f) / det,
        })
    }
}

#[derive(Clone, Copy)]
struct Pose {
    x: f64,
    y: f64,
    rotate: f64,
    scale_x: f64,
    scale_y: f64,
    opacity: f64,
}

impl Default for Pose {
    fn default() -> Self {
        Pose { x: 0.0, y: 0.0, rotate: 0.0, scale_x: 1.0, scale_y: 1.0, opacity: 1.0 }
    }
}

impl Pose {
    fn set(&mut self, property: Property, value: f64) {
        match property {
            Property::X => self.x = value,
            Property::Y => self.y = value,
            Property::Rotate => self.rotate = value,
            Property::ScaleX => self.scale_x = value,
            Property::ScaleY => self.scale_y = value,
            Property::Opacity => self.opacity = value.clamp(0.0, 1.0),
        }
    }

    /// Move, then rotate and scale around the pivot.
    fn matrix(&self, pivot: [f64; 2]) -> Matrix {
        Matrix::translate(self.x + pivot[0], self.y + pivot[1])
            .then(Matrix::rotate(self.rotate))
            .then(Matrix::scale(self.scale_x, self.scale_y))
            .then(Matrix::translate(-pivot[0], -pivot[1]))
    }
}

/// The value of a track at a frame. Keys must be sorted by frame.
fn value_at(keys: &[Key], frame: u32) -> f64 {
    let next = keys.partition_point(|key| key.frame <= frame);
    if next == 0 {
        return keys[0].value;
    }
    let from = &keys[next - 1];
    let Some(to) = keys.get(next) else {
        return from.value;
    };
    let t = (frame - from.frame) as f64 / (to.frame - from.frame) as f64;
    from.value + (to.value - from.value) * from.ease.apply(t)
}

fn check_finite(value: f64, what: &str) -> Result<(), String> {
    if value.is_finite() { Ok(()) } else { Err(format!("{what} must be a finite number")) }
}

/// Check a request before evaluating it, so bad input gives a clear message.
fn validate(request: &mut EvaluateRequest) -> Result<(), String> {
    let rig = &request.rig;
    let scene = &mut request.scene;
    if rig.format_version == 0 || rig.format_version > FORMAT_VERSION {
        return Err(format!("Unsupported rig format version {}", rig.format_version));
    }
    if scene.format_version == 0 || scene.format_version > FORMAT_VERSION {
        return Err(format!("Unsupported scene format version {}", scene.format_version));
    }
    if scene.fps == 0 || scene.fps > MAX_FPS {
        return Err(format!("fps must be between 1 and {MAX_FPS}"));
    }
    if scene.frame_count == 0 || scene.frame_count > MAX_FRAMES {
        return Err(format!("frameCount must be between 1 and {MAX_FRAMES}"));
    }
    if scene.hold_frames == 0 || scene.hold_frames > scene.frame_count {
        return Err("holdFrames must be at least 1 and no more than frameCount".into());
    }
    if rig.parts.len() > MAX_PARTS {
        return Err(format!("A rig can have at most {MAX_PARTS} parts"));
    }
    let output = scene.frame_count as usize * rig.parts.len() * VALUES_PER_PART;
    if output > MAX_OUTPUT_VALUES {
        return Err("The scene is too long for this many parts".into());
    }
    for (id, part) in &rig.parts {
        check_finite(part.pivot[0], &format!("The pivot of {id}"))?;
        check_finite(part.pivot[1], &format!("The pivot of {id}"))?;
        if let Some(parent) = &part.parent {
            if !rig.parts.contains_key(parent) {
                return Err(format!("{id} has an unknown parent {parent}"));
            }
        }
    }
    for (id, parent) in &request.dom_parents {
        if !rig.parts.contains_key(id) || !rig.parts.contains_key(parent) {
            return Err(format!("Unknown part in the SVG layout: {id}"));
        }
    }
    let mut total_keys = 0;
    let mut seen = HashSet::new();
    for track in &mut scene.tracks {
        if !rig.parts.contains_key(&track.part) {
            return Err(format!("A track uses an unknown part {}", track.part));
        }
        if !seen.insert((track.part.clone(), track.property)) {
            return Err(format!("{} has more than one {:?} track", track.part, track.property));
        }
        if track.keys.is_empty() {
            return Err(format!("A {:?} track for {} has no keys", track.property, track.part));
        }
        total_keys += track.keys.len();
        if total_keys > MAX_KEYS {
            return Err(format!("A scene can have at most {MAX_KEYS} keys"));
        }
        track.keys.sort_by_key(|key| key.frame);
        for pair in track.keys.windows(2) {
            if pair[0].frame == pair[1].frame {
                return Err(format!("{} has two keys on frame {}", track.part, pair[0].frame));
            }
        }
        for key in &track.keys {
            check_finite(key.value, &format!("A key value for {}", track.part))?;
        }
    }
    Ok(())
}

/// Order parts so every parent comes before its children, and reject loops.
fn parent_order(rig: &Rig, ids: &[String]) -> Result<Vec<usize>, String> {
    let index: HashMap<&str, usize> = ids.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    let mut order = Vec::with_capacity(ids.len());
    // 0 = not visited, 1 = in progress, 2 = done
    let mut state = vec![0u8; ids.len()];
    for start in 0..ids.len() {
        let mut stack = vec![(start, false)];
        while let Some((i, children_done)) = stack.pop() {
            if children_done {
                state[i] = 2;
                order.push(i);
                continue;
            }
            match state[i] {
                2 => continue,
                1 => return Err(format!("{} is its own ancestor", ids[i])),
                _ => {}
            }
            state[i] = 1;
            stack.push((i, true));
            if let Some(parent) = &rig.parts[&ids[i]].parent {
                let p = index[parent.as_str()];
                if state[p] == 1 {
                    return Err(format!("{} is its own ancestor", ids[i]));
                }
                if state[p] == 0 {
                    stack.push((p, false));
                }
            }
        }
    }
    Ok(order)
}

/// A checked request, with parts in a fixed order, ready to pose any frame.
struct Prepared<'a> {
    scene: &'a Scene,
    ids: Vec<String>,
    order: Vec<usize>,
    pivots: Vec<[f64; 2]>,
    parents: Vec<Option<usize>>,
    dom_parents: Vec<Option<usize>>,
    tracks: Vec<(usize, &'a Track)>,
}

impl<'a> Prepared<'a> {
    fn new(request: &'a EvaluateRequest) -> Result<Prepared<'a>, String> {
        let rig = &request.rig;
        let mut ids: Vec<String> = rig.parts.keys().cloned().collect();
        ids.sort();
        let index: HashMap<&str, usize> = ids.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
        let order = parent_order(rig, &ids)?;
        let pivots = ids.iter().map(|id| rig.parts[id].pivot).collect();
        let parents = ids.iter().map(|id| rig.parts[id].parent.as_ref().map(|p| index[p.as_str()])).collect();
        let dom_parents = ids.iter().map(|id| request.dom_parents.get(id).map(|p| index[p.as_str()])).collect();
        let tracks = request.scene.tracks.iter().map(|t| (index[t.part.as_str()], t)).collect();
        Ok(Prepared { scene: &request.scene, ids, order, pivots, parents, dom_parents, tracks })
    }

    /// Each part's pose and world transform (root coordinates) at a frame.
    fn pose(&self, frame: u32, poses: &mut [Pose], world: &mut [Matrix]) {
        let held = frame - frame % self.scene.hold_frames;
        poses.iter_mut().for_each(|pose| *pose = Pose::default());
        for (part, track) in &self.tracks {
            poses[*part].set(track.property, value_at(&track.keys, held));
        }
        for &i in &self.order {
            let local = poses[i].matrix(self.pivots[i]);
            world[i] = match self.parents[i] {
                Some(p) => world[p].then(local),
                None => local,
            };
        }
    }
}

/// Work out every part's transform and opacity for every frame.
pub fn evaluate(mut request: EvaluateRequest) -> Result<FrameTable, String> {
    validate(&mut request)?;
    let prepared = Prepared::new(&request)?;
    let scene = &request.scene;
    let count = prepared.ids.len();
    let mut values = Vec::with_capacity(scene.frame_count as usize * count * VALUES_PER_PART);
    let mut poses = vec![Pose::default(); count];
    let mut world = vec![Matrix::IDENTITY; count];
    for frame in 0..scene.frame_count {
        prepared.pose(frame, &mut poses, &mut world);
        for i in 0..count {
            // An element inside another part's element already gets that element's transform.
            let m = match prepared.dom_parents[i] {
                Some(p) => world[p].inverse().unwrap_or(Matrix::IDENTITY).then(world[i]),
                None => world[i],
            };
            values.extend_from_slice(&[m.a, m.b, m.c, m.d, m.e, m.f, poses[i].opacity]);
        }
    }
    Ok(FrameTable { fps: scene.fps, frame_count: scene.frame_count, parts: prepared.ids, values })
}

/// One part's values at a frame, for the editor.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PartPose {
    pub x: f64,
    pub y: f64,
    pub rotate: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub opacity: f64,
    /// The part's transform in root coordinates, as `a b c d e f`.
    pub world: [f64; 6],
    /// The parent's transform in root coordinates (identity with no parent), for turning drags into moves.
    pub parent_world: [f64; 6],
}

/// Every part's values and transforms at one frame. The editor shows these and uses them to turn drags into keys.
pub fn pose_at(mut request: EvaluateRequest, frame: u32) -> Result<HashMap<String, PartPose>, String> {
    validate(&mut request)?;
    if frame >= request.scene.frame_count {
        return Err(format!("Frame {frame} is past the end of the scene"));
    }
    let prepared = Prepared::new(&request)?;
    let count = prepared.ids.len();
    let mut poses = vec![Pose::default(); count];
    let mut world = vec![Matrix::IDENTITY; count];
    prepared.pose(frame, &mut poses, &mut world);
    let flat = |m: Matrix| [m.a, m.b, m.c, m.d, m.e, m.f];
    Ok(prepared
        .ids
        .iter()
        .enumerate()
        .map(|(i, id)| {
            let p = poses[i];
            let parent = prepared.parents[i].map(|j| world[j]).unwrap_or(Matrix::IDENTITY);
            (id.clone(), PartPose {
                x: p.x,
                y: p.y,
                rotate: p.rotate,
                scale_x: p.scale_x,
                scale_y: p.scale_y,
                opacity: p.opacity,
                world: flat(world[i]),
                parent_world: flat(parent),
            })
        })
        .collect())
}

/// `pose_at` with the request as JSON, returning JSON.
pub fn pose_at_json(request: &str, frame: u32) -> Result<String, String> {
    let request: EvaluateRequest = serde_json::from_str(request).map_err(|e| format!("Invalid scene data: {e}"))?;
    let poses = pose_at(request, frame)?;
    serde_json::to_string(&poses).map_err(|e| e.to_string())
}

/// Evaluate a request given as JSON, and return the frame table as JSON.
pub fn evaluate_json(request: &str) -> Result<String, String> {
    let request: EvaluateRequest = serde_json::from_str(request).map_err(|e| format!("Invalid scene data: {e}"))?;
    let table = evaluate(request)?;
    serde_json::to_string(&table).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(json: &str) -> EvaluateRequest {
        serde_json::from_str(json).unwrap()
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    fn part_values<'a>(table: &'a FrameTable, frame: usize, part: &str) -> &'a [f64] {
        let i = table.parts.iter().position(|p| p == part).unwrap();
        let start = (frame * table.parts.len() + i) * VALUES_PER_PART;
        &table.values[start..start + VALUES_PER_PART]
    }

    const RIG: &str = r#""rig":{"formatVersion":1,"parts":{"body":{"pivot":[0,0]},"arm":{"pivot":[10,0],"parent":"body"}}}"#;

    #[test]
    fn linear_track_interpolates_between_keys() {
        let r = request(&format!(
            r#"{{{RIG},"scene":{{"formatVersion":1,"fps":24,"frameCount":5,"tracks":[
                {{"part":"body","property":"x","keys":[{{"frame":0,"value":0,"ease":"linear"}},{{"frame":4,"value":8}}]}}]}}}}"#
        ));
        let table = evaluate(r).unwrap();
        assert_eq!(table.frame_count, 5);
        assert!(close(part_values(&table, 2, "body")[4], 4.0));
        assert!(close(part_values(&table, 4, "body")[4], 8.0));
    }

    #[test]
    fn values_hold_before_first_and_after_last_key() {
        let r = request(&format!(
            r#"{{{RIG},"scene":{{"formatVersion":1,"fps":24,"frameCount":10,"tracks":[
                {{"part":"body","property":"y","keys":[{{"frame":3,"value":5}},{{"frame":6,"value":9}}]}}]}}}}"#
        ));
        let table = evaluate(r).unwrap();
        assert!(close(part_values(&table, 0, "body")[5], 5.0));
        assert!(close(part_values(&table, 9, "body")[5], 9.0));
    }

    #[test]
    fn step_ease_holds_until_next_key() {
        let keys = vec![
            Key { frame: 0, value: 1.0, ease: Ease::Step },
            Key { frame: 10, value: 2.0, ease: Ease::Linear },
        ];
        assert!(close(value_at(&keys, 9), 1.0));
        assert!(close(value_at(&keys, 10), 2.0));
    }

    #[test]
    fn hold_frames_animates_on_twos() {
        let r = request(&format!(
            r#"{{{RIG},"scene":{{"formatVersion":1,"fps":24,"frameCount":4,"holdFrames":2,"tracks":[
                {{"part":"body","property":"x","keys":[{{"frame":0,"value":0,"ease":"linear"}},{{"frame":3,"value":3}}]}}]}}}}"#
        ));
        let table = evaluate(r).unwrap();
        assert!(close(part_values(&table, 1, "body")[4], 0.0));
        assert!(close(part_values(&table, 3, "body")[4], 2.0));
    }

    #[test]
    fn rotation_turns_around_the_pivot() {
        let pose = Pose { rotate: 90.0, ..Pose::default() };
        let m = pose.matrix([10.0, 0.0]);
        // The pivot itself stays put.
        assert!(close(m.a * 10.0 + m.c * 0.0 + m.e, 10.0));
        assert!(close(m.b * 10.0 + m.d * 0.0 + m.f, 0.0));
        // A point 10 to the right of the pivot swings below it.
        assert!(close(m.a * 20.0 + m.e, 10.0));
        assert!(close(m.b * 20.0 + m.f, 10.0));
    }

    #[test]
    fn children_follow_their_parent() {
        let r = request(&format!(
            r#"{{{RIG},"scene":{{"formatVersion":1,"fps":24,"frameCount":1,"tracks":[
                {{"part":"body","property":"x","keys":[{{"frame":0,"value":7}}]}}]}}}}"#
        ));
        let table = evaluate(r).unwrap();
        assert!(close(part_values(&table, 0, "arm")[4], 7.0));
    }

    #[test]
    fn nested_svg_elements_do_not_apply_the_parent_twice() {
        let r = request(&format!(
            r#"{{{RIG},"domParents":{{"arm":"body"}},"scene":{{"formatVersion":1,"fps":24,"frameCount":1,"tracks":[
                {{"part":"body","property":"x","keys":[{{"frame":0,"value":7}}]}}]}}}}"#
        ));
        let table = evaluate(r).unwrap();
        assert_eq!(&part_values(&table, 0, "arm")[..6], &[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
    }

    #[test]
    fn opacity_is_clamped() {
        let r = request(&format!(
            r#"{{{RIG},"scene":{{"formatVersion":1,"fps":24,"frameCount":1,"tracks":[
                {{"part":"body","property":"opacity","keys":[{{"frame":0,"value":3}}]}}]}}}}"#
        ));
        assert!(close(part_values(&evaluate(r).unwrap(), 0, "body")[6], 1.0));
    }

    #[test]
    fn parent_loops_are_rejected() {
        let r = request(
            r#"{"rig":{"formatVersion":1,"parts":{"a":{"parent":"b"},"b":{"parent":"a"}}},"scene":{"formatVersion":1,"fps":24,"frameCount":1}}"#,
        );
        assert!(evaluate(r).unwrap_err().contains("own ancestor"));
    }

    #[test]
    fn unknown_parts_and_bad_settings_are_rejected() {
        let unknown = request(&format!(
            r#"{{{RIG},"scene":{{"formatVersion":1,"fps":24,"frameCount":1,"tracks":[
                {{"part":"wing","property":"x","keys":[{{"frame":0,"value":1}}]}}]}}}}"#
        ));
        assert!(evaluate(unknown).unwrap_err().contains("unknown part"));
        let fps = request(&format!(r#"{{{RIG},"scene":{{"formatVersion":1,"fps":0,"frameCount":1}}}}"#));
        assert!(evaluate(fps).is_err());
        let version = request(&format!(r#"{{{RIG},"scene":{{"formatVersion":2,"fps":24,"frameCount":1}}}}"#));
        assert!(evaluate(version).unwrap_err().contains("format version"));
    }

    #[test]
    fn duplicate_tracks_and_keys_are_rejected() {
        let tracks = request(&format!(
            r#"{{{RIG},"scene":{{"formatVersion":1,"fps":24,"frameCount":1,"tracks":[
                {{"part":"body","property":"x","keys":[{{"frame":0,"value":1}}]}},
                {{"part":"body","property":"x","keys":[{{"frame":0,"value":2}}]}}]}}}}"#
        ));
        assert!(evaluate(tracks).is_err());
        let keys = request(&format!(
            r#"{{{RIG},"scene":{{"formatVersion":1,"fps":24,"frameCount":1,"tracks":[
                {{"part":"body","property":"x","keys":[{{"frame":0,"value":1}},{{"frame":0,"value":2}}]}}]}}}}"#
        ));
        assert!(evaluate(keys).is_err());
    }

    #[test]
    fn invalid_json_gives_a_message() {
        assert!(evaluate_json("{").unwrap_err().starts_with("Invalid scene data"));
    }

    #[test]
    fn pose_at_reports_values_and_world_transforms() {
        let r = request(&format!(
            r#"{{{RIG},"scene":{{"formatVersion":1,"fps":24,"frameCount":5,"tracks":[
                {{"part":"body","property":"x","keys":[{{"frame":0,"value":0,"ease":"linear"}},{{"frame":4,"value":8}}]}},
                {{"part":"arm","property":"rotate","keys":[{{"frame":0,"value":30}}]}}]}}}}"#
        ));
        let poses = pose_at(r, 2).unwrap();
        assert!(close(poses["body"].x, 4.0));
        assert!(close(poses["arm"].rotate, 30.0));
        assert!(close(poses["arm"].scale_x, 1.0));
        // The arm's parent is the body, moved 4 to the right.
        assert!(close(poses["arm"].parent_world[4], 4.0));
        assert!(close(poses["body"].parent_world[4], 0.0));
    }

    #[test]
    fn pose_at_refuses_frames_past_the_end() {
        let r = request(&format!(r#"{{{RIG},"scene":{{"formatVersion":1,"fps":24,"frameCount":2}}}}"#));
        assert!(pose_at(r, 2).unwrap_err().contains("past the end"));
    }

    #[test]
    fn matrix_inverse_undoes_the_matrix() {
        let m = Pose { x: 3.0, rotate: 30.0, scale_x: 2.0, ..Pose::default() }.matrix([4.0, 5.0]);
        let i = m.inverse().unwrap().then(m);
        for (a, b) in [(i.a, 1.0), (i.b, 0.0), (i.c, 0.0), (i.d, 1.0), (i.e, 0.0), (i.f, 0.0)] {
            assert!(close(a, b));
        }
    }
}
