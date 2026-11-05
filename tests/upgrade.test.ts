import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';

// Upgrade a populated, frozen installation, including Auth password-hash fixtures.
// No production connections and no bootstrap_accounts call.
it.each([1,3])('recupera una instalación existente en migración %i sin tocar cuentas',async installed=>{
 const db=new PGlite(),admin='10000000-0000-4000-8000-000000000001';
 const migrations=['202611040001_ingegames.sql','202611040002_modo_practica.sql','202611040003_reinicio_practica.sql','202611040004_practica_segura.sql'];
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,email text,encrypted_password text);
   create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
  for(const name of migrations.slice(0,installed))await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
  for(let i=1;i<=10;i++){
   const uid=`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
   await db.query('insert into auth.users values($1,$2,$3)',[uid,`fixture${i}@test.invalid`,`fixture-password-hash-${i}`]);
   await db.query('insert into public.users(id,name,role,enabled,activities,slot) values($1,$2,$3,true,$4,$5)',[uid,`Cuenta ${i}`,i===1?'admin':'judge',['pingpong'],i===1?null:i-1]);
   if(i>1)await db.query('update public.judge_slots set uid=$1,email=$2,name=$3,enabled=true,activities=$4 where id=$5',[uid,`fixture${i}@test.invalid`,`Cuenta ${i}`,['pingpong'],i-1]);
  }
  const cmd=async(action:string,payload:unknown)=>(await db.query<{result:any}>('select public.command($1,$2,$3) as result',[admin,action,JSON.stringify(payload)])).rows[0].result;
  const team=await cmd('team',{name:'Equipo existente',career:'IMT',members:['A','B','C','D'],activities:['pingpong'],active:true});
  await cmd('settings',{status:'running'});
  await cmd('score',{operationId:crypto.randomUUID(),teamId:team.id,activity:'pingpong',points:5});
  await cmd('settings',{status:'finished'});await cmd('settings',{reveal:true});
  async function snapshots(){const result:Record<string,unknown>={};for(const table of ['auth.users','public.users','public.judge_slots','public.admin_audit','public.teams','public.score_events'])result[table]=(await db.query('select * from '+table+' order by id')).rows;return result;}
  const before=await snapshots();
  for(const name of migrations.slice(installed))await db.transaction(tx=>tx.exec(readFileSync('supabase/migrations/'+name,'utf8')));
  expect(await snapshots()).toEqual(before);
  const s=(await db.query<{data:any}>('select data from public.public_state')).rows[0].data;
  expect(s).toMatchObject({phase:'practice',status:'finished',reveal:true,totals:{IMT:5,IIS:0,IIT:0}});
  await db.query("select public.manage_practice($1,'reset_practice',$2,$3)",[admin,crypto.randomUUID(),s.revision]);
  const after=await snapshots();
  for(const table of ['auth.users','public.users','public.judge_slots'])expect(after[table]).toEqual(before[table]);
  expect(after['auth.users']).toHaveLength(10);expect(after['public.teams']).toEqual([]);expect(after['public.score_events']).toEqual([]);
  const reset=(await db.query<{data:any}>('select data from public.public_state')).rows[0].data;
  expect(reset).toMatchObject({phase:'practice',status:'not_started',reveal:false,revision:s.revision+1});
  expect(reset).not.toHaveProperty('finalTotals');expect(reset).not.toHaveProperty('finishedAt');
 }finally{await db.close();}
},60000);
