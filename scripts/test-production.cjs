const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const GROUPS = [
  {
    file: 'test/productionAudio.test.js',
    labels: ['production audio package'],
  },
  {
    file: 'test/productionLinuxReadiness.test.js',
    labels: ['production audio miss', 'Linux readiness', 'production configuration'],
  },
  {
    file: 'test/productionDeploymentPackage.test.js',
    labels: ['deployment package'],
  },
  {
    file: 'test/voiceMappingRules.test.js',
    labels: ['voice mapping rules'],
  },
  {
    file: 'test/phase08-index.test.js',
    labels: ['catalog voice index'],
  },
  {
    file: 'test/cardRepository.test.js',
    labels: ['card repository'],
  },
  {
    file: 'test/audioService.test.js',
    labels: ['audio service'],
  },
  {
    file: 'test/catalogFold.test.js',
    labels: ['catalog'],
  },
  {
    file: 'test/latestCards.test.js',
    labels: ['latest set'],
  },
  {
    file: 'test/latestClassGrouping.test.js',
    labels: ['latest class grouping'],
  },
  {
    file: 'test/latestImageBatch.test.js',
    labels: ['latest image batch'],
  },
  {
    file: 'test/cardAudioIndex.test.js',
    labels: ['card audio index'],
  },
  {
    file: 'test/miniprogram.test.js',
    labels: ['miniprogram catalog'],
  },
  {
    file: 'test/productionAudioAvailability.test.js',
    labels: ['production audio availability'],
  },
  {
    file: 'test/phase210RelatedAudioAudit.test.js',
    labels: ['related / generated card audio audit'],
  },
  {
    file: 'test/relatedCardDisplay.test.js',
    labels: ['related card display'],
  },
  {
    file: 'test/phase210BProductionCopy.test.js',
    labels: ['related card production copy'],
  },
  {
    file: 'test/phase210DRelatedAudioDeepAudit.test.js',
    labels: ['related card audio deep audit'],
  },
  {
    file: 'test/phase210ERelatedAudioProductionAudit.test.js',
    labels: ['related card audio production audit'],
  },
  {
    file: 'test/phase210FRelatedAudioUi.test.js',
    labels: ['related card multi-slot audio UI'],
  },
  {
    file: 'test/phase210GRelatedAudioDiscovery.test.js',
    labels: ['related card audio discovery audit'],
  },
  {
    file: 'test/tabBar.test.js',
    labels: ['tabBar'],
  },
  {
    file: 'test/musicVerification.test.js',
    labels: ['music mapping rules'],
  },
];

console.log('Production test suite');
console.log('');

let failed = false;
GROUPS.forEach((group) => {
  const result = spawnSync(process.execPath, [path.join(ROOT, group.file)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  const ok = result.status === 0;
  if (!ok) failed = true;
  group.labels.forEach((label) => {
    console.log((ok ? '[PASS] ' : '[FAIL] ') + label);
  });
  if (!ok) {
    const extra = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-12).join('\n');
    if (extra) console.log(extra);
  }
});

console.log('');
if (failed) {
  console.log('PRODUCTION_TESTS_FAIL');
  process.exit(1);
}
console.log('PRODUCTION_TESTS_PASS');
