/* Persistence only. Chapter rules and narrative remain in the existing pages. */
(function (root) {
  'use strict';
  const PREFIX = 'detective:saves:v2:';
  const LEGACY = n => n < 5 ? `last_case_chapter_${n}_v1` : `archive_case_chapter_${n}_v1`;
  const branches = ['originals', 'belov'];
  const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = v => JSON.parse(JSON.stringify(v));
  const specs = {
    1: {defaults:{clues:[],deductions:[],prologue:null,phone:null,scraps:[],burned:0,bin:false,cache:false,route:null,finished:false,started:false}, clues:['ledger','glass','paper','booking','note'], pairs:{fresh:['ledger','glass']}},
    2: {defaults:{clues:[],deductions:[],key:false,cabinet:false,finished:false,route:null}, clues:['report','notice','clock','power','typewriter','call','record'], pairs:{date:['report','notice'],time:['clock','power'],departure:['typewriter','call']}},
    3: {defaults:{clues:[],deductions:[],scene:'station',first:'station',dialogue:[],finished:false,board:{}}, clues:['ticket','copy','dispatch','timetable','witness','invoice','telegram'], pairs:{identity:['copy','witness'],cargo:['dispatch','invoice'],destination:['timetable','telegram']}},
    4: {defaults:{clues:['invoice'],deductions:[],crate:false,plan:null,finished:null,seenOutcomes:[],started:false}, clues:['invoice','manifest','loading','departure','phone'], pairs:{cargo:['invoice','manifest'],split:['loading','departure']}}
  };
  // Declarative validation metadata; generated from the unchanged chapter C objects.
  Object.assign(specs, root.DetectiveSaveSpecs || {});
  function validateChapter(n, input) {
    const spec = specs[n];
    if (!spec || !plain(input)) throw Error(`Некорректное сохранение главы ${n}`);
    const result = clone(spec.defaults);
    for (const k of Object.keys(result)) if (Object.hasOwn(input, k)) result[k] = clone(input[k]);
    const ids = (a, allowed) => Array.isArray(a) && a.every(x => typeof x === 'string' && allowed.includes(x)) && new Set(a).size === a.length;
    if (!ids(result.clues, spec.clues) || !ids(result.deductions, Object.keys(spec.pairs))) throw Error(`Неизвестные улики или выводы главы ${n}`);
    for (const id of result.deductions) if (!spec.pairs[id].every(x => result.clues.includes(x))) throw Error(`Вывод без улик: ${id}`);
    for (const [k,v] of Object.entries(spec.defaults)) if (typeof v === 'boolean' && typeof result[k] !== 'boolean') throw Error(`Некорректное поле ${k}`);
    if (n === 1) {
      const pick = (v, list) => v === null || list.includes(v);
      if (!pick(result.prologue,['hide','drown','call','froze']) || !pick(result.phone,['play','press','silent']) || !pick(result.route,['hotel','station'])) throw Error('Некорректный выбор главы I');
      if (!ids(result.scraps,['date','pier','initial']) || !Number.isInteger(result.burned) || result.burned < 0 || result.burned > 3 || result.scraps.length + result.burned > 3) throw Error('Некорректные обрывки');
      if (result.cache !== result.clues.includes('note')) throw Error('Тайник без записки');
      if ((result.scraps.length || result.burned) && !result.bin) throw Error('Обрывки без корзины');
      if ((result.finished || result.route) && !(result.prologue && result.phone && result.cache && result.deductions.includes('fresh'))) throw Error('Глава I не готова к завершению');
    }
    if (n === 2) {
      if (![null,'station','hotel'].includes(result.route) || (result.cabinet && !result.key)) throw Error('Некорректный маршрут или шкаф');
      if ((result.finished || result.route) && !(result.deductions.length === 3 && result.clues.includes('record'))) throw Error('Глава II не готова к завершению');
    }
    if (n === 3) {
      if (!['station','hotel'].includes(result.scene) || !['station','hotel'].includes(result.first) || !ids(result.dialogue,['saw','why','parcel']) || !plain(result.board)) throw Error('Некорректная сцена или диалог');
      const fields = {who:['','rudnev','belov','orlova'],cargo:['','blank','copies','originals'],place:['','train','warehouse','archive']};
      const board = {};
      for (const k of Object.keys(fields)) if (Object.hasOwn(result.board,k)) {if (!fields[k].includes(result.board[k])) throw Error('Некорректная версия'); board[k]=result.board[k];}
      result.board=board;
      if (result.finished && !(result.deductions.length===3 && board.who==='belov' && board.cargo==='originals' && board.place==='warehouse')) throw Error('Глава III не готова к завершению');
    }
    if (n === 4) {
      if (![null,...branches].includes(result.plan) || ![null,...branches].includes(result.finished) || !ids(result.seenOutcomes,branches)) throw Error('Некорректный исход склада');
      if ((result.plan || result.finished) && !(result.deductions.length===2 && result.crate && result.clues.includes('phone'))) throw Error('Операция не подготовлена');
      if (result.finished && result.finished!==result.plan) throw Error('Исход не совпадает с планом');
    }
    if (n >= 5) {
      if (!branches.includes(result.branch) || !Array.isArray(result.answers) || result.answers.length>spec.options.length || !result.answers.every((a,i)=>a==='' || (typeof a==='string' && /^\d+$/.test(a) && Number(a)<spec.options[i]))) throw Error('Некорректная ветка или ответы');
      if (result.solved && !(result.clues.length===spec.clues.length && result.deductions.length===Object.keys(spec.pairs).length && result.answers.length===spec.correct.length && result.answers.every((a,i)=>a===String(spec.correct[i])))) throw Error('Задача не решена');
      if (result.finished && !result.solved) throw Error('Глава не завершена');
    }
    return result;
  }
  function validateRun(input) {
    if (!plain(input) || !plain(input.chapters) || !branches.includes(input.branch) || typeof input.label!=='string' || input.label.length>200) throw Error('Некорректное прохождение');
    const chapters = {};
    for (const [n,state] of Object.entries(input.chapters)) {
      if (!/^[1-8]$/.test(n)) throw Error('Неизвестная глава');
      chapters[n]=validateChapter(Number(n),state);
      if (Number(n)>=5 && chapters[n].branch!==input.branch) throw Error('Смешаны сюжетные ветки');
    }
    if (chapters[4]?.finished && chapters[4].finished!==input.branch) throw Error('Ветка не совпадает с исходом IV');
    return {label:input.label,branch:input.branch,chapters};
  }
  function createStore(storage, options={}) {
    const uuid = options.uuid || (()=>root.crypto.randomUUID());
    const now = options.now || (()=>new Date().toISOString());
    const warnings = [];
    const warn = message => {if (!warnings.includes(message)) warnings.push(message); options.onWarning?.(message);};
    function get(key) {try {return storage.getItem(key);} catch {warn('Хранилище недоступно. Экспортируйте прогресс до закрытия страницы.'); return null;}}
    function putNew(key,value) {
      if (get(key)!==null) throw Error('Запись уже существует; перезапись запрещена');
      storage.setItem(key,JSON.stringify(value));
    }
    function entries() {
      const out=[];
      try {for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k?.startsWith(PREFIX+'revision:'))out.push([k,storage.getItem(k)]);}}
      catch {warn('Не удалось прочитать список сохранений.');}
      return out;
    }
    function revisions() {
      const out=[];
      for (const [key,raw] of entries()) try {
        const v=JSON.parse(raw);
        if (!plain(v) || v.schemaVersion!==2 || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.id) || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.runId) || key!==PREFIX+'revision:'+v.id || !Number.isSafeInteger(v.sequence) || v.sequence<0 || typeof v.createdAt!=='string' || !(v.parent===null || typeof v.parent==='string')) throw Error();
        v.data=validateRun(v.data);out.push(v);
      } catch {warn('Обнаружена повреждённая запись. Она сохранена без изменений; доступен экспорт исходных данных.');}
      return out.sort((a,b)=>a.sequence-b.sequence || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    }
    function latest(runId) {return revisions().filter(v=>v.runId===runId).at(-1)||null;}
    function append(runId,data,parent=null) {
      const record={schemaVersion:2,id:uuid(),runId,parent:parent?.id||null,sequence:(parent?.sequence??-1)+1,createdAt:now(),data:validateRun(data)};
      putNew(PREFIX+'revision:'+record.id,record);
      return record;
    }
    function create(data,label) {return append(uuid(),{...data,label:label||data.label});}
    function active(id) {
      if (id) {try{storage.setItem(PREFIX+'active',id);}catch{warn('Не удалось запомнить выбранное прохождение.');}}
      return get(PREFIX+'active');
    }
    function migrate() {
      const archiveKey=PREFIX+'legacy-archive';
      let archive;
      const existing=get(archiveKey);
      if (existing!==null) {
        try {archive=JSON.parse(existing);if(!plain(archive)||!plain(archive.raw))throw Error();}
        catch {warn('Архив миграции повреждён. Автоматическая миграция остановлена; экспортируйте данные.');return;}
      } else {
        const raw={};for(let n=2;n<=8;n++){const value=get(LEGACY(n));if(value!==null)raw[LEGACY(n)]=value;}
        archive={schemaVersion:2,raw,createdAt:now()};
        try{putNew(archiveKey,archive);}catch{warn('Не удалось создать архив старых сохранений. Миграция не выполнена.');return;}
      }
      const chapters={};
      for(let n=2;n<=8;n++) if(Object.hasOwn(archive.raw,LEGACY(n))) try{chapters[n]=validateChapter(n,JSON.parse(archive.raw[LEGACY(n)]));}catch{warn(`Старое сохранение главы ${n} повреждено. Исходная запись не изменена.`);}
      if(!Object.keys(chapters).length)return;
      const preferred=chapters[4]?.finished||chapters[4]?.plan||Object.values(chapters).find(s=>s.branch)?.branch||'originals';
      const needed=new Set([preferred,...Object.values(chapters).map(s=>s.branch).filter(Boolean)]);
      for(const branch of needed){
        const runId='legacy-'+branch;
        if(latest(runId))continue;
        const group={};
        for(const [n,s] of Object.entries(chapters)) {
          if(Number(n)>=5 && s.branch!==branch)continue;
          if(Number(n)===4 && (s.finished||s.plan) && (s.finished||s.plan)!==branch)continue;
          group[n]=s;
        }
        try{append(runId,{label:`Восстановлено · ${branch==='originals'?'Оригиналы сохранены':'Белов задержан'}`,branch,chapters:group});}catch{warn('Миграция прервана. Старые записи сохранены; повторите после освобождения места.');}
      }
      if(!active() && latest('legacy-'+preferred))active('legacy-'+preferred);
    }
    function list() {
      const all=revisions(), parents=new Set(all.map(v=>v.parent));
      return all.filter(v=>!parents.has(v.id)).reverse(); // Include concurrent heads, never hide a divergent snapshot.
    }
    function open(chapter,requestedRun,requestedRevision) {
      migrate();
      let record = requestedRevision ? revisions().find(v=>v.id===requestedRevision && v.runId===requestedRun) : latest(requestedRun||active());
      // A legacy IV decision must not hide an existing late-chapter save from another branch.
      // Only recovered legacy groups get this fallback; an explicitly selected run stays pinned.
      if(!requestedRun && record?.runId.startsWith('legacy-') && !record.data.chapters[chapter]){
        record=list().find(v=>v.runId.startsWith('legacy-') && v.data.chapters[chapter])||record;
      }
      if(!record && requestedRun)warn('Выбранное прохождение недоступно. Старые данные не изменены.');
      let data=record?clone(record.data):{label:'Новое прохождение',branch:'originals',chapters:{}};
      let runId=record?.runId||uuid();
      let error=false;
      function remember(){active(runId);options.onRun?.(runId);}
      remember();
      function persist() {
        try {
          if(record && JSON.stringify(record.data)===JSON.stringify(data)){error=false;return true;}
          const current=latest(runId);
          if(current && current.id!==record?.id){runId=uuid();record=null;data.label='Отдельное продолжение';warn('В другой вкладке изменился прогресс. Ваш путь сохранён отдельно.');}
          record=append(runId,data,record);error=false;remember();return true;
        } catch {error=true;warn('Прогресс не записан. Экспортируйте его до закрытия страницы.');return false;}
      }
      return {
        get runId(){return runId;},get branch(){return data.branch;},get error(){return error;},
        load:()=>clone(data.chapters[chapter]||null),
        previous:n=>clone(data.chapters[n]||null),
        save(state){
          try {
            const checked=validateChapter(chapter,state);
            if(chapter===4 && checked.finished && checked.finished!==data.branch){
              // Defensive boundary even if a caller forgot to fork before changing the decision.
              const old=clone(data);for(const n of Object.keys(old.chapters))if(Number(n)>=4)delete old.chapters[n];
              runId=uuid();record=null;data=old;data.branch=checked.finished;
            }
            if(chapter>=5 && checked.branch!==data.branch)throw Error('Ветка не совпадает');
            data.chapters[chapter]=checked;
            return persist();
          } catch {error=true;warn('Некорректное состояние не записано. Предыдущие версии сохранены.');return false;}
        },
        restart(){
          data=clone(data);for(const n of Object.keys(data.chapters))if(Number(n)>=chapter)delete data.chapters[n];
          data.label=`Повтор главы ${chapter}`;runId=uuid();record=null;remember();
        },
        forkDecision(state){
          data=clone(data);for(const n of Object.keys(data.chapters))if(Number(n)>=4)delete data.chapters[n];
          data.label='Другая развилка склада';runId=uuid();record=null;remember();
          const next=clone(state);next.plan=null;next.finished=null;data.chapters[4]=validateChapter(4,next);
        },
        export(){return {format:'detective-game-progress',schemaVersion:2,exportedAt:now(),runs:[{data:clone(data)}],raw:rawBackup()};}
      };
    }
    function rawBackup(){
      const raw={};try{for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(PREFIX)||/^((last|archive)_case_chapter_[2-8]_v1)$/.test(key))raw[key]=storage.getItem(key);}}catch{warn('Экспорт исходных данных неполон: хранилище недоступно.');}return raw;
    }
    function exportAll(){return {format:'detective-game-progress',schemaVersion:2,exportedAt:now(),runs:list().map(v=>({data:v.data})),raw:rawBackup()};}
    function importProgress(input){
      if(!plain(input)||input.format!=='detective-game-progress'||input.schemaVersion!==2||!Array.isArray(input.runs)||!input.runs.length||input.runs.length>100)throw Error('Неподдерживаемый файл прогресса');
      const data=input.runs.map(r=>validateRun(r.data)); // Validate everything before the first write.
      if(input.raw!==undefined && (!plain(input.raw) || !Object.values(input.raw).every(v=>typeof v==='string' || v===null)))throw Error('Некорректный архив');
      const imported=[];
      for(const d of data)imported.push(create(d,'Импорт · '+d.label.slice(0,180)));
      // Raw data is inert recovery material. Never execute it or restore it over existing keys.
      if(input.raw!==undefined)putNew(PREFIX+'import-archive:'+uuid(),input.raw);
      return imported;
    }
    return {open,list,latest,migrate,exportAll,importProgress,warnings,validateChapter,validateRun};
  }
  const api={createStore,validateChapter,validateRun,PREFIX,LEGACY};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  root.DetectiveSaves=api;
  if(root.document){
    let storage;try{storage=root.localStorage;}catch{storage={getItem(){throw Error();},setItem(){throw Error();},get length(){throw Error();}};}
    const store=createStore(storage,{onRun(id){const u=new URL(root.location.href);u.searchParams.set('run',id);u.searchParams.delete('revision');root.history.replaceState(null,'',u);}});
    api.store=store;
    api.open=n=>{const p=new URL(root.location.href).searchParams;const session=store.open(n,p.get('run'),p.get('revision'));api.session=session;return session;};
    api.download=value=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='detective-game-progress.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    document.addEventListener('click',event=>{
      const a=event.target.closest('a[href]');if(!a)return;
      const u=new URL(a.href,root.location.href);
      if(u.origin===root.location.origin && /\/(index|chapter[1-8]|saves)\.html$/.test(u.pathname) && api.session){u.searchParams.set('run',api.session.runId);a.href=u.href;}
    },true);
    document.addEventListener('DOMContentLoaded',()=>{
      const footer=document.querySelector('.intro-foot');
      if(footer){const a=document.createElement('a');a.href='saves.html';a.textContent=' · Сохранения';a.style.color='inherit';a.dataset.saveTools='';footer.append(a);}
      const header=document.querySelector('.header-right');
      if(header){const a=document.createElement('a');a.href='saves.html';a.className='tiny-button';a.textContent='Сохранения';a.dataset.saveTools='';header.append(a);}
      const warning=document.createElement('div');warning.dataset.saveTools='';warning.setAttribute('role','alert');warning.hidden=true;
      warning.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:100;background:#f1e7d4;color:#302c26;padding:12px;font:14px system-ui';
      const text=document.createElement('span'),button=document.createElement('button');button.textContent='Экспорт прогресса';button.onclick=()=>api.download(api.session?api.session.export():store.exportAll());warning.append(text,button);document.body.append(warning);
      function update(){warning.hidden=!store.warnings.length;text.textContent=store.warnings.join(' ')+' ';}
      update();api.showWarnings=update;
      // save() is synchronous; update the notice after each action without polling.
      document.addEventListener('click',()=>queueMicrotask(update));document.addEventListener('change',()=>queueMicrotask(update));
    });
  }
})(typeof window!=='undefined'?window:globalThis);
