/**
 * FDP website — ONE Google Sheets backend for everything
 * ------------------------------------------------------------------
 * Serves all three pages from a single Apps Script and a single Google Sheet:
 *   quiz/             Quiz Hall      (quizzes, questions, responses, scheduling)
 *   course/           12-day course  (scores, polls, logins, coordinator content)
 *   linear-algebra/   Phase 1 module (same as course)
 *
 * ONE-TIME SETUP (about 5 minutes)
 *  1. Create a new Google Sheet, e.g. "FDP Website Data".
 *  2. Extensions → Apps Script. Delete ALL existing files (Code.gs etc.), then paste this whole file as the only file.
 *  3. Change ADMIN_KEY below to your own secret (the coordinator key for quizzes AND content). Save.
 *  4. Run "doGet" once from the toolbar and authorise.
 *  5. Deploy → New deployment → Select type: Web app
 *        Execute as:     Me
 *        Who has access: Anyone
 *     Click Deploy and copy the Web app URL (ends in /exec).
 *  6. Put that SAME URL in all three pages:
 *        quiz/index.html             SCRIPT_URL: "<URL>"
 *        course/index.html           SHEET_URL:  "<URL>"
 *        linear-algebra/index.html   SHEET_URL:  "<URL>"
 *
 * AFTER EDITING THIS SCRIPT: Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.
 * The URL stays the same.
 *
 *   live/             Live games    (Kahoot-style: coordinator releases questions, faculty answer on their phones)
 *
 * Tabs created automatically: Quizzes, Questions, Responses, Feedback, Scores, Polls, Logins, Content, LiveGames, LiveAnswers.
 */

const ADMIN_KEY = "change-this-key";
// Only needed if this script was NOT created from the Sheet's Extensions → Apps Script menu (a "standalone" script).
// Paste the Sheet's ID here: the long text between /d/ and /edit in the Sheet's address bar.
const SHEET_ID = "";

const COLS = {
  Quizzes:   ["id", "title", "description", "open", "timeLimit", "showScore", "showReview", "oneAttempt", "shuffle", "passPercent", "opensAt", "closesAt", "day", "speaker", "feedback"],
  Questions: ["quizId", "qid", "order", "question", "optA", "optB", "optC", "optD", "optE", "optF", "correct", "explanation", "marks"],
  Responses: ["time", "quizId", "quizTitle", "name", "emp", "dept", "score", "total", "percent", "passed",
              "timeTakenSec", "fullscreenExits", "tabSwitches", "answers"],
  Feedback:  ["time", "quizId", "quizTitle", "day", "speaker", "name", "emp", "dept", "speakerRating", "relevanceRating", "comment"],
  Scores:    ["Time", "Name", "Emp ID", "Dept", "Courses", "Day", "Day title", "Attempt", "Score", "Total", "Percent", "Passed", "Answers"],
  Polls:     ["Time", "Name", "Emp ID", "Dept", "Poll ID", "Topic", "Option #", "Option text", "Previous option #"],
  Logins:    ["Time", "Name", "Emp ID", "Dept", "Courses"],
  Content:   ["id", "site", "day", "topic", "type", "title", "url", "text", "extra", "published", "publishAt", "expiresAt", "created"],
  LiveGames: ["id", "title", "status", "phase", "qIndex", "startsAt", "endsAt", "questions", "created"],
  LiveAnswers: ["time", "gameId", "qIndex", "emp", "name", "dept", "choice", "elapsedMs", "points"]
};
const LETTERS = "ABCDEF";

/* ---------------- sheet helpers ---------------- */
function sheet_(name) {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, COLS[name].length).setValues([COLS[name]]).setFontWeight("bold");
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() > 0) {
    // add any columns introduced by a newer version of this script (e.g. opensAt, closesAt)
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const missing = COLS[name].filter(c => head.indexOf(c) < 0);
    if (missing.length) sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
  }
  return sh;
}
function rows_(name) {
  const v = sheet_(name).getDataRange().getValues();
  const head = v.shift() || [];
  return v.filter(r => r.join("") !== "").map(r => {
    const o = {}; head.forEach((h, i) => o[h] = r[i]); return o;
  });
}
function rewrite_(name, objs) {
  const sh = sheet_(name), cols = COLS[name];
  sh.clearContents();
  const data = [cols].concat(objs.map(o => cols.map(c => o[c] === undefined || o[c] === null ? "" : o[c])));
  const range = sh.getRange(1, 1, data.length, cols.length);
  // Questions are stored as plain text. Otherwise Google Sheets turns an option such as "4, 5" or "1, 3" into a date.
  if (name === "Questions" || name === "LiveGames") range.setNumberFormat("@");
  range.setValues(data);
  sh.getRange(1, 1, 1, cols.length).setFontWeight("bold");
}
const bool_ = v => v === true || String(v).trim().toUpperCase() === "TRUE";
const num_ = (v, d) => (v === "" || v === null || v === undefined || isNaN(Number(v))) ? (d === undefined ? 0 : d) : Number(v);
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function adminCheck_(d) {
  if (ADMIN_KEY === "change-this-key") return "Set your own ADMIN_KEY in the Apps Script first, then redeploy.";
  if (d.key !== ADMIN_KEY) return "That coordinator key is not correct.";
  return "";
}

/* ---------------- GET: everything participants read ---------------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    // --- Quiz Hall ---
    if (p.action === "quizzes") {
      const qs = rows_("Questions");
      const now = Date.now();
      return json_({ now: now, quizzes: rows_("Quizzes").map(quizFromRow_)
        .filter(q => { const st = state_(q, now); return st === "live" || st === "scheduled"; }).map(q => ({
        id: q.id, title: q.title, description: q.description, timeLimit: q.timeLimit,
        opensAt: q.opensAt, closesAt: q.closesAt, upcoming: state_(q, now) === "scheduled",
        count: qs.filter(r => String(r.quizId) === q.id).length
      })) });
    }
    if (p.action === "quiz") {
      const quiz = loadQuiz_(p.id);
      if (!quiz) return json_({ error: "This quiz does not exist. Check the link with your coordinator." });
      const now = Date.now(), st = state_(quiz, now);
      if (st === "closed") return json_({ error: "This quiz is not open right now." });
      if (st === "scheduled") return json_({ error: "This quiz opens on " + fmt_(quiz.opensAt) + ".", opensAt: quiz.opensAt, now: now });
      if (st === "ended") return json_({ error: "This quiz closed on " + fmt_(quiz.closesAt) + ".", closesAt: quiz.closesAt, now: now });
      if (quiz.oneAttempt && p.emp && attempted_(quiz.id, p.emp))
        return json_({ error: "You have already submitted this quiz. Only one attempt is allowed." });
      let questions = quiz.questions.map(q => ({ qid: q.qid, text: q.text, options: q.options }));
      if (quiz.shuffle) questions = shuffle_(questions);
      return json_({ quiz: { id: quiz.id, title: quiz.title, description: quiz.description, timeLimit: quiz.timeLimit,
        passPercent: quiz.passPercent, count: questions.length,
        opensAt: quiz.opensAt, closesAt: quiz.closesAt, day: quiz.day, speaker: quiz.speaker, feedback: quiz.feedback }, questions: questions, now: now });
    }
    if (p.action === "liveState") return json_(liveState_(p));      // Live games: what a participant sees right now
    // --- Course / Linear Algebra ---
    if (p.action === "content") {          // published items inside their visibility window
      const now = Date.now(), site = p.site || "course";
      return json_({ now: now, items: contentRows_().filter(r => r.site === site && contentLive_(r, now)) });
    }
    if (p.action === "tally" && p.poll) {  // each person's latest vote
      const rows = sheet_("Polls").getDataRange().getValues().slice(1);
      const latest = {};
      rows.forEach(r => { if (String(r[4]) === p.poll) latest[String(r[2])] = Number(r[6]); });
      const counts = [];
      Object.keys(latest).forEach(k => { const i = latest[k]; counts[i] = (counts[i] || 0) + 1; });
      for (let i = 0; i < counts.length; i++) counts[i] = counts[i] || 0;
      while (counts.length < 4) counts.push(0);
      return json_({ counts: counts });
    }
    return json_({ ok: true, service: "fdp-backend" });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

/* ---------------- POST: submissions, score recording, coordinator actions ---------------- */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: "Bad request." }); }
  const act0 = String(d.action || "");
  if (act0 === "adminLiveHost" || act0 === "adminLiveList") {           // read-only live views for the coordinator: no lock, so they never queue behind answers
    try {
      const bad = adminCheck_(d); if (bad) return json_({ error: bad });
      return json_(act0 === "adminLiveHost" ? liveHost_(d) : liveList_());
    } catch (err) { return json_({ error: String(err) }); }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const action = String(d.action || "");
    if (action === "submit") return json_(submit_(d));                       // Quiz Hall answers
    if (action === "feedback") return json_(feedback_(d));                   // Quiz Hall feedback form
    if (action === "liveJoin") return json_(liveJoin_(d));                   // Live games: join / answer
    if (action === "liveAnswer") return json_(liveAnswer_(d));
    if (action.indexOf("adminContent") === 0) {                               // course / LA coordinator content
      const bad = adminCheck_(d); if (bad) return json_({ error: bad });
      return json_(adminContent_(d));
    }
    if (action.indexOf("admin") === 0) {                                      // quiz coordinator
      const bad = adminCheck_(d); if (bad) return json_({ error: bad });
      if (action === "adminLoad") return json_(adminLoad_());
      if (action === "adminSaveQuiz") return json_(adminSave_(d.quiz));
      if (action === "adminDeleteQuiz") return json_(adminDelete_(d.id));
      if (action === "adminLiveSave") return json_(liveSave_(d.game));
      if (action === "adminLiveDelete") return json_(liveDelete_(d.game));
      if (action === "adminLiveControl") return json_(liveControl_(d));
      if (action === "adminLiveExport") return json_(liveExport_(d));
      if (action === "adminAllResponses") return json_({ quizzes: adminLoad_().quizzes, responses: rows_("Responses"), feedback: rows_("Feedback") });
      if (action === "adminResults") return json_({ rows: rows_("Responses").filter(r => String(r.quizId) === String(d.id)) });
      return json_({ error: "Unknown action." });
    }
    // course / LA records (no "action": identified by d.type)
    if (d.type === "quiz") {
      sheet_("Scores").appendRow([new Date(d.time), d.name, d.emp, d.dept, d.courses, d.day, d.dayTitle,
        d.attempt, d.score, d.total, d.pct, d.passed ? "Yes" : "No", "'" + d.answers]);
    } else if (d.type === "poll") {
      sheet_("Polls").appendRow([new Date(d.time), d.name, d.emp, d.dept, d.poll, d.topic, d.option, d.optionText, d.previous]);
    } else if (d.type === "login") {
      sheet_("Logins").appendRow([new Date(d.time), d.name, d.emp, d.dept, d.courses]);
    } else {
      return json_({ error: "Unknown action." });
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ================= QUIZ HALL ================= */
function quizFromRow_(r) {
  return {
    id: String(r.id), title: String(r.title || r.id), description: String(r.description || ""),
    open: bool_(r.open), timeLimit: num_(r.timeLimit, 0), showScore: bool_(r.showScore),
    showReview: bool_(r.showReview), oneAttempt: bool_(r.oneAttempt), shuffle: bool_(r.shuffle),
    passPercent: num_(r.passPercent, 60),
    opensAt: num_(r.opensAt, 0), closesAt: num_(r.closesAt, 0),   // epoch milliseconds, 0 = not scheduled
    day: num_(r.day, 0), speaker: String(r.speaker || ""), feedback: bool_(r.feedback)   // FDP day number, speaker name, ask for feedback after the quiz
  };
}
/* Schedule: a published quiz is live between opensAt and closesAt (either may be empty). */
const GRACE_MS = 90 * 1000;   // answers sent up to 90 s after closing (auto-submit at the deadline) are still accepted
function state_(q, now) {
  if (!q.open) return "closed";
  if (q.opensAt && now < q.opensAt) return "scheduled";
  if (q.closesAt && now >= q.closesAt) return "ended";
  return "live";
}
function fmt_(ms) { return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), "d MMM yyyy, h:mm a"); }
function questionFromRow_(r) {
  const options = ["optA", "optB", "optC", "optD", "optE", "optF"]
    .map(k => r[k]).filter(x => x !== "" && x !== null && x !== undefined).map(String);
  return {
    qid: String(r.qid), order: num_(r.order, 0), text: String(r.question || ""), options: options,
    correct: LETTERS.indexOf(String(r.correct).trim().toUpperCase()),
    explanation: String(r.explanation || ""), marks: num_(r.marks, 1)
  };
}
function loadQuiz_(id) {
  const q = rows_("Quizzes").find(r => String(r.id) === String(id));
  if (!q) return null;
  const quiz = quizFromRow_(q);
  quiz.questions = rows_("Questions").filter(r => String(r.quizId) === quiz.id)
    .map(questionFromRow_).sort((a, b) => a.order - b.order);
  return quiz;
}
function attempted_(quizId, emp) {
  const e = String(emp).trim().toLowerCase();
  return rows_("Responses").some(r => String(r.quizId) === quizId && String(r.emp).trim().toLowerCase() === e);
}
function shuffle_(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function submit_(d) {
  const quiz = loadQuiz_(d.quizId);
  if (!quiz) return { error: "This quiz no longer exists." };
  const now = Date.now();
  if (!quiz.open) return { error: "This quiz has been closed by the coordinator." };
  if (quiz.opensAt && now < quiz.opensAt) return { error: "This quiz has not opened yet." };
  if (quiz.closesAt && now >= quiz.closesAt + GRACE_MS) return { error: "This quiz closed on " + fmt_(quiz.closesAt) + ", so new answers cannot be accepted.", closesAt: quiz.closesAt };
  if (!d.name || !d.emp) return { error: "Name and employee ID are required." };
  if (quiz.oneAttempt && attempted_(quiz.id, d.emp)) return { error: "You have already submitted this quiz." };
  const answers = d.answers || {};
  let score = 0, total = 0;
  const review = quiz.questions.map(q => {
    const chosen = answers[q.qid] === undefined || answers[q.qid] === null ? -1 : Number(answers[q.qid]);
    total += q.marks;
    if (chosen === q.correct) score += q.marks;
    return { qid: q.qid, text: q.text, options: q.options, correct: q.correct, chosen: chosen, explanation: q.explanation };
  });
  const percent = total ? Math.round(score / total * 100) : 0;
  const passed = percent >= quiz.passPercent;
  sheet_("Responses").appendRow([new Date(), quiz.id, quiz.title, d.name, String(d.emp), d.dept || "", score, total, percent,
    passed ? "Yes" : "No", num_(d.timeTaken, ""), num_(d.exits, 0), num_(d.switches, 0),
    quiz.questions.map(q => q.qid + ":" + (answers[q.qid] === undefined || answers[q.qid] === null ? "-" : LETTERS[answers[q.qid]])).join(" ")]);
  if (!quiz.showScore) return { submitted: true, showScore: false };
  return { submitted: true, showScore: true, score: score, total: total, percent: percent, passed: passed,
    passPercent: quiz.passPercent, review: quiz.showReview ? review : null };
}

/* feedback after a quiz: speaker and topic relevance, each rated 1 to 5 */
function feedback_(d) {
  const quiz = loadQuiz_(d.quizId);
  if (!quiz) return { error: "This quiz no longer exists." };
  if (!d.name || !d.emp) return { error: "Name and employee ID are required." };
  const a = Math.round(Number(d.speakerRating)), b = Math.round(Number(d.relevanceRating));
  if (!(a >= 1 && a <= 5) || !(b >= 1 && b <= 5)) return { error: "Please rate both questions from 1 to 5." };
  const emp = String(d.emp).trim().toLowerCase();
  const mine = rows_("Feedback").some(r => String(r.quizId) === quiz.id && String(r.emp).trim().toLowerCase() === emp);
  if (mine) return { ok: true, already: true };            // one feedback form per person per quiz
  sheet_("Feedback").appendRow([new Date(), quiz.id, quiz.title, quiz.day, quiz.speaker, String(d.name), String(d.emp), String(d.dept || ""),
    a, b, String(d.comment || "").slice(0, 1000)]);
  return { ok: true };
}

function adminLoad_() {
  const qs = rows_("Questions"), rs = rows_("Responses");
  return { quizzes: rows_("Quizzes").map(r => {
    const q = quizFromRow_(r);
    q.questions = qs.filter(x => String(x.quizId) === q.id).map(questionFromRow_).sort((a, b) => a.order - b.order);
    q.responses = rs.filter(x => String(x.quizId) === q.id).length;
    return q;
  }) };
}

function adminSave_(quiz) {
  if (!quiz || !quiz.id || !quiz.title) return { error: "A quiz needs an ID and a title." };
  const quizzes = rows_("Quizzes").filter(r => String(r.id) !== quiz.id);
  quizzes.push({ id: quiz.id, title: quiz.title, description: quiz.description || "", open: !!quiz.open,
    timeLimit: Number(quiz.timeLimit) || 0, showScore: !!quiz.showScore, showReview: !!quiz.showReview,
    oneAttempt: !!quiz.oneAttempt, shuffle: !!quiz.shuffle, passPercent: Number(quiz.passPercent) || 60,
    opensAt: Number(quiz.opensAt) || 0, closesAt: Number(quiz.closesAt) || 0,
    day: Math.max(0, Math.floor(Number(quiz.day) || 0)), speaker: String(quiz.speaker || "").slice(0, 120), feedback: !!quiz.feedback });
  rewrite_("Quizzes", quizzes);
  const keep = rows_("Questions").filter(r => String(r.quizId) !== quiz.id);
  (quiz.questions || []).forEach((q, i) => {
    const row = { quizId: quiz.id, qid: q.qid || ("q" + (i + 1)), order: i + 1, question: q.text,
      correct: LETTERS[q.correct] || "", explanation: q.explanation || "", marks: Number(q.marks) || 1 };
    ["optA", "optB", "optC", "optD", "optE", "optF"].forEach((k, j) => row[k] = (q.options || [])[j] || "");
    keep.push(row);
  });
  rewrite_("Questions", keep);
  return { ok: true };
}

function adminDelete_(id) {
  rewrite_("Quizzes", rows_("Quizzes").filter(r => String(r.id) !== String(id)));
  rewrite_("Questions", rows_("Questions").filter(r => String(r.quizId) !== String(id)));
  return { ok: true };   // responses are kept for the record
}

/* ================= COURSE / LINEAR ALGEBRA: coordinator content ================= */
function contentRows_() {
  const v = sheet_("Content").getDataRange().getValues();
  const head = v.shift() || [];
  return v.filter(r => r.join("") !== "").map(r => {
    const o = {}; head.forEach((h, i) => o[h] = r[i]);
    let extra = {}; try { extra = o.extra ? JSON.parse(o.extra) : {}; } catch (err) {}
    return { id: String(o.id), site: String(o.site || "course"), day: num_(o.day), topic: String(o.topic || ""), type: String(o.type),
      title: String(o.title || ""), url: String(o.url || ""), text: String(o.text || ""), extra: extra,
      published: bool_(o.published), publishAt: num_(o.publishAt), expiresAt: num_(o.expiresAt), created: num_(o.created) };
  });
}
function contentLive_(r, now) {
  return r.published && (!r.publishAt || now >= r.publishAt) && (!r.expiresAt || now < r.expiresAt);
}

function adminContent_(d) {
  const sh = sheet_("Content"), cols = COLS.Content;
  if (d.action === "adminContentLoad") {
    const site = d.site || "course";
    return { now: Date.now(), items: contentRows_().filter(r => r.site === site) };
  }
  if (d.action === "adminContentSave") {
    const it = d.item || {};
    if (!it.id || !it.type || !["video", "material", "note", "pin", "topic", "day", "quiz", "poll"].includes(it.type)) return { error: "Unknown content type." };
    if (it.type !== "pin" && !String(it.title || "").trim()) return { error: "Give it a title." };
    if (/^\s*(javascript|data):/i.test(String(it.url || ""))) return { error: "That link is not allowed." };
    const row = cols.map(c => c === "extra" ? JSON.stringify(it.extra || {}) : (it[c] === undefined || it[c] === null ? "" : it[c]));
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
    const at = ids.indexOf(String(it.id));
    const target = sh.getRange(at < 0 ? sh.getLastRow() + 1 : at + 2, 1, 1, cols.length);
    target.setNumberFormat("@");          // store everything as plain text so a cell starting with "=" is never run as a formula
    target.setValues([row]);
    return { ok: true };
  }
  if (d.action === "adminContentDelete") {
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
    const at = ids.indexOf(String(d.id));
    if (at >= 0) sh.deleteRow(at + 2);
    return { ok: true };
  }
  return { error: "Unknown action." };
}


/* ================= LIVE GAMES (Kahoot-style) =================
   The coordinator releases one question at a time. Faculty answer on their own devices; a correct answer scores
   500 to 1000 points, the faster the more. Questions without a correct answer are opinion polls (no points).
   The live state is kept in CacheService so hundreds of devices can poll it quickly; answers are saved to the
   LiveAnswers tab each time a question ends. Players reconnect safely: the sheet is the record. */
const LIVE_TTL = 21600, LIVE_GRACE_MS = 1500, LIVE_MAX_POINTS = 1000;
const LIVE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function cget_(k) { const v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; }
function cput_(k, o) { CacheService.getScriptCache().put(k, JSON.stringify(o), LIVE_TTL); }
function cdel_(k) { CacheService.getScriptCache().remove(k); }

function gameFromRow_(r) {
  let qs = []; try { qs = JSON.parse(r.questions || "[]"); } catch (err) {}
  return { id: String(r.id), title: String(r.title || ""), status: String(r.status || "draft"), phase: String(r.phase || "lobby"),
    qIndex: num_(r.qIndex, -1), startsAt: num_(r.startsAt, 0), endsAt: num_(r.endsAt, 0), questions: qs, created: num_(r.created, 0) };
}
function gameToRow_(g) {
  return { id: g.id, title: g.title, status: g.status, phase: g.phase, qIndex: g.qIndex, startsAt: g.startsAt, endsAt: g.endsAt,
    questions: JSON.stringify(g.questions), created: g.created };
}
function getGame_(id) {
  id = String(id || "").trim().toUpperCase(); if (!id) return null;
  let g = cget_("lg:" + id); if (g) return g;
  const r = rows_("LiveGames").find(x => String(x.id).toUpperCase() === id);
  if (!r) return null;
  g = gameFromRow_(r); cput_("lg:" + id, g); return g;
}
function putGame_(g) {
  cput_("lg:" + g.id, g);
  const all = rows_("LiveGames"); let found = false;
  const out = all.map(r => { if (String(r.id) === g.id) { found = true; return gameToRow_(g); } return r; });
  if (!found) out.push(gameToRow_(g));
  rewrite_("LiveGames", out);
}

/* answers per question {emp: [choice, points, elapsedMs]}, totals {emp: {n, e, d, t, c, ms}}, joined {emp: name} */
function rebuildLive_(g) {
  const ans = {}, tot = {}, joined = {};
  g.questions.forEach((_, i) => { ans[i] = {}; });
  rows_("LiveAnswers").filter(r => String(r.gameId) === g.id).forEach(r => {
    const k = String(r.emp).trim().toLowerCase(), qi = num_(r.qIndex, 0), pts = num_(r.points, 0);
    (ans[qi] = ans[qi] || {})[k] = [num_(r.choice, -1), pts, num_(r.elapsedMs, 0)];
    const t = tot[k] = tot[k] || { n: String(r.name), e: String(r.emp), d: String(r.dept || ""), t: 0, c: 0, ms: 0 };
    t.t += pts; if (pts > 0) { t.c++; t.ms += num_(r.elapsedMs, 0); }
    joined[k] = String(r.name);
  });
  Object.keys(ans).forEach(i => cput_("la:" + g.id + ":" + i, ans[i]));
  cput_("lt:" + g.id, tot); cput_("lj:" + g.id, joined);
  cput_("lx:" + g.id, Object.keys(ans).filter(i => Object.keys(ans[i]).length).map(Number));   // questions already saved in the sheet
}
function ansOf_(g, qi) { let a = cget_("la:" + g.id + ":" + qi); if (a) return a; rebuildLive_(g); return cget_("la:" + g.id + ":" + qi) || {}; }
function totOf_(g) { let t = cget_("lt:" + g.id); if (t) return t; rebuildLive_(g); return cget_("lt:" + g.id) || {}; }
function joinedOf_(g) { let j = cget_("lj:" + g.id); if (j) return j; rebuildLive_(g); return cget_("lj:" + g.id) || {}; }
function ranking_(tot) {
  return Object.keys(tot).map(k => ({ k: k, n: tot[k].n, e: tot[k].e, d: tot[k].d, t: tot[k].t, c: tot[k].c, ms: tot[k].ms }))
    .sort((a, b) => b.t - a.t || a.ms - b.ms || String(a.n).localeCompare(String(b.n)));
}
/* results appear only after the answer grace period, so nobody can see the right answer while an answer is still accepted */
function effPhase_(g, now) { return g.phase === "question" && now >= g.endsAt + LIVE_GRACE_MS ? "results" : g.phase; }
function counts_(g, qi) {
  const q = g.questions[qi], c = q.options.map(() => 0), a = ansOf_(g, qi);
  Object.keys(a).forEach(k => { const ch = a[k][0]; if (ch >= 0 && ch < c.length) c[ch]++; });
  return c;
}
/* write the answers of a finished question to the LiveAnswers tab (once) */
function flushQ_(g, qi) {
  if (qi === undefined || qi < 0 || qi >= g.questions.length) return;
  const done = cget_("lx:" + g.id) || [];
  if (done.indexOf(qi) >= 0) return;
  const a = ansOf_(g, qi), tot = totOf_(g), keys = Object.keys(a);
  if (keys.length) {
    const rows = keys.map(k => [new Date(), g.id, qi, (tot[k] || {}).e || k, (tot[k] || {}).n || "", (tot[k] || {}).d || "", a[k][0], a[k][2], a[k][1]]);
    const sh = sheet_("LiveAnswers");
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
  done.push(qi); cput_("lx:" + g.id, done);
}

/* ---- participants ---- */
function liveState_(p) {
  const g = getGame_(p.game);
  if (!g || g.status === "draft") return { error: "No game found with that code. Check the code with your coordinator." };
  const now = Date.now(), phase = effPhase_(g, now), key = String(p.emp || "").trim().toLowerCase();
  const out = { now: now, title: g.title, status: g.status, phase: phase, qIndex: g.qIndex, total: g.questions.length };
  if (phase === "question" || phase === "results") {
    const q = g.questions[g.qIndex];
    out.question = { text: q.text, options: q.options, seconds: q.seconds, poll: q.correct < 0, startsAt: g.startsAt, endsAt: g.endsAt };
    const mine = key ? ansOf_(g, g.qIndex)[key] : null;
    out.me = mine ? { choice: mine[0], points: mine[1], ms: mine[2] } : null;
    if (phase === "results") { out.question.correct = q.correct; out.explanation = q.explanation || ""; out.counts = counts_(g, g.qIndex); }
  }
  const tot = totOf_(g), rank = ranking_(tot);
  if (key && tot[key]) { out.myTotal = tot[key].t; out.myCorrect = tot[key].c; out.myRank = rank.findIndex(x => x.k === key) + 1; }
  out.players = Object.keys(joinedOf_(g)).length;
  if (phase === "results" || phase === "finished") out.leaderboard = rank.slice(0, phase === "finished" ? 10 : 5).map(x => ({ name: x.n, total: x.t }));
  return out;
}
function liveJoin_(d) {
  const g = getGame_(d.game);
  if (!g || g.status === "draft") return { error: "No game found with that code. Check the code with your coordinator." };
  const name = String(d.name || "").trim(), emp = String(d.emp || "").trim();
  if (!name || !emp) return { error: "Name and employee ID are required." };
  const j = joinedOf_(g); j[emp.toLowerCase()] = name; cput_("lj:" + g.id, j);
  return { ok: true, title: g.title };
}
function liveAnswer_(d) {
  const g = getGame_(d.game);
  if (!g || g.status === "draft") return { error: "No game found with that code." };
  const name = String(d.name || "").trim(), emp = String(d.emp || "").trim();
  if (!name || !emp) return { error: "Name and employee ID are required." };
  const now = Date.now();
  if (g.phase !== "question") return { error: "No question is open right now." };
  if (now > g.endsAt + LIVE_GRACE_MS) return { error: "Time is up for this question." };
  const q = g.questions[g.qIndex], choice = Math.floor(Number(d.choice));
  if (!(choice >= 0 && choice < q.options.length)) return { error: "Choose one of the options." };
  const key = emp.toLowerCase(), a = ansOf_(g, g.qIndex);
  if (a[key]) return { ok: true, already: true };
  const elapsed = Math.max(0, now - g.startsAt), span = q.seconds * 1000;
  const points = q.correct >= 0 && choice === q.correct ? Math.round(LIVE_MAX_POINTS * (1 - Math.min(1, elapsed / span) / 2)) : 0;
  a[key] = [choice, points, elapsed]; cput_("la:" + g.id + ":" + g.qIndex, a);
  const tot = totOf_(g), t = tot[key] = tot[key] || { n: name, e: emp, d: String(d.dept || ""), t: 0, c: 0, ms: 0 };
  t.n = name; t.t += points; if (points > 0) { t.c++; t.ms += elapsed; }
  cput_("lt:" + g.id, tot);
  const j = joinedOf_(g); j[key] = name; cput_("lj:" + g.id, j);
  return { ok: true, locked: true };
}

/* ---- coordinator ---- */
function liveList_() {
  return { games: rows_("LiveGames").map(gameFromRow_).sort((a, b) => b.created - a.created)
    .map(g => ({ id: g.id, title: g.title, status: g.status, phase: g.phase, qIndex: g.qIndex, count: g.questions.length, created: g.created })) };
}
function liveHost_(d) {
  const g = getGame_(d.game);
  if (!g) return { error: "Game not found." };
  const now = Date.now(), phase = effPhase_(g, now), tot = totOf_(g), rank = ranking_(tot);
  const out = { now: now, game: g, phase: phase, players: Object.keys(joinedOf_(g)).length, leaderboard: rank.slice(0, 10).map(x => ({ name: x.n, emp: x.e, total: x.t, correct: x.c })) };
  if (g.qIndex >= 0 && g.qIndex < g.questions.length) {
    out.counts = counts_(g, g.qIndex);
    out.answered = out.counts.reduce((a, b) => a + b, 0);
  }
  return out;
}
function liveSave_(game) {
  if (!game || !String(game.title || "").trim()) return { error: "Give the game a title." };
  const qs = (game.questions || []).map((q, i) => {
    const options = (q.options || []).map(o => String(o).trim()).filter(Boolean).slice(0, 6);
    return { text: String(q.text || "").trim().slice(0, 600), options: options, correct: Math.floor(Number(q.correct)),
      seconds: Math.min(300, Math.max(5, Math.floor(Number(q.seconds)) || 20)), explanation: String(q.explanation || "").trim().slice(0, 400) };
  });
  if (!qs.length) return { error: "Add at least one question." };
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i], n = i + 1;
    if (!q.text) return { error: "Question " + n + " has no text." };
    if (q.options.length < 2) return { error: "Question " + n + " needs at least two options." };
    if (!(q.correct >= -1 && q.correct < q.options.length)) q.correct = -1;
  }
  let g = game.id ? getGame_(game.id) : null;
  if (g && (g.phase === "question" || g.status === "running")) return { error: "This game is running. Finish it or reset it before editing the questions." };
  if (!g) {
    let id = "", taken = rows_("LiveGames").map(r => String(r.id));
    do { id = ""; for (let i = 0; i < 5; i++) id += LIVE_CODE_CHARS.charAt(Math.floor(Math.random() * LIVE_CODE_CHARS.length)); } while (taken.indexOf(id) >= 0);
    g = { id: id, status: "draft", phase: "lobby", qIndex: -1, startsAt: 0, endsAt: 0, created: Date.now() };
  }
  g.title = String(game.title).trim().slice(0, 120); g.questions = qs;
  putGame_(g);
  return { ok: true, id: g.id };
}
function liveDelete_(id) {
  id = String(id || "").trim().toUpperCase();
  rewrite_("LiveGames", rows_("LiveGames").filter(r => String(r.id).toUpperCase() !== id));
  ["lg:" + id, "lt:" + id, "lj:" + id, "lx:" + id].forEach(cdel_);
  return { ok: true };
}
function liveControl_(d) {
  const g = getGame_(d.game);
  if (!g) return { error: "Game not found." };
  const now = Date.now(), op = String(d.op || "");
  if (op === "open") {
    if (!g.questions.length) return { error: "Add questions first." };
    g.status = "lobby"; g.phase = "lobby"; g.qIndex = -1; g.startsAt = 0; g.endsAt = 0;
  } else if (op === "release") {
    if (g.status === "draft") { g.status = "lobby"; }
    if (g.status === "finished") return { error: "This game has finished. Reset it to play again." };
    flushQ_(g, g.qIndex);
    const idx = d.index !== undefined && d.index !== null ? Math.floor(Number(d.index)) : g.qIndex + 1;
    if (!(idx > g.qIndex && idx < g.questions.length)) return { error: "There are no more questions. End the game to show the final leaderboard." };
    const q = g.questions[idx];
    g.qIndex = idx; g.phase = "question"; g.status = "running"; g.startsAt = now; g.endsAt = now + q.seconds * 1000;
  } else if (op === "close") {
    if (g.phase === "question") { g.phase = "results"; g.endsAt = Math.min(g.endsAt, now); }
    flushQ_(g, g.qIndex);
  } else if (op === "end") {
    flushQ_(g, g.qIndex); g.phase = "finished"; g.status = "finished";
  } else if (op === "reset") {
    rewrite_("LiveAnswers", rows_("LiveAnswers").filter(r => String(r.gameId) !== g.id));
    ["lt:" + g.id, "lj:" + g.id, "lx:" + g.id].concat(g.questions.map((_, i) => "la:" + g.id + ":" + i)).forEach(cdel_);
    g.status = "lobby"; g.phase = "lobby"; g.qIndex = -1; g.startsAt = 0; g.endsAt = 0;
  } else return { error: "Unknown action." };
  putGame_(g);
  return { ok: true };
}
function liveExport_(d) {
  const g = getGame_(d.game);
  if (!g) return { error: "Game not found." };
  if (effPhase_(g, Date.now()) !== "question") flushQ_(g, g.qIndex);
  const tot = totOf_(g);
  return { game: { id: g.id, title: g.title, questions: g.questions.map(q => ({ text: q.text, options: q.options, correct: q.correct, seconds: q.seconds })) },
    ranking: ranking_(tot).map(x => ({ name: x.n, emp: x.e, dept: x.d, total: x.t, correct: x.c, ms: x.ms })),
    answers: rows_("LiveAnswers").filter(r => String(r.gameId) === g.id).map(r => ({ qIndex: num_(r.qIndex, 0), emp: String(r.emp), name: String(r.name), choice: num_(r.choice, -1), elapsedMs: num_(r.elapsedMs, 0), points: num_(r.points, 0) })) };
}
