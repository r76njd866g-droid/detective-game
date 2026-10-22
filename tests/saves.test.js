'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
require('../save-specs.js');
const {createStore,validateChapter,validateRun,PREFIX,LEGACY}=require('../save-store.js');
class Storage {
  constructor(){this.values=new Map();this.fail=false;}
  get length(){return this.values.size;}
  key(i){return [...this.values.keys()][i]||null;}
  getItem(k){return this.values.get(k)??null;}
  setItem(k,v){if(this.fail)throw Error('quota');this.values.set(k,String(v));}
}
const fixture=()=>{const storage=new Storage();let id=0;const store=createStore(storage,{uuid:()=>`id-${++id}`,now:()=> '2026-10-22T10:00:00.000Z'});return {store,storage};};
const fresh=n=>validateChapter(n,n>=5?{branch:'originals'}:{});
const warehouse=branch=>({clues:['invoice','manifest','loading','departure','phone'],deductions:['cargo','split'],crate:true,plan:branch,finished:branch,seenOutcomes:[branch],started:true});
test('inline scripts parse in all seven unchanged chapter URLs',()=>{
  for(let n=2;n<=8;n++){
    const s=fs.readFileSync(n===2?'index.html':`chapter${n}.html`,'utf8');
    for(const m of s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
    for(const m of s.matchAll(/(?:src|href)="([^"?]+)(?:\?[^"<>]*)?"/g))if(!m[1].startsWith('data:')&&!m[1].includes('${')&&!m[1].startsWith('#'))assert.ok(fs.existsSync(m[1]),m[1]);
  }
});
test('each chapter validates its original empty state',()=>{for(let n=2;n<=8;n++)assert.deepEqual(validateChapter(n,fresh(n)),fresh(n));});
test('legacy migration preserves every source byte and is idempotent',()=>{
  const {store,storage}=fixture();
  for(let n=2;n<=8;n++)storage.setItem(LEGACY(n),JSON.stringify(n===4?warehouse('originals'):fresh(n)));
  const before=new Map(storage.values);store.migrate();const count=store.list().length;store.migrate();
  assert.equal(store.list().length,count);
  for(const [k,v] of before)assert.equal(storage.getItem(k),v);
  const session=store.open(5);assert.equal(session.branch,'originals');assert.deepEqual(session.load(),fresh(5));
});
test('mixed legacy branches are recovered as separate paths',()=>{
  const {store,storage}=fixture();storage.setItem(LEGACY(4),JSON.stringify(warehouse('belov')));storage.setItem(LEGACY(5),JSON.stringify(fresh(5)));
  store.migrate();assert.equal(store.list().length,2);
  const recovered=store.list().find(r=>r.data.branch==='originals');assert.ok(recovered.data.chapters[5]);assert.equal(recovered.data.chapters[4],undefined);
  assert.equal(store.open(5).branch,'originals');assert.deepEqual(store.open(5).load(),fresh(5));
});
test('malformed JSON, unknown clues, null arrays and invalid enums do not crash or overwrite',()=>{
  for(const raw of ['{','null','[]',JSON.stringify({clues:['bad'],deductions:[]}),JSON.stringify({clues:[],deductions:[],scene:'bad'}),JSON.stringify({clues:[],deductions:[],dialogue:null})]){
    const {store,storage}=fixture();storage.setItem(LEGACY(3),raw);const session=store.open(3);assert.equal(session.load(),null);assert.equal(session.save(fresh(3)),true);assert.equal(storage.getItem(LEGACY(3)),raw);assert.ok(store.warnings.length);
  }
});
test('unsafe completed states and contradictory branches are rejected',()=>{
  assert.throws(()=>validateChapter(2,{finished:true}));assert.throws(()=>validateChapter(3,{board:{who:'injected'}}));assert.throws(()=>validateChapter(4,{plan:'belov'}));
  assert.throws(()=>validateChapter(5,{branch:'originals',solved:true,answers:['2','1']}));
  assert.throws(()=>validateRun({label:'x',branch:'originals',chapters:{4:warehouse('belov')}}));
});
test('restart and both warehouse decisions preserve prior playthroughs and clear downstream state',()=>{
  const {store,storage}=fixture();const session=store.open(4);session.save(warehouse('originals'));const first=session.runId;
  const later=store.open(5,first);const s=fresh(5);s.clues=['schedule'];later.save(s);
  const original=store.latest(first),before=JSON.stringify(original);
  const replay=store.open(4,first);replay.forkDecision(replay.load());const second=warehouse('belov');replay.save(second);
  assert.notEqual(first,replay.runId);assert.equal(JSON.stringify(store.latest(first)),before);
  assert.equal(store.latest(replay.runId).data.chapters[5],undefined);assert.equal(store.open(5,replay.runId).branch,'belov');
  const playing=store.open(5,first);playing.restart();playing.save(fresh(5));assert.notEqual(playing.runId,first);assert.equal(store.latest(first).data.chapters[5].clues[0],'schedule');
  assert.ok(storage.values.size>5);
});
test('stale tabs fork instead of overwriting current progress',()=>{
  const {store}=fixture();const first=store.open(2);first.save(fresh(2));const run=first.runId;
  const a=store.open(2,run),b=store.open(2,run);const s=fresh(2);s.clues=['report'];a.save(s);const t=fresh(2);t.clues=['clock'];b.save(t);
  assert.notEqual(a.runId,b.runId);assert.deepEqual(store.latest(a.runId).data.chapters[2].clues,['report']);assert.deepEqual(store.latest(b.runId).data.chapters[2].clues,['clock']);
});
test('immutable versions remain in export; corrupted latest falls back to prior valid version',()=>{
  const {store,storage}=fixture();const session=store.open(2);session.save(fresh(2));const run=session.runId;const s=fresh(2);s.clues=['report'];session.save(s);
  const record=store.latest(run);storage.setItem(PREFIX+'revision:'+record.id,'{broken');
  assert.deepEqual(store.open(2,run).load().clues,[]);assert.equal(store.exportAll().raw[PREFIX+'revision:'+record.id],'{broken');
});
test('export/import creates new IDs and never replaces existing data or evaluates raw payloads',()=>{
  const {store,storage}=fixture();const session=store.open(4);session.save(warehouse('belov'));const file=store.exportAll();const before=new Map(storage.values);
  const [imported]=store.importProgress(file);assert.notEqual(imported.runId,session.runId);assert.equal(imported.data.branch,'belov');
  for(const [k,v] of before)assert.equal(storage.getItem(k),v);
  const other=fixture();other.store.importProgress(file);assert.equal(other.store.list()[0].data.chapters[4].finished,'belov');
});
test('invalid import validates whole file before writing anything',()=>{
  const {store,storage}=fixture();const payload={format:'detective-game-progress',schemaVersion:2,runs:[{data:{label:'ok',branch:'originals',chapters:{}}},{data:{label:'bad',branch:'bad',chapters:{}}}]};
  assert.throws(()=>store.importProgress(payload));assert.equal(storage.length,0);
  payload.runs.pop();payload.raw={bad:123};assert.throws(()=>store.importProgress(payload));assert.equal(storage.length,0);
});
test('quota failures preserve old revisions and export includes the in-memory progress',()=>{
  const {store,storage}=fixture();const session=store.open(2);session.save(fresh(2));const record=store.latest(session.runId);storage.fail=true;
  const s=fresh(2);s.clues=['report'];assert.equal(session.save(s),false);assert.equal(session.error,true);assert.deepEqual(store.latest(session.runId),record);assert.deepEqual(session.export().runs[0].data.chapters[2].clues,['report']);
});
test('interrupted import leaves existing data untouched',()=>{
  const {store,storage}=fixture();const s=store.open(2);s.save(fresh(2));const before=new Map(storage.values),file=store.exportAll();storage.fail=true;
  assert.throws(()=>store.importProgress(file));for(const [k,v] of before)assert.equal(storage.getItem(k),v);
});
test('replaying each of the seven chapters retains the original chapter state',()=>{
  const firstClue={2:'report',3:'ticket',4:'manifest',5:'schedule',6:'map',7:'phone',8:'parcel'};
  for(let n=2;n<=8;n++){
    const {store}=fixture(),session=store.open(n),state=fresh(n);state.clues.push(firstClue[n]);session.save(state);
    const before=store.latest(session.runId),originalId=session.runId;
    session.restart();session.save(fresh(n));assert.notEqual(session.runId,originalId);assert.deepEqual(store.latest(originalId),before);
  }
});
test('strictly concurrent revision heads both remain selectable',()=>{
  const {store,storage}=fixture(),session=store.open(2);session.save(fresh(2));const base=store.latest(session.runId);
  for(const [id,clue] of [['race-a','clock'],['race-b','report']]){
    const revision=structuredClone(base);revision.id=id;revision.parent=base.id;revision.sequence++;revision.data.chapters[2].clues=[clue];
    storage.setItem(PREFIX+'revision:'+id,JSON.stringify(revision));
  }
  assert.equal(store.list().length,2);
  assert.deepEqual(store.open(2,session.runId,'race-a').load().clues,['clock']);
  assert.deepEqual(store.open(2,session.runId,'race-b').load().clues,['report']);
});
test('unavailable storage still supports in-memory play and emergency export',()=>{
  const broken={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},get length(){throw Error('blocked');}};
  let id=0;const store=createStore(broken,{uuid:()=>`temp-${++id}`});const session=store.open(2);const state=fresh(2);state.clues=['report'];
  assert.equal(session.save(state),false);assert.deepEqual(session.export().runs[0].data.chapters[2].clues,['report']);assert.ok(store.warnings.length);
});
test('archive quota failure stops migration without altering source records',()=>{
  const {store,storage}=fixture(),raw=JSON.stringify(fresh(2));storage.setItem(LEGACY(2),raw);storage.fail=true;
  store.migrate();assert.equal(storage.getItem(LEGACY(2)),raw);assert.equal(storage.getItem(PREFIX+'legacy-archive'),null);assert.equal(store.list().length,0);
});
test('validation metadata agrees with the existing chapter scenario objects',()=>{
  for(let n=5;n<=8;n++){
    const s=fs.readFileSync(`chapter${n}.html`,'utf8'),script=[...s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].startsWith('const C='))[1];
    const c=vm.runInNewContext(script.slice(0,script.indexOf("\n'use strict';"))+'C;');
    const spec=globalThis.DetectiveSaveSpecs[n];
    assert.equal(JSON.stringify(spec.clues),JSON.stringify(c.docs.map(d=>d.id)));
    assert.equal(JSON.stringify(spec.pairs),JSON.stringify(Object.fromEntries(c.links.map(d=>[d.id,d.pair]))));
    assert.equal(JSON.stringify(spec.options),JSON.stringify(c.puzzle.fields.map(f=>f.options.length)));
    assert.equal(JSON.stringify(spec.correct),JSON.stringify(c.puzzle.fields.map(f=>f.answer)));
  }
});
