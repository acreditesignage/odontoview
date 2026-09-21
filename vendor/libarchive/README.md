# libarchive-wasm 1.2.0

Local, unmodified `src/libarchive.js` and `src/libarchive.wasm` from the pinned
npm package. Run `pnpm install --frozen-lockfile` then `pnpm vendor:archive` to
reproduce these two assets. They run in a dedicated, disposable Web Worker.

Upstream: https://github.com/ofk/libarchive-wasm (MIT; see LICENSE).
Upstream build uses libarchive 3.7.7, OpenSSL 3.4.1, zlib 1.3.1, bzip2 1.0.8,
XZ/liblzma 5.6.4 and Emscripten 4.0.5. Third-party license texts are in licenses/.
Build recipe: https://github.com/ofk/libarchive-wasm/blob/main/lib/Dockerfile

Input is limited before the worker reads the archive. Entry count, declared and
actual sizes are checked during extraction. Cancellation terminates the worker,
releasing its WASM memory. Passwords and split volumes are unsupported.
