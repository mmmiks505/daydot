// Taskly — todos are saved in this browser's localStorage.
const STORE_KEY = "todo-calendar:v1";
const $ = (id) => document.getElementById(id);

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(todos)); } catch { /* storage unavailable */ }
}

let todos = load();
let selected = todayKey();
let viewMonth = new Date(); viewMonth.setDate(1);

const byTime = (a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || a.created - b.created;
const todosOn = (k) => todos.filter((t) => t.date === k).sort(byTime);

function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

function renderCalendar() {
  $("month-label").textContent = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const grid = $("grid");
  grid.innerHTML = "";
  const start = new Date(viewMonth);
  start.setDate(1 - start.getDay()); // back up to Sunday
  const tKey = todayKey();

  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = keyOf(d);
    const list = todosOn(k);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day";
    if (d.getMonth() !== viewMonth.getMonth()) cell.classList.add("other");
    if (k === tKey) cell.classList.add("is-today");
    if (k === selected) cell.classList.add("selected");
    cell.setAttribute("aria-label", `${d.toDateString()}, ${list.length} todo${list.length === 1 ? "" : "s"}`);

    const num = document.createElement("span");
    num.className = "num";
    num.textContent = d.getDate();
    cell.append(num);

    list.slice(0, 3).forEach((t) => {
      const c = document.createElement("span");
      c.className = "chip" + (t.done ? " done" : "");
      c.textContent = (t.time ? formatTime(t.time).replace(":00", "") + " " : "") + t.text;
      cell.append(c);
    });
    if (list.length > 3) {
      const more = document.createElement("span");
      more.className = "more";
      more.textContent = `+${list.length - 3} more`;
      cell.append(more);
    }
    if (list.length) {
      const dot = document.createElement("span");
      dot.className = "dot" + (list.every((t) => t.done) ? " all-done" : "");
      cell.append(dot);
    }

    cell.addEventListener("click", () => selectDay(k));
    grid.append(cell);
  }
}

function renderDay() {
  const d = fromKey(selected);
  const isToday = selected === todayKey();
  $("day-label").textContent = (isToday ? "Today · " : "") +
    d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const list = todosOn(selected);
  const left = list.filter((t) => !t.done).length;
  $("day-count").textContent = list.length ? `${left} of ${list.length} left to do` : "Nothing planned";

  const ul = $("day-todos");
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = '<li class="empty">No todos for this day yet.</li>';
    return;
  }
  list.forEach((t) => {
    const li = document.createElement("li");
    if (t.done) li.className = "done";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = t.done;
    cb.setAttribute("aria-label", `Mark "${t.text}" done`);
    cb.addEventListener("change", () => { t.done = cb.checked; save(); render(); });
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = t.text;
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = formatTime(t.time);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.textContent = "×";
    del.setAttribute("aria-label", `Delete "${t.text}"`);
    del.addEventListener("click", () => { todos = todos.filter((x) => x.id !== t.id); save(); render(); });
    li.append(cb, text, time, del);
    ul.append(li);
  });
}

function renderUpcoming() {
  const tKey = todayKey();
  const end = new Date(); end.setDate(end.getDate() + 14);
  const endKey = keyOf(end);
  const list = todos
    .filter((t) => !t.done && t.date <= endKey)
    .sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
    .slice(0, 12);

  const ul = $("upcoming");
  ul.innerHTML = "";
  if (!list.length) {
    ul.innerHTML = '<li class="empty">You\'re all caught up for the next two weeks.</li>';
    return;
  }
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  list.forEach((t) => {
    const li = document.createElement("li");
    if (t.date < tKey) li.className = "late";
    const b = document.createElement("button");
    b.type = "button";
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = t.date < tKey ? "Overdue"
      : t.date === tKey ? "Today"
      : t.date === keyOf(tomorrow) ? "Tomorrow"
      : fromKey(t.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (t.time) when.textContent += " " + formatTime(t.time);
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = t.text;
    b.append(when, text);
    b.addEventListener("click", () => selectDay(t.date));
    li.append(b);
    ul.append(li);
  });
}

function render() { renderCalendar(); renderDay(); renderUpcoming(); }

function selectDay(k) {
  selected = k;
  const d = fromKey(k);
  if (d.getMonth() !== viewMonth.getMonth() || d.getFullYear() !== viewMonth.getFullYear()) {
    viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  render();
}

function shiftMonth(n) {
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + n, 1);
  renderCalendar();
}

$("weekdays").innerHTML = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div>${d}</div>`).join("");
$("prev").addEventListener("click", () => shiftMonth(-1));
$("next").addEventListener("click", () => shiftMonth(1));
$("today").addEventListener("click", () => selectDay(todayKey()));

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("add-text").value.trim();
  if (!text) return;
  todos.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: selected,
    text,
    time: $("add-time").value,
    done: false,
    created: Date.now(),
  });
  save();
  $("add-text").value = "";
  $("add-time").value = "";
  render();
  $("add-text").focus();
});

render();
