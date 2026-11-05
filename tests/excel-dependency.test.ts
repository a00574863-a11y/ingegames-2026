import {createRequire} from 'node:module';
import {expect,it} from 'vitest';

it('ExcelJS resuelve UUID corregido, mantiene UUID v4 y rechaza buffers incompletos',()=>{
 const require=createRequire(import.meta.url);
 const excelRequire=createRequire(require.resolve('exceljs/package.json'));
 const uuid=excelRequire('uuid');
 expect(excelRequire('uuid/package.json').version).toBe('11.1.1');
 expect(uuid.v4()).toMatch(/^[0-9a-f-]{14}4[0-9a-f-]{21}$/);
 const ns='6ba7b810-9dad-11d1-80b4-00c04fd430c8';
 expect(()=>uuid.v5('x',ns,new Uint8Array(8),4)).toThrow(RangeError);
 expect(()=>uuid.v5('x',ns,new Uint8Array(16),1)).toThrow(RangeError);
 const normal=new Uint8Array(16);expect(uuid.v5('x',ns,normal)).toBe(normal);
});
