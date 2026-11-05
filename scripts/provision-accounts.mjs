// Local trusted script. Never imported by Vite; never print passwords or keys.
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
const url=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error('Define SUPABASE_URL y SUPABASE_SECRET_KEY en esta terminal, nunca variables VITE_ para la clave secreta.');
const client=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const accounts=JSON.parse(raw.replace(/^\uFEFF/,''));
if(!Array.isArray(accounts)||accounts.length!==10||new Set(accounts.map(c=>c.email?.toLowerCase())).size!==10||accounts.some(c=>typeof c.name!=='string'||!c.name.trim()||typeof c.password!=='string'||c.password.length<16))throw new Error('Se requieren diez cuentas únicas y contraseñas de al menos 16 caracteres.');
const {data:profiles,error:profileError}=await client.from('users').select('id').limit(1);
if(profileError)throw new Error('Primero instala la migración SQL. '+profileError.message);
if(profiles.length)throw new Error('Las cuentas del evento ya están inicializadas. No se sobrescribirán.');
const batch=createHash('sha256').update(JSON.stringify(accounts.map(c=>c.email.toLowerCase()))).digest('hex');
const existing=[];
for(let page=1;;page++){const {data,error}=await client.auth.admin.listUsers({page,perPage:100});if(error)throw error;existing.push(...data.users);if(data.users.length<100)break;}
const prepared=[];
for(const account of accounts){
 const email=account.email.toLowerCase();let user=existing.find(u=>u.email?.toLowerCase()===email);
 if(user&&user.app_metadata?.ingegames_batch!==batch)throw new Error('Existe un correo del lote que no fue creado por este aprovisionador. No se modificará.');
 if(!user){const {data,error}=await client.auth.admin.createUser({email,password:account.password,email_confirm:true,user_metadata:{name:account.name},app_metadata:{ingegames_batch:batch},ban_duration:'876000h'});if(error)throw new Error('No se pudo crear una cuenta: '+error.message);user=data.user;}
 prepared.push({id:user.id,email,name:account.name});
}
// No profile exists yet: partially created Auth users cannot access private data.
// Unban all before the atomic profile commit so the operation is resumable.
for(const account of prepared){const {error}=await client.auth.admin.updateUserById(account.id,{ban_duration:'none'});if(error)throw error;}
const {error}=await client.rpc('bootstrap_accounts',{p_accounts:prepared});if(error)throw new Error(error.message);
console.log('Diez cuentas habilitadas: un administrador y nueve jueces. Contraseñas originales conservadas.');
