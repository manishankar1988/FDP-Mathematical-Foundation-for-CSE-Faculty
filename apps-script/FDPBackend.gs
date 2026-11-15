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
 * Tabs created automatically: Quizzes, Questions, Responses, Scores, Polls, Logins, Content.
 */

const ADMIN_KEY = "change-this-key";

const COLS = {
  Quizzes:   ["id", "title", "description", "open", "timeLimit", "showScore", "showReview", "oneAttempt", "shuffle", "passPercent", "opensAt", "closesAt"],
  Questions: ["quizId", "qid", "order", "question", "optA", "optB", "optC", "optD", "optE", "optF", "correct", "explanation", "marks"],
  Responses: ["time", "quizId", "quizTitle", "name", "emp", "dept", "score", "total", "percent", "passed",
              "timeTakenSec", "fullscreenExits", "tabSwitches", "answers"],
  Scores:    ["Time", "Name", "Emp ID", "Dept", "Courses", "Day", "Day title", "Attempt", "Score", "Total", "Percent", "Passed", "Answers"],
  Polls:     ["Time", "Name", "Emp ID", "Dept", "Poll ID", "Topic", "Option #", "Option text", "Previous option #"],
  Logins:    ["Time", "Name", "Emp ID", "Dept", "Courses"],
  Content:   ["id", "site", "day", "topic", "type", "title", "url", "text", "extra", "published", "publishAt", "expiresAt", "created"]
};
const LETTERS = "ABCDEF";

/* ---------------- sheet helpers ---------------- */
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  sh.getRange(1, 1, data.length, cols.length).setValues(data);
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
        opensAt: quiz.opensAt, closesAt: quiz.closesAt }, questions: questions, now: now });
    }
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
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const action = String(d.action || "");
    if (action === "submit") return json_(submit_(d));                       // Quiz Hall answers
    if (action.indexOf("adminContent") === 0) {                               // course / LA coordinator content
      const bad = adminCheck_(d); if (bad) return json_({ error: bad });
      return json_(adminContent_(d));
    }
    if (action.indexOf("admin") === 0) {                                      // quiz coordinator
      const bad = adminCheck_(d); if (bad) return json_({ error: bad });
      if (action === "adminLoad") return json_(adminLoad_());
      if (action === "adminSaveQuiz") return json_(adminSave_(d.quiz));
      if (action === "adminDeleteQuiz") return json_(adminDelete_(d.id));
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
    opensAt: num_(r.opensAt, 0), closesAt: num_(r.closesAt, 0)   // epoch milliseconds, 0 = not scheduled
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
  if (quiz.closesAt && now >= quiz.closesAt + GRACE_MS) return { error: "This quiz closed on " + fmt_(quiz.closesAt) + ", so new answers cannot be accepted." };
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
    opensAt: Number(quiz.opensAt) || 0, closesAt: Number(quiz.closesAt) || 0 });
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
    if (!it.id || !it.type || !["video", "material", "note", "pin", "topic"].includes(it.type)) return { error: "Unknown content type." };
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
