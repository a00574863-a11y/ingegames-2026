import {afterEach,it,expect,vi} from 'vitest';
import {mapRow,watch} from '../src/supabase';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function fixture(){
 vi.useFakeTimers();const network={onLine:true};const events=new EventTarget();vi.stubGlobal('navigator',network);vi.stubGlobal('window',events);
 let change=()=>{},status=(_s:string)=>{};
 const channel={on:vi.fn((_event:unknown,_filter:unknown,fn:()=>void)=>{change=fn;return channel;}),subscribe:vi.fn((fn:(s:string)=>void)=>{status=fn;return channel;})};
 const client={channel:vi.fn(()=>channel),removeChannel:vi.fn(async()=>{})};
 return {client,events,network,change:()=>change(),status:(s:string)=>status(s)};
}
it('convierte filas SQL a los tipos usados por la interfaz y no conserva el payload interno',()=>{
 const row=mapRow({id:'score',judge_id:'judge',team_name:'Equipo',created_at:'2026-11-04T21:00:00Z',request_payload:{private:'internal'}});
 expect(row.judgeId).toBe('judge');expect(row.teamName).toBe('Equipo');expect(row.createdAt).toEqual({seconds:1793826000});expect(row).not.toHaveProperty('requestPayload');
 const slot=mapRow({id:2,uid:'judge-uid'});expect(slot.slot).toBe(2);expect(slot.id).toBe('2');
});
it('recupera cambios perdidos mediante polling y vuelve a leer al reconectar',async()=>{
 const f=fixture(),load=vi.fn(async()=>1),data=vi.fn(),connection=vi.fn();
 const stop=watch(f.client as any,'public_state',load,data,vi.fn(),connection);
 await vi.advanceTimersByTimeAsync(0);f.status('SUBSCRIBED');await vi.advanceTimersByTimeAsync(0);
 load.mockResolvedValue(2);await vi.advanceTimersByTimeAsync(15000);expect(data).toHaveBeenLastCalledWith(2);
 f.network.onLine=false;f.events.dispatchEvent(new Event('offline'));expect(connection).toHaveBeenLastCalledWith(false);
 f.network.onLine=true;load.mockResolvedValue(3);f.events.dispatchEvent(new Event('online'));await vi.advanceTimersByTimeAsync(0);expect(data).toHaveBeenLastCalledWith(3);stop();
});
it('serializa lecturas para que una respuesta anterior no sobrescriba la nueva',async()=>{
 const f=fixture();let resolveFirst:(n:number)=>void=()=>{};
 const load=vi.fn().mockImplementationOnce(()=>new Promise<number>(resolve=>{resolveFirst=resolve;})).mockResolvedValue(2),data=vi.fn();
 const stop=watch(f.client as any,'public_state',load,data,vi.fn());f.change();expect(load).toHaveBeenCalledTimes(1);
 resolveFirst(1);await vi.advanceTimersByTimeAsync(0);expect(data.mock.calls.map(c=>c[0])).toEqual([1,2]);stop();
});
it('marca fallo de sincronización sin fabricar resultados',async()=>{
 const f=fixture(),load=vi.fn(async()=>{throw new Error('Red interrumpida');}),data=vi.fn(),error=vi.fn(),connection=vi.fn();
 const stop=watch(f.client as any,'public_state',load,data,error,connection);await vi.advanceTimersByTimeAsync(0);
 expect(data).not.toHaveBeenCalled();expect(error).toHaveBeenCalled();expect(connection).toHaveBeenLastCalledWith(false);stop();
});
it('ignora respuestas tardías tras desmontar y elimina el canal y el polling',async()=>{
 const f=fixture();let finish:(n:number)=>void=()=>{};const data=vi.fn();
 const stop=watch(f.client as any,'public_state',()=>new Promise<number>(resolve=>{finish=resolve;}),data,vi.fn());stop();finish(1);await vi.advanceTimersByTimeAsync(0);
 expect(data).not.toHaveBeenCalled();expect(f.client.removeChannel).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
