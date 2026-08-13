import fs from 'node:fs';

const input = '/Users/bmeshesha/.codex/attachments/95ea9a8a-551a-41d0-8197-292721291bc7/pasted-text.txt';
const output = '/Users/bmeshesha/Documents/Brandmaster/brandmaster-review-462-32aef3a0.json';
const text = fs.readFileSync(input, 'utf8');
const start = text.indexOf('BEGIN CURRENT INPUT ROWS');
const end = text.indexOf('END CURRENT INPUT ROWS');
const rows = JSON.parse(text.slice(text.indexOf('[', start), text.lastIndexOf(']', end) + 1));

const obviousNonBrand = /(^|\b)(fit for|for \d|genuine|original[- ]te?ile|oem|factory|stock|brand:|product$|repair kit|rebuild kit|clutch cable|crankshaft pulley|control arm|ball joint|windshield|window glass|headrest|headliner|snow cover|bumper quick release|side auxiliary mirror|car side auxiliary mirror|solenoid|inflator|hood protectors|splash guards|power handle|twin piston|two gas springs|wheel bearing seal|parking aid sensor|parking aid sensor support|truck tool box lock|universal scoop|cars prevent|moto[rc]ycle? in genere|santee \d|nissan [a-z]|mazda [a-z]|cadillac [a-z]|chevy [a-z]|ford \d|toyota supra|honda [a-z0-9]|yamaha [a-z0-9]|polaris [a-z]|can am [a-z]|suzuki [a-z]|mercedes benz|for honda|for 20)/i;
const placeholder = /^(\d+|[0-9+.-]+|[A-Z]{1,3}-?\d{2,}|[a-z]{8,}|[A-Z]{2,}[0-9]{0,3})$/;

const decisions = rows.map((r) => {
  const target = r.permittedMergeTarget;
  let action = 'SKIP';
  let brandType = 'AMBIGUOUS';
  let confidence = 55;
  let reason = 'No qualifying source URL or decisive brand-identity evidence was supplied in the review batch.';
  let signals = ['COUNTERSIGNAL: Supplied batch contains no retrievable source URL for this row.'];
  if (obviousNonBrand.test(r.unmappedBrandName) || placeholder.test(r.unmappedBrandName.trim())) {
    action = 'DELETE';
    brandType = 'NON_BRAND';
    confidence = 96;
    reason = 'Value is a product description, fitment phrase, part number, or other non-brand value.';
    signals = ['COUNTERSIGNAL: Exact value is presented as a product, fitment, or part-number description.'];
  }
  return {
    unmappedBrandId: r.unmappedBrandId,
    unmappedBrandName: r.unmappedBrandName,
    action,
    targetBrandId: action === 'MERGE' ? target.targetBrandId : null,
    targetBrandName: action === 'MERGE' ? target.targetBrandName : null,
    brandType,
    brandSignals: signals,
    confidence,
    reason,
    evidence: action === 'DELETE'
      ? ['Supplied input value is explicitly a product, fitment, or part-number description rather than a brand.']
      : []
  };
});

fs.writeFileSync(output, JSON.stringify({
  schemaVersion: 'brandmaster.ai-review.v1',
  reviewRequestId: 'brandmaster-review-462-32aef3a0',
  decisions
}, null, 2) + '\n');
console.log(`${decisions.length} decisions written to ${output}`);
