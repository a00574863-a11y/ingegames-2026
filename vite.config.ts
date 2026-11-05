import { defineConfig,loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'VITE_');
 const key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
 if(key&&!key.startsWith('sb_publishable_'))throw new Error('El frontend solo acepta una clave Supabase publishable. Nunca uses una clave secreta o service_role.');
 return {plugins:[react(),tailwindcss()],base:env.VITE_BASE_PATH || '/ingegames-2026/'};
});
