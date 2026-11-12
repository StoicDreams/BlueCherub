use crate::prelude::*;

mod prelude;
mod scene;

/* Define web-worker processes here */

/// Evaluate a Blue Cherub scene into a frame table of part transforms.
/// The request is JSON with `rig`, `scene`, and `domParents`. See `scene.rs`.
/// example
/// ```javascript,ignore
/// let table = JSON.parse(await webui.worker.evaluate_scene(JSON.stringify(request)));
/// ```
#[wasm_bindgen]
pub fn evaluate_scene(request: String) -> Result<String, String> {
    scene::evaluate_json(&request)
}

/// Every part's values (`x`, `y`, `rotate`, `scaleX`, `scaleY`, `opacity`) and root-space transforms at a frame.
/// Takes the same JSON request as `evaluate_scene`.
/// example
/// ```javascript,ignore
/// let poses = JSON.parse(await webui.worker.pose_at(JSON.stringify(request), 12));
/// ```
#[wasm_bindgen]
pub fn pose_at(request: String, frame: u32) -> Result<String, String> {
    scene::pose_at_json(&request, frame)
}

/// Get UUID generated from JavaScript.
/// example
/// ```javascript,ignore
/// let data = await webui.worker.new_uuid();
/// ```
#[wasm_bindgen]
pub fn new_uuid() -> String {
    get_uuid()
}

/// Get worker data
/// example
/// ```javascript,ignore
/// let data = await webui.worker.get_worker_data('key');
/// ```
#[wasm_bindgen]
pub fn get_worker_data(key: String) -> String {
    get_global_data(key)
}

/// Set worker data
/// example
/// ```javascript,ignore
/// await webui.worker.set_worker_data('key', 'value');
/// ```
#[wasm_bindgen]
pub fn set_worker_data(key: String, value: String) {
    set_global_data(key, value);
}
