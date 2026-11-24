import { assertIsolated,stageDump } from './import.mjs';
import { profileDump } from './dump.mjs';

export const preservationPolicy='confirmed-no-backup-preserve-v1';
const canonical=value=>/^\d{1,5}$/.test(value??'')&&Number(value)>0?String(Number(value)).padStart(5,'0'):null;
const decoded=value=>typeof value==='string'?JSON.parse(value):value;
const normalized=value=>Array.isArray(value)?value.map(normalized):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalized(value[key])])):value;
const equal=(a,b)=>JSON.stringify(normalized(a))===JSON.stringify(normalized(b));

export function preservationPlan(dump) {
  const documents=dump.tables.genbook.records;
  const known=new Set(dump.tables.bookdept.records.map(row=>canonical(row.bookdept_id)));
  const ids=new Set(documents.map(row=>row.gen_book_id)),reservations=[],dispositions=[];
  const scopes=new Set();
  for(const row of documents){
    const series=canonical(row.bookdept),year=Number(row.gen_book_year),main=Number(row.book_number),sub=row.book_number_insert===null?null:Number(row.book_number_insert);
    if(!series||!Number.isInteger(year)||year<2400||year>3000||!Number.isInteger(main)||main<1||main>4294967295||sub!==null&&(!Number.isInteger(sub)||sub<0||sub>4294967295))throw new Error('Unreservable source number; preserve rehearsal must stop');
    const reasons=[];
    if(!known.has(series))reasons.push('A02');
    if(!['n','c'].includes(row.status_genbook)||!['0','1'].includes(row.secret)||!['0','1'].includes(row.publish))reasons.push('A03');
    if(!row.user_request||!row.user_dept)reasons.push('A04');
    if(!row.user_datetime||row.user_datetime.startsWith('0000-'))reasons.push('A05');
    if(reasons.length)dispositions.push({table:'genbook',sourceId:row.gen_book_id,handling:reasons.length===1&&reasons[0]==='A05'?'unknown_time':'restricted',reasons});
    reservations.push({sourceId:row.gen_book_id,series,year,main,sub,status:row.status_genbook,referencePresent:known.has(series)});
    scopes.add(JSON.stringify([series,year]));
  }
  for(const [table,code]of[['genbook_inform','A06'],['genbook_dept','A07']]){
    const data=dump.tables[table];
    for(const row of data.records)if(!ids.has(row.gen_book_id))dispositions.push({table,sourceId:row[data.primaryKey],handling:'restricted',reasons:[code]});
  }
  const profile=profileDump(dump);
  const summary={sourceSha256:dump.sourceSha256,rawCounts:profile.counts,reservations:reservations.length,sourceScopes:scopes.size,dispositions:dispositions.length,
    reasonOccurrences:dispositions.reduce((sum,row)=>sum+row.reasons.length,0),restricted:dispositions.filter(row=>row.handling==='restricted').length,
    unknownTime:dispositions.filter(row=>row.handling==='unknown_time').length,unresolvedSeries:[...new Set(reservations.filter(row=>!row.referencePresent).map(row=>row.series))].sort(),
    appHistoryImported:false,countersSeeded:false,gate:'blocked',productionReady:false};
  return {reservations,dispositions,summary};
}

export async function verifyPreservation(db,dump,plan,approvalReference){
  const [[batch]]=await db.execute('SELECT policy,approval_reference,report FROM legacy_preservation_batches WHERE source_sha256=?',[dump.sourceSha256]);
  if(!batch||batch.policy!==preservationPolicy||batch.approval_reference!==approvalReference)throw new Error('Preservation approval mismatch');
  if(!equal(decoded(batch.report),plan.summary))throw new Error('Preservation report mismatch');
  const [stored]=await db.execute('SELECT source_id,legacy_series_id,number_year,main_number,sub_number,original_status,series_reference_present FROM legacy_number_reservations WHERE source_sha256=?',[dump.sourceSha256]);
  if(stored.length!==plan.reservations.length)throw new Error('Reservation count mismatch');
  const expected=new Map(plan.reservations.map(row=>[row.sourceId,row]));
  for(const row of stored){
    const original=expected.get(row.source_id);
    if(!original||row.legacy_series_id!==original.series||Number(row.number_year)!==original.year||Number(row.main_number)!==original.main||(row.sub_number===null?null:Number(row.sub_number))!==original.sub||row.original_status!==original.status||Boolean(row.series_reference_present)!==original.referencePresent)throw new Error('Reservation payload mismatch');
  }
  const [held]=await db.execute('SELECT source_table,source_id,handling,reasons FROM legacy_dispositions WHERE source_sha256=?',[dump.sourceSha256]);
  if(held.length!==plan.dispositions.length)throw new Error('Disposition count mismatch');
  const holds=new Map(plan.dispositions.map(row=>[`${row.table}:${row.sourceId}`,row]));
  for(const row of held){const original=holds.get(`${row.source_table}:${row.source_id}`);if(!original||original.handling!==row.handling||!equal(original.reasons,decoded(row.reasons)))throw new Error('Disposition payload mismatch');}
}

// Stage + reservations + policy/dispositions + closed gate commit atomically.
// No promotion to app-readable history or live counter seeding is done here.
export async function preserveSnapshot(db,dump,{approvalReference,dryRun=false}={}){
  await assertIsolated(db);
  if(typeof approvalReference!=='string'||!approvalReference.trim()||approvalReference.length>200)throw new Error('Disposition approval reference required');
  const plan=preservationPlan(dump);
  await db.beginTransaction();
  try{
    const [[gate]]=await db.query('SELECT state FROM issuance_migration_gate WHERE id=1 FOR UPDATE');
    if(!gate)throw new Error('Migration gate missing');
    const [[history]]=await db.query('SELECT (SELECT COUNT(*) FROM issuance_documents)+(SELECT COUNT(*) FROM legacy_documents) total');
    if(Number(history.total))throw new Error('Preservation requires a fresh database without issued/app history');
    await db.query("UPDATE issuance_migration_gate SET state='blocked' WHERE id=1");
    await stageDump(db,dump,{manageTransaction:false});
    const [[old]]=await db.execute('SELECT policy FROM legacy_preservation_batches WHERE source_sha256=? FOR UPDATE',[dump.sourceSha256]);
    if(!old){
      await db.execute('INSERT INTO legacy_preservation_batches(source_sha256,policy,approval_reference,report) VALUES (?,?,?,?)',[dump.sourceSha256,preservationPolicy,approvalReference,JSON.stringify(plan.summary)]);
      for(let offset=0;offset<plan.reservations.length;offset+=250){
        await db.query('INSERT INTO legacy_number_reservations(source_sha256,source_id,legacy_series_id,number_year,main_number,sub_number,original_status,series_reference_present) VALUES ?',[plan.reservations.slice(offset,offset+250).map(row=>[dump.sourceSha256,row.sourceId,row.series,row.year,row.main,row.sub,row.status,row.referencePresent])]);
      }
      for(const row of plan.dispositions)await db.execute('INSERT INTO legacy_dispositions(source_sha256,source_table,source_id,handling,reasons) VALUES (?,?,?,?,?)',[dump.sourceSha256,row.table,row.sourceId,row.handling,JSON.stringify(row.reasons)]);
    }
    await verifyPreservation(db,dump,plan,approvalReference);
    // A preservation replay must never certify rewound mapped counters.
    const [[rewound]]=await db.execute(`SELECT COUNT(*) total FROM (SELECT l.series_id,r.number_year,MAX(r.main_number) floor FROM legacy_reservation_links l JOIN legacy_number_reservations r ON r.source_sha256=l.source_sha256 AND r.legacy_series_id=l.legacy_series_id WHERE l.source_sha256=? GROUP BY l.series_id,r.number_year) f LEFT JOIN issuance_counters c ON c.series_id=f.series_id AND c.number_year=f.number_year WHERE c.last_number IS NULL OR c.last_number<f.floor`,[dump.sourceSha256]);
    if(Number(rewound.total))throw new Error('Mapped reservation counter mismatch');
    if(dryRun)await db.rollback();else await db.commit();
    return {...plan.summary,replayed:Boolean(old),dryRun};
  }catch(error){await db.rollback();throw error;}
}

// Local-only proof for an EXPLICIT reviewed 1:1 mapping into empty disabled
// series. This never opens the global gate. Missing source series stay blocked.
export async function seedReservedCounters(db,{dump,approvalReference,reviewedBy,mappings}){
  await assertIsolated(db);
  const sourceSha256=dump?.sourceSha256;
  if(!/^[a-f0-9]{64}$/.test(sourceSha256)||typeof reviewedBy!=='string'||!reviewedBy.trim()||reviewedBy.length>200||!Array.isArray(mappings)||!mappings.length)throw new Error('Reviewed reservation mapping required');
  const ordered=[...mappings].sort((a,b)=>String(a.seriesId).localeCompare(String(b.seriesId)));
  if(new Set(ordered.map(row=>row.seriesId)).size!==ordered.length||new Set(ordered.map(row=>row.legacySeriesId)).size!==ordered.length)throw new Error('Reservation mapping must be one to one');
  for(const row of ordered)if(!/^\d{5}$/.test(row.legacySeriesId)||typeof row.seriesId!=='string'||!row.seriesId.trim()||row.seriesId.length>32)throw new Error('Invalid reservation mapping');
  await db.beginTransaction();
  try{
    const [[gate]]=await db.query('SELECT state FROM issuance_migration_gate WHERE id=1 FOR UPDATE');
    if(!gate||gate.state!=='blocked')throw new Error('Reservation seeding requires the closed migration gate');
    await stageDump(db,dump,{manageTransaction:false});
    await verifyPreservation(db,dump,preservationPlan(dump),approvalReference);
    const result=[];
    for(const row of ordered){
      const [[series]]=await db.execute('SELECT enabled FROM issuance_series WHERE id=? FOR UPDATE',[row.seriesId]);
      if(!series||series.enabled)throw new Error('Reservation mapping target must be disabled');
      const [[existing]]=await db.execute('SELECT (SELECT COUNT(*) FROM issuance_documents WHERE series_id=?)+(SELECT COUNT(*) FROM legacy_documents WHERE series_id=?) total',[row.seriesId,row.seriesId]);
      if(Number(existing.total))throw new Error('Reservation mapping target must be empty');
      const [floors]=await db.execute('SELECT number_year,MAX(main_number) floor,MIN(series_reference_present) known FROM legacy_number_reservations WHERE source_sha256=? AND legacy_series_id=? GROUP BY number_year ORDER BY number_year',[sourceSha256,row.legacySeriesId]);
      if(!floors.length||floors.some(scope=>!scope.known))throw new Error('Unresolved legacy series cannot be mapped');
      const [[link]]=await db.execute('SELECT series_id,reviewed_by FROM legacy_reservation_links WHERE source_sha256=? AND legacy_series_id=?',[sourceSha256,row.legacySeriesId]);
      if(link&&(link.series_id!==row.seriesId||link.reviewed_by!==reviewedBy))throw new Error('Changed reservation mapping');
      if(!link)await db.execute('INSERT INTO legacy_reservation_links(source_sha256,legacy_series_id,series_id,reviewed_by) VALUES (?,?,?,?)',[sourceSha256,row.legacySeriesId,row.seriesId,reviewedBy]);
      for(const scope of floors){
        await db.execute('INSERT INTO issuance_counters(series_id,number_year,last_number) VALUES (?,?,?) ON DUPLICATE KEY UPDATE last_number=GREATEST(last_number,?)',[row.seriesId,scope.number_year,scope.floor,scope.floor]);
        result.push({seriesId:row.seriesId,year:Number(scope.number_year),reservedFloor:Number(scope.floor)});
      }
    }
    await db.commit();return{counters:result,gate:'blocked'};
  }catch(error){await db.rollback();throw error;}
}
