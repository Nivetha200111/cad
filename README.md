# ServiceNow CAD Trainer

A zero-build static web app: flashcards, 10 × 60-question practice exams, and a
CAD-style scoreboard with topic analytics. 227 questions, no dependencies, no
internet required at runtime. Scores persist in the browser (localStorage).

```
.
├── index.html        # entry point (repo root)
├── styles.css
├── app.js            # flashcard + quiz + scoreboard engine
├── data/q1..q6.js    # question bank
└── vercel.json       # static deploy config
```

## Run locally
Just open `index.html`, or serve the folder:
```bash
python3 -m http.server 4321
# visit http://localhost:4321
```

## Deploy to Vercel

It's a pure static site at the repo root — **no build step, no settings needed.**

### Option A — Git + Vercel dashboard (recommended)
1. In Vercel: **Add New → Project**, import this repo (`Nivetha200111/cad`).
2. Leave **Root Directory = `./`**, Framework Preset = **Other**, Build Command empty.
3. **Deploy**.

### Option B — Vercel CLI
```bash
npm i -g vercel        # if needed
vercel                 # preview deploy  (accept defaults)
vercel --prod          # production deploy
```

### Option C — Drag & drop
Zip the repo contents and drop them on https://vercel.com/new.
