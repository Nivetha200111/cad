/* ServiceNow CAD Flashcards + Quiz Engine (DB-backed, offline-resilient) */
(function(){
  "use strict";
  const PASS = 70;                 // CAD passing %
  const QUIZ_SIZE = 60, QUIZ_COUNT = 10;
  let Q = [], QUIZZES = [], TOPICS = [];
  const state = { online:false, player:'' };

  const LS = {
    get(k,d){ try{return JSON.parse(localStorage.getItem(k)) ?? d;}catch(e){return d;} },
    set(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
  };

  /* ---------- API client (gracefully degrades to offline) ---------- */
  const API = {
    async getQuestions(){
      const r = await fetch('/api/questions',{headers:{accept:'application/json'}});
      if(!r.ok) throw new Error('questions '+r.status);
      const j = await r.json(); return j.questions||[];
    },
    async saveAttempt(p){
      const r = await fetch('/api/attempts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});
      if(!r.ok) throw new Error('save '+r.status);
      return r.json();
    },
    async getAttempts(player){
      const r = await fetch('/api/attempts?player='+encodeURIComponent(player),{headers:{accept:'application/json'}});
      if(!r.ok) throw new Error('attempts '+r.status);
      return (await r.json()).attempts||[];
    },
    async leaderboard(){
      const r = await fetch('/api/attempts',{headers:{accept:'application/json'}});
      if(!r.ok) throw new Error('lb '+r.status);
      return (await r.json()).leaderboard||[];
    }
  };

  /* ---------- seeded shuffle so quizzes are stable per build ---------- */
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function shuffle(arr, seed){const a=arr.slice();const r=mulberry32(seed);for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

  function buildQuizzes(){
    const ids = Q.map(q=>q._id);
    const quizzes=[];
    if(ids.length >= QUIZ_SIZE*QUIZ_COUNT){
      const pool = shuffle(ids, 1337);
      for(let i=0;i<QUIZ_COUNT;i++) quizzes.push(pool.slice(i*QUIZ_SIZE,(i+1)*QUIZ_SIZE));
    } else {
      for(let i=0;i<QUIZ_COUNT;i++){
        const pool = shuffle(ids, 1337 + i*7919);
        quizzes.push(pool.slice(0, Math.min(QUIZ_SIZE, pool.length)));
      }
    }
    return quizzes;
  }

  /* ---------- DOM helpers ---------- */
  const $=(s,el=document)=>el.querySelector(s);
  const el=(tag,props={},...kids)=>{const n=document.createElement(tag);Object.entries(props).forEach(([k,v])=>{if(v==null)return;if(k==='class')n.className=v;else if(k==='html')n.innerHTML=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else n.setAttribute(k,v);});kids.flat().forEach(k=>n.append(k&&k.nodeType?k:document.createTextNode(k==null?'':k)));return n;};
  const app = $('#app');

  /* ---------- player name ---------- */
  function getPlayer(){ return LS.get('cadPlayer',''); }
  function ensurePlayer(){
    return new Promise(resolve=>{
      const existing=getPlayer();
      if(existing){ state.player=existing; return resolve(existing); }
      showNameModal('', false, name=>{ state.player=name; LS.set('cadPlayer',name); resolve(name); });
    });
  }
  function showNameModal(prefill, cancelable, onSave){
    const bg=el('div',{class:'modal-bg'});
    const input=el('input',{type:'text',placeholder:'e.g. Nivetha',value:prefill||'',maxlength:'80'});
    const save=()=>{const v=input.value.trim();if(!v){input.focus();return;}document.body.removeChild(bg);onSave(v);};
    const row=el('div',{class:'row'});
    if(cancelable) row.append(el('button',{class:'btn ghost',onclick:()=>document.body.removeChild(bg)},'Cancel'));
    row.append(el('button',{class:'btn',onclick:save},'Save'));
    bg.append(el('div',{class:'modal'},
      el('h3',{},'What should we call you?'),
      el('p',{},'Your exam results are saved under this name so your progress and leaderboard rank follow you across devices.'),
      input, row));
    document.body.append(bg);
    input.focus();
    input.addEventListener('keydown',e=>{if(e.key==='Enter')save();});
  }
  function changeName(){
    showNameModal(state.player,true, async name=>{
      state.player=name; LS.set('cadPlayer',name);
      refreshHeader();
      await syncFromCloud();
      const active=document.querySelector('.tab.active')?.dataset.tab||'flash';
      go(active);
    });
  }
  window.__changeName=changeName;

  /* ---------- header ---------- */
  function refreshHeader(){
    $('#stat-total').textContent = Q.length;
    $('#player-name').textContent = state.player||'set name';
    const dot=$('#sync-dot'); dot.className='sync-dot '+(state.online?'on':'off');
    $('#stat-player').title = state.online? 'Synced to cloud — click to change name' : 'Offline (saved in this browser) — click to change name';
    const scores = LS.get('quizScores',{});
    const taken = Object.keys(scores).length;
    $('#stat-taken').textContent = taken+'/'+QUIZ_COUNT;
    const best = Object.values(scores).reduce((m,s)=>Math.max(m,s.pct),0);
    $('#stat-best').textContent = taken? best+'%':'—';
  }

  /* ---------- cloud sync ---------- */
  async function syncFromCloud(){
    if(!state.online||!state.player) return;
    try{
      const attempts = await API.getAttempts(state.player);
      const scores = LS.get('quizScores',{});
      const qstats = LS.get('qstats',{});
      // keep the best attempt per quiz across local + cloud
      attempts.forEach(a=>{
        const cur=scores[a.quiz];
        if(!cur || a.pct>cur.pct){
          scores[a.quiz]={pct:a.pct,correct:a.correct,total:a.total,perTopic:a.per_topic||{},ts:new Date(a.created_at).getTime()};
        }
        // rebuild per-question misses from the cloud (without resurrecting ones
        // you've since answered correctly locally)
        const ts=new Date(a.created_at).getTime();
        (a.missed||[]).forEach(m=>{
          const key=(m&&m.q)||m; if(!key) return;
          const s=qstats[key];
          if(!s){ qstats[key]={right:0,wrong:1,lastWrong:true,lastTs:ts}; }
          else if(ts>(s.lastTs||0)){ s.wrong=(s.wrong||0)+1; s.lastWrong=true; s.lastTs=ts; }
        });
      });
      LS.set('quizScores',scores);
      LS.set('qstats',qstats);
      refreshHeader();
    }catch(e){ /* ignore */ }
  }

  /* ===================== TAB: FLASHCARDS ===================== */
  let fcOrder=[], fcIdx=0, fcFlip=false, fcTopic='all', flashEl=null;

  // Build a deck from your recent exam results: questions you missed first
  // (most-missed, most-recent), else questions from your weakest topics.
  function weakDeck(){
    const qstats=LS.get('qstats',{});
    const byText={}; Q.forEach(q=>byText[q.q]=q);
    const missed=Object.entries(qstats)
      .filter(([t,s])=>byText[t] && s.lastWrong)
      .sort((a,b)=>(b[1].wrong-a[1].wrong) || (b[1].lastTs-a[1].lastTs))
      .map(([t])=>byText[t]._id);
    if(missed.length) return {ids:missed, reason:'missed'};
    // fallback: weakest topics from saved exam scores (per-topic mastery)
    const scores=LS.get('quizScores',{}); const agg={};
    Object.values(scores).forEach(s=>Object.entries(s.perTopic||{}).forEach(([t,v])=>{agg[t]=agg[t]||{c:0,t:0};agg[t].c+=v.c;agg[t].t+=v.t;}));
    const ranked=Object.entries(agg).map(([t,v])=>[t, v.c/v.t]).sort((a,b)=>a[1]-b[1]);
    if(ranked.length){
      let weak=ranked.filter(([t,m])=>m<0.99).map(([t])=>t);   // anything under 99% is weak
      if(!weak.length) weak=ranked.slice(0,3).map(([t])=>t);   // all ≥99%: drill the lowest few anyway
      if(weak.length) return {ids:Q.filter(q=>weak.includes(q.topic)).map(q=>q._id), reason:'topics', topics:weak};
    }
    return {ids:[], reason:'none'};
  }
  function hasResults(){ return Object.keys(LS.get('qstats',{})).length>0 || Object.keys(LS.get('quizScores',{})).length>0; }

  function flashSet(){
    if(fcTopic==='weak'){
      const d=weakDeck();
      fcOrder = d.ids.length? d.ids : Q.map(q=>q._id);
    } else {
      fcOrder = (fcTopic==='all'?Q:Q.filter(q=>q.topic===fcTopic)).map(q=>q._id);
    }
    fcIdx=0;fcFlip=false;
  }
  function renderFlash(){
    if(!fcOrder.length) flashSet();
    app.innerHTML='';
    const ctrl = el('div',{class:'card',style:'margin-bottom:16px'},
      el('div',{class:'grid cols3'},
        (()=>{const l=el('label',{class:'fld'},'Focus');
          const s=el('select',{onchange:e=>{fcTopic=e.target.value;flashSet();renderFlash();}});
          const wd=weakDeck();
          const wopt=el('option',{value:'weak'},'★ My weak spots ('+wd.ids.length+')');
          if(fcTopic==='weak')wopt.selected=true; s.append(wopt);
          const aopt=el('option',{value:'all'},'All topics ('+Q.length+')');
          if(fcTopic==='all')aopt.selected=true; s.append(aopt);
          TOPICS.forEach(t=>{const o=el('option',{value:t},t+' ('+Q.filter(q=>q.topic===t).length+')');if(t===fcTopic)o.selected=true;s.append(o);});
          l.append(s);return l;})(),
        el('label',{class:'fld'},'Shuffle',
          el('button',{class:'btn ghost',onclick:()=>{fcOrder=shuffle(fcOrder,Date.now()&0xffffff);fcIdx=0;fcFlip=false;renderFlash();}},'🔀 Shuffle deck')),
        el('label',{class:'fld'},'Reset order',
          el('button',{class:'btn ghost',onclick:()=>{flashSet();renderFlash();}},'↺ Reset'))
      )
    );
    app.append(ctrl);

    if(fcTopic==='weak'){
      const wd=weakDeck();
      let msg;
      if(wd.reason==='missed') msg='Showing the questions you missed on recent exams — most-missed, most-recent first.';
      else if(wd.reason==='topics') msg='Showing cards from your weakest topics (under 99% mastery): '+(wd.topics||[]).join(', ')+'.';
      else msg='Take a Practice Exam and your weak spots will appear here. Showing all cards for now.';
      app.append(el('div',{class:'card reveal',style:'margin-bottom:16px;padding:14px 18px'},
        el('div',{class:'muted',style:'font-size:14px'}, '★ '+msg)));
    }

    const q = Q[fcOrder[fcIdx]];
    const flash = el('div',{class:'flash'+(fcFlip?' flipped':'')});
    flashEl = flash;
    const inner = el('div',{class:'flash-inner',onclick:()=>{fcFlip=!fcFlip;flash.classList.toggle('flipped');}});
    const front = el('div',{class:'face front'},
      el('div',{class:'topic'},q.topic),
      el('div',{class:'qtext'},q.q),
      el('ul',{class:'opts-min'}, q.options.map(o=>el('li',{},'• '+o))),
      el('div',{class:'hint'},'Click card to reveal answer')
    );
    const back = el('div',{class:'face back'},
      el('div',{class:'topic'},q.topic),
      el('div',{class:'ans-line'}, 'Answer: ', el('span',{class:'good'}, q.correct.join('  |  '))),
      el('div',{class:'exp'}, q.explanation||'')
    );
    inner.append(front,back);flash.append(inner);app.append(flash);

    const bar = el('div',{class:'flash-bar'},
      el('button',{class:'btn ghost',onclick:()=>{fcIdx=(fcIdx-1+fcOrder.length)%fcOrder.length;fcFlip=false;renderFlash();}},'‹ Prev'),
      el('div',{class:'counter'}, (fcIdx+1)+' / '+fcOrder.length),
      el('button',{class:'btn',onclick:()=>{fcIdx=(fcIdx+1)%fcOrder.length;fcFlip=false;renderFlash();}},'Next ›')
    );
    app.append(bar);
    app.append(el('div',{class:'hint'},'Keyboard: ← → to navigate, Space/↑ to flip'));
  }

  /* ===================== TAB: QUIZZES (list) ===================== */
  function renderQuizList(){
    app.innerHTML='';
    const scores = LS.get('quizScores',{});
    app.append(el('div',{class:'card',style:'margin-bottom:16px'},
      el('p',{class:'muted',style:'margin:0'},
        'All '+Q.length+' questions are split into '+QUIZ_COUNT+' exam-style sets of '+QUIZ_SIZE+
        ' questions. Passing score is '+PASS+'%. Results are saved'+(state.online?' to the cloud under "'+state.player+'"':' in this browser')+'.')
    ));
    const grid = el('div',{class:'grid cols2'});
    QUIZZES.forEach((ids,i)=>{
      const sc = scores[i];
      const tile = el('div',{class:'card quiz-tile',onclick:()=>startQuiz(i)},
        el('h3',{}, 'Practice Exam '+(i+1)),
        el('div',{class:'meta'}, QUIZ_SIZE+' questions • mixed topics'),
        el('div',{}, sc
          ? el('span',{class:'badge '+(sc.pct>=PASS?'score':'fail')}, (sc.pct>=PASS?'PASS ':'FAIL ')+sc.pct+'%')
          : el('span',{class:'badge'},'Not attempted'))
      );
      grid.append(tile);
    });
    app.append(grid);
  }

  /* ===================== QUIZ RUNNER ===================== */
  let run=null;
  function startQuiz(i){
    run={ quiz:i, ids:QUIZZES[i].slice(), pos:0, answers:{}, submitted:false };
    renderQuiz();
  }
  function renderQuiz(){
    app.innerHTML='';
    const ids=run.ids, q=Q[ids[run.pos]];
    const answered=Object.keys(run.answers).length;
    const weak=run.mode==='weak';
    app.append(el('div',{class:'qhead'},
      el('button',{class:'btn ghost sm',onclick:()=>{if(confirm('Leave quiz? Progress for this attempt is lost.'))go(weak?'weakquiz':'quizzes');}},'✕ Exit'),
      el('div',{class:'badge'}, weak?'🎯 Weak Quiz':'Exam '+(run.quiz+1)),
      el('div',{class:'progress'}, el('i',{style:'width:'+((run.pos+1)/ids.length*100)+'%'})),
      el('div',{class:'badge'}, (run.pos+1)+'/'+ids.length),
      el('div',{class:'badge'}, answered+' answered')
    ));

    const card=el('div',{class:'card'});
    card.append(el('div',{class:'topic',style:'color:var(--accent);font-size:12px;font-weight:700;text-transform:uppercase'},q.topic));
    card.append(el('div',{style:'font-size:18px;font-weight:600;margin:8px 0 4px;line-height:1.5'},q.q));
    const multi=q.correct.length>1;
    if(multi)card.append(el('div',{class:'muted',style:'font-size:13px;margin-bottom:6px'},'Select '+q.correct.length+'.'));

    const cur = run.answers[run.pos]||[];
    q.options.forEach(opt=>{
      const chosen=cur.includes(opt);
      const isCorrect=q.correct.includes(opt);
      let cls='opt'+(multi?' multi':'');
      if(run.submitted){
        if(isCorrect)cls+=' correct';
        else if(chosen)cls+=' wrong';
      } else if(chosen)cls+=' sel';
      const row=el('div',{class:cls});
      if(!run.submitted){
        row.addEventListener('click',()=>{
          let a=run.answers[run.pos]||[];
          if(multi){ a=a.includes(opt)?a.filter(x=>x!==opt):[...a,opt]; }
          else { a=[opt]; }
          run.answers[run.pos]=a; renderQuiz();
        });
      }
      const mark = run.submitted
        ? (isCorrect?'✓':(chosen?'✕':''))
        : (chosen?(multi?'✓':'●'):'');
      row.append(el('div',{class:'mark'},mark), el('div',{class:'opt-txt'},opt));
      card.append(row);
    });

    if(run.submitted){
      card.append(el('div',{class:'review-exp'},
        el('b',{},'Correct: '), q.correct.join('  |  '),
        el('div',{style:'margin-top:8px'}, q.explanation||'')
      ));
    }
    app.append(card);

    const nav=el('div',{class:'qnav'});
    nav.append(el('button',{class:'btn ghost',onclick:()=>{if(run.pos>0){run.pos--;renderQuiz();}},disabled:run.pos===0?'':null},'‹ Prev'));
    const right=el('div',{style:'display:flex;gap:10px'});
    if(run.pos<ids.length-1) right.append(el('button',{class:'btn',onclick:()=>{run.pos++;renderQuiz();}},'Next ›'));
    if(!run.submitted) right.append(el('button',{class:'btn',onclick:submitQuiz}, weak?'✓ Submit':'✓ Submit exam'));
    else right.append(el('button',{class:'btn',onclick:()=>weak?showWeakResult():showResult(run.quiz)},'See results'));
    nav.append(right);
    app.append(nav);

    const jump=el('div',{class:'card',style:'margin-top:16px'});
    jump.append(el('div',{class:'muted',style:'font-size:12px;margin-bottom:8px'},'Jump to question'));
    const jg=el('div',{style:'display:flex;flex-wrap:wrap;gap:6px'});
    ids.forEach((_,k)=>{
      const a=run.answers[k];
      let bg='var(--panel2)',bd='var(--line)';
      if(run.submitted){const qq=Q[ids[k]];const ok=a&&a.length===qq.correct.length&&a.every(x=>qq.correct.includes(x));bg=ok?'rgba(52,211,153,.2)':(a?'rgba(248,113,113,.2)':'var(--panel2)');}
      else if(a&&a.length)bg='rgba(61,169,252,.25)';
      if(k===run.pos)bd='var(--accent)';
      jg.append(el('button',{style:`width:30px;height:30px;border-radius:7px;border:1px solid ${bd};background:${bg};color:var(--text);cursor:pointer;font-size:12px`,onclick:()=>{run.pos=k;renderQuiz();}},k+1));
    });
    jump.append(jg);app.append(jump);
  }

  function gradeRun(){
    const ids=run.ids; let correct=0; const perTopic={}; const results=[];
    ids.forEach((qid,k)=>{
      const q=Q[qid]; const a=run.answers[k]||[];
      const ok=a.length===q.correct.length && a.every(x=>q.correct.includes(x));
      perTopic[q.topic]=perTopic[q.topic]||{c:0,t:0};
      perTopic[q.topic].t++; if(ok){perTopic[q.topic].c++;correct++;}
      results.push({q:q.q, topic:q.topic, ok});
    });
    const pct=Math.round(correct/ids.length*100);
    return {pct,correct,total:ids.length,perTopic,results};
  }
  // persist per-question history so flashcards can focus on what you miss
  function recordQuestionStats(results){
    const qstats=LS.get('qstats',{});
    results.forEach(r=>{
      const s=qstats[r.q]||{right:0,wrong:0,lastWrong:false,lastTs:0};
      if(r.ok)s.right++; else s.wrong++;
      s.lastWrong=!r.ok; s.lastTs=Date.now();
      qstats[r.q]=s;
    });
    LS.set('qstats',qstats);
  }
  let lastWeak=null; // transient result of the most recent weak quiz
  async function submitQuiz(){
    const unanswered=run.ids.length-Object.keys(run.answers).length;
    if(unanswered>0 && !confirm(unanswered+' question(s) unanswered. Submit anyway?'))return;
    run.submitted=true;
    const g=gradeRun();
    recordQuestionStats(g.results);          // always update per-question mastery
    refreshHeader();
    if(run.mode==='weak'){
      lastWeak={pct:g.pct,correct:g.correct,total:g.total,perTopic:g.perTopic};
      showWeakResult();
      return;
    }
    const scores=LS.get('quizScores',{});
    scores[run.quiz]={pct:g.pct,correct:g.correct,total:g.total,perTopic:g.perTopic,ts:Date.now()};
    LS.set('quizScores',scores);
    showResult(run.quiz);
    if(state.online && state.player){
      const missed=g.results.filter(r=>!r.ok).map(r=>({q:r.q,topic:r.topic}));
      API.saveAttempt({player:state.player,quiz:run.quiz,pct:g.pct,correct:g.correct,total:g.total,perTopic:g.perTopic,missed})
        .catch(()=>{});
    }
  }

  // Shared result view (hero medallion + topic breakdown + actions)
  function renderResultView(sc, opts){
    app.innerHTML='';
    const pass=sc.pct>=PASS;
    const hero=el('div',{class:'card score-hero'});
    const ring=el('div',{class:'ring',style:'--p:'+sc.pct});
    ring.append(el('div',{class:'inner'},el('div',{class:'pct'},sc.pct+'%'),el('div',{class:'lbl'},sc.correct+' / '+sc.total+' correct')));
    hero.append(ring);
    hero.append(el('div',{class:'verdict '+(pass?'pass':'fail')}, pass?'PASS':'NOT YET'));
    hero.append(el('div',{class:'muted'}, opts.subtitle));
    hero.append(el('div',{class:'kpis'},
      el('div',{class:'kpi'},el('b',{},sc.correct),el('span',{},'Correct')),
      el('div',{class:'kpi'},el('b',{},(sc.total-sc.correct)),el('span',{},'Incorrect')),
      el('div',{class:'kpi'},el('b',{},sc.pct+'%'),el('span',{},'Score'))
    ));
    hero.append(el('div',{style:'margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap'}, ...opts.actions));
    app.append(hero);

    const tcard=el('div',{class:'card',style:'margin-top:16px'});
    tcard.append(el('div',{class:'section-h'}, opts.breakdownLabel||'Topic breakdown'));
    Object.entries(sc.perTopic).sort((a,b)=>(a[1].c/a[1].t)-(b[1].c/b[1].t)).forEach(([t,v])=>{
      const p=Math.round(v.c/v.t*100);
      tcard.append(el('div',{class:'bar-row'},
        el('div',{class:'nm'},t),
        el('div',{class:'bar'},el('i',{style:`width:${p}%;background:${p>=PASS?'var(--ok)':p>=40?'var(--warn)':'var(--bad)'}`})),
        el('div',{class:'vv'},v.c+'/'+v.t)
      ));
    });
    app.append(tcard);
  }

  function showResult(i){
    const sc=LS.get('quizScores',{})[i];
    renderResultView(sc, {
      subtitle:'Passing score is '+PASS+'%. Exam '+(i+1)+(state.online?' • saved to cloud':' • saved locally')+'.',
      breakdownLabel:'Topic breakdown — this exam',
      actions:[
        el('button',{class:'btn',onclick:()=>{run={quiz:i,ids:QUIZZES[i].slice(),pos:0,answers:{},submitted:false};renderQuiz();}},'↻ Retake'),
        el('button',{class:'btn ghost',onclick:()=>{run={quiz:i,ids:QUIZZES[i].slice(),pos:0,answers:run.answers,submitted:true};renderQuiz();}},'🔍 Review answers'),
        el('button',{class:'btn ghost',onclick:()=>go('quizzes')},'← All exams')
      ]
    });
  }

  function showWeakResult(){
    const sc=lastWeak;
    renderResultView(sc, {
      subtitle:'Targeted practice on your missed questions. Correct answers now drop out of your weak set.',
      breakdownLabel:'Topic breakdown — weak quiz',
      actions:[
        el('button',{class:'btn',onclick:()=>startWeakQuiz()},'↻ New weak quiz'),
        el('button',{class:'btn ghost',onclick:()=>{run.pos=0;run.submitted=true;renderQuiz();}},'🔍 Review answers'),
        el('button',{class:'btn ghost',onclick:()=>go('weakquiz')},'← Weak Quiz')
      ]
    });
  }

  /* ===================== TAB: WEAK QUIZ ===================== */
  function startWeakQuiz(){
    const wd=weakDeck();
    if(!wd.ids.length){ go('weakquiz'); return; }
    let ids=wd.ids;
    if(wd.reason==='topics') ids=shuffle(ids, Date.now()&0xffffff); // variety for topic drills
    ids=ids.slice(0,60);
    run={ mode:'weak', quiz:'weak', ids, pos:0, answers:{}, submitted:false };
    renderQuiz();
  }
  function renderWeakQuiz(){
    app.innerHTML='';
    const wd=weakDeck();
    if(wd.reason==='none'){
      app.append(el('div',{class:'card center reveal',style:'padding:40px'},
        el('div',{style:'font-size:40px'},'🎯'),
        el('h3',{},'No weak questions yet'),
        el('p',{class:'muted'},'Take a Practice Exam first. The questions you miss are collected here into a targeted quiz so you can drill exactly what you got wrong.'),
        el('button',{class:'btn',onclick:()=>go('quizzes')},'Go to exams')
      ));
      return;
    }
    const n=Math.min(wd.ids.length,60);
    const desc = wd.reason==='missed'
      ? 'Built from the '+wd.ids.length+' question'+(wd.ids.length===1?'':'s')+' you have missed on recent exams — hardest first. Answer correctly and they drop out of your weak set.'
      : 'No individually-missed questions are tracked yet, so this drills your weakest topics (under 99% mastery): '+(wd.topics||[]).join(', ')+'.';

    const hero=el('div',{class:'card score-hero reveal'});
    hero.append(el('div',{style:'font-size:40px'},'🎯'));
    hero.append(el('div',{class:'verdict',style:'color:var(--burg)'},'Weak Quiz'));
    hero.append(el('div',{class:'muted',style:'max-width:560px;margin:0 auto'}, desc));
    hero.append(el('div',{class:'kpis'},
      el('div',{class:'kpi'},el('b',{},n),el('span',{},'Questions')),
      el('div',{class:'kpi'},el('b',{}, wd.reason==='missed'?'Missed':'Weak topics'),el('span',{},'Source'))
    ));
    hero.append(el('div',{style:'margin-top:18px'},
      el('button',{class:'btn',onclick:startWeakQuiz},'▶ Start weak quiz')));
    app.append(hero);

    // preview the weak questions
    const list=el('div',{class:'card reveal',style:'margin-top:16px'});
    list.append(el('div',{class:'section-h'},'In this quiz'));
    const qstats=LS.get('qstats',{});
    wd.ids.slice(0,n).forEach((id,idx)=>{
      const q=Q[id]; const s=qstats[q.q];
      const tag = s ? ('missed '+s.wrong+'×') : q.topic;
      list.append(el('div',{class:'bar-row',style:'grid-template-columns:30px 1fr auto'},
        el('div',{class:'rank',style:'color:var(--muted);font-family:var(--display)'}, String(idx+1)),
        el('div',{class:'nm',style:'color:var(--ink2)'}, q.q),
        el('div',{}, el('span',{class:'badge fail'}, tag))
      ));
    });
    app.append(list);
  }

  /* ===================== TAB: SCOREBOARD ===================== */
  function renderScoreboard(){
    app.innerHTML='';
    const scores=LS.get('quizScores',{});
    const taken=Object.values(scores);
    if(!taken.length){
      app.append(el('div',{class:'card center',style:'padding:40px'},
        el('div',{style:'font-size:40px'},'📊'),
        el('h3',{},'No exams taken yet'),
        el('p',{class:'muted'},'Take a Practice Exam to populate your CAD scoreboard and topic analysis.'),
        el('button',{class:'btn',onclick:()=>go('quizzes')},'Go to exams')
      ));
      return;
    }
    const avg=Math.round(taken.reduce((s,x)=>s+x.pct,0)/taken.length);
    const best=Math.max(...taken.map(x=>x.pct));
    const passed=taken.filter(x=>x.pct>=PASS).length;

    const hero=el('div',{class:'card score-hero'});
    const ring=el('div',{class:'ring',style:'--p:'+avg});
    ring.append(el('div',{class:'inner'},el('div',{class:'pct'},avg+'%'),el('div',{class:'lbl'},'avg score')));
    hero.append(ring);
    hero.append(el('div',{class:'verdict '+(avg>=PASS?'pass':'fail')}, avg>=PASS?'On track':'Keep studying'));
    hero.append(el('div',{class:'kpis'},
      el('div',{class:'kpi'},el('b',{},taken.length+'/'+QUIZ_COUNT),el('span',{},'Exams taken')),
      el('div',{class:'kpi'},el('b',{},best+'%'),el('span',{},'Best score')),
      el('div',{class:'kpi'},el('b',{},passed),el('span',{},'Passed (≥'+PASS+'%)'))
    ));
    app.append(hero);

    const ec=el('div',{class:'card',style:'margin-top:16px'});
    ec.append(el('div',{class:'section-h'},'Exam scores'));
    for(let i=0;i<QUIZ_COUNT;i++){
      const sc=scores[i];
      const p=sc?sc.pct:0;
      ec.append(el('div',{class:'bar-row'},
        el('div',{class:'nm'},'Exam '+(i+1)),
        el('div',{class:'bar'},el('i',{style:`width:${p}%;background:${!sc?'var(--line)':p>=PASS?'var(--ok)':'var(--bad)'}`})),
        el('div',{class:'vv'}, sc? p+'%':'—')
      ));
    }
    app.append(ec);

    const agg={};
    taken.forEach(s=>Object.entries(s.perTopic||{}).forEach(([t,v])=>{agg[t]=agg[t]||{c:0,t:0};agg[t].c+=v.c;agg[t].t+=v.t;}));
    const tc=el('div',{class:'card',style:'margin-top:16px'});
    tc.append(el('div',{class:'section-h'},'Topic mastery (all attempts)'));
    const rows=Object.entries(agg).sort((a,b)=>(a[1].c/a[1].t)-(b[1].c/b[1].t));
    rows.forEach(([t,v])=>{
      const p=Math.round(v.c/v.t*100);
      tc.append(el('div',{class:'bar-row'},
        el('div',{class:'nm'},t),
        el('div',{class:'bar'},el('i',{style:`width:${p}%;background:${p>=PASS?'var(--ok)':p>=40?'var(--warn)':'var(--bad)'}`})),
        el('div',{class:'vv'},p+'%')
      ));
    });
    if(rows.length){
      const weak=rows[0];
      tc.append(el('div',{class:'review-exp'}, el('b',{},'💡 Focus next on: '), weak[0]+' — '+Math.round(weak[1].c/weak[1].t*100)+'% mastery.'));
    }
    app.append(tc);

    app.append(el('div',{class:'center',style:'margin-top:18px'},
      el('button',{class:'btn ghost',onclick:()=>{if(confirm('Clear locally cached scores? (Cloud history is kept.)')){LS.set('quizScores',{});refreshHeader();syncFromCloud().then(renderScoreboard);}}},'Reset local scores')));
  }

  /* ===================== TAB: LEADERBOARD ===================== */
  async function renderLeaderboard(){
    app.innerHTML='';
    app.append(el('div',{class:'card center',style:'padding:30px'},el('div',{class:'muted'},'Loading leaderboard…')));
    if(!state.online){
      app.innerHTML='';
      app.append(el('div',{class:'card center',style:'padding:40px'},
        el('div',{style:'font-size:40px'},'🏆'),
        el('h3',{},'Leaderboard needs the database'),
        el('p',{class:'muted'},'Connect a Vercel Postgres database to this project and the leaderboard will rank everyone by best score automatically. Until then, scores are saved in your browser only.')
      ));
      return;
    }
    let lb=[];
    try{ lb=await API.leaderboard(); }catch(e){ app.innerHTML=''; app.append(el('div',{class:'card center',style:'padding:30px'},el('div',{class:'muted'},'Could not load leaderboard.')));return; }
    app.innerHTML='';
    const card=el('div',{class:'card'});
    card.append(el('div',{class:'section-h'},'Leaderboard — best score per person'));
    if(!lb.length){ card.append(el('p',{class:'muted'},'No attempts yet. Be the first!')); app.append(card); return; }
    const tbl=el('table',{class:'lb'});
    tbl.append(el('thead',{},el('tr',{},el('th',{class:'rank'},'#'),el('th',{},'Player'),el('th',{},'Best'),el('th',{},'Attempts'))));
    const body=el('tbody',{});
    lb.forEach((r,i)=>{
      const tr=el('tr', r.player===state.player?{class:'me'}:{},
        el('td',{class:'rank'}, '#'+(i+1)),
        el('td',{}, r.player + (r.player===state.player?'  (you)':'')),
        el('td',{class:'pct',style:'color:'+(r.best>=PASS?'var(--ok)':'var(--bad)')}, r.best+'%'),
        el('td',{}, String(r.attempts))
      );
      body.append(tr);
    });
    tbl.append(body); card.append(tbl); app.append(card);
  }

  /* ===================== ROUTER ===================== */
  function go(tab){
    if(!state.player){ ensurePlayer().then(()=>{refreshHeader();go(tab);}); return; }
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
    LS.set('activeTab',tab);
    if(tab==='flash')renderFlash();
    else if(tab==='quizzes')renderQuizList();
    else if(tab==='weakquiz')renderWeakQuiz();
    else if(tab==='scoreboard')renderScoreboard();
    else if(tab==='leaderboard')renderLeaderboard();
  }
  window.__go=go;

  document.addEventListener('keydown',e=>{
    if(document.querySelector('.tab.active')?.dataset.tab!=='flash')return;
    if(!fcOrder.length)return;
    if(e.key==='ArrowRight'){fcIdx=(fcIdx+1)%fcOrder.length;fcFlip=false;renderFlash();}
    else if(e.key==='ArrowLeft'){fcIdx=(fcIdx-1+fcOrder.length)%fcOrder.length;fcFlip=false;renderFlash();}
    else if(e.key===' '||e.key==='ArrowUp'){e.preventDefault();fcFlip=!fcFlip;if(flashEl)flashEl.classList.toggle('flipped');}
  });
  $('#stat-player').addEventListener('click',changeName);

  /* ===================== BOOTSTRAP ===================== */
  async function bootstrap(){
    // 1) load questions: DB first, then static questions.json, then bundled JS
    try{
      const dbq = await API.getQuestions();
      if(dbq && dbq.length){ Q = dbq.map((q,i)=>({...q,_id:i})); state.online=true; }
      else throw new Error('empty');
    }catch(e){
      state.online=false;
      try{
        const r = await fetch('data/questions.json',{headers:{accept:'application/json'}});
        const arr = await r.json();
        Q = arr.map((q,i)=>({...q,_id:i}));
      }catch(e2){
        Q = (window.ALL_QUESTIONS||[]).map((q,i)=>({...q,_id:i}));
      }
    }
    TOPICS = [...new Set(Q.map(q=>q.topic))].sort();
    QUIZZES = buildQuizzes();

    await ensurePlayer();
    refreshHeader();
    await syncFromCloud();
    if(hasResults()) fcTopic='weak';   // flashcards default to your weak spots
    go(LS.get('activeTab','flash'));
  }
  bootstrap();
})();
