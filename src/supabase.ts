import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {Profile,State} from './domain';
const env=import.meta.env;
export const configured=!!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
if (env.VITE_SUPABASE_PUBLISHABLE_KEY&&!env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) throw new Error('Usa exclusivamente la clave Supabase publishable en el navegador.');
export const supabase=configured?createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}):null;
export const auth=supabase?.auth??null;

export async function command(action:string,payload:Record<string,unknown>={}) {
 if(!supabase)throw new Error('Configura Supabase para continuar.');
 if(!navigator.onLine)throw new Error('SIN CONEXIÓN — NO SE HA REGISTRADO EL PUNTAJE');
 const {data,error}=await supabase.functions.invoke('command',{body:{action,...payload},timeout:25000});
 if(error){
  const context=(error as {context?:Response}).context;
  const detail=context?await context.clone().json().catch(()=>null):null;
  throw new Error(detail?.error || error.message || 'No se pudo confirmar la operación.');
 }
 if(!data?.ok)throw new Error('El backend no confirmó la operación.');
 return data;
}
export async function readState():Promise<State>{
 const {data,error}=await supabase!.from('public_state').select('data').eq('id','state').single();
 if(error)throw new Error(error.message);return data.data as State;
}
export async function readProfile(id:string):Promise<Profile|null>{
 const {data,error}=await supabase!.from('users').select('id,name,role,enabled,activities').eq('id',id).maybeSingle();
 if(error)throw new Error(error.message);return data as Profile|null;
}
export const TABLES:Record<string,string>={teams:'teams',scoreEvents:'score_events',judgeSlots:'judge_slots'};
export function mapRow(row:Record<string,unknown>){
 const result:Record<string,unknown>={};
 for(const [key,value] of Object.entries(row)){
  if(key==='request_payload')continue;
  const camel=key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());
  result[camel]=key==='created_at'?{seconds:Math.floor(new Date(String(value)).getTime()/1000)}:value;
 }
 if('uid' in row){result.slot=row.id;result.id=String(row.id);}
 return result;
}
export async function readRows<T>(path:string,profile:Profile):Promise<T[]>{
 const table=TABLES[path];if(!table)throw new Error('Colección desconocida.');
 let request=supabase!.from(table).select('*');
 if(profile.role!=='admin')request=path==='teams'?request.overlaps('activities',profile.activities):request.eq('judge_id',profile.id);
 // PostgREST defaults to 1000 rows. Fetch every page so CSV/history stay complete.
 const result:T[]=[];
 const ordered=request.order('id',{ascending:true});
 for(let offset=0;;offset+=500){const {data,error}=await ordered.range(offset,offset+499);if(error)throw new Error(error.message);result.push(...data.map(row=>mapRow(row) as T));if(data.length<500)break;}
 return result;
}
/** Refetch after every subscription/reconnect. A serialized loader prevents old
 * responses from overwriting a newer score. Polling repairs missed events. */
export function watch<T>(client:SupabaseClient,table:string,load:()=>Promise<T>,onData:(data:T)=>void,onError:(error:Error)=>void,onStatus?:(realtime:boolean)=>void,filter?:string){
 let disposed=false,running=false,again=false,connected=false;
 async function refresh(){
  if(disposed)return;if(running){again=true;return;}running=true;
  do{again=false;try{const value=await load();if(!disposed){onData(value);onStatus?.(connected&&navigator.onLine);}}catch(e){if(!disposed){onError(e instanceof Error?e:new Error('Sin sincronización'));onStatus?.(false);}}}while(again&&!disposed);
  running=false;
 }
 const channel=client.channel(`${table}-${crypto.randomUUID()}`).on('postgres_changes',{event:'*',schema:'public',table,...(filter?{filter}:{})},()=>void refresh()).subscribe(status=>{
  connected=status==='SUBSCRIBED';if(!disposed)onStatus?.(connected&&navigator.onLine);if(connected)void refresh();
 });
 const offline=()=>onStatus?.(false),online=()=>void refresh();
 window.addEventListener('offline',offline);window.addEventListener('online',online);
 const timer=setInterval(()=>void refresh(),15000);void refresh();
 return()=>{disposed=true;clearInterval(timer);window.removeEventListener('offline',offline);window.removeEventListener('online',online);void client.removeChannel(channel);};
}
