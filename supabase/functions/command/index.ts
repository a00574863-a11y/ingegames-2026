import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {createHandler} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL');
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}') as Record<string,string>;
const secret=secretKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Object.values(secretKeys)[0];
if(!url||!secret)throw new Error('Falta la configuración de servidor de Supabase.');
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createHandler(admin));
