import {it,expect,vi} from 'vitest';
import {createHandler} from '../supabase/functions/command/handler';
function fixture(){const rpc=vi.fn(async(name:string)=>({data:name==='prepare_judge'?{uid:'judge-uid',token:'lease-token'}:{ok:true},error:null}));const client={auth:{getUser:vi.fn(async()=>({data:{user:{id:'verified-user'}},error:null})),admin:{updateUserById:vi.fn(async()=>({error:null}))}},rpc};return {client,handler:createHandler(client)};}
const request=(body:unknown,token=true)=>new Request('https://test.invalid/functions/v1/command',{method:'POST',headers:{...(token?{Authorization:'Bearer verified-jwt'}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});
it.each([
 {apikey:'sb_publishable_test'},
 {Authorization:'Basic invalid',apikey:'sb_publishable_test'},
 {Authorization:'Bearer ',apikey:'sb_publishable_test'},
])('rechaza solicitudes sin Bearer de usuario: %j',async headers=>{
 const {handler,client}=fixture();
 const req=new Request('https://test.invalid/functions/v1/command',{method:'POST',headers,body:JSON.stringify({action:'judge',slot:1})});
 expect((await handler(req)).status).toBe(401);
 expect(client.auth.getUser).not.toHaveBeenCalled();
 expect(client.rpc).not.toHaveBeenCalled();
 expect(client.auth.admin.updateUserById).not.toHaveBeenCalled();
});
it.each(['invalid-jwt','expired-jwt','sb_publishable_test'])('rechaza credenciales no autenticadas sin efectos: %s',async token=>{
 const {handler,client}=fixture();
 client.auth.getUser.mockResolvedValueOnce({data:{user:null} as any,error:new Error('Invalid session') as any});
 const req=request({action:'judge',slot:1});req.headers.set('Authorization',`Bearer ${token}`);
 expect((await handler(req)).status).toBe(401);
 expect(client.auth.getUser).toHaveBeenCalledWith(token);
 expect(client.rpc).not.toHaveBeenCalled();
 expect(client.auth.admin.updateUserById).not.toHaveBeenCalled();
});
it('rechaza falta de sesión antes de cualquier RPC',async()=>{const {handler,client}=fixture();expect((await handler(request({action:'score'},false))).status).toBe(401);expect(client.rpc).not.toHaveBeenCalled();});
it('valida la sesión con Auth y no acepta identidad suministrada por el navegador',async()=>{const {handler,client}=fixture();expect((await handler(request({action:'score',p_actor:'forged-admin',points:20}))).status).toBe(200);expect(client.auth.getUser).toHaveBeenCalledWith('verified-jwt');expect(client.rpc.mock.calls[0]).toEqual(['command',{p_actor:'verified-user',p_action:'score',p_payload:{p_actor:'forged-admin',points:20}}]);});
it('rechaza token inválido y acciones desconocidas',async()=>{const {handler,client}=fixture();client.auth.getUser.mockResolvedValueOnce({data:{user:null} as any,error:new Error('bad token') as any});expect((await handler(request({action:'score'}))).status).toBe(401);expect((await handler(request({action:'make-admin'}))).status).toBe(400);});
it('limita las cuentas de jueces a nueve',async()=>{const {handler,client}=fixture();expect((await handler(request({action:'judge',slot:10}))).status).toBe(400);expect(client.rpc).not.toHaveBeenCalled();});
it('actualiza Auth solo después de reservar y revocar el permiso del juez',async()=>{const {handler,client}=fixture();const result=await handler(request({action:'judge',slot:1,name:'Juez',email:'juez@test.invalid',password:'Example-Test-Password!',enabled:true,activities:['pingpong']}));expect(result.status).toBe(200);expect(client.rpc.mock.calls.map(c=>c[0])).toEqual(['prepare_judge','finish_judge']);expect(client.auth.admin.updateUserById).toHaveBeenCalledTimes(1);expect(JSON.stringify(client.rpc.mock.calls)).not.toContain('Example-Test-Password!');});
it('si Auth falla no restaura permisos y libera la reserva para reintentar',async()=>{const {handler,client}=fixture();client.auth.admin.updateUserById.mockResolvedValueOnce({error:new Error('error') as any});expect((await handler(request({action:'judge',slot:1,name:'Juez',email:'juez@test.invalid',enabled:false,activities:['mesa']}))).status).toBe(400);expect(client.rpc.mock.calls.map(c=>c[0])).toEqual(['prepare_judge','cancel_judge']);});
it('responde CORS y rechaza métodos o JSON inválidos',async()=>{const {handler}=fixture();expect((await handler(new Request('https://test.invalid',{method:'OPTIONS'}))).status).toBe(204);expect((await handler(new Request('https://test.invalid'))).status).toBe(405);expect((await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer token'},body:'bad json'}))).status).toBe(400);});
