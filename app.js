// Daydot — todos and settings are saved in this browser's localStorage.
const STORE_KEY = "todo-calendar:v1"; // kept from the first version so saved todos carry over
const SETTINGS_KEY = "daydot:settings";
const LISTS_KEY = "daydot:lists";
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const fmt = (k, opts) => fromKey(k).toLocaleDateString(undefined, opts);
function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}
const shortTime = (t) => formatTime(t).replace(":00", "");
function friendlyDay(k) {
  const t = todayKey();
  if (k === t) return "Today";
  if (k === addDays(t, 1)) return "Tomorrow";
  if (k === addDays(t, -1)) return "Yesterday";
  return fmt(k, { weekday: "short", month: "short", day: "numeric" });
}

/* ---------- storage ---------- */
function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
// Finished todos clear away by themselves 30 days after you tick them off.
const KEEP_DONE_DAYS = 30;
const pruneOld = (list) => list.filter((t) => !(t.done && t.doneAt && t.doneAt < Date.now() - KEEP_DONE_DAYS * 864e5));
let todos = readJSON(STORE_KEY, []);
const settings = Object.assign({ name: "", theme: "auto", weekStart: 0, mode: "month", color: "white" }, readJSON(SETTINGS_KEY, {}));
// Named lists, like Homework or Shopping. Every todo belongs to one; older todos go in Personal.
let lists = readJSON(LISTS_KEY, null) || [{ id: "personal", name: "Personal" }];
if (!lists.length) lists = [{ id: "personal", name: "Personal" }];
function fixListIds() {
  const ids = new Set(lists.map((l) => l.id));
  todos.forEach((t) => { if (!ids.has(t.listId)) t.listId = lists[0].id; if (t.date == null) t.date = ""; });
}
fixListIds();
// When logged in, sync.js uploads changes to the account a moment after each save.
const queueSync = () => { if (window.daydotSync) window.daydotSync.queue(); };

/* Syncing between devices works item by item: every todo and list remembers when it was
   last changed (u), and deleted ones leave a delete marker with the time. When two copies
   are combined, the newer version of each item wins and deleted items stay deleted. */
const DELETED_KEY = "daydot:deleted";
let deleted = readJSON(DELETED_KEY, {});
const forgetOldMarkers = () => { const cut = Date.now() - 90 * 864e5; for (const k in deleted) if (deleted[k] < cut) delete deleted[k]; };
const sameAsSaved = (x) => { const { u, ...rest } = x; return JSON.stringify(rest); };
const savedTodos = new Map();
const savedLists = new Map();
function baseline(arr, map) { map.clear(); arr.forEach((x) => map.set(x.id, sameAsSaved(x))); }
// Stamp what changed since the last save, and mark what disappeared as deleted.
function stamp(arr, map) {
  const now = Date.now();
  const ids = new Set();
  arr.forEach((x) => {
    ids.add(x.id);
    const j = sameAsSaved(x);
    if (map.get(x.id) !== j) { x.u = now; map.set(x.id, j); delete deleted[x.id]; }
  });
  for (const id of [...map.keys()]) if (!ids.has(id)) { deleted[id] = now; map.delete(id); }
  forgetOldMarkers();
}
const saveLists = () => { stamp(lists, savedLists); writeJSON(LISTS_KEY, lists); writeJSON(DELETED_KEY, deleted); queueSync(); };
const listOf = (id) => lists.find((l) => l.id === id) || lists[0];
const listName = (id) => { const l = listOf(id); return (l.emoji ? l.emoji + " " : "") + l.name; };
// Pastel colors a list can have; its todos use it on the calendar and in tags.
const LIST_COLORS = { gray: "#d6d6d6", pink: "#f8bbd0", orange: "#ffd3a8", yellow: "#ffee99", green: "#b7e4c7", blue: "#bbdefb", purple: "#d1c4e9" };
function tintWithList(node, listId) {
  const c = LIST_COLORS[listOf(listId).color];
  if (c) { node.classList.add("lc"); node.style.setProperty("--lc", c); }
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const saveTodos = () => { stamp(todos, savedTodos); writeJSON(STORE_KEY, todos); writeJSON(DELETED_KEY, deleted); queueSync(); };
const saveSettings = () => { settings.u = Date.now(); writeJSON(SETTINGS_KEY, settings); queueSync(); };
baseline(todos, savedTodos);
baseline(lists, savedLists);
if (pruneOld(todos).length !== todos.length) { todos = pruneOld(todos); saveTodos(); }

// Combine two copies (account and this device): newest version of each item wins,
// deleted items stay deleted. When both are equally new, the first copy (a) wins.
function mergeData(a, b) {
  const del = { ...(a.deleted || {}) };
  for (const [k, v] of Object.entries(b.deleted || {})) del[k] = Math.max(del[k] || 0, v);
  const pick = (x, y) => {
    const m = new Map();
    for (const it of [...(x || []), ...(y || [])]) {
      const cur = m.get(it.id);
      if (!cur || (it.u || 0) > (cur.u || 0)) m.set(it.id, it);
    }
    return [...m.values()].filter((it) => !(del[it.id] && del[it.id] >= (it.u || 0)));
  };
  const sa = a.settings, sb = b.settings;
  return {
    todos: pick(a.todos, b.todos),
    lists: pick(a.lists, b.lists),
    settings: !sa ? sb : !sb ? sa : (sb.u || 0) > (sa.u || 0) ? sb : sa,
    deleted: del,
  };
}
// Compares two copies ignoring key order, so syncing knows when nothing changed.
function stableJSON(x) {
  if (Array.isArray(x)) return "[" + x.map(stableJSON).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stableJSON(x[k])).join(",") + "}";
  return JSON.stringify(x === undefined ? null : x);
}
const byIdSorted = (arr) => [...(arr || [])].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
const sameData = (a, b) => stableJSON({ t: byIdSorted(a.todos), l: byIdSorted(a.lists), s: a.settings || null, d: a.deleted || {} })
  === stableJSON({ t: byIdSorted(b.todos), l: byIdSorted(b.lists), s: b.settings || null, d: b.deleted || {} });

/* ---------- state ---------- */
let selected = todayKey();
let viewMonth = new Date(); viewMonth.setDate(1);
let currentList = lists.some((l) => l.id === settings.list) ? settings.list : "all";

const byTime = (a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || a.created - b.created;
// Starred first, then the order you dragged them into, then by time.
const rank = (a, b) => (!!b.star - !!a.star) || ((a.order ?? 1e15) - (b.order ?? 1e15)) || byTime(a, b);
const todosOn = (k) => todos.filter((t) => t.date === k).sort(rank);

/* ---------- repeating todos ---------- */
// Ticking off a repeating todo adds the next one on its next date.
const REPEAT_LABELS = { daily: "Every day", weekdays: "Every weekday", weekly: "Every week", monthly: "Every month" };
function nextDate(k, repeat, monthDay) {
  if (repeat === "daily") return addDays(k, 1);
  if (repeat === "weekly") return addDays(k, 7);
  if (repeat === "weekdays") {
    let n = addDays(k, 1);
    while ([0, 6].includes(fromKey(n).getDay())) n = addDays(n, 1);
    return n;
  }
  const d = fromKey(k);
  const want = monthDay || d.getDate();
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate();
  return keyOf(new Date(d.getFullYear(), d.getMonth() + 1, Math.min(want, last)));
}

function addTodo(text, date, time, listId) {
  todos.push({
    id: newId(),
    date: date || "", text, time: time || "", listId: listId || lists[0].id, done: false, created: Date.now(),
  });
  saveTodos();
  renderAll();
}
const current = (t) => todos.find((x) => x.id === t.id) || t; // the live copy after a sync update
function setDone(t, done) {
  t = current(t);
  const wasDue = !t.done && t.date && t.date <= todayKey();
  t.done = done;
  t.doneAt = done ? Date.now() : undefined;
  if (done && t.repeat && !todos.some((x) => x.id === t.nextId)) {
    const base = t.date || todayKey();
    const next = JSON.parse(JSON.stringify(t));
    Object.assign(next, {
      id: newId(), date: nextDate(base, t.repeat, t.repeatDay), done: false, created: Date.now(),
      repeatDay: t.repeatDay || fromKey(base).getDate(),
    });
    delete next.doneAt; delete next.reminded; delete next.nextId;
    (next.subtasks || []).forEach((st) => { st.done = false; });
    t.nextId = next.id;
    todos.push(next);
  } else if (!done && t.nextId) {
    // Unticked by mistake: take back the next one, unless it's been ticked too.
    todos = todos.filter((x) => !(x.id === t.nextId && !x.done));
    delete t.nextId;
  }
  saveTodos();
  renderAll();
  if (done && wasDue && !todos.some((x) => !x.done && x.date && x.date <= todayKey())) allDone();
}
function allDone() {
  const y = $("yay");
  y.hidden = false;
  y.classList.remove("show");
  void y.offsetWidth;
  y.classList.add("show");
  clearTimeout(allDone.timer);
  allDone.timer = setTimeout(() => { y.hidden = true; }, 2600);
  y.onclick = () => { y.hidden = true; };
}
function removeTodo(t) {
  todos = todos.filter((x) => x.id !== t.id);
  saveTodos();
  renderAll();
}
function deleteWithUndo(t) {
  const at = todos.indexOf(t);
  removeTodo(t);
  showToast(`Deleted "${t.text}"`, "🗑", { label: "Undo", run: () => { todos.splice(Math.max(at, 0), 0, t); saveTodos(); renderAll(); } });
}

/* A todo row: checkbox, text with a small details line, star and Edit.
   Swipe right to tick it off, swipe left to delete. */
function todoItem(t, { showList = false, reorder = null, simple = false } = {}) {
  const li = el("li", t.done ? "done" : "");
  li.dataset.id = t.id;
  const row = el("div", "row");
  if (reorder) {
    const handle = el("span", "handle", "⋮⋮");
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-hidden", "true");
    addReorder(handle, li, reorder);
    row.append(handle);
  }
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = t.done;
  cb.setAttribute("aria-label", `Mark "${t.text}" done`);
  cb.addEventListener("change", () => {
    if (!cb.checked) { setDone(t, false); return; }
    buzz(15);
    // In To do (and for repeats) it slides away; elsewhere it pops and stays, crossed out.
    if (t.repeat || li.closest("#todo-groups")) swipeAway(li, () => setDone(t, true));
    else popDone(li, () => setDone(t, true));
  });

  const text = el("span", "text");
  text.setAttribute("role", "button");
  text.tabIndex = 0;
  text.setAttribute("aria-label", `Edit "${t.text}"`);
  text.append(el("span", "title", t.text));
  const bits = [];
  if (t.repeat) bits.push("🔁 " + REPEAT_LABELS[t.repeat]);
  if (remindAt(t) && !t.done) bits.push("🔔");
  if (t.subtasks && t.subtasks.length) bits.push(`☑ ${t.subtasks.filter((x) => x.done).length}/${t.subtasks.length}`);
  if (t.notes) bits.push(t.notes.split("\n")[0]);
  if (bits.length && !simple) text.append(el("span", "meta", bits.join(" · ")));
  text.addEventListener("click", () => { if (!li.dataset.held) openEditor(t); });
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEditor(t); } });
  row.append(cb, text);

  if (showList && !simple) {
    const tag = el("span", "tag", listName(t.listId));
    tintWithList(tag, t.listId);
    row.append(tag);
  }
  row.append(el("span", "time", simple ? "" : formatTime(t.time)));
  if (t.star) {
    const star = el("span", "star-mark", "★");
    star.title = "Starred (press and hold the todo to unstar)";
    row.append(star);
  }
  li.append(row);
  addSwipe(li, row, t);
  return li;
}

/* The ticked-off animation: the checkbox pops, a sparkle flies, the row turns green,
   slides off to the right, and the gap closes. Then the list updates. */
function swipeAway(li, then, alreadySwiped = false) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { then(); return; }
  const row = li.querySelector(".row");
  li.dataset.swipe = "done";
  li.classList.add("celebrate", "armed");
  li.style.height = li.offsetHeight + "px";
  const pop = alreadySwiped ? 0 : 280;
  setTimeout(() => { row.style.transform = "translateX(110%)"; row.style.opacity = "0"; }, pop);
  setTimeout(() => { li.classList.add("closing"); li.style.height = "0px"; }, pop + 300);
  setTimeout(then, pop + 560);
}

function popDone(li, then) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { then(); return; }
  li.classList.add("celebrate");
  setTimeout(then, 420);
}
const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not supported */ } };

/* Swipe a row sideways: right ticks it off (or back), left deletes it with Undo. */
function addSwipe(li, row, t) {
  let x0 = 0, y0 = 0, dx = 0, id = null, tracking = false, sideways = false, hold = null;
  row.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, input, .handle") || (e.pointerType === "mouse" && e.button !== 0)) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; id = e.pointerId; tracking = true; sideways = false;
    delete li.dataset.held;
    // Press and hold to star or unstar.
    clearTimeout(hold);
    hold = setTimeout(() => {
      if (!tracking || sideways) return;
      tracking = false;
      li.dataset.held = "1";
      buzz(20);
      li.classList.add("starring");
      setTimeout(() => { const c = current(t); c.star = !c.star; saveTodos(); renderAll(); }, 220);
    }, 520);
  });
  row.addEventListener("contextmenu", (e) => { if (li.dataset.held || tracking) e.preventDefault(); });
  row.addEventListener("pointermove", (e) => {
    if (!tracking || e.pointerId !== id) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!sideways) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      clearTimeout(hold);
      if (Math.abs(my) > Math.abs(mx)) { tracking = false; return; } // scrolling
      sideways = true;
      try { row.setPointerCapture(id); } catch { /* pointer already gone */ }
      li.classList.add("swiping");
    }
    dx = Math.max(-150, Math.min(150, mx));
    row.style.transform = `translateX(${dx}px)`;
    li.dataset.swipe = dx > 0 ? (t.done ? "undo" : "done") : "delete";
    li.classList.toggle("armed", Math.abs(dx) > 80);
  });
  const end = (cancel) => {
    clearTimeout(hold);
    if (!tracking) return;
    tracking = false;
    li.classList.remove("swiping", "armed");
    if (!(sideways && !cancel && dx > 80 && !t.done && t.repeat)) row.style.transform = "";
    if (!sideways || cancel) return;
    if (dx > 80 && !t.done && t.repeat) swipeAway(li, () => setDone(t, true), true);
    else if (dx > 80) setDone(t, !t.done);
    else if (dx < -80) deleteWithUndo(t);
    else delete li.dataset.swipe;
  };
  row.addEventListener("pointerup", () => end(false));
  row.addEventListener("pointercancel", () => end(true));
}

/* Drag the ⋮⋮ handle to put todos in your own order. */
function addReorder(handle, li, groupKey) {
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ul = li.parentElement;
    try { handle.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    li.classList.add("dragging");
    const move = (ev) => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("li");
      if (!over || over === li || over.parentElement !== ul) return;
      const r = over.getBoundingClientRect();
      ul.insertBefore(li, ev.clientY < r.top + r.height / 2 ? over : over.nextSibling);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      li.classList.remove("dragging");
      [...ul.children].forEach((n, i) => { const x = todos.find((t) => t.id === n.dataset.id); if (x) x.order = i; });
      saveTodos();
      renderAll();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

/* ---------- add / edit screen ---------- */
let editing = null; // the todo being edited, or null when adding a new one
function openEditor(todo, date) {
  editing = todo || null;
  $("edit-title").textContent = todo ? "Edit todo" : "New todo";
  $("edit-list").innerHTML = "";
  lists.forEach((l) => $("edit-list").append(new Option(listName(l.id), l.id)));
  $("edit-list").value = todo ? todo.listId : currentList !== "all" ? currentList : lists[0].id;
  $("edit-text").value = todo ? todo.text : "";
  $("edit-notes").value = todo ? todo.notes || "" : "";
  setEditDate(todo ? todo.date : date || "", false);
  showMiniCal(false);
  $("edit-time").value = todo ? todo.time : "";
  $("edit-remind").value = todo && todo.remind != null ? String(todo.remind) : "";
  $("edit-repeat").value = todo && todo.repeat ? todo.repeat : "";
  $("edit-steps").innerHTML = "";
  (todo && todo.subtasks || []).forEach((st) => addStepRow(st));
  updateRepeatHint();
  $("edit-star").checked = !!(todo && todo.star);
  $("edit-delete").hidden = !todo;
  updateRemindHint();
  // Only the name shows at first; open "More" if this todo already uses any extras.
  const extras = todo && (todo.notes || (todo.subtasks || []).length || todo.time || todo.repeat || todo.remind != null || todo.star);
  setMore(!!extras);
  openOverlay("edit-screen");
  if (!todo) setTimeout(() => $("edit-text").focus(), 50);
}

/* ---------- cute date picker ---------- */
let miniMonth = new Date(); miniMonth.setDate(1);
function setEditDate(k, notify = true) {
  $("edit-date").value = k || "";
  $("date-btn-text").textContent = k ? `${friendlyDay(k)}${friendlyDay(k).includes(",") ? "" : " · " + fmt(k, { month: "short", day: "numeric" })}` : "No date";
  $("date-btn").classList.toggle("empty", !k);
  if (k) { const d = fromKey(k); miniMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
  if (notify) $("edit-date").dispatchEvent(new Event("input"));
  updateMoreLabel();
  if (!$("mini-cal").hidden) renderMiniCal();
}
function showMiniCal(open) {
  $("mini-cal").hidden = !open;
  $("date-btn").setAttribute("aria-expanded", open);
  if (open) {
    if (!$("edit-date").value) { miniMonth = new Date(); miniMonth.setDate(1); }
    renderMiniCal();
  }
}
function renderMiniCal() {
  $("mini-month").textContent = miniMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const grid = $("mini-grid");
  grid.innerHTML = "";
  const names = [...WEEKDAYS.slice(settings.weekStart), ...WEEKDAYS.slice(0, settings.weekStart)];
  names.forEach((n) => grid.append(el("span", "mini-wd", n[0])));
  const first = keyOf(miniMonth);
  const offset = (miniMonth.getDay() - settings.weekStart + 7) % 7;
  for (let i = 0; i < offset; i++) grid.append(el("span"));
  const days = new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 0).getDate();
  const t = todayKey();
  const picked = $("edit-date").value;
  const busy = new Set(todos.filter((x) => !x.done && x.date).map((x) => x.date));
  for (let n = 0; n < days; n++) {
    const k = addDays(first, n);
    const d = fromKey(k);
    const b = el("button", "mini-day", d.getDate());
    b.type = "button";
    if ([0, 6].includes(d.getDay())) b.classList.add("weekend");
    if (k < t) b.classList.add("past");
    if (k === t) b.classList.add("today");
    if (busy.has(k)) b.classList.add("has");
    if (k === picked) b.classList.add("picked");
    b.setAttribute("aria-label", fmt(k, { weekday: "long", month: "long", day: "numeric" }));
    b.setAttribute("aria-pressed", k === picked);
    b.addEventListener("click", () => { setEditDate(k); setTimeout(() => showMiniCal(false), 220); });
    grid.append(b);
  }
}

function setMore(open) {
  $("edit-more").hidden = !open;
  $("more-btn").setAttribute("aria-expanded", open);
  updateMoreLabel();
}
function updateMoreLabel() {
  const d = $("edit-date").value;
  const bits = [];
  if (d) bits.push("📅 " + friendlyDay(d));
  if (lists.length > 1) bits.push(listName($("edit-list").value));
  $("more-label").textContent = $("edit-more").hidden ? ["More options", ...bits].join(" · ") : "Fewer options";
}

function addStepRow(st = { id: newId(), text: "", done: false }) {
  const li = el("li");
  li.dataset.id = st.id;
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = !!st.done;
  cb.setAttribute("aria-label", "Step done");
  const input = el("input");
  input.type = "text";
  input.value = st.text;
  input.maxLength = 120;
  input.placeholder = "A step";
  input.setAttribute("aria-label", "Step");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addStepRow().querySelector('input[type="text"]').focus(); }
  });
  const del = el("button", "step-del", "✕");
  del.type = "button";
  del.setAttribute("aria-label", "Remove step");
  del.addEventListener("click", () => li.remove());
  li.append(cb, input, del);
  $("edit-steps").append(li);
  return li;
}
const readSteps = () => [...$("edit-steps").children]
  .map((li) => ({ id: li.dataset.id, text: li.querySelector('input[type="text"]').value.trim(), done: li.querySelector('input[type="checkbox"]').checked }))
  .filter((st) => st.text);

function updateRepeatHint() {
  const r = $("edit-repeat").value;
  $("repeat-hint").textContent = !r ? "" : $("edit-date").value
    ? "When you tick it off, the next one is added automatically."
    : "No date picked, so it starts today. When you tick it off, the next one is added.";
}

/* ---------- reminders ---------- */
// A todo's reminder is how many minutes before it to remind (0 = at the time).
// It needs a date; with no time it uses 9:00 AM that day.
const REMIND_LABELS = { 0: "at the time", 10: "10 minutes before", 30: "30 minutes before", 60: "1 hour before", 1440: "1 day before" };
function remindAt(t) {
  if (!t.date || t.remind == null) return null;
  const [y, m, d] = t.date.split("-").map(Number);
  const [hh, mm] = (t.time || "09:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime() - t.remind * 60000;
}
const canNotify = () => "Notification" in window;

function updateRemindHint() {
  const date = $("edit-date").value;
  const remind = $("edit-remind").value;
  const hint = $("remind-hint");
  $("edit-ics").hidden = !date;
  if (remind === "") { hint.textContent = ""; return; }
  if (!date) { hint.textContent = "Pick a date so Daydot knows when to remind you."; return; }
  const when = new Date(remindAt({ date, time: $("edit-time").value, remind: Number(remind) }));
  hint.textContent = "Reminds you " + when.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) +
    (!$("edit-time").value ? " (9 AM, since there's no time)" : "") + ".";
}

async function askNotifyPermission() {
  if (!canNotify() || Notification.permission !== "default") return;
  try { await Notification.requestPermission(); } catch { /* older browsers */ }
  renderNotifyStatus();
  if (window.daydotSync && window.daydotSync.subscribePush) window.daydotSync.subscribePush();
}

let swReg = null;
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((r) => { swReg = r; }).catch(() => {});
}

function showToast(text, icon = "🔔", action = null) {
  $("toast-text").textContent = text;
  $("toast").querySelector(".toast-icon").textContent = icon;
  const btn = $("toast-action");
  btn.hidden = !action;
  btn.onclick = action ? () => { $("toast").hidden = true; action.run(); } : null;
  if (action) btn.textContent = action.label;
  $("toast").hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { $("toast").hidden = true; }, action ? 6000 : 12000);
}

function fireReminder(t) {
  const body = (t.time ? formatTime(t.time) + " · " : "") + friendlyDay(t.date);
  showToast(`${t.text} — ${body}`);
  if (canNotify() && Notification.permission === "granted") {
    const opts = { body, tag: t.id, icon: "icon.svg" };
    if (swReg) swReg.showNotification(t.text, opts).catch(() => {});
    else try { new Notification(t.text, opts); } catch { /* not allowed here */ }
  }
}

// Checks every 20 seconds while Daydot is open. Missed reminders from the last day
// show when you next open it.
function checkReminders() {
  const now = Date.now();
  let changed = false;
  todos.forEach((t) => {
    const at = remindAt(t);
    if (!at || t.done || t.reminded === at || at > now) return;
    if (now - at < 864e5) fireReminder(t);
    t.reminded = at;
    changed = true;
  });
  if (changed) saveTodos();
}

/* Downloads a calendar file with an alarm, so the phone's own calendar reminds you
   even when Daydot is closed. */
function downloadIcs(t) {
  const [y, m, d] = t.date.split("-");
  const esc = (v) => v.replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  let start, end;
  if (t.time) {
    const [hh, mm] = t.time.split(":");
    start = `DTSTART:${y}${m}${d}T${hh}${mm}00`;
    const e = new Date(+y, m - 1, +d, +hh, +mm + 30);
    end = `DTEND:${e.getFullYear()}${pad(e.getMonth() + 1)}${pad(e.getDate())}T${pad(e.getHours())}${pad(e.getMinutes())}00`;
  } else {
    start = `DTSTART;VALUE=DATE:${y}${m}${d}`;
    end = `DTEND;VALUE=DATE:${addDays(t.date, 1).replace(/-/g, "")}`;
  }
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Daydot//EN", "BEGIN:VEVENT",
    `UID:${t.id}@daydot`, `DTSTAMP:${stamp}`, start, end, `SUMMARY:${esc(t.text)}`];
  if (t.notes) lines.push(`DESCRIPTION:${esc(t.notes)}`);
  if (t.remind != null) {
    // All-day events count from midnight, so "at the time" means 9 AM that day.
    const mins = t.time ? t.remind : t.remind - 540;
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(t.text)}`,
      mins >= 0 ? `TRIGGER:-PT${mins}M` : `TRIGGER:PT${-mins}M`, "END:VALARM");
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  const a = el("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  a.download = (t.text.replace(/[^\w\s-]/g, "").trim().slice(0, 40) || "todo") + ".ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderNotifyStatus() {
  const status = $("notif-status");
  const btn = $("notif-on");
  if (!canNotify()) {
    status.textContent = "Shown inside Daydot";
    btn.hidden = true;
  } else if (Notification.permission === "granted") {
    status.textContent = "On";
    btn.hidden = true;
  } else if (Notification.permission === "denied") {
    status.textContent = "Blocked in your browser settings";
    btn.hidden = true;
  } else {
    status.textContent = "";
    btn.hidden = false;
  }
}

/* Daydot's own "Are you sure?" box. The browser's built-in confirm() is silently
   blocked in some apps and home-screen views, which made Delete do nothing. */
function askConfirm(message, yesLabel = "Delete") {
  return new Promise((resolve) => {
    const box = $("confirm");
    $("confirm-text").textContent = message;
    $("confirm-yes").textContent = yesLabel;
    box.hidden = false;
    const done = (answer) => {
      box.hidden = true;
      $("confirm-yes").onclick = $("confirm-no").onclick = box.onclick = null;
      document.removeEventListener("keydown", onKey, true);
      resolve(answer);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    $("confirm-yes").onclick = () => done(true);
    $("confirm-no").onclick = () => done(false);
    box.onclick = (e) => { if (e.target === box) done(false); };
    document.addEventListener("keydown", onKey, true);
    setTimeout(() => $("confirm-no").focus(), 30);
  });
}
const notify = (text) => showToast(text, "ℹ️");

/* Full-screen forms get their own history entry, so Cancel, the back gesture or Esc closes them. */
const OVERLAYS = ["edit-screen", "list-screen", "account-screen"];
function openOverlay(id) {
  const already = overlayOpen();
  OVERLAYS.forEach((o) => { $(o).hidden = o !== id; });
  document.body.classList.add("day-open");
  if (!already) history.pushState({ ...(history.state || {}), overlay: true }, "", location.href);
}
function hideOverlays() {
  OVERLAYS.forEach((id) => { $(id).hidden = true; });
  document.body.classList.toggle("day-open", !$("day-screen").hidden);
  editing = null;
  editingList = null;
}
function closeOverlay() {
  if (history.state && history.state.overlay) history.back(); // popstate hides it
  else hideOverlays();
}
const overlayOpen = () => OVERLAYS.some((id) => !$(id).hidden);

/* ---------- lists ---------- */
let editingList = null;
let listColorChoice = "";
function renderListColors() {
  const wrap = $("list-colors");
  wrap.innerHTML = "";
  [["", "No color"], ...Object.keys(LIST_COLORS).map((k) => [k, k[0].toUpperCase() + k.slice(1)])].forEach(([key, name]) => {
    const b = el("button", "swatch" + (key ? "" : " none"));
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", name);
    b.title = name;
    b.setAttribute("aria-checked", listColorChoice === key);
    if (key) b.style.background = LIST_COLORS[key];
    b.addEventListener("click", () => { listColorChoice = key; renderListColors(); });
    wrap.append(b);
  });
}
function openListEditor(list) {
  editingList = list || null;
  $("list-screen-title").textContent = list ? "Edit list" : "New list";
  $("list-name").value = list ? list.name : "";
  $("list-emoji").value = list && list.emoji ? list.emoji : "";
  listColorChoice = list && list.color ? list.color : "";
  renderListColors();
  $("list-delete").hidden = !list || lists.length < 2;
  openOverlay("list-screen");
  setTimeout(() => $("list-name").focus(), 50);
}
function chooseList(id) {
  currentList = id;
  settings.list = id;
  saveSettings();
  renderTodoList();
}

/* ---------- calendar ---------- */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekStartOf = (k) => {
  const d = fromKey(k);
  return addDays(k, -((d.getDay() - settings.weekStart + 7) % 7));
};

function dayCell(k, { other = false, week = false } = {}) {
  const list = todosOn(k);
  const cell = el("button", week ? "day week-day" : "day");
  cell.type = "button";
  if (other) cell.classList.add("other");
  if (k === todayKey()) cell.classList.add("is-today");
  if (k === selected) cell.classList.add("selected");
  cell.setAttribute("aria-label", `${fmt(k, { weekday: "long", month: "long", day: "numeric" })}, ${list.length} todo${list.length === 1 ? "" : "s"}`);

  const head = el("span", "day-head");
  if (week) head.append(el("span", "wd", fmt(k, { weekday: "short" })));
  head.append(el("span", "num", fromKey(k).getDate()));
  cell.append(head);

  const max = week ? Infinity : 3;
  cell.dataset.key = k;
  list.slice(0, max).forEach((t) => {
    const chip = el("span", "chip" + (t.done ? " done" : ""), (t.star ? "★ " : "") + (t.time ? shortTime(t.time) + " " : "") + t.text);
    tintWithList(chip, t.listId);
    addChipDrag(chip, t);
    cell.append(chip);
  });
  if (list.length > max) cell.append(el("span", "more", `+${list.length - max} more`));
  if (week && !list.length) cell.append(el("span", "more", "Nothing planned"));
  if (list.length) cell.append(el("span", "dot" + (list.every((t) => t.done) ? " all-done" : "")));

  cell.addEventListener("click", () => { if (!justDragged) openDay(k); }); // tap a day to see and add its todos
  return cell;
}

/* Drag a todo on the calendar onto another day to move it.
   Mouse: just drag. Touch: press and hold for a moment, then drag. */
let justDragged = false;
let chipDragging = false;
document.addEventListener("touchmove", (e) => { if (chipDragging) e.preventDefault(); }, { passive: false });
function addChipDrag(chip, t) {
  chip.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    let ghost = null, target = null, holdTimer = null;
    const start = () => {
      chipDragging = true;
      try { chip.setPointerCapture(pid); } catch { /* pointer already gone */ }
      ghost = chip.cloneNode(true);
      ghost.classList.add("ghost");
      document.body.append(ghost);
      document.body.classList.add("dragging-chip");
      if (navigator.vibrate) navigator.vibrate(15);
      place(sx, sy);
    };
    const place = (x, y) => {
      ghost.style.left = x + "px";
      ghost.style.top = y + "px";
      const over = document.elementFromPoint(x, y)?.closest(".day[data-key]");
      if (over !== target) {
        if (target) target.classList.remove("drop-target");
        target = over;
        if (target) target.classList.add("drop-target");
      }
    };
    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      const far = Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8;
      if (!chipDragging) {
        if (!far) return;
        if (e.pointerType === "mouse") start();
        else { cleanup(); return; } // moved before the hold finished: it's a scroll
      }
      place(ev.clientX, ev.clientY);
    };
    const cleanup = () => {
      clearTimeout(holdTimer);
      chip.removeEventListener("pointermove", move);
      chip.removeEventListener("pointerup", up);
      chip.removeEventListener("pointercancel", cancel);
    };
    const finish = (drop) => {
      cleanup();
      if (!chipDragging) return;
      chipDragging = false;
      ghost.remove();
      document.body.classList.remove("dragging-chip");
      if (target) target.classList.remove("drop-target");
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 50);
      const key = drop && target && target.dataset.key;
      if (key && key !== t.date) {
        t.date = key;
        delete t.reminded;
        saveTodos();
        renderAll();
        notify(`Moved "${t.text}" to ${friendlyDay(key)}.`);
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    if (e.pointerType !== "mouse") holdTimer = setTimeout(start, 350);
    chip.addEventListener("pointermove", move);
    chip.addEventListener("pointerup", up);
    chip.addEventListener("pointercancel", cancel);
  });
}

function renderCalendar() {
  const mode = settings.mode;
  $("view-calendar").querySelector(".cal-layout").dataset.mode = mode;
  document.querySelectorAll("#mode-seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));

  const grid = $("grid");
  const weekdays = $("weekdays");
  grid.innerHTML = "";
  grid.className = "grid grid-" + mode;
  const names = [...WEEKDAYS.slice(settings.weekStart), ...WEEKDAYS.slice(0, settings.weekStart)];
  weekdays.innerHTML = names.map((d) => `<div>${d}</div>`).join("");

  if (mode === "month") {
    $("month-label").textContent = viewMonth.toLocaleDateString(undefined, { month: innerWidth < 480 ? "short" : "long", year: "numeric" });
    const start = weekStartOf(keyOf(viewMonth));
    for (let i = 0; i < 42; i++) {
      const k = addDays(start, i);
      grid.append(dayCell(k, { other: fromKey(k).getMonth() !== viewMonth.getMonth() }));
    }
  } else if (mode === "week") {
    const start = weekStartOf(selected);
    const end = addDays(start, 6);
    const sameMonth = fromKey(start).getMonth() === fromKey(end).getMonth();
    $("month-label").textContent = `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
    for (let i = 0; i < 7; i++) grid.append(dayCell(addDays(start, i), { week: true }));
  } else {
    $("month-label").textContent = fmt(selected, innerWidth < 480 ? { weekday: "short", month: "short", day: "numeric" } : { weekday: "long", month: "long", day: "numeric" });
  }
}

function renderDay() {
  $("day-screen-label").textContent = fmt(selected, { weekday: "long", month: "long", day: "numeric" });
  const list = todosOn(selected);
  const left = list.filter((t) => !t.done).length;
  $("day-count").textContent = (selected === todayKey() ? "Today · " : "") +
    (list.length ? `${left} of ${list.length} left to do` : "Nothing planned");
  const ul = $("day-todos");
  ul.innerHTML = "";

  list.forEach((t) => ul.append(todoItem(t)));
}

function selectDay(k) {
  selected = k;
  const d = fromKey(k);
  viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  renderCalendar();
  renderDay();
}

function setMode(mode) {
  settings.mode = mode;
  saveSettings();
}

/* Full-screen day: its own history entry, so Back (button, gesture or browser) closes it. */
function openDay(k) {
  history.pushState({ day: true }, "", "#day/" + k);
  showTab();
}
function closeDay() {
  if (history.state && history.state.day) history.back();
  else go("calendar");
}
function moveDay(n) {
  history.replaceState({ day: true }, "", "#day/" + addDays(selected, n));
  showTab();
}

function step(n) {
  if (settings.mode === "month") {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + n, 1);
    renderCalendar();
  } else {
    selectDay(addDays(selected, settings.mode === "week" ? 7 * n : n));
  }
}

/* ---------- to do list ---------- */
// The next copy of a repeating todo stays out of To do until its day comes
// (it's still on the calendar on that day).
const waitingRepeat = (x) => x.repeat && !x.done && x.date && x.date > todayKey();
function renderListChips() {
  const wrap = $("list-chips");
  wrap.innerHTML = "";
  const chip = (id, label, count) => {
    const b = el("button", "list-chip");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", currentList === id);
    const color = id !== "all" && LIST_COLORS[listOf(id).color];
    if (color) { const dot = el("span", "list-dot"); dot.style.setProperty("--lc", color); b.append(dot); }
    b.append(el("span", null, label));
    if (count) b.append(el("span", "count", count));
    b.addEventListener("click", () => chooseList(id));
    wrap.append(b);
  };
  chip("all", "All", todos.filter((x) => !x.done && !waitingRepeat(x)).length);
  lists.forEach((l) => chip(l.id, listName(l.id), todos.filter((x) => !x.done && !waitingRepeat(x) && x.listId === l.id).length));
  const add = el("button", "list-chip new", "+ New list");
  add.type = "button";
  add.addEventListener("click", () => openListEditor(null));
  wrap.append(add);
}

let showDone = false;
const matches = (x, q) => [x.text, x.notes || "", ...(x.subtasks || []).map((st) => st.text)].join(" ").toLowerCase().includes(q);

function renderTodoList() {
  renderListChips();
  const t = todayKey();
  const all = currentList === "all";
  const scope = (all ? todos : todos.filter((x) => x.listId === currentList)).filter((x) => !waitingRepeat(x));
  const q = $("todo-search").value.trim().toLowerCase();
  let open = scope.filter((x) => !x.done);
  let done = scope.filter((x) => x.done);
  const overdue = open.filter((x) => x.date && x.date < t).length;
  $("list-title").textContent = all ? "All lists" : listName(currentList);
  $("list-edit").hidden = all;
  $("todo-summary").textContent = open.length
    ? `${open.length} to do${overdue ? ` · ${overdue} overdue` : ""}`
    : "All caught up!";
  if (q) { open = open.filter((x) => matches(x, q)); done = done.filter((x) => matches(x, q)); }
  const simple = settings.todoView === "simple";
  document.querySelectorAll("[data-todo-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.todoView === (simple ? "simple" : "detailed")));
  $("todo-add").hidden = simple;
  if (simple) { renderSimpleList(open, q); renderDoneSection(done, q, all && lists.length > 1); return; }

  // Dated todos first (soonest first), then ones with no date.
  open.sort((a, b) => (!a.date - !b.date) || a.date.localeCompare(b.date) || rank(a, b));
  // Group: all overdue together, then one group per date, then "No date".
  const groups = new Map();
  open.forEach((x) => {
    const g = !x.date ? "none" : x.date < t ? "overdue" : x.date;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(x);
  });
  if (groups.has("none")) { const v = groups.get("none"); groups.delete("none"); groups.set("none", v); }

  const wrap = $("todo-groups");
  wrap.innerHTML = "";
  if (!open.length) {
    const msg = q ? `Nothing to do matches "${$("todo-search").value.trim()}".` : scope.length ? "Nothing left to do 🎉" : "Nothing here yet. Tap + Add todo to add one.";
    wrap.append(el("p", "empty card", msg));
  }
  const showList = all && lists.length > 1;
  groups.forEach((items, g) => {
    const sec = el("section", "card group" + (g === "overdue" ? " overdue" : ""));
    const h = el("h2");
    if (g === "overdue") {
      h.textContent = "Overdue";
    } else if (g === "none") {
      h.textContent = "No date";
    } else {
      const link = el("button", "group-link", friendlyDay(g));
      link.type = "button";
      link.title = "Show on calendar";
      link.addEventListener("click", () => openDay(g));
      h.append(link);
      if (friendlyDay(g) !== fmt(g, { weekday: "short", month: "short", day: "numeric" })) {
        h.append(el("span", "group-date", fmt(g, { weekday: "short", month: "short", day: "numeric" })));
      }
    }
    const ul = el("ul", "todos");
    items.forEach((x) => {
      const li = todoItem(x, { showList, reorder: !q && items.length > 1 ? g : null });
      if (g === "overdue") li.querySelector(".time").textContent = friendlyDay(x.date) + (x.time ? " " + shortTime(x.time) : "");
      ul.append(li);
    });
    sec.append(h, ul);
    wrap.append(sec);
  });

  renderDoneSection(done, q, showList);
}

/* Simple view: every open todo in one plain checklist, no dates or details,
   with a line at the bottom to add one quickly. */
let focusQuickAdd = false;
function renderSimpleList(open, q) {
  open.sort(rank);
  const wrap = $("todo-groups");
  wrap.innerHTML = "";
  const card = el("section", "card simple-list");
  const ul = el("ul", "todos");
  open.forEach((x) => ul.append(todoItem(x, { simple: true, reorder: !q && open.length > 1 ? "simple" : null })));
  const form = el("form", "quick-add");
  form.autocomplete = "off";
  const input = el("input");
  input.placeholder = q ? "Clear the search to add" : "Add a todo";
  input.maxLength = 120;
  input.disabled = !!q;
  input.setAttribute("aria-label", "Add a todo");
  form.append(el("span", "plus", "+"), input);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    focusQuickAdd = true;
    addTodo(text, "", "", currentList !== "all" ? currentList : lists[0].id);
  });
  card.append(ul, form);
  wrap.append(card);
  if (focusQuickAdd) { focusQuickAdd = false; setTimeout(() => input.focus(), 0); }
}

function renderDoneSection(done, q, showList) {
  // Finished todos, folded away until you want them.
  const dw = $("done-wrap");
  dw.innerHTML = "";
  if (!done.length) return;
  done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const expanded = showDone || !!q;
  const sec = el("section", "card group done-group");
  const btn = el("button", "done-toggle");
  btn.type = "button";
  btn.setAttribute("aria-expanded", expanded);
  btn.append(el("span", null, `Done (${done.length})`), el("span", "chev", "▾"));
  btn.addEventListener("click", () => { showDone = !showDone; renderTodoList(); });
  sec.append(btn);
  if (expanded) {
    sec.append(el("p", "done-note", `Finished todos clear away after ${KEEP_DONE_DAYS} days.`));
    const ul = el("ul", "todos");
    done.slice(0, 100).forEach((x) => ul.append(todoItem(x, { showList, simple: settings.todoView === "simple" })));
    sec.append(ul);
  }
  dw.append(sec);
}

/* ---------- profile ---------- */
// App colors, the same choices as giftlst. Light mode: a pale background, the pastel for
// highlights, and a deeper tone of it for buttons and text. Dark mode: a tinted dark
// background with a light tone of the pastel.
const COLORS = {
  white:  { name: "White / Gray", swatch: "#e0e0e0", light: { bg: "#f5f5f5", pastel: "#e0e0e0", accent: "#474747" }, dark: { bg: "#131313", accent: "#c8c8c8" } },
  pink:   { name: "Pink",   swatch: "#f8bbd0", light: { bg: "#fff3f7", pastel: "#f8bbd0", accent: "#8c4a60" }, dark: { bg: "#191114", accent: "#ffb1c8" } },
  green:  { name: "Green",  swatch: "#b7e4c7", light: { bg: "#f2fbf5", pastel: "#b7e4c7", accent: "#386a4c" }, dark: { bg: "#0f1511", accent: "#9dd4b0" } },
  yellow: { name: "Yellow", swatch: "#ffee99", light: { bg: "#fffce8", pastel: "#ffee99", accent: "#6a5f11" }, dark: { bg: "#15130b", accent: "#dac86f" } },
  blue:   { name: "Blue",   swatch: "#bbdefb", light: { bg: "#f2f8ff", pastel: "#bbdefb", accent: "#36618e" }, dark: { bg: "#111418", accent: "#a1c9fd" } },
  purple: { name: "Purple", swatch: "#d1c4e9", light: { bg: "#f8f4fd", pastel: "#d1c4e9", accent: "#65558f" }, dark: { bg: "#141218", accent: "#cfbdfe" } },
};

function renderProfile() {
  const name = settings.name.trim();
  $("avatar-letter").textContent = name ? name[0].toUpperCase() : "🙂";
  $("avatar-letter").hidden = !!settings.photo;
  $("avatar-img").hidden = !settings.photo;
  if (settings.photo) $("avatar-img").src = settings.photo;
  $("photo-remove").hidden = !settings.photo;
  if (document.activeElement !== $("name-input")) $("name-input").value = settings.name;


  document.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-checked", b.dataset.color === settings.color));
  document.querySelectorAll("[data-theme-choice]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.themeChoice === settings.theme));
  document.querySelectorAll("[data-week]").forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.week) === settings.weekStart));
}

/* Profile picture: shrink to a 256px square so it fits in browser storage. */
$("photo-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const size = 256;
    const side = Math.min(img.width, img.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    settings.photo = canvas.toDataURL("image/jpeg", 0.85);
    URL.revokeObjectURL(img.src);
    saveSettings();
    renderProfile();
  };
  img.onerror = () => notify("That picture couldn't be opened. Try a JPG or PNG.");
  img.src = URL.createObjectURL(file);
});
$("photo-remove").addEventListener("click", () => { delete settings.photo; saveSettings(); renderProfile(); });

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const root = document.documentElement;
  const dark = settings.theme === "dark" || (settings.theme === "auto" && darkQuery.matches);
  const c = COLORS[settings.color] || COLORS.white;
  const t = dark ? c.dark : c.light;
  root.classList.toggle("dark", dark);
  root.style.setProperty("--bg", t.bg);
  root.style.setProperty("--pastel", t.pastel || c.swatch);
  root.style.setProperty("--accent", t.accent);
  root.style.setProperty("--on-accent", dark ? "#1c1b1d" : "#ffffff");
  document.querySelector('meta[name="theme-color"]').content = t.bg;
}
darkQuery.addEventListener("change", applyTheme);

Object.entries(COLORS).forEach(([key, c]) => {
  const b = el("button", "swatch");
  b.type = "button";
  b.dataset.color = key;
  b.setAttribute("role", "radio");
  b.setAttribute("aria-label", c.name);
  b.title = c.name;
  b.style.background = c.swatch;
  b.addEventListener("click", () => { settings.color = key; saveSettings(); applyTheme(); renderProfile(); });
  $("color-swatches").append(b);
});

/* ---------- tabs ---------- */
const TABS = ["calendar", "todo", "profile"];
function go(tab) {
  if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  showTab();
}
function showTab() {
  const hash = location.hash.slice(1);
  const dayMatch = /^day\/(\d{4}-\d{2}-\d{2})$/.exec(hash);
  const tab = dayMatch ? "calendar" : TABS.includes(hash) ? hash : "calendar";

  // Full-screen day: move the day's todo list into it; otherwise back into the calendar card.
  const open = !!dayMatch;
  if (open) selectDay(dayMatch[1]);
  const home = open ? $("day-screen-body") : $("view-calendar").querySelector(".calendar");
  if ($("day-panel").parentElement !== home) home.append($("day-panel"));
  $("day-screen").hidden = !open;
  document.body.classList.toggle("day-open", open);
  if (open) { renderDay(); return; }

  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.dataset.view !== tab; });
  document.querySelectorAll(".tab").forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
}

function renderBadge() {
  const t = todayKey();
  const n = todos.filter((x) => !x.done && x.date && x.date <= t).length;
  const b = $("todo-badge");
  b.hidden = !n;
  b.textContent = n > 9 ? "9+" : n;
  b.setAttribute("aria-label", `${n} due`);
}

function renderAll() {
  const before = rowPositions();
  renderCalendar();
  renderDay();
  renderTodoList();
  renderProfile();
  renderBadge();
  glide(before);
}

/* Todos glide to their new place instead of jumping (and new ones fade in). */
const rowKey = (li) => (li.closest("ul").id === "day-todos" ? "d" : "") + li.dataset.id;
const ROWS = "#todo-groups li[data-id], #done-wrap li[data-id], #day-todos li[data-id]";
function rowPositions() {
  const map = new Map();
  document.querySelectorAll(ROWS).forEach((li) => {
    const r = li.getBoundingClientRect();
    if (r.height) map.set(rowKey(li), r.top);
  });
  return map;
}
function glide(before) {
  if (!before.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll(ROWS).forEach((li) => {
    const r = li.getBoundingClientRect();
    if (!r.height) return;
    const old = before.get(rowKey(li));
    const anim = old == null
      ? [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }]
      : Math.abs(old - r.top) > 1 ? [{ transform: `translateY(${old - r.top}px)` }, { transform: "none" }] : null;
    if (anim) li.animate(anim, { duration: 260, easing: "cubic-bezier(.2, .8, .2, 1)" });
  });
}

/* ---------- events ---------- */
$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("month-label").addEventListener("click", () => selectDay(todayKey()));
$("mode-seg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  setMode(b.dataset.mode);
  selectDay(selected);
});

$("day-quick").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("day-quick-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addTodo(text, selected, "", currentList !== "all" ? currentList : lists[0].id);
  input.focus();
});
$("todo-add").addEventListener("click", () => openEditor(null, ""));
$("edit-cancel").addEventListener("click", closeOverlay);
$("list-cancel").addEventListener("click", closeOverlay);
["edit-date", "edit-time", "edit-remind"].forEach((id) => $(id).addEventListener("input", updateRemindHint));
["edit-date", "edit-repeat"].forEach((id) => $(id).addEventListener("input", updateRepeatHint));
$("more-btn").addEventListener("click", () => setMore($("edit-more").hidden));
$("edit-list").addEventListener("change", updateMoreLabel);
$("date-btn").addEventListener("click", () => showMiniCal($("mini-cal").hidden));
$("mini-prev").addEventListener("click", () => { miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() - 1, 1); renderMiniCal(); });
$("mini-next").addEventListener("click", () => { miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 1); renderMiniCal(); });
document.querySelectorAll("[data-quick]").forEach((b) => b.addEventListener("click", () => {
  const q = b.dataset.quick;
  setEditDate(q === "none" ? "" : addDays(todayKey(), Number(q)));
  setTimeout(() => showMiniCal(false), q === "none" ? 0 : 220);
}));
$("add-step").addEventListener("click", () => addStepRow().querySelector('input[type="text"]').focus());
$("edit-ics").addEventListener("click", () => {
  const remind = $("edit-remind").value === "" ? null : Number($("edit-remind").value);
  downloadIcs({ id: editing ? editing.id : newId(), text: $("edit-text").value.trim() || "Todo", notes: $("edit-notes").value.trim(), date: $("edit-date").value, time: $("edit-time").value, remind });
});
$("notif-on").addEventListener("click", askNotifyPermission);
$("toast-close").addEventListener("click", () => { $("toast").hidden = true; });
$("list-edit").addEventListener("click", () => openListEditor(lists.find((l) => l.id === currentList)));
$("list-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("list-name").value.trim();
  if (!name) return;
  const emoji = $("list-emoji").value.trim();
  if (editingList) {
    const live = lists.find((x) => x.id === editingList.id);
    if (!live) lists.push(editingList); else editingList = live;
    Object.assign(editingList, { name, emoji, color: listColorChoice });
  } else {
    const l = { id: newId(), name, emoji, color: listColorChoice };
    lists.push(l);
    currentList = settings.list = l.id;
    saveSettings();
  }
  saveLists();
  renderAll();
  closeOverlay();
});
$("list-delete").addEventListener("click", async () => {
  const l = editingList;
  if (!l || lists.length < 2) return;
  const n = todos.filter((x) => x.listId === l.id).length;
  if (!(await askConfirm(`Delete "${l.name}"${n ? ` and its ${n} todo${n === 1 ? "" : "s"}` : ""}? This can't be undone.`, "Delete list"))) return;
  lists = lists.filter((x) => x.id !== l.id);
  todos = todos.filter((x) => x.listId !== l.id);
  currentList = settings.list = "all";
  saveLists(); saveTodos(); saveSettings();
  renderAll();
  closeOverlay();
});
$("edit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("edit-text").value.trim();
  const date = $("edit-date").value;
  const listId = $("edit-list").value;
  const remind = $("edit-remind").value === "" ? null : Number($("edit-remind").value);
  const notes = $("edit-notes").value.trim();
  const repeat = $("edit-repeat").value || null;
  const subtasks = readSteps();
  let finalDate = date;
  if (repeat && !finalDate) finalDate = todayKey();
  if (!text) return;
  if (remind != null && !finalDate) { setMore(true); updateRemindHint(); showMiniCal(true); return; }
  if (remind != null) askNotifyPermission();
  if (editing) {
    // Use the live copy (a sync from another device may have replaced it); if it was
    // deleted elsewhere meanwhile, saving brings it back.
    const live = todos.find((x) => x.id === editing.id);
    if (!live) todos.push(editing); else editing = live;
    if (editing.repeat !== repeat || editing.date !== finalDate) delete editing.repeatDay;
    Object.assign(editing, { text, date: finalDate, time: $("edit-time").value, listId, remind, notes, repeat, subtasks, star: $("edit-star").checked });
    saveTodos();
    renderAll();
  } else {
    addTodo(text, finalDate, $("edit-time").value, listId);
    Object.assign(todos[todos.length - 1], { remind, notes, repeat, subtasks, star: $("edit-star").checked });
    saveTodos();
    renderAll();
  }
  closeOverlay();
});
$("edit-delete").addEventListener("click", async () => {
  const t = editing;
  if (!t || !(await askConfirm(`Delete "${t.text}"?`, "Delete todo"))) return;
  removeTodo(t);
  closeOverlay();
});
window.addEventListener("popstate", () => {
  if (!(history.state && history.state.overlay) && overlayOpen()) hideOverlays();
});
$("todo-search").addEventListener("input", renderTodoList);
function setSearch(open) {
  $("search-bar").hidden = !open;
  $("search-toggle").setAttribute("aria-expanded", open);
  if (open) setTimeout(() => $("todo-search").focus(), 30);
  else if ($("todo-search").value) { $("todo-search").value = ""; renderTodoList(); }
}
$("search-toggle").addEventListener("click", () => setSearch($("search-bar").hidden));
$("search-close").addEventListener("click", () => setSearch(false));
$("todo-search").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); setSearch(false); } });
document.querySelectorAll("[data-todo-view]").forEach((b) => b.addEventListener("click", () => {
  settings.todoView = b.dataset.todoView;
  saveSettings();
  renderTodoList();
}));

$("name-input").addEventListener("input", (e) => { settings.name = e.target.value; saveSettings(); renderProfile(); });
$("theme-seg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-theme-choice]");
  if (!b) return;
  settings.theme = b.dataset.themeChoice;
  saveSettings(); applyTheme(); renderProfile();
});
$("week-seg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-week]");
  if (!b) return;
  settings.weekStart = Number(b.dataset.week);
  saveSettings(); renderAll();
});

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ app: "daydot", todos, lists, settings }, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = `daydot-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.todos;
    const okTodo = (x) => x && typeof x.text === "string" && (!x.date || (typeof x.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date)))
      && (!x.time || (typeof x.time === "string" && /^\d{2}:\d{2}$/.test(x.time)))
      && (x.remind == null || [0, 10, 30, 60, 1440].includes(x.remind))
      && (!x.repeat || x.repeat in REPEAT_LABELS)
      && (x.notes == null || typeof x.notes === "string")
      && (x.subtasks == null || (Array.isArray(x.subtasks) && x.subtasks.every((st) => st && typeof st.text === "string")));
    if (!Array.isArray(list) || !list.every(okTodo)) throw new Error();
    if (!(await askConfirm(`Replace your todos with the ${list.length} in this file?`, "Replace"))) return;
    if (Array.isArray(data.lists) && data.lists.length && data.lists.every((l) => l && l.id && typeof l.name === "string")) {
      lists = data.lists.map((l) => ({ id: String(l.id), name: l.name, emoji: l.emoji || "", color: l.color || "" }));
    }
    todos = list.map((x, i) => ({ id: x.id || "i" + i + Date.now().toString(36), date: x.date || "", text: x.text, time: x.time || "", listId: x.listId, remind: x.remind ?? null, notes: typeof x.notes === "string" ? x.notes : "", repeat: x.repeat || null, repeatDay: x.repeatDay, star: !!x.star, order: x.order, subtasks: Array.isArray(x.subtasks) ? x.subtasks : [], reminded: x.reminded, done: !!x.done, doneAt: x.doneAt, created: x.created || Date.now() }));
    fixListIds();
    currentList = "all";
    saveLists();
    saveTodos();
    renderAll();
  } catch {
    notify("That file isn't a Daydot export.");
  }
});
$("clear-done").addEventListener("click", async () => {
  const n = todos.filter((x) => x.done).length;
  if (!n) { notify("No finished todos to clear."); return; }
  if (!(await askConfirm(`Delete ${n} finished todo${n === 1 ? "" : "s"}? This can't be undone.`, "Clear"))) return;
  todos = todos.filter((x) => !x.done);
  saveTodos();
  renderAll();
});

$("day-back").addEventListener("click", closeDay);
$("day-prev").addEventListener("click", () => moveDay(-1));
$("day-next").addEventListener("click", () => moveDay(1));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !$("confirm").hidden) return;
  if (overlayOpen()) closeOverlay();
  else if (!$("day-screen").hidden) closeDay();
});
window.addEventListener("hashchange", showTab);

/* For sync.js: read everything to upload, and swap in what comes from the account. */
window.daydot = {
  snapshot: () => JSON.parse(JSON.stringify({ todos, lists, settings, deleted })),
  merge: mergeData,
  same: sameData,
  // Upcoming reminders, for the online sender that reminds you when Daydot is closed.
  reminderItems() {
    const soon = Date.now() - 3600000;
    return todos
      .filter((t) => !t.done && remindAt(t) && remindAt(t) > soon)
      .map((t) => ({
        id: t.id, at: remindAt(t), title: t.text,
        body: (t.time ? formatTime(t.time) + " · " : "") + fmt(t.date, { weekday: "short", month: "short", day: "numeric" }),
      }))
      .sort((a, b) => a.at - b.at)
      .slice(0, 200);
  },
  load(data) {
    if (Array.isArray(data.todos)) todos = data.todos;
    if (Array.isArray(data.lists) && data.lists.length) lists = data.lists;
    if (data.deleted && typeof data.deleted === "object") deleted = data.deleted;
    if (data.settings && typeof data.settings === "object") {
      Object.keys(settings).forEach((k) => { if (!(k in data.settings)) delete settings[k]; });
      Object.assign(settings, { name: "", theme: "auto", weekStart: 0, mode: "month", color: "white" }, data.settings);
    }
    fixListIds();
    baseline(todos, savedTodos);
    baseline(lists, savedLists);
    if (pruneOld(todos).length !== todos.length) { todos = pruneOld(todos); stamp(todos, savedTodos); }
    if (currentList !== "all" && !lists.some((l) => l.id === currentList)) currentList = "all";
    writeJSON(STORE_KEY, todos); writeJSON(LISTS_KEY, lists); writeJSON(SETTINGS_KEY, settings); writeJSON(DELETED_KEY, deleted);
    applyTheme();
    renderAll();
  },
  clearLocal() {
    try { [STORE_KEY, LISTS_KEY, SETTINGS_KEY, DELETED_KEY].forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
    location.reload();
  },
};

// Remove the opening animation once it has played.
setTimeout(() => { const sp = $("splash"); if (sp) sp.remove(); }, 3100);

// After a reload no form is open, so forget a leftover "form open" history marker
// (otherwise the next Cancel would need two taps).
if (history.state && history.state.overlay) history.replaceState({ ...history.state, overlay: false }, "", location.href);

applyTheme();
renderAll();
renderNotifyStatus();
showTab();
checkReminders();
setInterval(checkReminders, 20000);
// Coming back to the app on a new day shows that day's repeating todos.
document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkReminders(); renderAll(); } });
