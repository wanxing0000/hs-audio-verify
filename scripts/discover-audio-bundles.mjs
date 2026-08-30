import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// Bundled via scripts/run-discover-audio-bundles.cjs (esbuild → tmp/discover-audio-bundles.cjs).
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.json'));
const { runDiscover } = require('../src/validation/discoverAudioBundles.js');

runDiscover(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
