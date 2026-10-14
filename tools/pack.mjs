// Split packager: concatenates package files into one blob, cuts it into fixed-size
// chunks (<name>.data.00, .01, ...) and writes an index with per-chunk SHA-256 and a
// VFS table (path -> [start, end)). Output is content-addressed by the blob hash, so
// chunk URLs never change meaning and can be cached forever.
//
// usage: node tools/pack.mjs <packages.config.json> <outDir>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function packOne(pkg, { chunkSize, rootDir, outDir }) {
  const parts = pkg.files.map((f) => ({ path: f.path, bytes: readFileSync(resolve(rootDir, f.src)) }));
  const blob = Buffer.concat(parts.map((p) => p.bytes));
  const blobHash = sha256(blob);
  const version = blobHash.slice(0, 12);
  const pkgDir = join(outDir, 'packages', pkg.name);
  const verDir = join(pkgDir, version);

  rmSync(pkgDir, { recursive: true, force: true });
  mkdirSync(verDir, { recursive: true });

  const chunkCount = Math.ceil(blob.length / chunkSize);
  const chunks = Array.from({ length: chunkCount }, (_, i) => {
    const bytes = blob.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, blob.length));
    const file = `${pkg.name}.data.${String(i).padStart(2, '0')}`;
    writeFileSync(join(verDir, file), bytes);
    return { file, size: bytes.length, sha256: sha256(bytes) };
  });

  let offset = 0;
  const files = parts.map((p) => {
    const entry = { path: p.path, start: offset, end: offset + p.bytes.length };
    offset = entry.end;
    return entry;
  });

  const index = {
    name: pkg.name,
    version,
    dataSize: blob.length,
    chunkSize,
    sha256: blobHash,
    chunks,
    files,
  };
  writeFileSync(join(verDir, 'index.json'), JSON.stringify(index, null, 2));

  const base = `packages/${pkg.name}/${version}/`;
  return {
    entry: {
      name: pkg.name,
      label: pkg.label,
      description: pkg.description,
      role: pkg.role,
      iwad: pkg.iwad,
      args: pkg.args ?? [],
      dataSize: blob.length,
      chunkCount,
      index: `${base}index.json`,
    },
    urls: [`${base}index.json`, ...chunks.map((c) => base + c.file)],
  };
}

function main() {
  const [configPath, outArg] = process.argv.slice(2);
  if (!configPath || !outArg) {
    console.error('usage: node tools/pack.mjs <packages.config.json> <outDir>');
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const rootDir = dirname(resolve(configPath));
  const outDir = resolve(outArg);
  const chunkSize = config.chunkSize;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error('chunkSize must be a positive integer');

  const built = config.packages.map((pkg) => ({ pkg, ...packOne(pkg, { chunkSize, rootDir, outDir }) }));

  const catalog = { generatedAt: new Date().toISOString(), packages: built.map((b) => b.entry) };
  writeFileSync(join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2));

  const warmNames = new Set(config.warm ?? []);
  const warm = {
    note: 'Optional prefetch list. Not a complete dependency list; packages load on demand regardless.',
    urls: built.filter((b) => warmNames.has(b.pkg.name)).flatMap((b) => b.urls),
  };
  writeFileSync(join(outDir, 'warm.json'), JSON.stringify(warm, null, 2));

  for (const b of built) {
    const mb = (b.entry.dataSize / 1048576).toFixed(1);
    console.log(`${b.entry.name.padEnd(8)} ${b.entry.role.padEnd(10)} ${mb} MB in ${b.entry.chunkCount} chunks -> ${b.entry.index}`);
  }
  console.log(`warm.json: ${warm.urls.length} urls`);
}

main();
