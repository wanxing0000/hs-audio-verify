const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function phase010ArtifactPaths() {
  const resultsPath = path.join(ROOT, 'data', 'music-verification', 'phase-0.10-results.json');
  if (!fs.existsSync(resultsPath)) {
    return { resultsPath, available: false };
  }
  let results;
  try {
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  } catch (e) {
    return { resultsPath, available: false };
  }
  const wavPath = results.conversion && results.conversion.wavPath;
  const fsbPath = results.conversion && results.conversion.fsbPath;
  const playVoicePath = results.playVoice && results.playVoice.wavPath;
  const previewPaths = (results.combinedPreview || []).map((row) => row && row.path).filter(Boolean);
  const needed = [wavPath, fsbPath, playVoicePath].concat(previewPaths);
  const available = needed.length > 0 && needed.every((filePath) => filePath && fs.existsSync(filePath));
  return { resultsPath, wavPath, fsbPath, playVoicePath, available };
}

function hearthstoneInstallPresent() {
  return fs.existsSync(path.join('C:', 'Hearthstone', 'Data', 'Win'));
}

function skipDevelopmentOnly(name, reason) {
  console.log('SKIP ' + name);
  console.log('reason: ' + reason);
  console.log('environment: ' + os.platform());
  process.exit(0);
}

module.exports = {
  ROOT,
  phase010ArtifactPaths,
  hearthstoneInstallPresent,
  skipDevelopmentOnly,
};
