import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';

let db:PGlite,legacy:string,legacySnapshot:unknown;
const admin='10000000-0000-4000-8000-000000000001',judge='10000000-0000-4000-8000-000000000002';
const all=['pingpong','futbolito','videojuegos','mesa'];
const cmd=async(action:string,payload:unknown,actor=admin)=>(await db.query<{r:any}>('select public.command($1,$2,$3) r',[actor,action,JSON.stringify(payload)])).rows[0].r;
const state=async()=>(await db.query<{data:any}>('select data from public.public_state')).rows[0].data;
const team=async(id:string)=>(await db.query<{members:string[];points:number}>('select members,points from public.teams where id=$1',[id])).rows[0];
const members=(count:number)=>Array.from({length:count},(_,i)=>`Persona ${i+1}`);
async function snapshot(){const result:Record<string,unknown>={};for(const table of ['auth.users','public.users','public.judge_slots','public.teams','public.score_events','public.admin_audit','public.practice_requests','public.public_state'])result[table]=(await db.query('select * from '+table+' order by id')).rows;return result;}
async function identities(){return {auth:(await db.query('select * from auth.users order by id')).rows,users:(await db.query('select * from public.users order by id')).rows,slots:(await db.query('select * from public.judge_slots order by id')).rows};}
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const file of ['202611040001_ingegames.sql','202611040002_modo_practica.sql','202611040003_reinicio_practica.sql','202611040004_practica_segura.sql','202611040005_fix_reset_delete.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 for(let i=1;i<=10;i++){
  const id=`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
  await db.query('insert into auth.users values($1,$2)',[id,`fixture${i}@test.invalid`]);
  await db.query('insert into public.users(id,name,role,enabled,activities,slot) values($1,$2,$3,true,$4,$5)',[id,`Cuenta ${i}`,i===1?'admin':'judge',all,i===1?null:i-1]);
  if(i>1)await db.query('update public.judge_slots set uid=$1,activities=$2,enabled=true where id=$3',[id,all,i-1]);
 }
 legacy=(await cmd('team',{name:'Equipo existente',career:'IMT',members:members(4),activities:all,active:true})).id;
 await cmd('settings',{status:'running'});await cmd('score',{operationId:crypto.randomUUID(),teamId:legacy,activity:'pingpong',points:20},judge);
 legacySnapshot=await snapshot();
 await db.exec(readFileSync('supabase/migrations/202611040006_equipos_flexibles.sql','utf8'));
},60000);
afterAll(async()=>{await db?.close();});
it('actualiza desde 005 sin modificar equipos de cuatro integrantes, puntuaciones ni cuentas',async()=>{
 expect(await snapshot()).toEqual(legacySnapshot);expect(await team(legacy)).toEqual({members:members(4),points:20});
});
it.each([1,2,3,4])('registra %i integrantes, muestra el equipo al juez y suma exactamente 20 puntos',async count=>{
 const before=await state(),id=(await cmd('team',{name:`Equipo de ${count}`,career:'IIS',members:members(count),activities:all,active:true})).id;
 await cmd('score',{operationId:crypto.randomUUID(),teamId:id,activity:'pingpong',points:20},judge);
 expect(await team(id)).toEqual({members:members(count),points:20});
 const after=await state();expect(after.totals.IIS).toBe(before.totals.IIS+20);expect(after.byActivity.pingpong.IIS).toBe(before.byActivity.pingpong.IIS+20);
 expect((await db.query('select points from public.score_events where team_id=$1',[id])).rows).toEqual([{points:20}]);
 expect(after.recent[0]).toMatchObject({career:'IIS',points:20});
 const visible=await db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[judge]);return tx.query('select members from public.teams where id=$1',[id]);});
 expect(visible.rows).toEqual([{members:members(count)}]);
});
it.each([[],members(5),[''],['Ana',' '],['Ana',''],['Ana',null],['Ana',' ana '],['A'.repeat(101)],['\t\n']].map(people=>({people})))('rechaza integrantes inválidos en RPC: $people',async({people})=>{
 const before=await snapshot();await expect(cmd('team',{name:'Inválido',career:'IIT',members:people,activities:all,active:true})).rejects.toThrow();expect(await snapshot()).toEqual(before);
});
it.each([[],members(5),[''],['Ana',' '],['Ana',null],['Ana',' ana '],['\t\n']].map(people=>({people})))('CHECK también rechaza arreglos inválidos en escritura directa: $people',async({people})=>{
 await expect(db.query("insert into public.teams(name,name_key,career,members,activities) values('Directo','directo','IIT',$1,$2)",[people,all])).rejects.toThrow(/constraint/);
});
it('edita el mismo equipo de 4 a 1, 2, 3 y 4 integrantes sin alterar puntos',async()=>{
 const before=await state();
 for(const count of [1,2,3,4]){
  await cmd('team',{id:legacy,name:'Equipo existente',career:'IMT',members:members(count),activities:all,active:true});
  expect(await team(legacy)).toEqual({members:members(count),points:20});
 }
 expect((await state()).totals).toEqual(before.totals);expect((await state()).byActivity).toEqual(before.byActivity);
 await expect(cmd('team',{id:legacy,name:'Equipo existente',career:'IMT',members:[],activities:all,active:true})).rejects.toThrow();expect((await team(legacy)).members).toEqual(members(4));
});
it('mantiene la unicidad de nombres de equipo y los permisos de registro',async()=>{
 await expect(cmd('team',{name:' equipo   existente ',career:'IMT',members:members(1),activities:all,active:true})).rejects.toThrow(/existe/);
 await expect(cmd('team',{name:'Equipo juez',career:'IMT',members:members(1),activities:all,active:true},judge)).rejects.toThrow(/administrador/);
});
it('el reinicio local limpia equipos de todos los tamaños y conserva las diez cuentas y asignaciones',async()=>{
 const before=await identities(),revision=(await state()).revision;
 await db.query("select public.manage_practice($1,'reset_practice',$2,$3)",[admin,crypto.randomUUID(),revision]);
 expect(await identities()).toEqual(before);expect(before.auth).toHaveLength(10);
 expect((await db.query('select * from public.teams')).rows).toEqual([]);expect((await db.query('select * from public.score_events')).rows).toEqual([]);
 expect(await state()).toMatchObject({phase:'practice',status:'not_started',totals:{IMT:0,IIS:0,IIT:0},revision:revision+1});
});
