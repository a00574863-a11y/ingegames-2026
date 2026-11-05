import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';

// PGlite has no native safeupdate library. This statement-trigger test double
// reproduces its WHERE-less DELETE rejection (message and SQLSTATE 21000),
// inspecting the active RPC definition before either table can be changed.
// It is local-only, not a claim that the native extension was run here.
let db:PGlite,oldSource:string,oldSecurity:unknown;
const admin='10000000-0000-4000-8000-000000000001';
const path='supabase/migrations/';
const migrations=['202611040001_ingegames.sql','202611040002_modo_practica.sql','202611040003_reinicio_practica.sql','202611040004_practica_segura.sql'];
const definition=async()=>(await db.query<{prosrc:string}>("select prosrc from pg_proc where oid='public.manage_practice(uuid,text,uuid,bigint)'::regprocedure")).rows[0].prosrc;
const security=async()=>(await db.query("select prosecdef,proconfig,proacl::text from pg_proc where oid='public.manage_practice(uuid,text,uuid,bigint)'::regprocedure")).rows;
const state=async()=>(await db.query<{data:any}>('select data from public.public_state')).rows[0].data;
const cmd=async(action:string,payload:unknown)=>(await db.query<{r:any}>('select public.command($1,$2,$3) r',[admin,action,JSON.stringify(payload)])).rows[0].r;
const reset=async(action='reset_practice',id=crypto.randomUUID(),revision?:number)=>(await db.query<{r:any}>('select public.manage_practice($1,$2,$3,$4) r',[admin,action,id,revision??(await state()).revision])).rows[0].r;
async function snapshot(){
 const result:Record<string,unknown>={};
 for(const table of ['auth.users','public.users','public.judge_slots','public.teams','public.score_events','public.admin_audit','public.practice_requests','public.public_state'])result[table]=(await db.query('select * from '+table+' order by id')).rows;
 return result;
}
async function play(){
 const team=await cmd('team',{name:'Práctica con anulaciones',career:'IMT',members:['A','B','C','D'],activities:['pingpong'],active:true});
 await cmd('settings',{status:'running'});
 const score=crypto.randomUUID();
 await cmd('score',{operationId:score,teamId:team.id,activity:'pingpong',points:20});
 await cmd('adjust',{operationId:crypto.randomUUID(),teamId:team.id,activity:'pingpong',points:5,reason:'Ajuste local'});
 await cmd('reverse',{operationId:crypto.randomUUID(),eventId:score,reason:'Anulación local'});
 await cmd('settings',{status:'finished'});await cmd('settings',{reveal:true});
}
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create table auth.users(id uuid primary key,email text,encrypted_password text);
  create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
 for(const migration of migrations)await db.exec(readFileSync(path+migration,'utf8'));
 for(let i=1;i<=10;i++){
  const id=`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
  await db.query('insert into auth.users values($1,$2,$3)',[id,`fixture${i}@test.invalid`,`fixture-hash-${i}`]);
  await db.query('insert into public.users(id,name,role,enabled,activities,slot) values($1,$2,$3,true,$4,$5)',[id,`Cuenta ${i}`,i===1?'admin':'judge',['pingpong'],i===1?null:i-1]);
  if(i>1)await db.query('update public.judge_slots set uid=$1,email=$2,activities=$3,enabled=true where id=$4',[id,`fixture${i}@test.invalid`,['pingpong'],i-1]);
 }
 oldSource=await definition();oldSecurity=await security();
 await db.exec(`create function public.test_safeupdate_delete() returns trigger language plpgsql as $$
  declare source text;
  begin
   select prosrc into source from pg_proc where oid='public.manage_practice(uuid,text,uuid,bigint)'::regprocedure;
   if source ~* ('DELETE[[:space:]]+FROM[[:space:]]+public[.]'||TG_TABLE_NAME||'[[:space:]]*;') then
    raise exception using message='DELETE requires a WHERE clause',errcode='21000';
   end if;
   return null;
  end;$$;
  create trigger test_safeupdate before delete on public.score_events for each statement execute function public.test_safeupdate_delete();
  create trigger test_safeupdate before delete on public.teams for each statement execute function public.test_safeupdate_delete();`);
 await play();
},60000);
afterAll(async()=>{await db?.close();});

it('reproduce localmente el error de safeupdate en la 004 sin cambios parciales',async()=>{
 const before=await snapshot();
 expect(oldSource).toContain('DELETE FROM public.score_events;');
 expect(oldSource).toContain('DELETE FROM public.teams;');
 await expect(reset()).rejects.toMatchObject({message:'DELETE requires a WHERE clause',code:'21000'});
 expect(await snapshot()).toEqual(before);
});
it('005 solo cambia los dos DELETE y conserva datos, privilegios y todas las protecciones',async()=>{
 const before=await snapshot();
 await db.exec(readFileSync(path+'202611040005_fix_reset_delete.sql','utf8'));
 expect(await snapshot()).toEqual(before);expect(await security()).toEqual(oldSecurity);
 expect(await definition()).toBe(oldSource.replace('DELETE FROM public.score_events;','DELETE FROM public.score_events WHERE id IS NOT NULL;').replace('DELETE FROM public.teams;','DELETE FROM public.teams WHERE id IS NOT NULL;'));
});
it('reinicia una práctica revelada con ajustes y referencias de anulación sin tocar cuentas',async()=>{
 const before=await snapshot(),revision=(await state()).revision,id=crypto.randomUUID();
 expect(await reset('reset_practice',id,revision)).toMatchObject({ok:true,phase:'practice',revision:revision+1});
 const after=await snapshot();
 for(const table of ['auth.users','public.users','public.judge_slots'])expect(after[table]).toEqual(before[table]);
 expect(after['auth.users']).toHaveLength(10);expect(after['public.teams']).toEqual([]);expect(after['public.score_events']).toEqual([]);
 expect(after['public.admin_audit']).toEqual(expect.arrayContaining(before['public.admin_audit'] as unknown[]));
 expect(after['public.practice_requests']).toHaveLength(1);
 expect(await state()).toMatchObject({status:'not_started',phase:'practice',reveal:false,revision:revision+1,totals:{IMT:0,IIS:0,IIT:0}});
 expect(await state()).not.toHaveProperty('finalTotals');expect(await state()).not.toHaveProperty('finishedAt');
 expect(await reset('reset_practice',id,revision)).toMatchObject({duplicate:true});expect(await snapshot()).toEqual(after);
});
it('la misma corrección permite preparar el oficial y mantiene prohibidos sus reinicios',async()=>{
 await play();const before=await snapshot();
 expect(await reset('start_official')).toMatchObject({ok:true,phase:'official'});
 const after=await snapshot();
 for(const table of ['auth.users','public.users','public.judge_slots'])expect(after[table]).toEqual(before[table]);
 expect(after['public.teams']).toEqual([]);expect(after['public.score_events']).toEqual([]);
 expect(await state()).toMatchObject({phase:'official',status:'not_started',reveal:false});
 expect(after['public.practice_requests']).toHaveLength(2);
 await expect(reset()).rejects.toThrow(/oficial/);expect(await snapshot()).toEqual(after);
});
