#!/usr/bin/env node
/* Parse data/bank.txt (delimited, escape-free) into:
     - data/questions.json   (used by the frontend offline + as DB seed)
     - api/_seed.json         (used by the API to seed Postgres)
   Run:  node scripts/build-bank.js
*/
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'data', 'bank.txt'), 'utf8');

const chunks = src.split('[[Q]]').map(c => c.trim()).filter(Boolean);
const questions = [];
const problems = [];

chunks.forEach((chunk, idx) => {
  const lines = chunk.split('\n');
  let topic = '', q = '', options = [], correct = [], exp = [];
  let mode = 'head';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (mode === 'exp') {
      if (line.trim() === '<<<') { mode = 'done'; continue; }
      exp.push(line);
      continue;
    }
    if (line.trim() === '>>>') { mode = 'exp'; continue; }
    if (line.startsWith('topic:')) topic = line.slice(6).trim();
    else if (line.startsWith('question:')) q = line.slice(9).trim();
    else if (line.startsWith('*- ')) { const o = line.slice(3).trim(); options.push(o); correct.push(o); }
    else if (line.startsWith('- ')) options.push(line.slice(2).trim());
  }
  const explanation = exp.join('\n').trim();
  if (!q) problems.push(`#${idx}: missing question`);
  if (!options.length) problems.push(`#${idx} (${q.slice(0,40)}): no options`);
  if (!correct.length) problems.push(`#${idx} (${q.slice(0,40)}): no correct answer`);
  correct.forEach(c => { if (!options.includes(c)) problems.push(`#${idx} (${q.slice(0,40)}): correct not in options`); });
  questions.push({ topic, q, options, correct, explanation });
});

if (problems.length) {
  console.error('INTEGRITY PROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}

fs.writeFileSync(path.join(root, 'data', 'questions.json'), JSON.stringify(questions));
fs.writeFileSync(path.join(root, 'api', '_seed.json'), JSON.stringify(questions));
console.log(`Built ${questions.length} questions -> data/questions.json + api/_seed.json`);
const byTopic = {};
questions.forEach(q => byTopic[q.topic] = (byTopic[q.topic] || 0) + 1);
console.log(Object.entries(byTopic).sort((a,b)=>b[1]-a[1]).map(([t,n])=>`  ${n}  ${t}`).join('\n'));
