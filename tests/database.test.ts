import {PGlite,type Transaction} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {winners,type State} from '../src/domain';
// Real PostgreSQL (WASM), including PL/pgSQL, grants, RLS and transactions.
// Auth identities are fixtures. This does not emulate Supabase Auth or Realtime.
let db:PGlite;const user=(i:number)=>`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const admin=user(1),judges=Array.from({length:9},(_,i)=>user(i+2)),teams:Record<string,string>={};
const all=['pingpong','futbolito','videojuegos','mesa'];let first:string;let duplicate:string;
async function role<T>(name:'anon'|'authenticated'|'service_role',uid:string,fn:(tx:Transaction)=>Promise<T>){return db.transaction(async tx=>{await tx.exec(`set local role ${name}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return fn(tx);});}
async function rpc(name:string,args:unknown[],casts:string[],actor=admin){return role('service_role',actor,async tx=>{const r=await tx.query<{result:any}>(`select public.${name}(${args.map((_,i)=>`$${i+1}::${casts[i]}`).join(',')}) as result`,args.map(a=>typeof a==='object'?JSON.stringify(a):a));return r.rows[0].result;});}
async function command(action:string,payload:Record<string,unknown>,actor=admin){return rpc('command',[actor,action,payload],['uuid','text','jsonb'],actor);}
async function state(){return (await role('anon','',tx=>tx.query<{data:State}>("select data from public.public_state where id='state'"))).rows[0].data;}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text unique);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase/migrations/202611040001_ingegames.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202611040002_modo_practica.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202611040003_reinicio_practica.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202611040004_practica_segura.sql','utf8'));
 const accounts=Array.from({length:10},(_,i)=>({id:user(i+1),name:i===0?'Administrador':`Juez ${i}`,email:`cuenta${i}@test.invalid`}));
 for(const a of [...accounts,{id:user(99),email:'unauthorized@test.invalid'}])await db.query('insert into auth.users(id,email) values($1,$2)',[a.id,a.email]);
 await rpc('bootstrap_accounts',[accounts],['jsonb']);
},60000);
afterAll(async()=>{await db?.close();});
describe('Backend PostgreSQL migrado',()=>{
 it('inicializa sin equipos ni puntos y con exactamente un admin y nueve jueces',async()=>{
  const s=await state();expect(s.status).toBe('not_started');expect(s.totals).toEqual({IMT:0,IIS:0,IIT:0});
  expect((await db.query('select * from public.users')).rows).toHaveLength(10);
  expect((await db.query("select * from public.users where role='judge'")).rows).toHaveLength(9);
  expect((await db.query('select * from public.teams')).rows).toHaveLength(0);
 });
 it('no permite al público leer información privada',async()=>{
  for(const table of ['teams','users','score_events','judge_slots','admin_audit','event_settings','judge_locks'])await expect(role('anon','',tx=>tx.query(`select * from public.${table}`))).rejects.toThrow();
 });
 it('un usuario solo ve su perfil y el admin ve las diez cuentas',async()=>{
  expect((await role('authenticated',judges[0],tx=>tx.query('select * from public.users'))).rows).toHaveLength(1);
  expect((await role('authenticated',admin,tx=>tx.query('select * from public.users'))).rows).toHaveLength(10);
  expect((await role('authenticated',judges[0],tx=>tx.query('select * from public.judge_slots'))).rows).toHaveLength(0);
 });
 it('rechaza llamadas SQL directas y escrituras de clientes, incluido el admin',async()=>{
  for(const uid of [admin,judges[0],user(99)]){
   await expect(role('authenticated',uid,tx=>tx.query("update public.public_state set data='{}'"))).rejects.toThrow();
   await expect(role('authenticated',uid,tx=>tx.query("select public.command($1,'settings','{\"status\":\"running\"}')",[admin]))).rejects.toThrow();
   await expect(role('authenticated',uid,tx=>tx.query("update public.users set role='admin' where id=$1",[uid]))).rejects.toThrow();
  }
 });
 it('registra IMT, IIS e IIT, exige cuatro integrantes y evita nombres duplicados',async()=>{
  for(const career of ['IMT','IIS','IIT'])teams[career]=(await command('team',{name:`Equipo ${career}`,career,members:['Uno','Dos','Tres','Cuatro'],activities:all,active:true})).id;
  await expect(command('team',{name:'  equipo   IMT ',career:'IMT',members:['A','B','C','D'],activities:all,active:true})).rejects.toThrow(/existe/);
  await expect(command('team',{name:'Inválido',career:'IMT',members:['A','B','C'],activities:all,active:true})).rejects.toThrow();
  await expect(command('team',{id:teams.IMT,name:'Equipo IMT',career:'IIS',members:['A','B','C','D'],activities:all,active:true})).rejects.toThrow(/inmutable/);
 });
 it('rechaza jueces en administración, desconocidos y puntos antes del inicio',async()=>{
  await expect(command('settings',{status:'running'},judges[0])).rejects.toThrow(/administrador/);
  await expect(command('score',{operationId:crypto.randomUUID(),teamId:teams.IMT,activity:'pingpong',points:20},user(99))).rejects.toThrow(/autorizada/);
  await expect(command('score',{operationId:crypto.randomUUID(),teamId:teams.IMT,activity:'pingpong',points:20},judges[0])).rejects.toThrow(/curso/);
 });
 it('inicia y registra 20 puntos atómicamente con fecha del servidor',async()=>{
  await command('settings',{status:'running'});first=crypto.randomUUID();await command('score',{operationId:first,teamId:teams.IMT,activity:'pingpong',points:20},judges[0]);
  expect((await state()).totals.IMT).toBe(20);
  expect((await db.query<{points:number}>('select points from public.teams where id=$1',[teams.IMT])).rows[0].points).toBe(20);
  expect((await db.query<{created_at:Date}>('select created_at from public.score_events where id=$1',[first])).rows[0].created_at).toBeTruthy();
 });
 it('rechaza actividades ajenas y cantidades no habilitadas sin cambios parciales',async()=>{
  const before=await state();
  await expect(command('score',{operationId:crypto.randomUUID(),teamId:teams.IMT,activity:'mesa',points:20},judges[0])).rejects.toThrow(/asignada/);
  await expect(command('score',{operationId:crypto.randomUUID(),teamId:teams.IMT,activity:'pingpong',points:17},judges[0])).rejects.toThrow(/habilitada/);
  expect(await state()).toEqual(before);
 });
 it('procesa solicitudes de los nueve jueces sin perder entradas (motor local serializado)',async()=>{
  await Promise.all(judges.map((actor,i)=>command('score',{operationId:crypto.randomUUID(),teamId:teams[['IMT','IIS','IIT'][i%3]],activity:all[i%4],points:5},actor)));
  expect((await state()).totals).toEqual({IMT:35,IIS:15,IIT:15});
 });
 it('el UUID hace idempotente un doble envío y rechaza cambiar su contenido',async()=>{
  duplicate=crypto.randomUUID();const payload={operationId:duplicate,teamId:teams.IMT,activity:'pingpong',points:10};
  await Promise.all([command('score',payload,judges[0]),command('score',payload,judges[0])]);
  expect((await state()).totals.IMT).toBe(45);
  await expect(command('score',{...payload,points:20},judges[0])).rejects.toThrow(/reutilizado/);
 });
 it('RLS limita equipos por actividad e historial al juez que lo registró',async()=>{
  const privateTeam=await command('team',{name:'Solo mesa',career:'IIT',members:['A','B','C','D'],activities:['mesa'],active:true});
  expect((await role('authenticated',judges[0],tx=>tx.query('select * from public.teams where id=$1',[privateTeam.id]))).rows).toHaveLength(0);
  const scores=await role('authenticated',judges[0],tx=>tx.query<{judge_id:string}>('select judge_id from public.score_events'));
  expect(scores.rows.length).toBeGreaterThan(0);expect(scores.rows.every(s=>s.judge_id===judges[0])).toBe(true);
 });
 it('anula conservando el original e impide anularlo dos veces',async()=>{
  await command('reverse',{operationId:crypto.randomUUID(),eventId:first,reason:'Corrección de prueba'});expect((await state()).totals.IMT).toBe(25);
  await expect(command('reverse',{operationId:crypto.randomUUID(),eventId:first,reason:'Doble anulación'})).rejects.toThrow(/anulada/);
  expect((await db.query('select * from public.score_events where id=$1',[first])).rows).toHaveLength(1);
 });
 it('serializa cambios de juez, revoca acceso y rechaza una décima plaza',async()=>{
  const lease=await rpc('prepare_judge',[admin,1],['uuid','integer']);
  await expect(command('score',{operationId:crypto.randomUUID(),teamId:teams.IMT,activity:'pingpong',points:5},judges[0])).rejects.toThrow(/desactivada/);
  expect((await role('authenticated',judges[0],tx=>tx.query('select * from public.teams'))).rows).toHaveLength(0);
  await expect(rpc('prepare_judge',[admin,1],['uuid','integer'])).rejects.toThrow(/actualizando/);
  await expect(rpc('prepare_judge',[admin,10],['uuid','integer'])).rejects.toThrow();
  await rpc('finish_judge',[admin,1,lease.token,{name:'Juez uno',email:'cuenta1@test.invalid',enabled:true,activities:['pingpong']}],['uuid','integer','uuid','jsonb']);
 });
 it('pausa bloquea puntuaciones y reanudar conserva los datos',async()=>{
  await command('settings',{status:'paused'});await expect(command('score',{operationId:crypto.randomUUID(),teamId:teams.IMT,activity:'pingpong',points:5},judges[0])).rejects.toThrow(/curso/);
  await command('settings',{status:'running'});expect((await state()).totals.IMT).toBe(25);
 });
 it('congela al finalizar, conserva el empate y permite revelarlo sin elegir arbitrariamente',async()=>{
  await command('adjust',{operationId:crypto.randomUUID(),teamId:teams.IIT,activity:'mesa',points:10,reason:'Ajuste documentado de prueba'});
  await command('settings',{status:'finished'});await command('settings',{reveal:true});const s=await state();
  expect(s.status).toBe('finished');expect(s.reveal).toBe(true);expect(winners(s)).toEqual(['IMT','IIT']);
  await expect(command('score',{operationId:crypto.randomUUID(),teamId:teams.IMT,activity:'pingpong',points:5},judges[0])).rejects.toThrow(/congelados/);
  await expect(command('reverse',{operationId:crypto.randomUUID(),eventId:duplicate,reason:'Fuera de tiempo'})).rejects.toThrow(/congelados/);
  await expect(command('adjust',{operationId:crypto.randomUUID(),teamId:teams.IMT,activity:'pingpong',points:5,reason:'Fuera de tiempo'})).rejects.toThrow(/congelados/);
  await expect(command('settings',{tieWinner:'IIS',reason:'No está empatada'})).rejects.toThrow();
  await command('settings',{sharedWinners:true});expect((await state()).sharedWinners).toBe(true);
 });
 it('reconstruye los totales desde todo el historial sin descontar dos veces',async()=>{
  const rows=(await db.query<{career:string;points:number}>('select career,sum(points)::integer as points from public.score_events group by career')).rows;
  expect(Object.fromEntries(rows.map(r=>[r.career,r.points]))).toEqual((await state()).totals);
 });
 it('no permite reiniciar las cuentas ni reabrir los resultados',async()=>{
  await expect(rpc('bootstrap_accounts',[[]],['jsonb'])).rejects.toThrow(/inicializadas|sobrescribir/);
  await expect(command('settings',{status:'running'})).rejects.toThrow(/Transición/);
 });
 async function manage(action='reset_practice',actor=admin,id=crypto.randomUUID(),revision?:number){
  return rpc('manage_practice',[actor,action,id,revision??(await state()).revision],['uuid','text','uuid','bigint'],actor);
 }
 async function accounts(){return {
  auth:(await db.query('select * from auth.users order by id')).rows,
  users:(await db.query('select * from public.users order by id')).rows,
  slots:(await db.query('select * from public.judge_slots order by id')).rows,
  settings:(await db.query('select * from public.event_settings order by id')).rows
 };}
 async function clean(){
  const s=await state();expect(s).toMatchObject({phase:'practice',status:'not_started',totals:{IMT:0,IIS:0,IIT:0},recent:[],presets:[5,10,20,50],customPoints:false,animations:true,rotation:false,rotationSeconds:20,reveal:false,sharedWinners:false,tieWinner:''});
  expect(s).not.toHaveProperty('finalTotals');expect(s).not.toHaveProperty('finishedAt');
  for(const scores of Object.values(s.byActivity))expect(scores).toEqual({IMT:0,IIS:0,IIT:0});
  expect((await db.query('select * from public.teams')).rows).toHaveLength(0);
  expect((await db.query('select * from public.score_events')).rows).toHaveLength(0);
 }
 async function play(){
  const t=await command('team',{name:'Ensayo repetible',career:'IMT',members:['A','B','C','D'],activities:all,active:true});
  await command('settings',{status:'running'});
  await command('score',{operationId:crypto.randomUUID(),teamId:t.id,activity:'pingpong',points:20},judges[0]);
  return t.id;
 }
 it('reinicia tras finalizar y revelar; restaura cada opción y conserva cuentas, asignaciones y auditoría',async()=>{
  const beforeAccounts=await accounts(),before=await state(),audit=(await db.query('select * from public.admin_audit order by id')).rows;
  expect(before.reveal).toBe(true);expect(before).toHaveProperty('finalTotals');
  await command('settings',{animations:false,rotation:true,rotationSeconds:90,customPoints:true,presets:[7]});
  const revision=(await state()).revision;
  await manage();await clean();expect((await state()).revision).toBe(revision+1);
  expect(await accounts()).toEqual(beforeAccounts);
  expect(beforeAccounts.users).toHaveLength(10);expect(beforeAccounts.slots).toHaveLength(9);
  const afterAudit=(await db.query('select * from public.admin_audit order by id')).rows;
  expect(afterAudit).toEqual(expect.arrayContaining(audit));expect(afterAudit.length).toBeGreaterThan(audit.length);
 });
 it('reinicia antes del inicio y permite reinicios consecutivos con revisión creciente',async()=>{
  const revision=(await state()).revision;await manage();await manage();await clean();expect((await state()).revision).toBe(revision+2);
 });
 it('reinicia con equipos, puntuaciones, ajustes y anulaciones',async()=>{
  const teamId=await play(),operationId=crypto.randomUUID();
  await command('adjust',{operationId,teamId,activity:'pingpong',points:5,reason:'Corrección de ensayo'});
  await command('reverse',{operationId:crypto.randomUUID(),eventId:operationId,reason:'Anulación de ensayo'});
  await manage();await clean();
 });
 it('reinicia después de finalizar sin revelar y permite comenzar otra práctica inmediatamente',async()=>{
  await play();await command('settings',{status:'finished'});expect((await state()).reveal).toBe(false);
  await manage();await clean();await play();expect((await state()).totals.IMT).toBe(20);await manage();
 });
 it('rechaza jueces, desconocidos y administrador deshabilitado sin alterar el estado',async()=>{
  const before=await state();
  for(const actor of [...judges,user(99)])await expect(manage('reset_practice',actor)).rejects.toThrow(/administrador/);
  await db.query('update public.users set enabled=false where id=$1',[admin]);
  try{await expect(manage()).rejects.toThrow(/administrador/);}finally{await db.query('update public.users set enabled=true where id=$1',[admin]);}
  expect(await state()).toEqual(before);
 });
 it('cierra RPC antiguo, RPC nuevo, recibos y escrituras directas a todos los clientes',async()=>{
  expect((await db.query("select to_regprocedure('public.manage_practice(uuid,text)') as f")).rows[0]).toEqual({f:null});
  for(const name of ['anon','authenticated'] as const){
   await expect(role(name,admin,tx=>tx.query("select public.manage_practice($1,'reset_practice',$2,0)",[admin,crypto.randomUUID()]))).rejects.toThrow(/permission denied/);
   for(const table of ['practice_requests','admin_audit'])await expect(role(name,admin,tx=>tx.query('select * from public.'+table))).rejects.toThrow(/permission denied/);
  }
 });
 it('valida acción, UUID y revisión incluso si se invoca directamente por servicio',async()=>{
  const before=await state();
  for(const args of [[admin,null,crypto.randomUUID(),before.revision],[admin,'bad',crypto.randomUUID(),before.revision],[admin,'reset_practice',null,before.revision],[admin,'reset_practice',crypto.randomUUID(),null],[admin,'reset_practice',crypto.randomUUID(),-1]]){
   await expect(rpc('manage_practice',args,['uuid','text','uuid','bigint'])).rejects.toThrow();
  }
  expect(await state()).toEqual(before);
 });
 it('un doble envío usa un único recibo y no borra datos registrados tras la primera respuesta',async()=>{
  const id=crypto.randomUUID(),revision=(await state()).revision;
  const results=await Promise.all([manage('reset_practice',admin,id,revision),manage('reset_practice',admin,id,revision)]);
  expect(results.filter(r=>r.duplicate)).toHaveLength(1);expect((await state()).revision).toBe(revision+1);
  await play();const before=await state();expect((await manage('reset_practice',admin,id,revision)).duplicate).toBe(true);expect(await state()).toEqual(before);
  await expect(manage('start_official',admin,id,revision)).rejects.toThrow(/reutilizado/);
  await expect(manage('reset_practice',admin,id,revision+1)).rejects.toThrow(/reutilizado/);
  await manage();
 });
 it('solo acepta una de dos confirmaciones simultáneas distintas (PGlite serializa transacciones)',async()=>{
  const revision=(await state()).revision;
  const results=await Promise.allSettled([manage('reset_practice',admin,crypto.randomUUID(),revision),manage('reset_practice',admin,crypto.randomUUID(),revision)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect((await state()).revision).toBe(revision+1);
 });
 it('rechaza una confirmación obsoleta si otro juez puntúa mientras se revisa',async()=>{
  const teamId=await play(),revision=(await state()).revision;
  await command('score',{operationId:crypto.randomUUID(),teamId,activity:'pingpong',points:5},judges[0]);
  const before=await state();await expect(manage('reset_practice',admin,crypto.randomUUID(),revision)).rejects.toThrow(/cambió/);expect(await state()).toEqual(before);await manage();
 });
 it.each([true,false])('serializa puntuación frente a reinicio, puntuación primero=%s',async scoreFirst=>{
  const teamId=await play(),revision=(await state()).revision;
  const score=()=>command('score',{operationId:crypto.randomUUID(),teamId,activity:'pingpong',points:5},judges[0]);
  const reset=()=>manage('reset_practice',admin,crypto.randomUUID(),revision);
  const results=await Promise.allSettled(scoreFirst?[score(),reset()]:[reset(),score()]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  if(scoreFirst){expect((await state()).totals.IMT).toBe(25);await manage();}else await clean();
 });
 it('una alta o edición de equipo también invalida la confirmación anterior',async()=>{
  const revision=(await state()).revision;
  await command('team',{name:'Equipo recién registrado',career:'IIS',members:['A','B','C','D'],activities:all,active:true});
  await expect(manage('reset_practice',admin,crypto.randomUUID(),revision)).rejects.toThrow(/cambió/);
  expect((await db.query('select * from public.teams')).rows).toHaveLength(1);await manage();
 });
 it('revierte todo el reinicio si falla su auditoría',async()=>{
  await play();const before=await state(),rows=(await db.query('select * from public.score_events')).rows;
  await db.exec("create function public.test_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'auditoria indisponible'; end; $$; create trigger test_fail before insert on public.admin_audit for each row execute function public.test_fail_audit();");
  try{await expect(manage()).rejects.toThrow(/auditoria/);expect(await state()).toEqual(before);expect((await db.query('select * from public.score_events')).rows).toEqual(rows);expect((await db.query('select * from public.teams')).rows).toHaveLength(1);}
  finally{await db.exec('drop trigger test_fail on public.admin_audit;drop function public.test_fail_audit();');}
  await manage();
 });
 let officialId:string,officialRevision:number;
 it('activa el oficial desde una práctica revelada y conserva las diez cuentas y permisos',async()=>{
  await play();await command('settings',{status:'finished'});await command('settings',{reveal:true});const before=await accounts();
  officialId=crypto.randomUUID();officialRevision=(await state()).revision;
  expect(await manage('start_official',admin,officialId,officialRevision)).toMatchObject({ok:true,phase:'official',revision:officialRevision+1});
  const s=await state();expect(s.status).toBe('not_started');expect(s.totals).toEqual({IMT:0,IIS:0,IIT:0});expect(s.reveal).toBe(false);expect(s).not.toHaveProperty('finalTotals');expect(s).not.toHaveProperty('finishedAt');expect(await accounts()).toEqual(before);
  expect((await db.query('select * from public.teams')).rows).toHaveLength(0);expect((await db.query('select * from public.score_events')).rows).toHaveLength(0);
 });
 it('impide reiniciar el oficial y cambiar su fase mediante settings o escrituras SQL',async()=>{
  const before=await state();
  await expect(manage()).rejects.toThrow(/oficial/);await expect(manage('start_official')).rejects.toThrow(/oficial/);
  await expect(command('settings',{phase:'practice'})).rejects.toThrow(/Sin cambios/);
  for(const expr of ["jsonb_set(data,'{phase}','\"practice\"')","data-'phase'","jsonb_set(data,'{phase}','null')"]){
   await expect(db.exec("update public.public_state set data="+expr+" where id='state'")).rejects.toThrow(/oficial/);
  }
  for(const sql of ["delete from public.public_state","truncate public.public_state","insert into public.public_state values('state','{}',now())"]){
   await expect(role('service_role',admin,tx=>tx.exec(sql))).rejects.toThrow(/permission denied/);
  }
  expect(await state()).toEqual(before);
 });
 it('permite puntuación normal de los nueve jueces durante el evento oficial',async()=>{
  const teamId=await play();
  await Promise.all(judges.map((actor,i)=>command('score',{operationId:crypto.randomUUID(),teamId,activity:all[i%4],points:5},actor)));
  expect((await state()).totals.IMT).toBe(65);expect((await state()).phase).toBe('official');
  const before=await state();expect((await manage('start_official',admin,officialId,officialRevision)).duplicate).toBe(true);expect(await state()).toEqual(before);
 });
 it('congela resultados oficiales y mantiene bloqueado el reinicio tras revelar',async()=>{
  await command('settings',{status:'finished'});await command('settings',{reveal:true});const before=await state();
  for(const action of ['score','adjust','reverse'])await expect(command(action,{operationId:crypto.randomUUID()})).rejects.toThrow(/congelados/);
  await expect(command('settings',{status:'running'})).rejects.toThrow(/Transición/);await expect(manage()).rejects.toThrow(/oficial/);expect(await state()).toEqual(before);
 });
});
