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
});
