# FDP on Mathematical Foundations — website

Self-learning material and quizzes for the Faculty Development Programme, Department of CSE,
Sahrdaya College of Engineering and Technology (16–30 November 2026).

| Folder | What it is | Link after hosting |
| --- | --- | --- |
| `index.html` | Home page linking to everything | `https://<username>.github.io/<repo>/` |
| `linear-algebra/` | Linear Algebra Essentials (Phase 1, 16–17 Nov) | `.../linear-algebra/` |
| `course/` | Full 12-day Mathematics Prerequisite Programme | `.../course/` |
| `quiz/` | Quiz Hall: coordinator-set, full-screen quizzes | `.../quiz/` |
| `shared/` | Code used by `course/` and `linear-algebra/` (coordinator content manager). Upload it with the site | — |
| `apps-script/` | Google Sheets backends (not part of the website; paste into Apps Script) | — |

## Host on GitHub Pages

1. Sign in at github.com → **+** → **New repository**. Name it e.g. `fdp-math`, choose **Public**, click **Create repository**.
2. Click **uploading an existing file**. Drag in **the contents of this folder** (index.html, README.md, .nojekyll and the
   course, linear-algebra, quiz, shared and apps-script folders), not the folder itself. Click **Commit changes**.
   - `.nojekyll` is a hidden file. If your computer hides it, it is optional; the site works without it.
3. **Settings → Pages** → Source: **Deploy from a branch** → Branch **main**, folder **/ (root)** → **Save**.
4. After 1–2 minutes the site is live at `https://<username>.github.io/fdp-math/`.

To update later, upload the changed file into the same folder (same name) and commit. The links stay the same.

### Using git instead

```bash
cd fdp-math-site
git init -b main
git add .
git commit -m "FDP maths site"
git remote add origin https://github.com/<username>/fdp-math.git
git push -u origin main
```

Then turn on Pages as in step 3.

## Collect scores in Google Sheets (do this before sharing links)

Without this, the pages run in demo mode and scores stay in each person's browser.

All three pages share **one** script and **one** Google Sheet: `apps-script/FDPBackend.gs`.
1. New Google Sheet → **Extensions → Apps Script**. Delete any existing files, paste `FDPBackend.gs` as the only file → change `ADMIN_KEY` to your own secret → Save.
2. Run `doGet` once and authorise. Then **Deploy → New deployment → Web app**; Execute as **Me**; Who has access **Anyone** → Deploy → copy the URL ending in `/exec`.
3. Put that same URL in all three pages, in the SETTINGS block near the top of each script, and commit:
   - `quiz/index.html` → `SCRIPT_URL: "<URL>"`
   - `course/index.html` and `linear-algebra/index.html` → `SHEET_URL: "<URL>"`, and change `ADMIN_PIN`.
4. Open `.../quiz/#admin` and sign in with your `ADMIN_KEY` to create quizzes. Use the same key for *Add content for participants* in the course pages.

## What coordinators can do from the website

**Quizzes** (`.../quiz/#admin`, sign in with `ADMIN_KEY`)
- **+ New quiz**: write questions, or paste them from Excel/Google Sheets.
- **Publish and close on time**: in the quiz editor, tick *Published* and set *Opens at* and *Closes at*.
  The quiz appears as "Opens soon" on the lobby, goes live by itself, and stops accepting answers at the closing time.
  People still answering are submitted automatically at that moment (answers arriving up to 90 seconds late are still accepted).
  Leave a time empty to open as soon as published, or to close only when you press the button.
- On the quiz list: **Publish now**, **Close now**, **Unpublish**, **Reopen** (for a quiz whose time has passed), **Edit**, **Results**.
- Times are entered in the coordinator's computer time zone. Error messages that quote a time use the Apps Script
  project's time zone (Apps Script → Project Settings).

**Videos, materials, notes and new topics** (`.../course/#admin` and `.../linear-algebra/#admin`, PIN, then *Add content for participants*)
- **Extra video**, **Material or link** (PDF, slides, Drive folder, website), **Note or announcement**: attach to one topic or to a whole day.
- **A whole new day**: give it a number (after the last existing day), a title and a short description. It appears on the home page and side menu under "Added by your coordinator". Then add topics and quiz questions to it.
- **Quiz questions for a day**: type or paste questions as plain text (question, options `A) B) C)…`, then `Answer: B`, optional `Explanation: …`; a blank line between questions). They are added to the day's quiz, or tick *Replace* to use only yours.
- **A poll** on a day or a topic: a question and 2 to 6 options. Everyone can vote and see the results; a poll does not lock the quiz. Results per option are shown in the coordinator list.
- **Replace the main video** of a topic for everyone (also available on each topic page while in coordinator view).
- **A whole new topic** at the end of a day, with video, reading notes and its own poll.
- Every item can be published/hidden, shown from a date and hidden after a date. Items can be edited or deleted later.
- This needs `apps-script/FDPBackend.gs` deployed with your own `ADMIN_KEY` set (the key is asked once per browser tab).
  Without `SHEET_URL` the items are kept only in the coordinator's own browser, so other participants will not see them.

After editing an Apps Script later: **Deploy → Manage deployments → Edit → Version: New version → Deploy** (the URL stays the same).

## Notes
- The repository is public: anyone can read the page source, so change the course `ADMIN_PIN` before uploading.
  Quiz answers and the quiz `ADMIN_KEY` live only in Google Sheets / Apps Script, never in this repository.
- Open the site through its `github.io` link. Opening the files directly from your computer can stop YouTube videos playing.
