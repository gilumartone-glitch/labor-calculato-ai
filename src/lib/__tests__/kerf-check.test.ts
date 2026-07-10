import { describe, it, expect } from 'vitest';
import { computeNesting } from '@/lib/nesting';

const mat = { id:'m1', name:'Poli', weight:'', color:'Trasp', height:'100', heightUnit:'cm', composition:'', fireproof:'', unit:'mq', pricePiece:10, priceCut:10, format:'lastra', priceUnit:'mq', dimUnit:'cm', baseWidth:'100' };
const cat = { materials:[mat], operations:[], perimeterOps:[], perimeterPresets:[], importedAt:null, fileName:null, printOps:[], __kerfMm: 6, __perimeterMarginMm: 0, __skipPerimeterMargin: true } as any;
const mk = (id, w, h, q=1) => ({ id, productName:'Poli', color:'Trasp', fireproof:'', matchedHeight:'100', matchedHeightUnit:'cm', catalogMaterialId:'m1', variantId:'m1', priceMode:'cut', materialQty:0, width:w, height:h, dimUnit:'cm', shape:'rect', quantity:q, perimeters:[], allowRotation:false, allowSplit:false });

describe('kerf', () => {
  it('leaves 6mm between pieces', () => {
    const g = computeNesting([mk('a',30,20), mk('b',30,20)], cat)[0];
    console.log('items', g.items);
    console.log('mixedSheets', g.mixedSheets);
  });
});
