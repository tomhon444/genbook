import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeCentralReview } from './audit-central-mapping.mjs';

test('review packet preserves pending decisions, inactive evidence and source binding without issuing grants', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'genbook-central-review-'));
  const owner = { sourceId: '001', kind: 'value', documentCount: 2, referenceCount: 2,
    match: { status: 'inactive', matches: [{ STAFF_ID: '001', DEPT_ID: 'new', ACTIVE: '0' }] },
    historicalDepartments: [{ sourceId: 'old', kind: 'value' }], currentDepartmentId: 'new', currentDepartmentDiffersFromHistorical: true };
  const missing = { sourceId: 'missing|owner', kind: 'value', documentCount: 1, match: { status: 'missing', matches: [] } };
  const markup = { ...missing, sourceId: '![image](https://example.invalid/tracker)<img src="x">' };
  const packet = { sourceSha256: 'a'.repeat(64), completedAt: '2026-11-19T00:00:00Z', evidence: {
    owners: [owner, missing, markup], departmentIds: [{ sourceId: 'old', kind: 'value', referenceCount: 2, references: [{ table: 'genbook' }], match: { status: 'active', matches: [{ DEPT_ID: 'old', STATUS: '1' }] } }],
    series: [{ sourceId: '00001', status: 'unique', documentCount: 2 }],
    grants: [{ sourceId: 'g', staffId: '001', seriesId: '00009', decision: 'pending' }],
  } };
  try {
    const result = await writeCentralReview(packet, directory);
    assert.equal(result.missingGrantSeriesRows, 1);
    const proposals = JSON.parse(await readFile(path.join(directory, 'review-proposals.json'), 'utf8'));
    assert.equal(proposals.sourceSha256, packet.sourceSha256);
    assert.equal(proposals.owners[0].centralStatus, 'inactive');
    assert.equal(proposals.owners[0].candidateTargetId, '001');
    assert.equal(proposals.owners[0].decision, 'pending');
    assert.equal(proposals.owners[0].review, null);
    assert.equal(proposals.owners[1].candidateTargetId, null);
    assert.equal(proposals.series[0].targetId, null);
    assert.equal(proposals.approvals, null);
    assert.equal(proposals.productionReady, false);
    assert.equal(proposals.readyForLocalPromotion, false);
    assert.deepEqual(proposals.legacyGrantRows, packet.evidence.grants);
    const markdown = await readFile(path.join(directory, 'REVIEW.md'), 'utf8');
    assert.ok(markdown.includes('missing\\|owner'));
    assert.ok(!markdown.includes('![image]'));
    assert.ok(!markdown.includes('<img'));
    assert.ok(markdown.includes('&lt;img'));
    assert.ok(markdown.includes('not proof of a staff transfer'));
    await assert.rejects(writeCentralReview(packet, directory), { code: 'EEXIST' });
  } finally {
    // mkdtemp owns this exact newly created directory, never a caller path.
    await rm(directory, { recursive: true });
  }
});
