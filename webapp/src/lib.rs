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
