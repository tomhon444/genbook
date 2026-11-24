import { hash } from './dump.mjs';

export function preservationFixture(){
  const row=(id,main,changes={})=>({gen_book_id:String(id),bookdept:'00001',gen_book_year:'2569',book_number:String(main),book_number_insert:null,status_genbook:'n',secret:'0',publish:'0',user_request:'TEST-001',user_dept:'204',user_login:'TEST-001',title:'Restricted synthetic raw',date_request:'2026-11-13',user_datetime:'2026-11-13 10:00:00',lastupdate:null,...changes});
  return {sourceSha256:hash('synthetic-preservation-v1'),tables:{
    book:{primaryKey:'idbook',records:[]},typebook:{primaryKey:'idtypebook',records:[]},
    bookdept:{primaryKey:'bookdept_id',records:[{bookdept_id:'00001',book_number:'ทดสอบ 001',book_year:'y'}]},
    genbook:{primaryKey:'gen_book_id',records:[row(1,42),row(2,70,{book_number_insert:'2',status_genbook:'c'}),row(3,90,{user_request:null,user_dept:'',user_login:'',title:null,date_request:null,user_datetime:null,publish:null}),row(4,30,{user_datetime:null}),row(5,1,{bookdept:'00096',status_genbook:'c'}),row(6,42)]},
    genbook_inform:{primaryKey:'gen_book_inform_id',records:[{gen_book_inform_id:'7',gen_book_id:'999',inform:'Synthetic orphan'}]},
    genbook_dept:{primaryKey:'gen_book_dept_id',records:[{gen_book_dept_id:'8',gen_book_id:'999',dept_status:'1',dept:'Synthetic orphan'}]},
  }};
}
