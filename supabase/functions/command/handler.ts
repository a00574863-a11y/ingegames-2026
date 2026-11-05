// Dependency-injected handler: the same source runs on Deno and in unit tests.
type Client = {
 auth:{getUser:(token:string)=>Promise<any>;admin:{updateUserById:(id:string,attributes:Record<string,unknown>)=>Promise<any>}};
 rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>;
};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const activities=['pingpong','futbolito','videojuegos','mesa'];
export function createHandler(client:Client){return async(request:Request)=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST')return response(405,{error:'Método no permitido.'});
 let reservation:{slot:number;token:string}|undefined;
 try{
  const bearer=request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if(!bearer)return response(401,{error:'Inicia sesión.'});
  const {data:identity,error:authError}=await client.auth.getUser(bearer);
  if(authError||!identity?.user)return response(401,{error:'Sesión inválida. Inicia sesión de nuevo.'});
  const raw=await request.text();if(new TextEncoder().encode(raw).length>24000)return response(413,{error:'Solicitud demasiado grande.'});
  let payload:Record<string,any>;try{payload=JSON.parse(raw);}catch{return response(400,{error:'JSON inválido.'});}
  if(!payload||Array.isArray(payload)||typeof payload!=='object')return response(400,{error:'Solicitud inválida.'});
  const {action,...input}=payload;
  if(!['judge','team','score','adjust','reverse','settings','reset_practice','start_official'].includes(action))return response(400,{error:'Acción desconocida.'});
  // No caller-supplied identity is ever forwarded as p_actor.
  const actor=identity.user.id;
  if(action==='judge'){
   const {slot,name,email,password,enabled}=input;
   if(!Number.isInteger(slot)||slot<1||slot>9||typeof name!=='string'||!name.trim()||name.trim().length>100||typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||typeof enabled!=='boolean'||!Array.isArray(input.activities)||!input.activities.length||input.activities.some((a:unknown)=>!activities.includes(a as string))||new Set(input.activities).size!==input.activities.length)return response(400,{error:'Datos del juez inválidos.'});
   if(password!==undefined&&password!==''&&(typeof password!=='string'||password.length<12||password.length>128))return response(400,{error:'Usa una contraseña de entre 12 y 128 caracteres.'});
   const {data:lease,error:leaseError}=await client.rpc('prepare_judge',{p_actor:actor,p_slot:slot});
   if(leaseError)return response(400,{error:leaseError.message});
   reservation={slot,token:lease.token};
   const {error:updateError}=await client.auth.admin.updateUserById(lease.uid,{email:email.trim().toLowerCase(),email_confirm:true,ban_duration:enabled?'none':'876000h',user_metadata:{name:name.trim()},...(password?{password}:{})});
   if(updateError)return response(400,{error:'No se pudo actualizar la cuenta. El juez permanece deshabilitado; revisa el correo e inténtalo de nuevo.'});
   const {data,error}=await client.rpc('finish_judge',{p_actor:actor,p_slot:slot,p_token:lease.token,p_payload:{name:name.trim(),email:email.trim().toLowerCase(),enabled,activities:input.activities}});
   if(error)return response(400,{error:error.message});reservation=undefined;return response(200,data);
  }
  const practiceAction = action === 'reset_practice' || action === 'start_official';
  if(practiceAction&&(typeof input.operationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0))return response(400,{error:'Falta ID de operación o revisión válida. Actualiza el panel y vuelve a confirmar.'});
  const {data,error}=practiceAction
  ? await client.rpc('manage_practice',{p_actor:actor,p_action:action,p_operation_id:input.operationId,p_expected_revision:input.expectedRevision})
  : await client.rpc('command',{p_actor:actor,p_action:action,p_payload:input});
  if(error)return response(400,{error:error.message});return response(200,data);
 }catch{return response(500,{error:'No se pudo confirmar la operación. Reintenta con el mismo ID.'});}
 finally{if(reservation)await client.rpc('cancel_judge',{p_slot:reservation.slot,p_token:reservation.token}).then(()=>undefined,()=>undefined);}
};}
