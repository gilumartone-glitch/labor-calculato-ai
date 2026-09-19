import { describe, it, expect } from "vitest";
import { computeNesting } from "@/lib/nesting";
import type { Catalog, PieceLine } from "@/components/calculator/types";

const cat: Catalog = {
  materials: [{ id:"m1", name:"Tela", weight:"", color:"", height:"300", heightUnit:"cm", composition:"", fireproof:"", unit:"mq", pricePiece:10, priceCut:10, format:"rotolo", priceUnit:"mq", dimUnit:"cm" }],
  operations: [], perimeterOps: [], perimeterPresets: [], importedAt:null, fileName:null, printOps: [],
  __skipInitialScrap: true,
};
const p: PieceLine = {
  id:"p1", productName:"Tela", color:"", fireproof:"", matchedHeight:"300", matchedHeightUnit:"cm",
  catalogMaterialId:"m1", variantId:"m1", priceMode:"cut", materialQty:0,
  width:200, height:2000, dimUnit:"cm", shape:"rect", quantity:1, perimeters:[],
  allowRotation:false, allowSplit:true, fullnessPct:80, manualMargins:true, marginExtraWCm:0, marginExtraHCm:0,
};
describe("x", () => { it("y", () => {
  const g = computeNesting([p], cat)[0];
  console.log(JSON.stringify({len:g.totalLengthM, roll:g.rollWidthM, seam:g.seamLengthM, items:g.items.map(i=>({l:i.label,x:i.x,y:i.y,w:i.w,h:i.h,r:i.rotated}))}, null, 1));
  expect(1).toBe(1);
});});
