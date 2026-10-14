// Chunked package loader: fetches <name>.data.NN in parallel, verifies each chunk's
// size and SHA-256, reassembles the blob and mounts its files into the Emscripten FS.

const MAX_ATTEMPTS = 3;
export const PACKAGE_CACHE = 'arcade-packages-v1'; // must match CACHE in web/sw.js

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(bytes) {
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// Reads a response body while reporting received bytes; returns the full chunk.
async function readWithProgress(res, expectedSize, onBytes) {
  const out = new Uint8Array(expectedSize);
  const reader = res.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > expectedSize) throw new Error(`chunk larger than declared ${expectedSize} bytes`);
    out.set(value, received);
    received += value.length;
    onBytes(value.length);
  }
  if (received !== expectedSize) throw new Error(`chunk size ${received}, expected ${expectedSize}`);
  return out;
}

// The service worker caches any 200 response, so a chunk that fails verification must
// be evicted before retrying, otherwise every retry replays the same bad bytes.
async function evictCached(url) {
  try {
    const cache = await caches.open(PACKAGE_CACHE);
    await cache.delete(url.href);
  } catch {
    // Cache Storage unavailable: nothing was cached, nothing to evict.
  }
}

async function fetchChunk(url, chunk, onBytes) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let counted = 0;
    const track = (n) => { counted += n; onBytes(n); };
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await readWithProgress(res, chunk.size, track);
      const digest = await sha256Hex(bytes);
      if (digest !== chunk.sha256) throw new Error(`SHA-256 mismatch (${digest.slice(0, 12)}...)`);
      return bytes;
    } catch (err) {
      lastError = err;
      onBytes(-counted); // roll back progress of the failed attempt
      await evictCached(url);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw new Error(`${chunk.file}: ${lastError.message} (after ${MAX_ATTEMPTS} attempts)`);
}

/**
 * Loads one package described by its index.json.
 * onProgress({ loaded, total, chunksDone, chunkCount, chunkIndex? }) is called as bytes
 * arrive; chunkIndex is set when that chunk has finished and passed verification.
 * Resolves to { index, files: [{ path, bytes }] }.
 */
export async function loadPackage(indexUrl, { onProgress = () => {}, concurrency = 3 } = {}) {
  const index = await fetchJson(indexUrl);
  const base = new URL('.', new URL(indexUrl, location.href));
  const blob = new Uint8Array(index.dataSize);
  const state = { loaded: 0, total: index.dataSize, chunksDone: 0, chunkCount: index.chunks.length };
  const report = (extra = {}) => onProgress({ ...state, ...extra });

  let next = 0;
  const worker = async () => {
    while (next < index.chunks.length) {
      const i = next;
      next += 1;
      const chunk = index.chunks[i];
      const bytes = await fetchChunk(new URL(chunk.file, base), chunk, (n) => {
        state.loaded += n;
        report();
      });
      blob.set(bytes, i * index.chunkSize);
      state.chunksDone += 1;
      report({ chunkIndex: i });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, index.chunks.length) }, worker));

  const files = index.files.map((f) => ({ path: f.path, bytes: blob.subarray(f.start, f.end) }));
  return { index, files };
}

export function mountFiles(FS, files) {
  for (const { path, bytes } of files) {
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    FS.mkdirTree(dir);
    FS.writeFile(path, bytes);
  }
}
