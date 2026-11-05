import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {teamMembersFromFields} from '../src/domain';
import {TeamMembersFields,TeamMembersList} from '../src/team-members';

it.each([1,2,3,4])('prepara %i integrantes y omite campos opcionales vacíos',count=>{
 const names=Array.from({length:count},(_,i)=>`Persona ${i+1}`);
 expect(teamMembersFromFields([...names,...Array(4-count).fill('  ')])).toEqual(names);
});
it('compacta campos opcionales y recorta los nombres',()=>{
 expect(teamMembersFromFields([' Ana ','','  Luis ',''])).toEqual(['Ana','Luis']);
});
it.each([[],[''],[' ','Ana'],['A','B','C','D','E'],['Ana',' ana '],['A'.repeat(101)]].map(fields=>({fields})))('rechaza integrantes inválidos $fields',({fields})=>{
 expect(()=>teamMembersFromFields(fields)).toThrow();
});
it('muestra cuatro campos, solo el primero obligatorio y tres controles para quitar',()=>{
 const html=renderToStaticMarkup(<TeamMembersFields members={['Ana','Luis']}/>);
 expect(html).toContain('De 1 a 4 integrantes');
 expect(html.match(/<input /g)).toHaveLength(4);expect(html.match(/required=""/g)).toHaveLength(1);
 expect(html.match(/<input[^>]*name="member1"[^>]*>/)?.[0]).toContain('required=""');
 expect(html.match(/type="button"/g)).toHaveLength(3);
 expect(html).toContain('value="Ana"');expect(html).toContain('value="Luis"');
});
it('lista únicamente integrantes registrados sin huecos',()=>{
 expect(renderToStaticMarkup(<TeamMembersList members={[' Ana ','','Luis','  ']}/>)).toContain('2 integrantes · Ana · Luis');
 expect(renderToStaticMarkup(<TeamMembersList members={['Ana']}/>)).toContain('1 integrante · Ana');
});
