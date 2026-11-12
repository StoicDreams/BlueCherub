import wasmInit, * as procs from '/webapp.js';
const AsyncFunction = (async () => { }).constructor;

// Messages can arrive before the WebAssembly module finishes loading, so each one waits for it.
const ready = wasmInit();

// Listen for messages from the main thread
self.onmessage = async (msg) => {
    if (!msg.isTrusted) return;
    const { id, run, data } = msg.data;
    let result;
    try {
        await ready;
        result = await processMessage(run, data);
    } catch (ex) {
        console.error('worker failed', ex);
        result = { ok: false, msg: String(ex) };
    }
    postMessage({ id: id, message: result });
};

async function processMessage(run, data) {
    if (!run) return { ok: false, msg: 'Missing run' };
    let proc = procs[run];
    if (typeof proc !== 'function') return { ok: false, msg: `Unknown worker process ${run}` };
    try {
        if (proc.constructor == AsyncFunction) {
            return { ok: true, msg: await proc(...data) };
        }
        return { ok: true, msg: proc(...data) };
    } catch (ex) {
        // Rust functions that return an error throw it here, as a message for the caller.
        return { ok: false, msg: String(ex) };
    }
}

// Optional: Handle errors originating from the worker itself
self.onerror = (error) => {
    console.error("Unhandled error in worker:", error);
};
