import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {buildResultsWorkbook,validateReport,type TournamentReport} from '../src/results';
import {teamRanking} from '../src/team-ranking';
let db:PGlite,report:TournamentReport,session:string,teamA:string,teamB:string;
const admin='10000000-0000-4000-8000-000000000001',judge='10000000-0000-4000-8000-000000000002';
const cmd=async(action:string,payload:unknown,actor=admin)=>(await db.query<{r:any}>('select public.command($1,$2,$3) r',[actor,action,JSON.stringify(payload)])).rows[0].r;
const state=async()=>(await db.query<{data:any}>('select data from public.public_state')).rows[0].data;
const getReport=async(id:string,actor=admin)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);return (await tx.query<{r:TournamentReport}>('select public.tournament_report($1) r',[id])).rows[0].r;});
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const f of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 for(const [id,role] of [[admin,'admin'],[judge,'judge']]){await db.query('insert into auth.users values($1,$2)',[id,role+'@test.invalid']);await db.query('insert into public.users(id,name,role,enabled,activities,slot) values($1,$2,$3,true,$4,$5)',[id,role,role,['pingpong','mesa'],role==='judge'?1:null]);}
 teamA=(await cmd('team',{name:'Robots',career:'IMT',members:['Privado'],activities:['pingpong'],active:true})).id;
 teamB=(await cmd('team',{name:'Naranja',career:'IMT',members:['Privado B'],activities:['pingpong'],active:true})).id;
 await cmd('team',{name:'Azul',career:'IIS',members:['Privado C'],activities:['mesa'],active:true});
 await cmd('settings',{status:'running'});session=(await state()).sessionId;
},60000);
afterAll(async()=>{await db?.close();});
it('publica solo ID, nombre, carrera y puntos, incluidos ceros; ranking estable y empates',async()=>{
 const s=await state();expect(s.teams).toHaveLength(3);expect(Object.keys(s.teams[0]).sort()).toEqual(['career','id','name','points']);
 expect(teamRanking(s.teams,'IMT').map(t=>t.rank)).toEqual([1,1]);expect(teamRanking(s.teams,'IIS')).toHaveLength(1);
 expect(teamRanking(s.teams,'IMT').map(t=>t.id)).toEqual([teamA,teamB].sort());
});
it('sincroniza acumulados, cambios de posición, ajustes y anulaciones sin doble descuento',async()=>{
 const op=crypto.randomUUID();await cmd('score',{operationId:op,teamId:teamA,activity:'pingpong',points:20},judge);
 let s=await state();expect(s.totals.IMT).toBe(20);expect(teamRanking(s.teams,'IMT')[0]).toMatchObject({id:teamA,points:20});
 await cmd('score',{operationId:crypto.randomUUID(),teamId:teamB,activity:'pingpong',points:50},judge);
 expect(teamRanking((await state()).teams,'IMT')[0].id).toBe(teamB);
 await cmd('reverse',{operationId:crypto.randomUUID(),eventId:op,reason:'Corrección'});
 await cmd('adjust',{operationId:crypto.randomUUID(),teamId:teamB,activity:'pingpong',points:-30,reason:'Corrección negativa'});
 s=await state();expect(s.totals.IMT).toBe(20);expect(s.teams.find((t:any)=>t.id===teamA).points).toBe(0);
 await expect(cmd('reverse',{operationId:crypto.randomUUID(),eventId:op,reason:'Duplicada'})).rejects.toThrow();
});
it('congela instantánea definitiva privada, consistente e inmutable al revelar',async()=>{
 await cmd('settings',{status:'finished'});report=await getReport(session);validateReport(report);
 expect(report.phase).toBe('practice');expect(report.events).toHaveLength(4);expect(report.totals).toEqual((await state()).totals);
 await cmd('settings',{reveal:true});expect(await getReport(session)).toEqual(report);
 await expect(getReport(session,judge)).rejects.toThrow(/administrador/);
 await expect(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select * from public.tournament_reports');})).rejects.toThrow(/permission/);
});
it('produce XLSX real con cinco hojas, filtros, fechas numéricas y negativos; detecta discrepancias',async()=>{
 const book=await buildResultsWorkbook(report);expect(book.worksheets.map(s=>s.name)).toEqual(['RESUMEN GENERAL','RANKING DE EQUIPOS','PUNTOS POR ACTIVIDAD','PUNTOS POR JUEZ','HISTORIAL COMPLETO']);
 const bytes=await book.xlsx.writeBuffer();expect(new Uint8Array(bytes).slice(0,2)).toEqual(new Uint8Array([80,75]));
 const {default:ExcelJS}=await import('exceljs');const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(bytes);
 expect(reopened.getWorksheet('HISTORIAL COMPLETO')!.getCell('A5').value).toBeInstanceOf(Date);
 expect(reopened.getWorksheet('HISTORIAL COMPLETO')!.getColumn(6).values).toContain(-30);
 expect(reopened.worksheets.every(s=>!!s.autoFilter)).toBe(true);
 expect(()=>validateReport({...report,totals:{...report.totals,IMT:999}})).toThrow(/coinciden/);
},30000);
it('separa sesiones de práctica y oficial; conserva reportes tras reinicio y bloquea reinicio oficial',async()=>{
 await db.query("select public.manage_practice($1,'reset_practice',$2,$3)",[admin,crypto.randomUUID(),(await state()).revision]);
 expect((await state()).sessionId).not.toBe(session);expect((await state()).teams).toEqual([]);expect(await getReport(session)).toEqual(report);
 await db.query("select public.manage_practice($1,'start_official',$2,$3)",[admin,crypto.randomUUID(),(await state()).revision]);
 await cmd('settings',{status:'running'});await cmd('settings',{status:'finished'});
 const official=await getReport((await state()).sessionId);expect(official.phase).toBe('official');expect(official.events).toEqual([]);expect(official.sessionId).not.toBe(session);
 expect((await buildResultsWorkbook(official)).worksheets).toHaveLength(5);
 await expect(db.query("select public.manage_practice($1,'reset_practice',$2,$3)",[admin,crypto.randomUUID(),(await state()).revision])).rejects.toThrow(/oficial/);
 expect(await getReport(session)).toEqual(report);
});
