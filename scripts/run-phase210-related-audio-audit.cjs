'use strict';

const fs = require('fs');
const path = require('path');
const {
  runProjectRelatedAudioAudit,
  compactAuditJson,
  renderMarkdown,
} = require('../src/audit/relatedAudioAudit.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-related-audio-audit.json');
const OUT_MD = path.join(ROOT, 'data', 'card-verification', 'phase-2.10-report.md');

const result = runProjectRelatedAudioAudit(ROOT);
const json = compactAuditJson(result);
fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 2) + '\n', 'utf8');
fs.writeFileSync(OUT_MD, renderMarkdown(json), 'utf8');

const s = result.summary;
console.log('PHASE_2_10_AUDIT_WRITTEN');
console.log('json=' + OUT_JSON);
console.log('md=' + OUT_MD);
console.log('parents=' + s.primaryParents + ' edges=' + s.primaryEdges + ' related=' + s.primaryRelated);
console.log('3plus=' + s.parentsWith3Plus);
console.log('zeroAudio=' + s.zeroAudio.total);
console.log('mappingProductionMissing=' + s.mappingProductionMissing);
console.log('relatedNotInCatalog=' + s.relatedCardNotInCatalog);
console.log('unindexed=' + s.audioExistsButUnindexed);
console.log('parentAudioRelatedZeroPlayable=' + s.parentWithAudioRelatedWithoutAudioPlayable);
