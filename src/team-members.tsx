import {useRef} from 'react';
import {MAX_TEAM_MEMBERS} from './domain';

function MemberField({index,name}:{index:number;name?:string}){
 const input=useRef<HTMLInputElement>(null);
 return <div><label htmlFor={`team-member-${index}`}>Integrante {index+1} {index===0?'(obligatorio)':'(opcional)'}</label><div className="member-field"><input ref={input} id={`team-member-${index}`} name={`member${index+1}`} required={index===0} maxLength={100} defaultValue={name??''}/>{index>0&&<button type="button" aria-label={`Quitar integrante ${index+1}`} onClick={()=>{if(input.current){input.current.value='';input.current.focus();}}}>Quitar</button>}</div></div>;
}
export function TeamMembersFields({members=[]}:{members?:string[]}){
 return <div className="team-member-fields"><p><strong>De 1 a 4 integrantes</strong><br/><small>Solo el integrante 1 es obligatorio. Completa los opcionales para agregar personas o pulsa Quitar para retirarlas.</small></p>{Array.from({length:MAX_TEAM_MEMBERS},(_,index)=><MemberField key={index} index={index} name={members[index]}/>)}</div>;
}
export function TeamMembersList({members}:{members:string[]}){
 const registered=members.map(name=>name.trim()).filter(Boolean);
 return <p className="team-members">{registered.length} {registered.length===1?'integrante':'integrantes'} · {registered.join(' · ')}</p>;
}
