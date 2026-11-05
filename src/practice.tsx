import {RotateCcw,Trophy} from 'lucide-react';
import type {State} from './domain';
import {command} from './supabase';

export type Confirmation = {label:string;run:()=>Promise<unknown>;success?:string};
export function PhaseBanner({state,admin=false}:{state:State;admin?:boolean}){
 if(state.phase==='practice')return <div className="phase-banner practice" role="status"><strong>MODO PRÁCTICA</strong><span>Ensayo · Los resultados no son oficiales.</span></div>;
 if(admin)return <div className="phase-banner official"><strong>{state.phase==='official'?'EVENTO OFICIAL':'FASE SIN CONFIRMAR'}</strong><span>{state.phase==='official'?'Los reinicios están bloqueados definitivamente.':'Espera la actualización del servidor.'}</span></div>;
 return null;
}
export function PracticeControls({state,disabled,onConfirm}:{state:State;disabled:boolean;onConfirm:(c:Confirmation)=>void}){
 if(state.phase!=='practice')return null;
 function confirm(action:'reset_practice'|'start_official'){
  const payload={operationId:crypto.randomUUID(),expectedRevision:state.revision};
  onConfirm({
   label:action==='reset_practice'
    ?'REINICIAR PRÁCTICA: se eliminarán equipos, integrantes, puntos, historial y ganador de ensayo. Se restaurarán las opciones predeterminadas. Se conservarán las diez cuentas, contraseñas, permisos, asignaciones y auditoría privada. Podrás ensayar otra vez. ¿Confirmas?'
    :'COMENZAR EVENTO OFICIAL: se eliminarán equipos y resultados de práctica y se restaurarán las opciones predeterminadas. Se conservarán las diez cuentas, contraseñas, permisos, asignaciones y auditoría privada. El cambio es irreversible: no podrás volver a práctica ni reiniciar. Después registra los equipos e inicia el torneo oficial. ¿Confirmas?',
   run:()=>command(action,payload),
   success:action==='reset_practice'?'Práctica reiniciada. Puedes registrar equipos y comenzar otro ensayo.':'Evento oficial preparado. Registra los equipos e inicia el torneo; los reinicios quedaron bloqueados.'
  });
 }
 return <><button className="danger" disabled={disabled} onClick={()=>confirm('reset_practice')}><RotateCcw size={18}/>REINICIAR PRÁCTICA</button><button className="primary" disabled={disabled} onClick={()=>confirm('start_official')}><Trophy size={18}/>COMENZAR EVENTO OFICIAL</button></>;
}
