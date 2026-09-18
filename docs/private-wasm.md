# Experimental private WASM loading

The loader obtains the configured build through a hidden `sandbox="allow-scripts"` srcdoc frame. The frame has an opaque origin (serialized as `null`), omits credentials and referrers, and rejects redirects. There is no ordinary parent-window fetch fallback. The upstream must permit credentialless CORS from `null` (for example with Access-Control-Allow-Origin: *).

Original bytes are stored in the parent site's Cache Storage, keyed by the full build URL, before Wail modifies its own copy. Cache hits never revalidate or contact the upstream. Web Locks serialize cross-tab downloads where supported. Storage requires HTTPS or localhost and can be unavailable, cleared, or evicted. In those cases the same private download is used again. Clearing the `diepcustom-wasm-v1` cache in browser developer tools forces a new download.

This reduces WASM requests; it does not conceal IP addresses on cache misses, change other asset requests, or isolate the executing WASM's existing imports. No server-side WASM copy is created. Header validation rejects obvious non-WASM responses but is not cryptographic integrity verification.

Run `node tests/wasm-fetch.cjs` for isolated regression tests. Before deployment, verify in a real browser: clear the cache, load the game, confirm the WASM GET has Origin: null and no Referer/Cookie, then reload and confirm no WASM network request. Also verify successful game startup and failure with upstream CORS blocked. Live upstream/browser verification has not been performed in the development environment.
