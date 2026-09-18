// The original build stays in this browser; no server-side WASM mirror.
const PrivateWasm = (() => {
    const cacheName = "diepcustom-wasm-v1";
    const pending = new Map();

    function validate(buffer) {
        const header = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8));
        const expected = [0, 97, 115, 109, 1, 0, 0, 0];
        if (header.length !== 8 || expected.some((value, i) => header[i] !== value)) {
            throw new Error("Invalid WASM response");
        }
        return buffer;
    }

    function fetchOpaque(url) {
        return new Promise((resolve, reject) => {
            const frame = document.createElement("iframe");
            frame.hidden = true;
            frame.setAttribute("sandbox", "allow-scripts");
            frame.referrerPolicy = "no-referrer";
            const token = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
            const finish = (error, buffer) => {
                clearTimeout(timer);
                window.removeEventListener("message", onMessage);
                frame.remove();
                if (error) reject(error);
                else resolve(buffer);
            };
            const onMessage = event => {
                if (event.source !== frame.contentWindow || event.origin !== "null" ||
                    !event.data || event.data.token !== token) return;
                if (event.data.ok && event.data.buffer instanceof ArrayBuffer) {
                    finish(null, event.data.buffer);
                } else {
                    finish(new Error(event.data.error || "Private WASM fetch failed"));
                }
            };
            const timer = setTimeout(() => finish(new Error("Private WASM fetch timed out")), 60000);
            window.addEventListener("message", onMessage);
            // Escape '<' so configuration cannot terminate the inline script.
            const literal = value => JSON.stringify(value).replace(/</g, "\\u003c");
            frame.srcdoc = `<meta name="referrer" content="no-referrer"><script>
                fetch(${literal(url)}, {
                    mode: "cors",
                    credentials: "omit",
                    referrerPolicy: "no-referrer",
                    redirect: "error",
                    cache: "force-cache"
                }).then(response => {
                    if (!response.ok) throw new Error("WASM HTTP " + response.status);
                    return response.arrayBuffer();
                }).then(buffer => {
                    parent.postMessage({ token: ${literal(token)}, ok: true, buffer }, "*", [buffer]);
                }).catch(error => {
                    parent.postMessage({ token: ${literal(token)}, ok: false, error: String(error) }, "*");
                });
            <\/script>`;
            try {
                document.body.appendChild(frame);
            } catch (error) {
                finish(error);
            }
        });
    }

    async function load(url) {
        let cache;
        try {
            cache = await caches.open(cacheName);
            const hit = await cache.match(url);
            if (hit) {
                try {
                    return validate(await hit.arrayBuffer());
                } catch (_) {
                    await cache.delete(url);
                }
            }
        } catch (error) {
            console.warn("WASM cache unavailable; using private fetch", error);
        }
        // Never fall back to a parent-window fetch: that would disclose its origin.
        const buffer = validate(await fetchOpaque(url));
        if (cache) {
            try {
                await cache.put(url, new Response(buffer, {
                    headers: { "Content-Type": "application/wasm" }
                }));
            } catch (error) {
                console.warn("WASM could not be cached; future visits may download it again", error);
            }
        }
        return buffer;
    }

    return {
        fetch(url) {
            if (!pending.has(url)) {
                // Serialize same-build loads across tabs when Web Locks is available.
                const task = navigator.locks
                    ? navigator.locks.request(cacheName + ":" + url, () => load(url))
                    : load(url);
                pending.set(url, task);
                task.catch(() => pending.delete(url));
            }
            // Wail may mutate its input; retain an untouched in-memory copy.
            return pending.get(url).then(buffer => buffer.slice(0));
        }
    };
})();
