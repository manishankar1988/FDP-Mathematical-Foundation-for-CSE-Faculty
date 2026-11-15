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
 * The script creates three tabs on first use:
 *   Scores — one row per quiz attempt
 *   Polls  — one row per vote (latest vote per person counts in tallies)
 *   Logins — one row per sign-in
 */

const TABS = {
  Scores: ["Time", "Name", "Emp ID", "Dept", "Courses", "Day", "Day title", "Attempt", "Score", "Total", "Percent", "Passed", "Answers"],
  Polls:  ["Time", "Name", "Emp ID", "Dept", "Poll ID", "Topic", "Option #", "Option text", "Previous option #"],
  Logins: ["Time", "Name", "Emp ID", "Dept", "Courses"]
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
