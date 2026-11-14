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
const settings = Object.assign({ name: "", theme: "auto", weekStart: 0, mode: "month", color: "white" }, readJSON(SETTINGS_KEY, {}));
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
  const edit = el("button", "edit-btn", "Edit");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit "${t.text}"`);
  edit.addEventListener("click", () => openEditor(t));
  li.append(cb, el("span", "text", t.text), el("span", "time", formatTime(t.time)), edit);
  return li;
}

/* ---------- add / edit screen ---------- */
let editing = null; // the todo being edited, or null when adding a new one

function openEditor(todo, date) {
  editing = todo || null;
  $("edit-title").textContent = todo ? "Edit todo" : "New todo";
  $("edit-text").value = todo ? todo.text : "";
  $("edit-date").value = todo ? todo.date : date || selected;
  $("edit-time").value = todo ? todo.time : "";
  $("edit-delete").hidden = !todo;
  $("edit-screen").hidden = false;
  document.body.classList.add("day-open");
  history.pushState({ ...(history.state || {}), edit: true }, "", location.href);
  if (!todo) setTimeout(() => $("edit-text").focus(), 50);
}
function hideEditor() {
  $("edit-screen").hidden = true;
  document.body.classList.toggle("day-open", !$("day-screen").hidden);
  editing = null;
}
function closeEditor() {
  if (history.state && history.state.edit) history.back(); // popstate hides it
  else hideEditor();
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

  cell.addEventListener("click", () => openDay(k)); // tap a day to see and add its todos
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
    $("month-label").textContent = fmt(selected, { weekday: "long", month: "long", day: "numeric" });
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
      link.addEventListener("click", () => openDay(g));
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

  const stats = [
    ["To do", todos.filter((x) => !x.done).length],
    ["Done", todos.filter((x) => x.done).length],
  ];
  $("stats").innerHTML = "";
  stats.forEach(([label, value]) => {
    const tile = el("div", "card stat");
    tile.append(el("span", "stat-value", value), el("span", "stat-label", label));
    $("stats").append(tile);
  });

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
  img.onerror = () => alert("That picture couldn't be opened. Try a JPG or PNG.");
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
  setMode(b.dataset.mode);
  selectDay(selected);
});

$("day-add").addEventListener("click", () => openEditor(null, selected));
$("todo-add").addEventListener("click", () => openEditor(null, todayKey()));
$("edit-cancel").addEventListener("click", closeEditor);
$("edit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("edit-text").value.trim();
  const date = $("edit-date").value;
  if (!text || !date) return;
  if (editing) {
    Object.assign(editing, { text, date, time: $("edit-time").value });
    saveTodos();
    renderAll();
  } else {
    if (filter === "done") filter = "open";
    addTodo(text, date, $("edit-time").value);
  }
  closeEditor();
});
$("edit-delete").addEventListener("click", () => {
  if (!editing || !confirm(`Delete "${editing.text}"?`)) return;
  removeTodo(editing);
  closeEditor();
});
window.addEventListener("popstate", () => {
  if (!(history.state && history.state.edit) && !$("edit-screen").hidden) hideEditor();
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

$("day-back").addEventListener("click", closeDay);
$("day-prev").addEventListener("click", () => moveDay(-1));
$("day-next").addEventListener("click", () => moveDay(1));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("edit-screen").hidden) closeEditor();
  else if (!$("day-screen").hidden) closeDay();
});
window.addEventListener("hashchange", showTab);

applyTheme();
renderAll();
showTab();
