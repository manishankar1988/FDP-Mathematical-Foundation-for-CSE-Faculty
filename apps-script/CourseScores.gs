/**
 * Score recorder for the Mathematics Prerequisite Programme (faculty bootcamp).
 *
 * SETUP (about 5 minutes, one time):
 *  1. Create a new Google Sheet (e.g. "Maths Bootcamp Scores").
 *  2. Extensions → Apps Script. Delete the sample code and paste this whole file. Save.
 *  3. Deploy → New deployment → type "Web app".
 *       Execute as:      Me
 *       Who has access:  Anyone   (needed so faculty browsers can post scores without signing in)
 *  4. Authorise when asked, then copy the Web app URL (ends in /exec).
 *  5. In index.html, set   SHEET_URL: "<that URL>"   inside CONFIG, and re-upload the page.
 *
 * The script creates four tabs on first use:
 *   Scores  — one row per quiz attempt
 *   Polls   — one row per vote (latest vote per person counts in tallies)
 *   Logins  — one row per sign-in
 *   Content — videos, materials, notes and extra topics added by coordinators from the website
 *
 * COORDINATOR CONTENT (adding videos / materials / topics from the website)
 *  Change ADMIN_KEY below to your own secret, then redeploy. On the course page open
 *  "Coordinator view", and sign in with that key under "Add content for participants".
 *  AFTER EDITING THIS SCRIPT: Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.
 */

const ADMIN_KEY = "CSESahrdaya@2026";

const TABS = {
  Scores: ["Time", "Name", "Emp ID", "Dept", "Courses", "Day", "Day title", "Attempt", "Score", "Total", "Percent", "Passed", "Answers"],
  Polls:  ["Time", "Name", "Emp ID", "Dept", "Poll ID", "Topic", "Option #", "Option text", "Previous option #"],
  Logins: ["Time", "Name", "Emp ID", "Dept", "Courses"],
  Content: ["id", "site", "day", "topic", "type", "title", "url", "text", "extra", "published", "publishAt", "expiresAt", "created"]
};

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(TABS[name]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, TABS[name].length).setFontWeight("bold");
  }
  return sh;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (String(d.action || "").indexOf("adminContent") === 0) return json_(adminContent_(d));
    if (d.type === "quiz") {
      sheet_("Scores").appendRow([new Date(d.time), d.name, d.emp, d.dept, d.courses, d.day, d.dayTitle,
        d.attempt, d.score, d.total, d.pct, d.passed ? "Yes" : "No", "'" + d.answers]);
    } else if (d.type === "poll") {
      sheet_("Polls").appendRow([new Date(d.time), d.name, d.emp, d.dept, d.poll, d.topic, d.option, d.optionText, d.previous]);
    } else if (d.type === "login") {
      sheet_("Logins").appendRow([new Date(d.time), d.name, d.emp, d.dept, d.courses]);
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** GET ?action=tally&poll=<id> → { counts: [n0, n1, ...] } using each person's latest vote. */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === "content") {          // what participants see: published items inside their visibility window
    const now = Date.now(), site = p.site || "course";
    return json_({ now: now, items: contentRows_().filter(r => r.site === site && contentLive_(r, now)) });
  }
  if (p.action === "tally" && p.poll) {
    const rows = sheet_("Polls").getDataRange().getValues().slice(1);
    const latest = {};               // emp → option index (rows are in time order)
    rows.forEach(r => { if (String(r[4]) === p.poll) latest[String(r[2])] = Number(r[6]); });
    const counts = [];
    Object.keys(latest).forEach(k => { const i = latest[k]; counts[i] = (counts[i] || 0) + 1; });
    for (let i = 0; i < counts.length; i++) counts[i] = counts[i] || 0;
    while (counts.length < 4) counts.push(0);
    return json_({ counts: counts });
  }
  return json_({ ok: true, service: "maths-bootcamp-recorder" });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- coordinator content (videos, materials, notes, extra topics) ---------------- */
const bool_ = v => v === true || String(v).trim().toUpperCase() === "TRUE";
const num_ = v => (v === "" || v === null || v === undefined || isNaN(Number(v))) ? 0 : Number(v);

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
  if (ADMIN_KEY === "change-this-key") return { error: "Set your own ADMIN_KEY in the Apps Script first, then redeploy." };
  if (d.key !== ADMIN_KEY) return { error: "That coordinator key is not correct." };
  const sh = sheet_("Content"), cols = TABS.Content;
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
