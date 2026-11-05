import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {PhaseBanner,PracticeControls,type Confirmation} from '../src/practice';
import {INITIAL,type State} from '../src/domain';
import {command} from '../src/supabase';
vi.mock('../src/supabase',()=>({command:vi.fn(async()=>({ok:true}))}));
const practice:State={...INITIAL,phase:'practice',revision:42};
it('identifica práctica y oculta advertencias en la presentación oficial',()=>{
 expect(renderToStaticMarkup(<PhaseBanner state={practice}/>)).toContain('MODO PRÁCTICA');
 expect(renderToStaticMarkup(<PhaseBanner state={{...practice,phase:'official'}}/>)).toBe('');
 expect(renderToStaticMarkup(<PhaseBanner state={{...practice,phase:'official'}} admin/>)).toContain('EVENTO OFICIAL');
});
it('oculta ambos controles si el estado es oficial o aún no confirma fase',()=>{
 for(const phase of ['official',undefined] as const)expect(renderToStaticMarkup(<PracticeControls state={{...practice,phase}} disabled={false} onConfirm={vi.fn()}/>)).toBe('');
});
it('mantiene ambos controles durante una práctica finalizada y los bloquea sin sincronización',()=>{
 const html=renderToStaticMarkup(<PracticeControls state={{...practice,status:'finished',reveal:true}} disabled onConfirm={vi.fn()}/>);
 expect(html).toContain('REINICIAR PRÁCTICA');expect(html).toContain('COMENZAR EVENTO OFICIAL');expect(html.match(/disabled=""/g)).toHaveLength(2);
});
it.each([0,1])('confirmar botón %s conserva UUID/revisión al reintentar y explica la eliminación',async index=>{
 const onConfirm=vi.fn();
 const element=PracticeControls({state:practice,disabled:false,onConfirm})!;
 element.props.children[index].props.onClick();
 const confirmation=onConfirm.mock.calls[0][0] as Confirmation;
 expect(confirmation.label).toContain('diez cuentas');expect(confirmation.label).toContain('contraseñas');
 if(index===1)expect(confirmation.label).toContain('irreversible');
 expect(command).not.toHaveBeenCalled();
 await confirmation.run();await confirmation.run();
 const calls=vi.mocked(command).mock.calls;expect(calls.at(-1)).toEqual(calls.at(-2));
 expect(calls.at(-1)).toEqual([index===0?'reset_practice':'start_official',{operationId:expect.any(String),expectedRevision:42}]);
 vi.mocked(command).mockClear();
});
