import {ACTIVITIES,CAREERS,COLORS,ranking,type Activity,type Career} from './domain';
import {teamRanking,type PublicTeam} from './team-ranking';
import {supabase} from './supabase';

type ReportEvent={id:string;team_id:string|null;team_name:string;career:Career;activity:Activity;points:number;judge_id:string;judge_name:string;created_at:string;kind:string;reason:string;reverses:string|null;reversed_by:string|null};
export type TournamentReport={sessionId:string;phase:'practice'|'official';finishedAt:string;totals:Record<Career,number>;byActivity:Record<Activity,Record<Career,number>>;teams:PublicTeam[];events:ReportEvent[]};
export function validateReport(report:TournamentReport){
 for(const c of CAREERS){
  if(report.events.filter(e=>e.career===c).reduce((n,e)=>n+e.points,0)!==report.totals[c])throw Error(`Los movimientos de ${c} no coinciden con el total definitivo. Contacta al administrador.`);
  for(const a of Object.keys(ACTIVITIES) as Activity[])if(report.events.filter(e=>e.career===c&&e.activity===a).reduce((n,e)=>n+e.points,0)!==report.byActivity[a][c])throw Error('Los puntos por actividad no coinciden con el cierre.');
 }
 for(const t of report.teams)if(report.events.filter(e=>e.team_id===t.id).reduce((n,e)=>n+e.points,0)!==t.points)throw Error(`Los movimientos del equipo ${t.name} no coinciden con su acumulado.`);
}
// Mexico City has no daylight-saving time. Store local wall time as a real Excel date.
const localDate=(iso:string)=>new Date(new Date(iso).getTime()-6*3600000);
export async function buildResultsWorkbook(report:TournamentReport){
 validateReport(report);
 const {default:ExcelJS}=await import('exceljs');
 const book=new ExcelJS.Workbook();book.creator='INGEGAMES 2026';book.created=new Date(report.finishedAt);
 const metadata=`${report.phase==='practice'?'PRÁCTICA':'OFICIAL'} · Sesión ${report.sessionId} · Cierre ${localDate(report.finishedAt).toISOString().slice(0,19).replace('T',' ')} · Hora de Ciudad de México`;
 function sheet(name:string,headers:string[],rows:(string|number|Date|null)[][]){
  const ws=book.addWorksheet(name,{views:[{state:'frozen',ySplit:4}],properties:{tabColor:{argb:'FF1677FF'}}});
  ws.mergeCells(1,1,1,headers.length);ws.getCell('A1').value='INGEGAMES 2026 · '+name;ws.getRow(1).height=32;
  ws.getCell('A1').font={name:'Calibri',size:18,bold:true,color:{argb:'FFFFFFFF'}};ws.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF101D35'}};
  ws.mergeCells(2,1,2,headers.length);ws.getCell('A2').value=metadata;ws.getCell('A2').alignment={wrapText:true,vertical:'middle'};ws.getRow(2).height=32;
  ws.getRow(4).values=headers;ws.getRow(4).height=30;
  ws.getRow(4).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF203C60'}};cell.alignment={wrapText:true,vertical:'middle'};});
  for(const values of rows){const row=ws.addRow(values);row.height=26;row.eachCell(cell=>{
   cell.font={name:'Calibri',size:11};cell.alignment={vertical:'middle',wrapText:true};
   if(typeof cell.value==='number')cell.numFmt='#,##0;[Red]-#,##0;0';
   if(cell.value instanceof Date)cell.numFmt='dd/mm/yyyy hh:mm:ss';
   if(CAREERS.includes(cell.value as Career)){cell.font={bold:true,color:{argb:'FF'+COLORS[cell.value as Career].slice(1)}};}
   else if(row.number%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F4F9'}};
  });}
  ws.autoFilter={from:{row:4,column:1},to:{row:Math.max(4,ws.rowCount),column:headers.length}};
  ws.columns.forEach((column,i)=>{column.width=Math.min(44,Math.max(18,headers[i].length+3,...rows.map(r=>r[i] instanceof Date?23:typeof r[i]==='string'?Math.min(44,String(r[i]).length+2):14)));});
  ws.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};ws.pageSetup.printTitlesRow='1:4';
  return ws;
 }
 sheet('RESUMEN GENERAL',['Carrera','Puntos totales','Posición'],ranking(report.totals).map(c=>[c,report.totals[c],1+CAREERS.filter(x=>report.totals[x]>report.totals[c]).length]));
 sheet('RANKING DE EQUIPOS',['Carrera','Posición','Equipo','Puntos aportados','Equipo ID'],CAREERS.flatMap(c=>teamRanking(report.teams,c).map(t=>[c,t.rank,t.name,t.points,t.id])));
 const activityRows:(string|number)[][]=[];
 for(const c of CAREERS){
  for(const [a,name] of Object.entries(ACTIVITIES)){
   for(const t of report.teams.filter(t=>t.career===c))activityRows.push([c,t.name,name,report.events.filter(e=>e.team_id===t.id&&e.activity===a).reduce((n,e)=>n+e.points,0),'Equipo']);
   const unassigned=report.events.filter(e=>e.career===c&&!e.team_id&&e.activity===a).reduce((n,e)=>n+e.points,0);
   if(unassigned)activityRows.push([c,'Sin equipo',name,unassigned,'Ajuste administrativo']);
   activityRows.push([c,'SUBTOTAL ACTIVIDAD',name,report.byActivity[a as Activity][c],'Subtotal']);
  }
  activityRows.push([c,'TOTAL CARRERA','Todas',report.totals[c],'Total']);
 }
 activityRows.push(['TODAS','TOTAL GENERAL','Todas',CAREERS.reduce((n,c)=>n+report.totals[c],0),'Total']);
 sheet('PUNTOS POR ACTIVIDAD',['Carrera','Equipo','Actividad','Puntos netos','Tipo de fila'],activityRows);
 const judgeRows:(string|number)[][]=[];
 for(const id of [...new Set(report.events.map(e=>e.judge_id))].sort()){
  const events=report.events.filter(e=>e.judge_id===id);
  for(const e of events)judgeRows.push([id,e.judge_name,ACTIVITIES[e.activity],e.team_name||'Sin equipo',e.career,e.points,e.kind==='adjustment'?'Ajuste administrativo':e.kind==='reversal'?'Anulación':'Puntuación',e.id]);
  judgeRows.push([id,events[0].judge_name,'TOTAL REGISTRADO','','',events.reduce((n,e)=>n+e.points,0),'Subtotal','']);
 }
 sheet('PUNTOS POR JUEZ',['Juez ID','Juez','Actividad','Equipo','Carrera','Puntos netos','Tipo de movimiento','Evento ID'],judgeRows);
 sheet('HISTORIAL COMPLETO',['Fecha y hora (CDMX)','Juez','Juego','Carrera','Equipo','Puntos','Tipo de movimiento','Evento ID','Anula evento','Anulado por','Motivo','Juez ID','Equipo ID'],report.events.map(e=>[localDate(e.created_at),e.judge_name,ACTIVITIES[e.activity],e.career,e.team_name||'Sin equipo',e.points,e.kind==='adjustment'?'Ajuste administrativo':e.kind==='reversal'?'Anulación':'Puntuación',e.id,e.reverses,e.reversed_by,e.reason,e.judge_id,e.team_id]));
 return book;
}
export async function downloadResults(sessionId:string){
 const {data,error}=await supabase!.rpc('tournament_report',{p_session_id:sessionId});
 if(error)throw Error(error.message);
 const report=data as TournamentReport,book=await buildResultsWorkbook(report),buffer=await book.xlsx.writeBuffer();
 const url=URL.createObjectURL(new Blob([new Uint8Array(buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const link=document.createElement('a');link.href=url;link.download=`INGEGAMES_2026_${report.phase==='practice'?'PRACTICA':'OFICIAL'}_Resultados_${report.finishedAt.replace(/[:.]/g,'-')}_${sessionId.slice(0,8)}.xlsx`;
 document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
