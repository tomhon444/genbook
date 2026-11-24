import { mappingTemplate, mappingPlan, canonicalSeries } from './mapping.mjs';

const states = ['held', 'invalid', 'pending', 'ready'];
const emptyCounts = () => Object.fromEntries(states.map(state => [state, 0]));
const exactSort = (left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right));
const sourceValue = value => value === null || value === undefined ? null : String(value);
const key = value => JSON.stringify(value);

// A work queue, never executable identity evidence. Every target/review remains
// exactly as supplied in the source-bound mapping, including pending blanks.
export function mappingWorkbench(dump, mapping = mappingTemplate(dump)) {
  const plan = mappingPlan(dump, mapping);
  const stateById = new Map();
  for (const row of plan.held) stateById.set(row.sourceId, 'held');
  for (const id of plan.invalid) stateById.set(id, 'invalid');
  for (const id of plan.unresolved) stateById.set(id, 'pending');
  for (const row of plan.documents) stateById.set(row.sourceId, 'ready');
  const decisions = Object.fromEntries(['owners', 'departments', 'series'].map(kind => [kind, new Map(mapping[kind].map(row => [row.sourceId, row]))]));
  const ownBlockers = new Map();
  for (const blocker of plan.blockers) {
    const id = `${blocker.kind}:${key(blocker.sourceId)}`;
    if (!ownBlockers.has(id)) ownBlockers.set(id, new Set());
    ownBlockers.get(id).add(blocker.code);
  }
  const groups = Object.fromEntries(['owners', 'departments', 'series', 'actors'].map(kind => [kind, new Map()]));
  const totals = emptyCounts();
  let differentActorDocuments = 0, missingActorDocuments = 0, missingOwnerDocuments = 0;
  for (const document of dump.tables.genbook.records) {
    const state = stateById.get(document.gen_book_id);
    if (!state) throw new Error('Work queue could not reconcile a source document');
    totals[state]++;
    const refs = { owners: sourceValue(document.user_request), departments: sourceValue(document.user_dept), series: canonicalSeries(document.bookdept), actors: sourceValue(document.user_login) };
    if (refs.owners && refs.actors && refs.owners !== refs.actors) differentActorDocuments++;
    if (!refs.actors) missingActorDocuments++;
    if (!refs.owners) missingOwnerDocuments++;
    for (const [kind, sourceId] of Object.entries(refs)) {
      const groupKey = key(sourceId), entries = groups[kind];
      if (!entries.has(groupKey)) {
        const decision = decisions[kind]?.get(sourceId);
        entries.set(groupKey, { sourceId, missingSourceReference: sourceId === null || sourceId === '', documentCount: 0,
          documentStates: emptyCounts(), decision: decision?.decision ?? 'not-in-mapping', targetId: decision?.targetId ?? '',
          review: decision?.review ?? null, mappingBlockers: [...(ownBlockers.get(`${kind}:${groupKey}`) ?? [])].sort(),
          sampleSourceIds: [], related: Object.fromEntries(Object.keys(refs).filter(value => value !== kind).map(value => [value, new Set()])) });
      }
      const group = entries.get(groupKey);
      group.documentCount++;
      group.documentStates[state]++;
      if (group.sampleSourceIds.length < 5) group.sampleSourceIds.push(document.gen_book_id);
      for (const [relatedKind, relatedId] of Object.entries(refs)) if (relatedKind !== kind) group.related[relatedKind].add(relatedId);
    }
  }
  const queues = Object.fromEntries(Object.entries(groups).map(([kind, entries]) => {
    const rows = [...entries.values()].map(row => ({ ...row, related: Object.fromEntries(Object.entries(row.related).map(([name, values]) => [name, [...values].sort(exactSort)])) }));
    rows.sort((a, b) => (b.documentStates.pending + b.documentStates.invalid) - (a.documentStates.pending + a.documentStates.invalid) || exactSort(a.sourceId, b.sourceId));
    if (rows.reduce((sum, row) => sum + row.documentCount, 0) !== plan.summary.sourceDocuments) throw new Error('Work queue group total mismatch');
    return [kind, rows];
  }));
  const staffReferences = [...new Set([...queues.owners, ...queues.actors].map(row => row.sourceId).filter(value => typeof value === 'string' && value.length > 0))].sort(exactSort);
  // Includes unused source series without pretending that history confers any
  // current issuing grant or that an equal CENTRAL ID proves an identity.
  const unreferencedSeries = mappingTemplate(dump).series.filter(row => !groups.series.has(key(row.sourceId)))
    .map(row => ({ ...(decisions.series.get(row.sourceId) ?? { ...row, decision: 'not-in-mapping' }) }));
  return {
    version: 1, sourceSha256: dump.sourceSha256, sourceFingerprint: mapping.sourceFingerprint,
    mappingFingerprint: plan.mappingFingerprint,
    summary: { ...plan.summary, documentStates: totals, differentActorDocuments, missingActorDocuments, missingOwnerDocuments,
      ownerGroups: queues.owners.length, departmentGroups: queues.departments.length, seriesGroups: queues.series.length,
      actorGroups: queues.actors.length, centralStaffReferences: staffReferences.length, unusedSeriesReferences: unreferencedSeries.length },
    queues, unreferencedSeries, centralLookup: { coverage: 'exact-owner-and-actor-references-only-not-a-complete-user-directory-or-grants', staffReferences },
    globalBlockers: plan.blockers.filter(row => !['owners', 'departments', 'series', 'genbook'].includes(row.kind)
      || (['owners', 'departments', 'series'].includes(row.kind) && !groups[row.kind].has(key(row.sourceId)))),
    sourceIssues: plan.blockers.filter(row => row.kind === 'genbook'),
    held: plan.held,
  };
}

const cell = value => String(value === null ? '(NULL)' : value === '' ? '(empty)' : value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|').replaceAll('`', '&#96;').replace(/[\r\n]/g, ' ');
export function workbenchMarkdown(packet) {
  let result = `# T12 — คิวตรวจ mapping\n\nต้นฉบับ SHA-256: ${packet.sourceSha256}\n\n`;
  result += 'ข้อมูลเฉพาะเครื่อง รหัสในชุดนี้เป็น reference จาก snapshot ไม่ใช่บัญชีที่ยืนยันแล้ว ไม่ใช้ชื่อหรือ email จับคู่ ไม่ต้อง dump CENTRAL: ตรวจเฉพาะรหัสที่จำเป็นผ่านช่องทางอ่านที่ได้รับอนุญาตเมื่อพร้อม\n\n';
  result += `หนังสือ ${packet.summary.sourceDocuments}; เก็บแยก ${packet.summary.documentStates.held}; ข้อมูลไม่ผ่าน ${packet.summary.documentStates.invalid}; รอ mapping ${packet.summary.documentStates.pending}; ผ่านแผน ${packet.summary.documentStates.ready}\n\n`;
  result += `พร้อมซ้อม promotion ทั้งชุด: ${packet.summary.readyForLocalPromotion ? 'ใช่' : 'ยังไม่พร้อม'}; เงื่อนไขค้างทั้งหมด ${packet.summary.blockers} ข้อ การผ่านเงื่อนไขรายแถวไม่แทนการรับรอง manifest/นโยบายทั้งชุด\n\n`;
  result += 'กรอกผลตัดสินใน mapping.json ที่แนบมา พร้อมหลักฐาน/ผู้รับรองจริง ตรวจด้วย migration:check ห้ามใช้คิวนี้เป็นคำรับรอง mapping อัตโนมัติ และห้ามให้สิทธิ์ออกเลขจากการเป็นเจ้าของประวัติ ผู้ทำรายการเดิม (actor) แยกจากเจ้าของ\n\n';
  for (const [kind, title] of [['owners', 'ผู้ขอ/เจ้าของ'], ['departments', 'หน่วยงาน ณ วันออก'], ['series', 'ชุดเลข'], ['actors', 'ผู้ทำรายการเดิม (ไม่ใช่ผู้ขอโดยอัตโนมัติ)']]) {
    result += `## ${title}\n\n| reference เดิม | ทั้งหมด | เก็บแยก | ไม่ผ่านข้อมูล | รอ mapping | ผ่านแผน | decision | target |\n|---|---:|---:|---:|---:|---:|---|---|\n`;
    for (const row of packet.queues[kind]) result += `| ${cell(row.sourceId)} | ${row.documentCount} | ${row.documentStates.held} | ${row.documentStates.invalid} | ${row.documentStates.pending} | ${row.documentStates.ready} | ${cell(row.decision)} | ${cell(row.targetId)} |\n`;
    result += '\n';
  }
  return result + 'รายละเอียด reference ที่เกี่ยวข้อง ตัวอย่าง source ID และเหตุผลค้างอยู่ใน queue.json ไม่มีเนื้อหาหนังสือ รหัสผ่าน หรือไฟล์แนบ คิวนี้ไม่เปลี่ยนฐานข้อมูล ไม่เพิ่มสิทธิ์ และไม่เปิด gate\n';
}
