import {useState} from 'react';
import {motion} from 'framer-motion';
import type {Career} from './domain';

export type PublicTeam={id:string;name:string;career:Career;points:number};
export function teamRanking(teams:PublicTeam[],career:Career){
 const ordered=teams.filter(t=>t.career===career).sort((a,b)=>b.points-a.points||a.id.localeCompare(b.id));
 let rank=1;
 return ordered.map((team,i)=>{if(i===0||team.points!==ordered[i-1].points)rank=i+1;return {...team,rank};});
}
export function TeamRanking({teams,career,animated}:{teams:PublicTeam[];career:Career;animated:boolean}){
 const [expanded,setExpanded]=useState(false),rows=teamRanking(teams,career);
 return <section className="team-ranking" aria-label={`Ranking de equipos ${career}`}>
  <h3>RANKING DE EQUIPOS <span>{rows.length}</span></h3>
  <ol className={expanded?'expanded':''}>{rows.slice(0,expanded?undefined:5).map(t=><motion.li layout={animated?'position':false} transition={{duration:.35}} key={t.id} className={t.rank<=3?`podium podium-${t.rank}`:''}>
   <span className="team-position">{t.rank}</span><span className="team-name" title={t.name}>{t.name}</span><b>{t.points.toLocaleString('es-MX')} <small>pts</small></b>
  </motion.li>)}</ol>
  {!rows.length&&<p>Sin equipos registrados</p>}
  {rows.length>5&&<button aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'VER LOS PRIMEROS 5':`VER LOS ${rows.length} EQUIPOS`}</button>}
 </section>;
}
