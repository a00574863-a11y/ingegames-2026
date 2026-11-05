import {describe,it,expect} from 'vitest';
import {INITIAL,ranking,winners} from '../src/domain';
describe('Clasificación y empates',()=>{
 it('no inventa un campeón cuando las tres carreras empiezan en cero',()=>{expect(winners(INITIAL)).toHaveLength(3);});
 it('ordena por puntos sin perder carreras',()=>{expect(ranking({IMT:20,IIS:50,IIT:35})).toEqual(['IIS','IIT','IMT']);});
 it('conserva dos ganadores empatados',()=>{expect(winners({...INITIAL,totals:{IMT:50,IIS:50,IIT:10}})).toEqual(['IMT','IIS']);});
 it('respeta un desempate explícito entre líderes',()=>{expect(winners({...INITIAL,totals:{IMT:50,IIS:50,IIT:10},tieWinner:'IIS'})).toEqual(['IIS']);});
 it('no acepta como ganador del desempate a una carrera que no empató',()=>{expect(winners({...INITIAL,totals:{IMT:50,IIS:50,IIT:10},tieWinner:'IIT'})).toEqual(['IMT','IIS']);});
});
