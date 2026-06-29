# ServiceNow CAD Trainer

A zero-build static web app: flashcards, 10 × 60-question practice exams, and a
CAD-style scoreboard with topic analytics. 227 questions, no dependencies, no
internet required at runtime. Scores persist in the browser (localStorage).

```
cad-flashcards/
├── index.html        # entry point
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

It's a pure static site — no build step.

### Option A — Vercel CLI (fastest)
```bash
npm i -g vercel        # if needed
cd cad-flashcards
vercel                 # preview deploy  (accept defaults)
vercel --prod          # production deploy
```
When asked for settings, accept defaults: **Framework Preset = Other**,
**Build Command = (none)**, **Output Directory = ./**.

### Option B — Git + Vercel dashboard
1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Vercel: **Add New → Project**, import the repo.
3. Set **Root Directory = `cad-flashcards`** (since the app lives in a subfolder).
4. Framework Preset = **Other**, leave Build Command empty.
5. **Deploy**.

### Option C — Drag & drop
Zip the contents of `cad-flashcards/` and drop it on https://vercel.com/new.
