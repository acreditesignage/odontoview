import test from 'node:test';
import assert from 'node:assert/strict';
import {applyImplantGizmoDelta, normalizeImplantAngle} from './implantTransformGizmo.js';

const implant={id:'i1',x:10,y:20,z:30,rx:5,ry:-10,rz:170};

test('gizmo translates existing implant state without mutation',()=>{
  const next=applyImplantGizmoDelta(implant,{mode:'translate',axis:'x',delta:2.5});
  assert.notStrictEqual(next,implant);
  assert.equal(next.x,12.5);
  assert.equal(next.y,20);
  assert.equal(implant.x,10);
});

test('gizmo translates all three world axes',()=>{
  assert.equal(applyImplantGizmoDelta(implant,{mode:'translate',axis:'y',delta:-3}).y,17);
  assert.equal(applyImplantGizmoDelta(implant,{mode:'translate',axis:'z',delta:1.25}).z,31.25);
});

test('gizmo rotates the same rx ry rz state with normalized angles',()=>{
  assert.equal(applyImplantGizmoDelta(implant,{mode:'rotate',axis:'x',delta:15}).rx,20);
  assert.equal(applyImplantGizmoDelta(implant,{mode:'rotate',axis:'z',delta:25}).rz,-165);
  assert.equal(normalizeImplantAngle(540),180);
  assert.equal(normalizeImplantAngle(-540),-180);
});

test('invalid gizmo inputs are safe no-op copies',()=>{
  assert.deepEqual(applyImplantGizmoDelta(implant,{mode:'translate',axis:'q',delta:2}),implant);
  assert.deepEqual(applyImplantGizmoDelta(implant,{mode:'rotate',axis:'x',delta:NaN}),implant);
  assert.notStrictEqual(applyImplantGizmoDelta(implant,{mode:'translate',axis:'q',delta:2}),implant);
});
