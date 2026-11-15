/* =====================================================================
   Coordinator content for the course pages (shared by course/ and linear-algebra/)

   Lets coordinators add, without editing any file:
     video     an extra YouTube video under a topic (or for a whole day)
     material  a link to a PDF, slides, Drive folder or web page
     note      a short written note or announcement
     pin       replace the main video of an existing topic, for everyone
     topic     a whole new topic (video + notes + poll) at the end of a day
     day       a whole new day (appears after the original days; add topics and a quiz to it)
     quiz      multiple-choice questions for a day's quiz (added to it, or replacing it)
     poll      a stand-alone poll on a day or topic
   Every item can be published or hidden, shown from a date and hidden after a date.

   Storage: the Google Sheet (tab "Content") when SHEET_URL is set, otherwise this browser only.
   Loaded before the page's main script; the page calls Extras.init(...) once.
   ===================================================================== */
const Extras = (() => {
  const TYPES = { video:"Extra video", material:"Material / link", note:"Note", pin:"Replaced main video", topic:"New topic", day:"New day", quiz:"Quiz questions", poll:"Poll" };
  const CSS = `
.xlist{display:flex;flex-direction:column;gap:14px}
.xres .xt{font-weight:600;margin-bottom:4px}
.xres p,.xnote p{margin:0 0 .6em;font-size:14px;color:var(--muted)}
.xlink{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:10px 12px;text-decoration:none;color:var(--ink);background:var(--bg)}
.xlink:hover{border-color:var(--accent)}
.xlink .xi{width:30px;height:30px;border-radius:8px;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font-weight:700;flex:none}
.xlink small{display:block;color:var(--muted);font-size:12.5px}
.xnote{border-left:3px solid var(--brass);background:var(--brass-soft);padding:10px 14px;border-radius:0 8px 8px 0}
.xnote b{display:block;margin-bottom:4px}
.xnote ul,.xres ul{margin:0 0 .6em;padding-left:1.2em}
.xform{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.xform .full{grid-column:1/-1}
.xform .field input[type=text],.xform .field input[type=url],.xform .field input[type=password],.xform .field input[type=datetime-local],.xform .field input[type=number],.xform .field select,.xform .field textarea{padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);width:100%;min-width:0}
.xform textarea{min-height:84px;resize:vertical;line-height:1.45}
.xform .field small{color:var(--muted);font-size:12px}
.xform .chk{display:flex;gap:8px;align-items:center;font-size:14px;cursor:pointer}
.xform .chk input{accent-color:var(--accent)}
.xb{display:inline-block;font:600 11px var(--mono);letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:4px;background:var(--sunken);color:var(--muted)}
.xb.live{background:var(--good-soft);color:var(--good)} .xb.scheduled{background:var(--brass-soft);color:var(--brass)}
.xmuted{color:var(--muted);font-size:12.5px}
.xpollbox h4{font-size:15px;margin:0 0 10px}
@media (max-width:600px){.xform{grid-template-columns:1fr}}`;

  let cfg = { site:"course", ns:"fmb" };
  let items = [];               // what this viewer may currently see (server-filtered when remote)
  let skew = 0, fetchedAt = 0, sig = "[]";
  let key = null;               // coordinator key for the Google Sheet (kept for this tab only)
  let editing = null, adminItems = [];

  const $x = s => document.querySelector(s);
  const E = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const remote = () => !!CONFIG.SHEET_URL;
  const lsKey = () => cfg.ns + ":extras";
  const now = () => Date.now() + skew;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const byCreated = (a, b) => (a.created || 0) - (b.created || 0);
  function rd(){ try{ const v = localStorage.getItem(lsKey()); return v ? JSON.parse(v) : []; }catch(e){ return []; } }
  function wr(v){ try{ localStorage.setItem(lsKey(), JSON.stringify(v)); }catch(e){} }
  const safeUrl = u => /^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "";
  const toLocal = ms => { if(!ms) return ""; const d = new Date(ms), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fromLocal = v => { if(!v) return 0; const t = new Date(v).getTime(); return isNaN(t) ? 0 : t; };
  const when = ms => new Date(ms).toLocaleString([], { day:"numeric", month:"short", hour:"numeric", minute:"2-digit" });

  function live(it, t){ t = t === undefined ? now() : t; return !!it.published && (!it.publishAt || t >= it.publishAt) && (!it.expiresAt || t < it.expiresAt); }
  function status(it, t){
    t = t === undefined ? now() : t;
    if(!it.published) return "hidden";
    if(it.publishAt && t < it.publishAt) return "scheduled";
    if(it.expiresAt && t >= it.expiresAt) return "expired";
    return "live";
  }

  /* plain text → safe HTML: blank line = new paragraph, lines starting "- " = bullets, $maths$ kept for KaTeX */
  function fmtText(text){
    const blocks = String(text || "").replace(/\r/g, "").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    return blocks.map(b => {
      const lines = b.split("\n");
      if(lines.every(l => /^\s*[-*•]\s+/.test(l))) return "<ul>" + lines.map(l => "<li>" + E(l.replace(/^\s*[-*•]\s+/, "")) + "</li>").join("") + "</ul>";
      return "<p>" + lines.map(E).join("<br>") + "</p>";
    }).join("");
  }

  /* ------------------------- loading and applying ------------------------- */
  async function fetchPublic(){
    if(!remote()){ items = rd(); return; }
    const r = await (await fetch(CONFIG.SHEET_URL + "?action=content&site=" + encodeURIComponent(cfg.site))).json();
    if(r && Array.isArray(r.items)){ if(r.now) skew = r.now - Date.now(); items = r.items; }
  }
  /* adds live coordinator days, topics and quiz questions to DAYS; originals are kept in d._base / d._baseQuiz */
  function apply(){
    const t = now();
    for(let i = DAYS.length - 1; i >= 0; i--) if(DAYS[i].extraDay) DAYS.splice(i, 1);
    items.filter(i => i.type === "day" && live(i, t)).sort((a, b) => a.day - b.day).forEach(i => {
      if(DAYS.some(d => d.id === +i.day)) return;
      DAYS.push({ id:+i.day, week:3, code:(i.extra && i.extra.code) || "Added", title:i.title, lands:i.text || "Added by your coordinator", topics:[], quiz:[], extraDay:true });
    });
    DAYS.forEach(d => {
      d._base = d._base || d.topics.slice();
      d._baseQuiz = d._baseQuiz || (d.quiz || []).slice();
      d.topics = d._base.concat(items.filter(i => i.type === "topic" && +i.day === d.id && live(i, t)).sort(byCreated).map(toTopic));
      let qs = d._baseQuiz;
      items.filter(i => i.type === "quiz" && +i.day === d.id && live(i, t)).sort(byCreated).forEach(i => {
        const ex = i.extra || {}, add = (ex.questions || []).map(toQuestion);
        qs = ex.replace ? add : qs.concat(add);
      });
      d.quiz = qs;
    });
  }
  /* coordinator text is escaped here; $maths$ is rendered by KaTeX afterwards */
  const toQuestion = q => ({ q:E(q.q), o:(q.o || []).map(E), a:q.a, e:q.e || "" });
  function extraGroup(){ return DAYS.some(d => d.extraDay) ? [{ week:3, rail:"Added by your coordinator", home:"Days added by your coordinator" }] : []; }
  const minDayNum = () => Math.max(0, ...DAYS.filter(d => !d.extraDay).map(d => d.id)) + 1;

  /* quiz questions typed as plain text:  question / A) B) C)... / Answer: B / Explanation: ... , blank line between questions */
  function parseQuiz(text){
    const blocks = String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    if(!blocks.length) return { error:"Add at least one question." };
    const out = [];
    for(let bi = 0; bi < blocks.length; bi++){
      const qn = "Question " + (bi + 1) + ": ", qLines = [], opts = []; let ans = -1, exp = "";
      for(const l of blocks[bi].split("\n").map(x => x.trim()).filter(Boolean)){
        let m;
        if((m = l.match(/^answer\s*[:=-]\s*\(?([A-Fa-f])\)?\.?\s*$/i))) ans = "ABCDEF".indexOf(m[1].toUpperCase());
        else if((m = l.match(/^explanation\s*[:=-]\s*(.*)$/i))) exp = m[1].trim();
        else if((m = l.match(/^\(?([A-Fa-f])[).:]\s+(.+)$/)) && m[1].toUpperCase() === "ABCDEF"[opts.length]) opts.push(m[2].trim());
        else if(!opts.length && !exp) qLines.push(l);
        else if(exp) exp += " " + l;
        else return { error: qn + "this line is not understood: “" + l.slice(0, 60) + "”. Options must be A), B), C)… in order." };
      }
      if(!qLines.length) return { error: qn + "the question text is missing." };
      if(opts.length < 2 || opts.length > 6) return { error: qn + "give 2 to 6 options, written A) B) C)…" };
      if(ans < 0 || ans >= opts.length) return { error: qn + "add a line like “Answer: B” that matches one of the options." };
      out.push({ q:qLines.join(" "), o:opts, a:ans, e:exp });
    }
    return { questions: out };
  }
  const quizToText = qs => (qs || []).map(q => [q.q].concat(q.o.map((o, i) => "ABCDEF"[i] + ") " + o), ["Answer: " + "ABCDEF"[q.a]], q.e ? ["Explanation: " + q.e] : []).join("\n")).join("\n\n");
  function toTopic(i){
    const ex = i.extra || {}, yt = ytId(i.url || "");
    const opts = (ex.pollOpts || []).filter(Boolean);
    return { id:"x-" + i.id, title:i.title, extraTopic:true,
      video: yt ? { yt, src:"Added by your coordinator" } : { search: i.title },
      notes: fmtText(i.text) || "<p>Your coordinator added this topic. Watch the video and open the extra resources below, then cast your vote.</p>",
      poll: { q: ex.pollQ || "How well did you follow this topic?", opts: opts.length >= 2 ? opts : ["Very well", "Mostly", "I need more help", "I have not covered it yet"] } };
  }
  async function load(){
    try{ await fetchPublic(); }catch(e){ items = remote() ? items : rd(); }
    fetchedAt = Date.now(); const s = JSON.stringify(items), changed = s !== sig; sig = s; apply();
    return changed;
  }
  /* called from route(): re-reads the sheet at most once a minute and redraws only if something changed */
  function refreshIfStale(redraw){
    if(!remote() || Date.now() - fetchedAt < 60000) return;
    fetchedAt = Date.now();
    fetchPublic().then(() => { const s = JSON.stringify(items); if(s !== sig){ sig = s; apply(); redraw(); } }).catch(() => {});
  }

  /* ------------------------- what participants see ------------------------- */
  function pinFor(topicId){
    const t = now();
    const p = items.filter(i => i.type === "pin" && i.topic === topicId && live(i, t)).sort(byCreated).pop();
    return p ? ytId(p.url) : null;
  }
  function ytEmbed(id, title){
    return `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1" title="${E(title)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }
  function resItem(i){
    if(i.type === "video"){
      const id = ytId(i.url || ""); if(!id) return "";
      return `<div class="xres"><div class="xt">${E(i.title)}</div>${i.text ? fmtText(i.text) : ""}${ytEmbed(id, i.title)}
        <div class="xmuted" style="margin-top:6px"><a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">Open on YouTube ↗</a></div></div>`;
    }
    if(i.type === "material"){
      const u = safeUrl(i.url); if(!u) return "";
      return `<a class="xlink" href="${E(u)}" target="_blank" rel="noopener noreferrer"><span class="xi">↗</span><span><b>${E(i.title)}</b><small>${E(i.text || u.replace(/^https?:\/\//i, "").slice(0, 70))}</small></span></a>`;
    }
    if(i.type === "note") return `<div class="xnote"><b>${E(i.title)}</b>${fmtText(i.text)}</div>`;
    if(i.type === "poll"){
      if(((i.extra && i.extra.pollOpts) || []).length < 2) return "";
      return `<div class="xres xpollbox"><div class="body poll" style="padding:0" data-xp="${E(i.id)}"><h4>${E(i.title)}</h4><div class="opts"></div><div class="pollnote"></div></div></div>`;
    }
    return "";
  }
  const SHOWN = ["video", "material", "note", "poll"];
  function visible(){ const t = now(); return items.filter(i => SHOWN.includes(i.type) && live(i, t)).sort(byCreated); }
  function topicBlock(t){
    const list = visible().filter(i => i.topic === t.id).map(resItem).filter(Boolean);
    if(!list.length) return "";
    return `<section class="phase"><header><span class="n">+</span><h3>Extra resources</h3><span class="right">Added by your coordinator</span></header><div class="body xlist">${list.join("")}</div></section>`;
  }
  function dayBlock(d){
    const list = visible().filter(i => +i.day === d.id && !i.topic).map(resItem).filter(Boolean);
    if(!list.length) return "";
    return `<section class="phase"><header><span class="n">+</span><h3>Resources for Day ${d.id}</h3><span class="right">Added by your coordinator</span></header><div class="body xlist">${list.join("")}</div></section>`;
  }
  /* stand-alone polls: votes are stored like topic polls (id "xp-<item id>") */
  function localCounts(pid, n){
    const c = Array(n).fill(0);
    Object.values(S.users).forEach(u => { const v = u.polls[pid]; if(v !== undefined && c[v] !== undefined) c[v]++; });
    return c;
  }
  function drawPoll(box, it, remoteCounts){
    const opts = it.extra.pollOpts, pid = "xp-" + it.id, vote = U().polls[pid];
    const counts = remoteCounts ? opts.map((_, i) => remoteCounts[i] || 0) : localCounts(pid, opts.length);
    const total = counts.reduce((a, b) => a + b, 0);
    box.querySelector(".opts").innerHTML = opts.map((o, i) => {
      const pct = total ? Math.round(counts[i] / total * 100) : 0;
      return `<button class="opt ${vote === i ? "mine" : ""}" data-i="${i}" type="button"><span class="fill" style="width:${vote !== undefined ? pct : 0}%"></span><span>${E(o)}</span>${vote !== undefined ? `<span class="pct">${pct}% · ${counts[i]}</span>` : ""}</button>`;
    }).join("");
    box.querySelector(".pollnote").textContent = vote === undefined ? "Pick one option. You can change your vote later." : remoteCounts ? total + " votes from all faculty so far." : CONFIG.SHEET_URL ? "Loading results from all faculty…" : total + " vote" + (total === 1 ? "" : "s") + " on this computer.";
    box.querySelectorAll(".opt").forEach(b => b.onclick = () => {
      const i = +b.dataset.i, prev = U().polls[pid];
      U().polls[pid] = i; save();
      send({ type:"poll", poll:pid, topic:it.title, option:i, optionText:opts[i], previous: prev === undefined ? "" : prev, name:S.user.name, emp:S.user.emp, dept:S.user.dept, time:new Date().toISOString() });
      drawPoll(box, it);
      if(CONFIG.SHEET_URL) setTimeout(() => fetchTally(pid).then(c => { if(c && box.isConnected) drawPoll(box, it, c); }), 1200);
    });
    if(vote !== undefined && CONFIG.SHEET_URL && !remoteCounts) fetchTally(pid).then(c => { if(c && box.isConnected) drawPoll(box, it, c); });
  }
  function afterRender(){
    math($x("#view"));
    document.querySelectorAll("[data-xp]").forEach(box => { const it = items.find(x => x.id === box.dataset.xp); if(it && S.user) drawPoll(box, it); });
  }

  /* ------------------------- coordinator: talking to the store ------------------------- */
  async function post(body){
    const r = await fetch(CONFIG.SHEET_URL, { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    return r.json();
  }
  function loadKey(){ if(key) return key; try{ key = sessionStorage.getItem(cfg.ns + ":ckey"); }catch(e){} return key; }
  function setKey(k){ key = k; try{ if(k) sessionStorage.setItem(cfg.ns + ":ckey", k); else sessionStorage.removeItem(cfg.ns + ":ckey"); }catch(e){} }
  async function adminLoad(){
    if(!remote()) return { items: rd() };
    return post({ action:"adminContentLoad", key: loadKey(), site: cfg.site });
  }
  async function adminSave(it){
    it.site = cfg.site;
    if(!remote()){ const a = rd().filter(x => x.id !== it.id); a.push(it); wr(a); return { ok:true }; }
    return post({ action:"adminContentSave", key: loadKey(), item: it });
  }
  async function adminDelete(id){
    if(!remote()){ wr(rd().filter(x => x.id !== id)); return { ok:true }; }
    return post({ action:"adminContentDelete", key: loadKey(), id });
  }
  async function reloadPublic(){ try{ await fetchPublic(); }catch(e){} sig = JSON.stringify(items); fetchedAt = Date.now(); apply(); if(typeof renderRail === "function") renderRail(); }

  /* the "replace main video" shortcut shown on each topic page in coordinator view */
  async function pinVideo(topicId, dayId, yt){
    if(remote() && !loadKey()){ const k = window.prompt("Coordinator key (the ADMIN_KEY you set in the Apps Script):"); if(!k) return false; setKey(k); }
    const r = await adminSave({ id:"pin-" + topicId, day:dayId, topic:topicId, type:"pin", title:"Main video", url:"https://youtu.be/" + yt, text:"", extra:{}, published:true, publishAt:0, expiresAt:0, created:Date.now() });
    if(r && r.error){ if(/key/i.test(r.error)) setKey(null); toast(r.error); return false; }
    await reloadPublic(); return true;
  }
  async function unpinVideo(topicId){
    if(remote() && !loadKey()){ const k = window.prompt("Coordinator key (the ADMIN_KEY you set in the Apps Script):"); if(!k) return false; setKey(k); }
    const r = await adminDelete("pin-" + topicId);
    if(r && r.error){ if(/key/i.test(r.error)) setKey(null); toast(r.error); return false; }
    await reloadPublic(); return true;
  }

  /* ------------------------- coordinator: the panel ------------------------- */
  function adminPanel(){
    return `<div class="panel" id="xAdmin"><h3>Add content for participants</h3>
      <p>Add videos, materials, notes or whole new topics without editing any file. ${remote() ? "Everything is saved in your Google Sheet and appears for all participants." : "<b>Sheet not connected:</b> items are saved only in this browser, so participants on other computers will not see them. Set SHEET_URL to publish for everyone."}</p>
      <div id="xBody"><p>Loading…</p></div></div>`;
  }
  /* days the coordinator can pick: the live ones plus any added day that is currently hidden */
  function adminDays(){
    const out = DAYS.map(d => ({ id:d.id, title:d.title }));
    adminItems.filter(i => i.type === "day" && !out.some(o => o.id === +i.day)).forEach(i => out.push({ id:+i.day, title:i.title + " (hidden)" }));
    return out.sort((a, b) => a.id - b.id);
  }
  const dayName = id => { const d = adminDays().find(x => x.id === +id); return d ? `Day ${d.id} · ${d.title}` : `Day ${id}`; };
  function topicsOf(dayId){
    const d = DAYS.find(x => x.id === +dayId);
    const base = d ? (d._base || d.topics).map(t => ({ id:t.id, title:t.title })) : [];
    const extra = adminItems.filter(i => i.type === "topic" && +i.day === +dayId).sort(byCreated).map(i => ({ id:"x-" + i.id, title:i.title + " (new)" }));
    return base.concat(extra);
  }
  function topicTitle(id){ for(const d of DAYS){ const t = topicsOf(d.id).find(x => x.id === id); if(t) return t.title; } return id; }

  async function bindAdmin(){
    const box = $x("#xBody"); if(!box) return;
    if(remote() && !loadKey()){
      box.innerHTML = `<form id="xKeyForm" class="xform" novalidate><div class="field full"><label for="xKey">Coordinator key</label>
        <input type="password" id="xKey" autocomplete="off"><small>The ADMIN_KEY you set in the Apps Script (not the PIN above).</small></div>
        <div class="full err" id="xKeyErr"></div><div class="full"><button class="btn primary" type="submit">Unlock</button></div></form>`;
      $x("#xKeyForm").onsubmit = e => { e.preventDefault(); setKey($x("#xKey").value); bindAdmin(); };
      return;
    }
    let r;
    try{ r = await adminLoad(); }catch(e){ r = { error:"Could not reach the Google Sheet. Check your internet connection." }; }
    if(r.error){
      if(/key/i.test(r.error)) setKey(null);
      box.innerHTML = `<p class="err">${E(r.error)}</p>${remote() ? `<button class="btn" id="xRetry">Try again</button>` : ""}`;
      const rb = $x("#xRetry"); if(rb) rb.onclick = bindAdmin;
      return;
    }
    adminItems = r.items || [];
    box.innerHTML = formHtml() + `<h3 style="margin-top:8px">Added so far (<span id="xCount">0</span>)</h3><div class="tablewrap"><table class="data"><thead><tr><th>Type</th><th>Title</th><th>Where</th><th>Visibility</th><th></th></tr></thead><tbody id="xRows"></tbody></table></div>`;
    bindForm(); renderRows();
  }

  function formHtml(){
    return `<form class="xform" id="xForm" novalidate>
      <div class="field"><label for="xType">What do you want to add?</label><select id="xType">
        <option value="video">Extra video</option><option value="material">Material or link (PDF, slides, Drive, website)</option>
        <option value="note">Note or announcement</option><option value="pin">Replace the main video of a topic</option><option value="topic">A whole new topic (video, notes and poll)</option>
        <option value="day">A whole new day</option><option value="quiz">Quiz questions for a day</option><option value="poll">A poll</option></select></div>
      <div class="field" id="xDayRow"><label for="xDay">Day</label><select id="xDay">${adminDays().map(d => `<option value="${d.id}">${E(dayName(d.id))}</option>`).join("")}</select></div>
      <div class="field" id="xNumRow" hidden><label for="xNum">Day number</label><input type="number" id="xNum" min="${minDayNum()}" step="1" value="${minDayNum()}"><small>${minDayNum()} or higher. New days appear after the original days, in number order. Add its topics and quiz afterwards.</small></div>
      <div class="field" id="xCodeRow" hidden><label for="xCode">Label (optional)</label><input type="text" id="xCode" maxlength="30" placeholder="e.g. Wed 18 Nov"></div>
      <div class="field full" id="xTopicRow"><label for="xTopic">Topic</label><select id="xTopic"></select><small id="xTopicHint"></small></div>
      <div class="field full" id="xTitleRow"><label for="xTitle" id="xTitleLabel">Title</label><input type="text" id="xTitle" maxlength="140"></div>
      <div class="field full" id="xUrlRow"><label for="xUrl" id="xUrlLabel">Link</label><input type="url" id="xUrl" placeholder="https://"><small id="xUrlHint"></small></div>
      <div class="field full" id="xTextRow"><label for="xText" id="xTextLabel">Description</label><textarea id="xText"></textarea><small id="xTextHint">Blank line = new paragraph. Start lines with “- ” for bullets. Maths between dollar signs, e.g. $A^{-1}$.</small></div>
      <div class="field full" id="xQuizRow" hidden><label for="xQuiz">Questions</label>
        <textarea id="xQuiz" rows="12" placeholder="What is 2 + 2?&#10;A) 3&#10;B) 4&#10;C) 5&#10;Answer: B&#10;Explanation: Basic addition.&#10;&#10;Next question here…"></textarea>
        <small>One question per block, blocks separated by a blank line. Options A) B) C)… (2 to 6), then “Answer: B”, and optionally “Explanation: …”. Maths between dollar signs works, e.g. $x^2$.</small>
        <label class="chk" style="margin-top:8px"><input type="checkbox" id="xReplace"> Replace the day's existing quiz (otherwise these questions are added after it)</label></div>
      <div class="field full" id="xPollRow"><div id="xPollQRow"><label for="xPollQ">Poll question for this topic</label><input type="text" id="xPollQ" placeholder="How well did you follow this topic?"></div>
        <label for="xPollO" style="margin-top:8px">Poll options (one per line, 2 to 6)</label><textarea id="xPollO" rows="4" placeholder="Very well&#10;Mostly&#10;I need more help&#10;I have not covered it yet"></textarea>
        <small id="xPollHint">Participants must vote on a new topic before the day's quiz opens, as with every other topic.</small></div>
      <label class="chk full"><input type="checkbox" id="xPub" checked> Published (visible to participants)</label>
      <div class="field"><label for="xFrom">Show from (optional)</label><input type="datetime-local" id="xFrom"><small>Empty = as soon as it is published.</small></div>
      <div class="field"><label for="xUntil">Hide after (optional)</label><input type="datetime-local" id="xUntil"><small>Empty = stays visible until you hide it.</small></div>
      <div class="full err" id="xErr"></div>
      <div class="full row"><button class="btn primary" type="submit" id="xSave">Add</button><button class="btn ghost" type="button" id="xCancel" hidden>Cancel editing</button></div></form>`;
  }

  function bindForm(){
    const type = () => $x("#xType").value;
    const fillTopics = sel => { $x("#xTopic").innerHTML = (type() === "pin" ? "" : `<option value="">Whole day (not tied to one topic)</option>`) + topicsOf($x("#xDay").value).map(t => `<option value="${E(t.id)}">${E(t.title)}</option>`).join(""); if(sel !== undefined) $x("#xTopic").value = sel; };
    const sync = () => {
      const t = type(), show = (id, on) => { $x("#" + id).hidden = !on; };
      show("xDayRow", t !== "day"); show("xNumRow", t === "day"); show("xCodeRow", t === "day");
      show("xTopicRow", t !== "topic" && t !== "day" && t !== "quiz");
      show("xTitleRow", t !== "pin" && t !== "quiz");
      show("xUrlRow", ["video", "material", "note", "pin", "topic"].includes(t));
      show("xTextRow", ["video", "material", "note", "topic", "day"].includes(t));
      show("xPollRow", t === "topic" || t === "poll"); show("xPollQRow", t === "topic"); show("xQuizRow", t === "quiz");
      $x("#xTitleLabel").textContent = t === "poll" ? "Poll question" : t === "day" ? "Day title" : "Title";
      $x("#xPollHint").textContent = t === "poll" ? "A poll does not lock the quiz. Everyone can vote and see the results." : "Participants must vote on a new topic before the day's quiz opens, as with every other topic.";
      $x("#xUrlLabel").textContent = t === "material" ? "Link" : t === "note" ? "Link (optional)" : t === "topic" ? "YouTube link (optional)" : "YouTube link";
      $x("#xUrlHint").textContent = t === "material" ? "Share a Drive / OneDrive / website link that anyone with the link can open." : t === "note" ? "" : "Paste any YouTube link, e.g. https://youtu.be/…";
      $x("#xTextLabel").textContent = t === "note" ? "Note" : t === "topic" ? "Reading notes for the topic" : t === "day" ? "What this day covers (optional)" : "Description (optional)";
      $x("#xTopicHint").textContent = t === "pin" ? "The chosen topic will show this video instead of its current one." : "Pick a topic to attach it there, or leave it for the whole day.";
      fillTopics($x("#xTopic").value);
    };
    $x("#xType").onchange = sync;
    $x("#xDay").onchange = () => fillTopics();
    sync();
    $x("#xCancel").onclick = () => resetForm();
    $x("#xForm").onsubmit = async e => {
      e.preventDefault();
      const t = type(), err = $x("#xErr"); err.textContent = "";
      const it = { id: editing ? editing.id : (t === "pin" ? "pin-" + $x("#xTopic").value : uid()), day:+$x("#xDay").value, topic: t === "topic" ? "" : $x("#xTopic").value, type:t,
        title: $x("#xTitle").value.trim(), url: $x("#xUrl").value.trim(), text: $x("#xText").value.trim(), extra:{},
        published: $x("#xPub").checked, publishAt: fromLocal($x("#xFrom").value), expiresAt: fromLocal($x("#xUntil").value), created: editing ? editing.created : Date.now() };
      if(t === "day"){
        const n = Math.floor(+$x("#xNum").value);
        if(!(n >= minDayNum())){ err.textContent = "Day number must be " + minDayNum() + " or higher."; return; }
        if(adminItems.some(x => x.type === "day" && +x.day === n && x.id !== it.id)){ err.textContent = "Day " + n + " already exists. Choose another number."; return; }
        it.day = n; it.topic = ""; it.url = ""; it.extra = { code: $x("#xCode").value.trim() };
      }
      if(t === "quiz"){
        const r = parseQuiz($x("#xQuiz").value); if(r.error){ err.textContent = r.error; return; }
        it.extra = { questions:r.questions, replace:$x("#xReplace").checked }; it.topic = ""; it.url = ""; it.text = "";
        it.title = r.questions.length + " question" + (r.questions.length === 1 ? "" : "s") + (it.extra.replace ? " (replace quiz)" : " (added to quiz)");
        if(JSON.stringify(it.extra).length > 40000){ err.textContent = "That is too many questions for one item. Split them into two items."; return; }
      }
      if(t === "poll"){
        const opts = $x("#xPollO").value.split("\n").map(x => x.trim()).filter(Boolean);
        if(opts.length < 2 || opts.length > 6){ err.textContent = "A poll needs 2 to 6 options, one per line."; return; }
        it.extra = { pollOpts: opts }; it.url = ""; it.text = "";
      }
      if(t === "pin"){ it.title = "Main video"; it.text = ""; if(!it.topic){ err.textContent = "Choose the topic whose video you want to replace."; return; } }
      if(t !== "pin" && !it.title){ err.textContent = t === "poll" ? "Write the poll question." : "Give it a title."; return; }
      if((t === "video" || t === "pin") && !ytId(it.url)){ err.textContent = "That does not look like a YouTube link."; return; }
      if(t === "topic" && it.url && !ytId(it.url)){ err.textContent = "That does not look like a YouTube link. Leave it empty if there is no video."; return; }
      if(t === "material" && !safeUrl(it.url)){ err.textContent = "Enter a full link starting with http:// or https://"; return; }
      if(t === "note" && it.url && !safeUrl(it.url)){ err.textContent = "The link must start with http:// or https://"; return; }
      if(t === "note" && !it.text){ err.textContent = "Write the note text."; return; }
      if(t === "topic"){
        const opts = $x("#xPollO").value.split("\n").map(s => s.trim()).filter(Boolean);
        if(opts.length === 1 || opts.length > 6){ err.textContent = "A poll needs 2 to 6 options, or leave the options empty to use the default poll."; return; }
        it.extra = { pollQ: $x("#xPollQ").value.trim(), pollOpts: opts };
      }
      if(it.publishAt && it.expiresAt && it.expiresAt <= it.publishAt){ err.textContent = "“Hide after” must be later than “Show from”."; return; }
      $x("#xSave").disabled = true;
      let r; try{ r = await adminSave(it); }catch(ex){ r = { error:"Could not reach the Google Sheet. Check your connection and try again." }; }
      $x("#xSave").disabled = false;
      if(r.error){ if(/key/i.test(r.error)){ setKey(null); bindAdmin(); } err.textContent = r.error; return; }
      toast(editing ? "Changes saved." : "Added.");
      const i = adminItems.findIndex(x => x.id === it.id); if(i >= 0) adminItems[i] = it; else adminItems.push(it);
      await reloadPublic(); refreshDays(); resetForm(); renderRows();
    };
  }
  /* a day added or hidden a moment ago must show up in the Day list straight away */
  function refreshDays(){
    const sel = $x("#xDay"); if(!sel) return;
    const keep = sel.value;
    sel.innerHTML = adminDays().map(d => `<option value="${d.id}">${E(dayName(d.id))}</option>`).join("");
    if([...sel.options].some(o => o.value === keep)) sel.value = keep;
    sel.onchange && sel.onchange();
  }
  function resetForm(){
    editing = null;
    ["xTitle", "xUrl", "xText", "xPollQ", "xPollO", "xFrom", "xUntil", "xQuiz", "xCode"].forEach(id => { $x("#" + id).value = ""; });
    $x("#xReplace").checked = false; $x("#xNum").value = minDayNum();
    $x("#xPub").checked = true; $x("#xSave").textContent = "Add"; $x("#xCancel").hidden = true; $x("#xErr").textContent = "";
  }
  function startEdit(it){
    editing = it;
    $x("#xType").value = it.type; $x("#xType").onchange(); $x("#xDay").value = it.day; $x("#xDay").onchange();
    $x("#xNum").value = it.day; $x("#xCode").value = (it.extra && it.extra.code) || "";
    $x("#xQuiz").value = it.type === "quiz" ? quizToText(it.extra && it.extra.questions) : ""; $x("#xReplace").checked = !!(it.extra && it.extra.replace);
    $x("#xTopic").value = it.topic || "";
    $x("#xTitle").value = it.title === "Main video" && it.type === "pin" ? "" : it.title; $x("#xUrl").value = it.url || ""; $x("#xText").value = it.text || "";
    $x("#xPollQ").value = (it.extra && it.extra.pollQ) || ""; $x("#xPollO").value = ((it.extra && it.extra.pollOpts) || []).join("\n");
    $x("#xPub").checked = !!it.published; $x("#xFrom").value = toLocal(it.publishAt); $x("#xUntil").value = toLocal(it.expiresAt);
    $x("#xSave").textContent = "Save changes"; $x("#xCancel").hidden = false;
    $x("#xForm").scrollIntoView({ behavior:"smooth", block:"center" });
  }

  function renderRows(){
    const body = $x("#xRows"); if(!body) return;
    const list = adminItems.slice().sort((a, b) => (b.created || 0) - (a.created || 0));
    $x("#xCount").textContent = list.length;
    if(!list.length){ body.innerHTML = `<tr><td colspan="5" class="xmuted" style="white-space:normal">Nothing added yet. Use the form above.</td></tr>`; return; }
    body.innerHTML = list.map(it => {
      const st = status(it), win = it.publishAt || it.expiresAt ? `<div class="xmuted">${it.publishAt ? "from " + E(when(it.publishAt)) : ""}${it.publishAt && it.expiresAt ? " · " : ""}${it.expiresAt ? "until " + E(when(it.expiresAt)) : ""}</div>` : "";
      const where = it.type === "topic" || it.type === "day" ? E(dayName(it.day)) : it.topic ? E(dayName(it.day)) + `<div class="xmuted">${E(topicTitle(it.topic))}</div>` : E(dayName(it.day)) + `<div class="xmuted">whole day</div>`;
      const label = it.type === "pin" ? "Replaced video" : it.title;
      return `<tr><td>${E(TYPES[it.type] || it.type)}</td><td style="white-space:normal;min-width:160px">${E(label)}</td><td style="white-space:normal">${where}</td>
        <td><span class="xb ${st}">${st}</span>${win}${it.type === "poll" ? `<div class="xmuted" data-xtally="${E(it.id)}"></div>` : ""}</td>
        <td><div class="row"><button class="btn small" data-xedit="${E(it.id)}">Edit</button><button class="btn small" data-xtoggle="${E(it.id)}">${it.published ? "Hide" : "Publish"}</button><button class="btn small ghost" data-xdel="${E(it.id)}">Delete</button></div></td></tr>`;
    }).join("");
    body.querySelectorAll("[data-xtally]").forEach(el => {
      const it = adminItems.find(x => x.id === el.dataset.xtally), opts = (it.extra && it.extra.pollOpts) || [], pid = "xp-" + it.id;
      const show = c => { el.innerHTML = opts.map((o, i) => E(o) + ": <b>" + (c[i] || 0) + "</b>").join("<br>"); };
      show(localCounts(pid, opts.length));
      if(remote()) fetchTally(pid).then(c => { if(c && el.isConnected) show(c); });
    });
    body.querySelectorAll("[data-xedit]").forEach(b => b.onclick = () => startEdit(adminItems.find(x => x.id === b.dataset.xedit)));
    body.querySelectorAll("[data-xtoggle]").forEach(b => b.onclick = async () => {
      const it = adminItems.find(x => x.id === b.dataset.xtoggle); const copy = Object.assign({}, it, { published: !it.published });
      b.disabled = true; const r = await adminSave(copy).catch(() => ({ error:"Could not reach the Google Sheet." }));
      if(r.error){ toast(r.error); b.disabled = false; return; }
      Object.assign(it, copy); toast(copy.published ? "Published." : "Hidden from participants."); renderRows(); reloadPublic().then(refreshDays);
    });
    body.querySelectorAll("[data-xdel]").forEach(b => b.onclick = async () => {
      if(!b.dataset.armed){ b.dataset.armed = "1"; b.textContent = "Click again to delete"; setTimeout(() => { if(b.isConnected){ b.dataset.armed = ""; b.textContent = "Delete"; } }, 4000); return; }
      const id = b.dataset.xdel; b.disabled = true; const r = await adminDelete(id).catch(() => ({ error:"Could not reach the Google Sheet." }));
      if(r.error){ toast(r.error); b.disabled = false; return; }
      adminItems = adminItems.filter(x => x.id !== id); if(editing && editing.id === id) resetForm();
      toast("Deleted."); renderRows(); reloadPublic().then(refreshDays);
    });
  }

  function init(c){
    cfg = Object.assign(cfg, c || {});
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  }
  return { init, load, apply, refreshIfStale, pinFor, pinVideo, unpinVideo, topicBlock, dayBlock, afterRender, adminPanel, bindAdmin, extraGroup };
})();
