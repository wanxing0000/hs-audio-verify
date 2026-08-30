const { runDiscover } = require('./discoverAudioBundles.js');

runDiscover(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
