// Runs the Rust (WebAssembly) processes from webapp/src in a web worker, as webui.worker.
// Call any exported Rust function by name: `await webui.worker.evaluate_scene(json)`.
// Components that load before this script can wait for the `app-worker-ready` event on document.
(() => {
    if (!window.Worker) {
        console.log("Web Workers are not supported.");
        return;
    }
    const myWorker = new Worker(new URL('/worker.js', import.meta.url), { type: 'module' });
    const pending = new Map();
    myWorker.onmessage = (msg) => {
        if (!msg.isTrusted) return;
        const { id, message } = msg.data;
        const call = pending.get(id);
        if (!call) return;
        pending.delete(id);
        if (message && message.ok) {
            call.resolve(message.msg);
        } else {
            call.reject(message ? message.msg : 'The worker returned no result');
        }
    };
    myWorker.onerror = (error) => {
        console.error('Main thread: Worker error:', error);
    };
    webui.worker = new Proxy({}, {
        get(_, name) {
            // Without this, `await webui.worker` would treat the proxy as a promise and call a worker process named "then".
            if (typeof name !== 'string' || name === 'then') return undefined;
            const run = webui.toSnake(name).replace(/-/g, '_');
            return function (...args) {
                return new Promise((resolve, reject) => {
                    const id = webui.uuid();
                    pending.set(id, { resolve, reject });
                    myWorker.postMessage({ id: id, run: run, data: args });
                });
            };
        }
    });
    document.dispatchEvent(new Event('app-worker-ready'));
})();
