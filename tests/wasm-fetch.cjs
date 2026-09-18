const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('client/wasm-fetch.js', 'utf8');
const bytes = () => Uint8Array.from([0,97,115,109,1,0,0,0]).buffer;
const entries = new Map();
let downloads = 0;
let fail = false;
let unavailable = false;
function page() {
    let listener;
    const context = {
        ArrayBuffer, Uint8Array, Uint32Array, Response, crypto, setTimeout, clearTimeout,
        console: { warn() {} }, navigator: {},
        caches: { async open() {
            if (unavailable) throw new Error('storage blocked');
            return {
                async match(url) { return entries.get(url)?.clone(); },
                async put(url, res) { entries.set(url, res); },
                async delete(url) { entries.delete(url); }
            };
        } },
        window: {
            addEventListener(type, fn) { listener = fn; },
            removeEventListener(type, fn) { assert.equal(listener, fn); listener = null; }
        },
        document: {
            createElement() { return { contentWindow: {}, setAttribute(k,v) {
                assert.equal(k, 'sandbox'); assert.equal(v, 'allow-scripts');
            }, remove() {} }; },
            body: { appendChild(frame) {
                assert.equal(frame.referrerPolicy, 'no-referrer');
                const script = frame.srcdoc.match(/<script>([\s\S]*)<\/script>/)[1];
                new vm.Script(script);
                vm.runInNewContext(script, {
                    fetch: async (url, options) => {
                        downloads++;
                        assert.equal(options.credentials, 'omit');
                        assert.equal(options.referrerPolicy, 'no-referrer');
                        assert.equal(options.mode, 'cors');
                        assert.equal(options.redirect, 'error');
                        if (fail) throw new Error('CORS rejected');
                        return { ok: true, arrayBuffer: async () => bytes() };
                    },
                    parent: { postMessage(data) {
                        // Unrelated window messages must be ignored.
                        listener({ source: {}, origin: 'null', data });
                        assert.ok(listener);
                        listener({ source: frame.contentWindow, origin: 'null', data });
                    } }
                });
            } }
        }
    };
    return vm.runInNewContext(source + '\nPrivateWasm', context);
}
(async () => {
    const url = 'https://static.example/build_fixed.wasm';
    const first = page();
    const [a, b] = await Promise.all([first.fetch(url), first.fetch(url)]);
    assert.equal(downloads, 1);
    assert.notEqual(a, b);
    new Uint8Array(a)[0] = 255;
    assert.equal(new Uint8Array(b)[0], 0);
    await page().fetch(url);
    assert.equal(downloads, 1, 'new page must read persistent cache without a request');
    await page().fetch(url + '2');
    assert.equal(downloads, 2, 'changed build must use a distinct key');
    unavailable = true;
    await page().fetch(url);
    assert.equal(downloads, 3, 'blocked storage must use the opaque fetch');
    fail = true;
    await assert.rejects(page().fetch(url), /CORS rejected/);
    assert.equal(downloads, 4, 'failure must not retry through the parent');
    console.log('PASS: cache reuse, build keys, concurrency, byte isolation, private options, message source validation, storage failure, fail closed');
})().catch(error => { console.error(error); process.exitCode = 1; });
