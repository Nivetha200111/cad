/* ServiceNow CAD Flashcards + Quiz Engine */
(function(){
  "use strict";
  const Q = (window.ALL_QUESTIONS || []).map((q,i)=>({...q, _id:i}));
  const PASS = 70; // CAD passing %
  const QUIZ_SIZE = 60, QUIZ_COUNT = 10;
  const LS = {
    get(k,d){ try{return JSON.parse(localStorage.getItem(k)) ?? d;}catch(e){return d;} },
    set(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
  };

  /* ---------- seeded shuffle so quizzes are stable per build ---------- */
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  function shuffle(arr, seed){const a=arr.slice();const r=mulberry32(seed);for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

  /* Build the 10 quizzes. If the bank has >= 600 questions we slice into
     non-overlapping 60s; otherwise each exam is its own 60-question shuffle
     of the full pool (standard mock-exam behavior, overlap allowed). */
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
  const QUIZZES = buildQuizzes();

  /* ---------- topics ---------- */
  const TOPICS = [...new Set(Q.map(q=>q.topic))].sort();

  /* ---------- DOM helpers ---------- */
  const $=(s,el=document)=>el.querySelector(s);
  const el=(tag,props={},...kids)=>{const n=document.createElement(tag);Object.entries(props).forEach(([k,v])=>{if(k==='class')n.className=v;else if(k==='html')n.innerHTML=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else n.setAttribute(k,v);});kids.flat().forEach(k=>n.append(k?.nodeType?k:document.createTextNode(k??'')));return n;};
  const app = $('#app');

  /* ---------- header stats ---------- */
  function refreshHeader(){
    $('#stat-total').textContent = Q.length;
    const scores = LS.get('quizScores',{});
    const taken = Object.keys(scores).length;
    $('#stat-taken').textContent = taken+'/'+QUIZ_COUNT;
    const best = Object.values(scores).reduce((m,s)=>Math.max(m,s.pct),0);
    $('#stat-best').textContent = taken? best+'%':'—';
  }

  /* ===================== TAB: FLASHCARDS ===================== */
  let fcOrder=[], fcIdx=0, fcFlip=false, fcTopic='all';
  function flashSet(){
    fcOrder = (fcTopic==='all'?Q:Q.filter(q=>q.topic===fcTopic)).map(q=>q._id);
    fcIdx=0;fcFlip=false;
  }
  function renderFlash(){
    if(!fcOrder.length) flashSet();
    app.innerHTML='';
    const ctrl = el('div',{class:'card',style:'margin-bottom:16px'},
      el('div',{class:'grid cols3'},
        (()=>{const l=el('label',{class:'fld'},'Topic');
          const s=el('select',{onchange:e=>{fcTopic=e.target.value;flashSet();renderFlash();}});
          s.append(el('option',{value:'all'},'All topics ('+Q.length+')'));
          TOPICS.forEach(t=>{const o=el('option',{value:t},t+' ('+Q.filter(q=>q.topic===t).length+')');if(t===fcTopic)o.selected=true;s.append(o);});
          l.append(s);return l;})(),
        el('label',{class:'fld'},'Shuffle',
          el('button',{class:'btn ghost',onclick:()=>{fcOrder=shuffle(fcOrder,Date.now()&0xffffff);fcIdx=0;fcFlip=false;renderFlash();}},'🔀 Shuffle deck')),
        el('label',{class:'fld'},'Reset order',
          el('button',{class:'btn ghost',onclick:()=>{flashSet();renderFlash();}},'↺ Reset'))
      )
    );
    app.append(ctrl);

    const q = Q[fcOrder[fcIdx]];
    const flash = el('div',{class:'flash'+(fcFlip?' flipped':'')});
    const inner = el('div',{class:'flash-inner',onclick:()=>{fcFlip=!fcFlip;renderFlash();}});
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
        'All '+Q.length+' questions were shuffled and split into '+QUIZ_COUNT+' exam-style sets of '+QUIZ_SIZE+
        ' questions. Passing score is '+PASS+'%. Your results feed the Scoreboard.')
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
    app.append(el('div',{class:'qhead'},
      el('button',{class:'btn ghost sm',onclick:()=>{if(confirm('Leave quiz? Progress for this attempt is lost.'))go('quizzes');}},'✕ Exit'),
      el('div',{class:'badge'},'Exam '+(run.quiz+1)),
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
    if(!run.submitted) right.append(el('button',{class:'btn',onclick:submitQuiz},'✓ Submit exam'));
    else right.append(el('button',{class:'btn',onclick:()=>showResult(run.quiz)},'See results'));
    nav.append(right);
    app.append(nav);

    // jump grid
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
    const ids=run.ids; let correct=0; const perTopic={};
    ids.forEach((qid,k)=>{
      const q=Q[qid]; const a=run.answers[k]||[];
      const ok=a.length===q.correct.length && a.every(x=>q.correct.includes(x));
      perTopic[q.topic]=perTopic[q.topic]||{c:0,t:0};
      perTopic[q.topic].t++; if(ok){perTopic[q.topic].c++;correct++;}
    });
    const pct=Math.round(correct/ids.length*100);
    return {pct,correct,total:ids.length,perTopic,answered:Object.keys(run.answers).length};
  }
  function submitQuiz(){
    const unanswered=run.ids.length-Object.keys(run.answers).length;
    if(unanswered>0 && !confirm(unanswered+' question(s) unanswered. Submit anyway?'))return;
    run.submitted=true;
    const g=gradeRun();
    const scores=LS.get('quizScores',{});
    scores[run.quiz]={pct:g.pct,correct:g.correct,total:g.total,perTopic:g.perTopic,ts:Date.now()};
    LS.set('quizScores',scores);
    refreshHeader();
    showResult(run.quiz);
  }

  function showResult(i){
    const scores=LS.get('quizScores',{}); const sc=scores[i];
    app.innerHTML='';
    const pass=sc.pct>=PASS;
    const hero=el('div',{class:'card score-hero'});
    const ring=el('div',{class:'ring',style:'--p:'+sc.pct});
    ring.append(el('div',{class:'inner'},el('div',{class:'pct'},sc.pct+'%'),el('div',{class:'lbl'},sc.correct+' / '+sc.total+' correct')));
    hero.append(ring);
    hero.append(el('div',{class:'verdict '+(pass?'pass':'fail')}, pass?'PASS':'NOT YET'));
    hero.append(el('div',{class:'muted'}, 'Passing score is '+PASS+'%. Exam '+(i+1)+'.'));
    hero.append(el('div',{class:'kpis'},
      el('div',{class:'kpi'},el('b',{},sc.correct),el('span',{},'Correct')),
      el('div',{class:'kpi'},el('b',{},(sc.total-sc.correct)),el('span',{},'Incorrect')),
      el('div',{class:'kpi'},el('b',{},sc.pct+'%'),el('span',{},'Score'))
    ));
    hero.append(el('div',{style:'margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap'},
      el('button',{class:'btn',onclick:()=>{run={quiz:i,ids:QUIZZES[i].slice(),pos:0,answers:{},submitted:false};renderQuiz();}},'↻ Retake'),
      el('button',{class:'btn ghost',onclick:()=>{run={quiz:i,ids:QUIZZES[i].slice(),pos:0,answers:run.answers,submitted:true};renderQuiz();}},'🔍 Review answers'),
      el('button',{class:'btn ghost',onclick:()=>go('quizzes')},'← All exams')
    ));
    app.append(hero);

    const tcard=el('div',{class:'card',style:'margin-top:16px'});
    tcard.append(el('div',{class:'section-h'},'Topic breakdown — this exam'));
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

    // per-exam
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

    // aggregate topic analysis across all attempts
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
      el('button',{class:'btn ghost',onclick:()=>{if(confirm('Clear all saved scores?')){LS.set('quizScores',{});refreshHeader();renderScoreboard();}}},'Reset all scores')));
  }

  /* ===================== ROUTER ===================== */
  function go(tab){
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
    LS.set('activeTab',tab);
    if(tab==='flash')renderFlash();
    else if(tab==='quizzes')renderQuizList();
    else if(tab==='scoreboard')renderScoreboard();
  }
  window.__go=go;

  document.addEventListener('keydown',e=>{
    if(document.querySelector('.tab.active')?.dataset.tab!=='flash')return;
    if(e.key==='ArrowRight'){fcIdx=(fcIdx+1)%fcOrder.length;fcFlip=false;renderFlash();}
    else if(e.key==='ArrowLeft'){fcIdx=(fcIdx-1+fcOrder.length)%fcOrder.length;fcFlip=false;renderFlash();}
    else if(e.key===' '||e.key==='ArrowUp'){e.preventDefault();fcFlip=!fcFlip;renderFlash();}
  });

  refreshHeader();
  go(LS.get('activeTab','flash'));
})();
