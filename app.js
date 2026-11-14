// Daydot — todos and settings are saved in this browser's localStorage.
const STORE_KEY = "todo-calendar:v1"; // kept from the first version so saved todos carry over
const SETTINGS_KEY = "daydot:settings";
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
let todos = readJSON(STORE_KEY, []);
const settings = Object.assign({ name: "", theme: "auto", weekStart: 0, mode: "month" }, readJSON(SETTINGS_KEY, {}));
const saveTodos = () => writeJSON(STORE_KEY, todos);
const saveSettings = () => writeJSON(SETTINGS_KEY, settings);

/* ---------- state ---------- */
let selected = todayKey();
let viewMonth = new Date(); viewMonth.setDate(1);
let filter = "open";

const byTime = (a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || a.created - b.created;
const todosOn = (k) => todos.filter((t) => t.date === k).sort(byTime);

function addTodo(text, date, time) {
  todos.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date, text, time: time || "", done: false, created: Date.now(),
  });
  saveTodos();
  renderAll();
}
function setDone(t, done) {
  t.done = done;
  t.doneAt = done ? Date.now() : undefined;
  saveTodos();
  renderAll();
}
function removeTodo(t) {
  todos = todos.filter((x) => x.id !== t.id);
  saveTodos();
  renderAll();
}

/* A todo row with checkbox, text, time and delete. */
function todoItem(t) {
  const li = el("li", t.done ? "done" : "");
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = t.done;
  cb.setAttribute("aria-label", `Mark "${t.text}" done`);
  cb.addEventListener("change", () => setDone(t, cb.checked));
  const del = el("button", "del", "×");
  del.type = "button";
  del.setAttribute("aria-label", `Delete "${t.text}"`);
  del.addEventListener("click", () => removeTodo(t));
  li.append(cb, el("span", "text", t.text), el("span", "time", formatTime(t.time)), del);
  return li;
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
  list.slice(0, max).forEach((t) => {
    cell.append(el("span", "chip" + (t.done ? " done" : ""), (t.time ? shortTime(t.time) + " " : "") + t.text));
  });
  if (list.length > max) cell.append(el("span", "more", `+${list.length - max} more`));
  if (week && !list.length) cell.append(el("span", "more", "Nothing planned"));
  if (list.length) cell.append(el("span", "dot" + (list.every((t) => t.done) ? " all-done" : "")));

  cell.addEventListener("click", () => selectDay(k));
  return cell;
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
    $("month-label").textContent = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const start = weekStartOf(keyOf(viewMonth));
    for (let i = 0; i < 42; i++) {
      const k = addDays(start, i);
      grid.append(dayCell(k, { other: fromKey(k).getMonth() !== viewMonth.getMonth() }));
    }
  } else if (mode === "week") {
    const start = weekStartOf(selected);
    const end = addDays(start, 6);
    const sameMonth = fromKey(start).getMonth() === fromKey(end).getMonth();
    $("month-label").textContent = `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}, ${fromKey(end).getFullYear()}`;
    for (let i = 0; i < 7; i++) grid.append(dayCell(addDays(start, i), { week: true }));
  } else {
    $("month-label").textContent = fmt(selected, { month: "long", day: "numeric", year: "numeric" });
  }
}

function renderDay() {
  $("day-label").textContent = (selected === todayKey() ? "Today · " : "") +
    fmt(selected, { weekday: "long", month: "long", day: "numeric" });
  const list = todosOn(selected);
  const left = list.filter((t) => !t.done).length;
  $("day-count").textContent = list.length ? `${left} of ${list.length} left to do` : "Nothing planned";
  const ul = $("day-todos");
  ul.innerHTML = "";
  if (!list.length) ul.append(el("li", "empty", "No todos for this day yet."));
  list.forEach((t) => ul.append(todoItem(t)));
}

function selectDay(k) {
  selected = k;
  const d = fromKey(k);
  viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  renderCalendar();
  renderDay();
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
function renderTodoList() {
  const t = todayKey();
  const open = todos.filter((x) => !x.done);
  const overdue = open.filter((x) => x.date < t).length;
  $("todo-summary").textContent = open.length
    ? `${open.length} to do${overdue ? ` · ${overdue} overdue` : ""}`
    : "All caught up!";

  document.querySelectorAll(".filter").forEach((b) => {
    const on = b.dataset.filter === filter;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
  });

  let list = filter === "open" ? open : filter === "done" ? todos.filter((x) => x.done) : [...todos];
  list.sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b));
  if (filter === "done") list.reverse();

  // Group: all overdue together, then one group per date.
  const groups = new Map();
  list.forEach((x) => {
    const g = filter === "open" && x.date < t ? "overdue" : x.date;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(x);
  });

  const wrap = $("todo-groups");
  wrap.innerHTML = "";
  if (!list.length) {
    const msg = filter === "done" ? "Nothing finished yet." : "Nothing to do. Add a todo above!";
    wrap.append(el("p", "empty card", msg));
    return;
  }
  groups.forEach((items, g) => {
    const sec = el("section", "card group" + (g === "overdue" ? " overdue" : ""));
    const h = el("h2");
    if (g === "overdue") {
      h.textContent = "Overdue";
    } else {
      const link = el("button", "group-link", friendlyDay(g));
      link.type = "button";
      link.title = "Show on calendar";
      link.addEventListener("click", () => { selectDay(g); go("calendar"); });
      h.append(link);
      if (friendlyDay(g) !== fmt(g, { weekday: "short", month: "short", day: "numeric" })) {
        h.append(el("span", "group-date", fmt(g, { weekday: "short", month: "short", day: "numeric" })));
      }
    }
    const ul = el("ul", "todos");
    items.forEach((x) => {
      const li = todoItem(x);
      if (g === "overdue") li.querySelector(".time").textContent = friendlyDay(x.date) + (x.time ? " " + shortTime(x.time) : "");
      ul.append(li);
    });
    sec.append(h, ul);
    wrap.append(sec);
  });
}

/* ---------- profile ---------- */
function streak() {
  const doneDays = new Set(todos.filter((x) => x.done && x.doneAt).map((x) => keyOf(new Date(x.doneAt))));
  let k = todayKey();
  if (!doneDays.has(k)) k = addDays(k, -1); // today not done yet doesn't break the streak
  let n = 0;
  while (doneDays.has(k)) { n++; k = addDays(k, -1); }
  return n;
}

function renderProfile() {
  const name = settings.name.trim();
  $("avatar").textContent = name ? name[0].toUpperCase() : "🙂";
  if (document.activeElement !== $("name-input")) $("name-input").value = settings.name;

  const weekAgo = Date.now() - 7 * 864e5;
  const stats = [
    ["To do", todos.filter((x) => !x.done).length],
    ["Done", todos.filter((x) => x.done).length],
    ["Done this week", todos.filter((x) => x.done && x.doneAt > weekAgo).length],
    ["Day streak", streak() + " 🔥"],
  ];
  $("stats").innerHTML = "";
  stats.forEach(([label, value]) => {
    const tile = el("div", "card stat");
    tile.append(el("span", "stat-value", value), el("span", "stat-label", label));
    $("stats").append(tile);
  });

  document.querySelectorAll("[data-theme-choice]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.themeChoice === settings.theme));
  document.querySelectorAll("[data-week]").forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.week) === settings.weekStart));
}

function applyTheme() {
  if (settings.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}

/* ---------- tabs ---------- */
const TABS = ["calendar", "todo", "profile"];
function go(tab) {
  if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  showTab();
}
function showTab() {
  const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "calendar";
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.dataset.view !== tab; });
  document.querySelectorAll(".tab").forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
}

function renderBadge() {
  const t = todayKey();
  const n = todos.filter((x) => !x.done && x.date <= t).length;
  const b = $("todo-badge");
  b.hidden = !n;
  b.textContent = n > 9 ? "9+" : n;
  b.setAttribute("aria-label", `${n} due`);
}

function renderAll() {
  renderCalendar();
  renderDay();
  renderTodoList();
  renderProfile();
  renderBadge();
}

/* ---------- events ---------- */
$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("today").addEventListener("click", () => selectDay(todayKey()));
$("mode-seg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  settings.mode = b.dataset.mode;
  saveSettings();
  selectDay(selected);
});

$("day-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("day-text").value.trim();
  if (!text) return;
  addTodo(text, selected, $("day-time").value);
  $("day-text").value = "";
  $("day-time").value = "";
  $("day-text").focus();
});

$("todo-date").value = todayKey();
$("todo-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("todo-text").value.trim();
  if (!text || !$("todo-date").value) return;
  if (filter === "done") filter = "open";
  addTodo(text, $("todo-date").value, $("todo-time").value);
  $("todo-text").value = "";
  $("todo-time").value = "";
  $("todo-text").focus();
});
document.querySelectorAll(".filter").forEach((b) =>
  b.addEventListener("click", () => { filter = b.dataset.filter; renderTodoList(); }));

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
  const blob = new Blob([JSON.stringify({ app: "daydot", todos, settings }, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = `daydot-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.todos;
    if (!Array.isArray(list) || !list.every((x) => x && typeof x.text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date))) throw new Error();
    if (!confirm(`Replace your todos with the ${list.length} in this file?`)) return;
    todos = list.map((x, i) => ({ id: x.id || "i" + i + Date.now().toString(36), date: x.date, text: x.text, time: x.time || "", done: !!x.done, doneAt: x.doneAt, created: x.created || Date.now() }));
    saveTodos();
    renderAll();
  } catch {
    alert("That file isn't a Daydot export.");
  }
});
$("clear-done").addEventListener("click", () => {
  const n = todos.filter((x) => x.done).length;
  if (!n) { alert("No finished todos to clear."); return; }
  if (!confirm(`Delete ${n} finished todo${n === 1 ? "" : "s"}? This can't be undone.`)) return;
  todos = todos.filter((x) => !x.done);
  saveTodos();
  renderAll();
});

window.addEventListener("hashchange", showTab);

applyTheme();
renderAll();
showTab();
