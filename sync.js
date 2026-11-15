// Daydot accounts: email + password sign-in with Firebase, and saving everything
// (todos, lists, settings) to the account so it shows up on every device.
// If this file can't load (offline), Daydot still works and saves in the browser.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, onSnapshot, serverTimestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Public web settings for the Daydot Firebase project (safe to publish; the
// database rules are what keep each person's data private).
const app = initializeApp({
  apiKey: "AIzaSyDryNUQWjMIeTrK2EjvA9RuCdV2VqUd_Ck",
  authDomain: "daydot-todos.firebaseapp.com",
  projectId: "daydot-todos",
  storageBucket: "daydot-todos.firebasestorage.app",
  messagingSenderId: "384922267230",
  appId: "1:384922267230:web:70548c54d9702bc55a0ecf",
});
// Stay logged in on this device until you tap Log out (saved in the browser's storage,
// with a fallback if one kind of storage isn't available).
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });

// The last email used on this device, so logging in again is quick. It's kept after
// logging out (only the email, never the password) until you tap "Not you?".
const EMAIL_KEY = "daydot:email";
const rememberedEmail = () => { try { return localStorage.getItem(EMAIL_KEY) || ""; } catch { return ""; } };
const rememberEmail = (e) => { try { if (e) localStorage.setItem(EMAIL_KEY, e); else localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ } };
const db = getFirestore(app);

// For testing on this computer only: http://localhost:…/?emulator uses local test servers.
if (["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emulator")) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

// Public half of the Web Push key. The private half is a GitHub secret used by the
// reminder sender (.github/workflows/reminders.yml). Empty = phone reminders are off.
const VAPID_PUBLIC_KEY = "BHpq-NI610ZmmYEoXodo_s26lg2zo0yLsUaFIrtKnQXcnM_kst7ItOMvIEToxvxaNdVAwh9I0MGISF4ofK2Xfhc";

const $ = (id) => document.getElementById(id);
let user = null;
let ready = false;   // true once the account's data has been loaded
let dirty = false;   // local changes not uploaded yet
let offlineEdits = false; // changes made while logged in but before the account could load
let timer = null;
let unsubscribe = null;
let mode = "login";

const userDoc = () => doc(db, "users", user.uid);
const reminderDoc = () => doc(db, "reminders", user.uid);

/* ---------- reminders when Daydot is closed ---------- */
// This device's push address is saved to the account; a GitHub job checks every
// few minutes and sends any reminders that are due.
const subKey = (endpoint) => { let h = 5381; for (const c of endpoint) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return "d" + h.toString(36); };
async function pushSubscription(create) {
  if (!VAPID_PUBLIC_KEY || !("PushManager" in window) || !("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) {
    const key = Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  return sub;
}
async function subscribePush() {
  if (!user || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const sub = await pushSubscription(true);
    if (sub) await setDoc(reminderDoc(), { subs: { [subKey(sub.endpoint)]: sub.toJSON() } }, { merge: true });
  } catch { /* push not supported here, e.g. iPhone Safari before adding to home screen */ }
}
async function unsubscribePush() {
  try {
    const sub = await pushSubscription(false);
    if (!sub) return;
    await setDoc(reminderDoc(), { subs: { [subKey(sub.endpoint)]: deleteField() } }, { merge: true });
    await sub.unsubscribe();
  } catch { /* ignore */ }
}
const setStatus = (text) => { $("sync-status").textContent = text; };

async function upload() {
  clearTimeout(timer);
  if (!user || !ready) return;
  try {
    await setDoc(userDoc(), { ...window.daydot.snapshot(), updatedAt: serverTimestamp() });
    // Reminder times go in a separate small doc that the reminder sender can read.
    await setDoc(reminderDoc(), { items: window.daydot.reminderItems(), updatedAt: serverTimestamp() }, { merge: true });
    dirty = false;
    setStatus("✓ Saved to your account");
  } catch {
    setStatus(navigator.onLine ? "Couldn't save. Trying again soon…" : "Offline · saved on this phone, will sync when you're back online");
    timer = setTimeout(upload, 15000);
  }
}

window.daydotSync = {
  subscribePush,
  queue() {
    if (user && !ready) { offlineEdits = true; setStatus("Offline · saved on this phone, will sync when you're back online"); return; }
    if (!user || !ready) return;
    dirty = true;
    setStatus(navigator.onLine ? "Saving…" : "Offline · saved on this phone, will sync when you're back online");
    clearTimeout(timer);
    timer = setTimeout(upload, 800);
  },
};

// The first time you log in on a device, keep what's already here too.
function merge(cloud, local) {
  const byId = (arr) => new Map((arr || []).map((x) => [x.id, x]));
  const todos = byId(local.todos);
  byId(cloud.todos).forEach((v, k) => todos.set(k, v));
  const lists = byId(local.lists);
  byId(cloud.lists).forEach((v, k) => lists.set(k, v));
  return { todos: [...todos.values()], lists: [...lists.values()], settings: cloud.settings || local.settings };
}

onAuthStateChanged(auth, async (u) => {
  user = u;
  ready = false;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  $("account-card").hidden = false;
  $("acct-in").hidden = !u;
  if (!u) { showLoggedOut(); return; }
  $("acct-out").hidden = true;
  $("acct-back").hidden = true;
  rememberEmail(u.email);

  $("acct-email").textContent = u.email;
  loadAccount(u);
});

// Get the account's todos and start live updates. If there's no internet, keep using
// what's on this device and try again as soon as the connection comes back.
async function loadAccount(u) {
  if (user !== u || ready) return;
  setStatus("Loading your todos…");
  try {
    const snap = await getDoc(userDoc());
    if (user !== u) return;
    // Normally combine the account with this device. If you changed things here while
    // offline, this device has the newest copy, so it wins.
    if (snap.exists() && !offlineEdits) window.daydot.load(merge(snap.data(), window.daydot.snapshot()));
    offlineEdits = false;
    ready = true;
    await upload();
    subscribePush();
    // Live updates: changes made on another device show up here.
    unsubscribe = onSnapshot(userDoc(), (s) => {
      if (!s.exists() || s.metadata.hasPendingWrites || dirty) return;
      window.daydot.load(s.data());
    });
  } catch {
    setStatus(navigator.onLine
      ? "Couldn't reach your account. Your todos are still saved on this device."
      : "Offline · your todos are saved on this phone and will sync when you're back online");
    window.addEventListener("online", () => loadAccount(u), { once: true });
  }
}

// Back online: send anything saved while offline.
window.addEventListener("online", () => { if (dirty) upload(); });

/* ---------- log in / create account screen ---------- */
function setMode(m) {
  mode = m;
  const signup = m === "signup";
  $("acct-title").textContent = signup ? "Create account" : "Log in";
  $("acct-submit").textContent = signup ? "Create account" : "Log in";
  $("acct-password").autocomplete = signup ? "new-password" : "current-password";
  $("acct-forgot").hidden = signup;
  document.querySelectorAll("[data-acct-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.acctMode === m));
  showError("");
  showNote("");
}
function showError(text) { $("acct-error").textContent = text; $("acct-error").hidden = !text; }
function showNote(text) { $("acct-note").textContent = text; $("acct-note").hidden = !text; }

function showLoggedOut() {
  const email = rememberedEmail();
  $("acct-back").hidden = !email;
  $("acct-out").hidden = !!email;
  $("acct-remembered").textContent = email;
}

function openAccount(m) {
  setMode(m);
  const email = m === "login" ? rememberedEmail() : "";
  $("acct-email-input").value = email;
  $("acct-password").value = "";
  openOverlay("account-screen");
  // With the email filled in, go straight to the password (your phone may offer to fill it).
  setTimeout(() => $(email ? "acct-password" : "acct-email-input").focus(), 50);
}

const MESSAGES = {
  "auth/email-already-in-use": "There's already an account with that email. Try logging in.",
  "auth/invalid-email": "That doesn't look like an email address.",
  "auth/missing-email": "Type your email first.",
  "auth/weak-password": "Pick a password with at least 6 characters.",
  "auth/missing-password": "Type your password.",
  "auth/invalid-credential": "That email and password don't match. Try again.",
  "auth/wrong-password": "That email and password don't match. Try again.",
  "auth/user-not-found": "There's no account with that email. Create one instead.",
  "auth/too-many-requests": "Too many tries. Wait a minute and try again.",
  "auth/network-request-failed": "Couldn't connect. Check your internet and try again.",
};
const messageFor = (e) => MESSAGES[e && e.code] || "Something went wrong. Try again.";

$("acct-signup").addEventListener("click", () => openAccount("signup"));
$("acct-login").addEventListener("click", () => openAccount("login"));
$("acct-quick").addEventListener("click", () => openAccount("login"));
$("acct-forget").addEventListener("click", () => { rememberEmail(""); showLoggedOut(); });
$("acct-cancel").addEventListener("click", closeOverlay);
document.querySelectorAll("[data-acct-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.acctMode)));

$("acct-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("acct-email-input").value.trim();
  const password = $("acct-password").value;
  showError(""); showNote("");
  if (!email) return showError(MESSAGES["auth/missing-email"]);
  if (password.length < 6) return showError(mode === "signup" ? MESSAGES["auth/weak-password"] : MESSAGES["auth/missing-password"]);
  $("acct-submit").disabled = true;
  try {
    if (mode === "signup") await createUserWithEmailAndPassword(auth, email, password);
    else await signInWithEmailAndPassword(auth, email, password);
    rememberEmail(email);
    closeOverlay();
  } catch (err) {
    showError(messageFor(err));
  } finally {
    $("acct-submit").disabled = false;
  }
});

$("acct-forgot").addEventListener("click", async () => {
  const email = $("acct-email-input").value.trim();
  showError(""); showNote("");
  if (!email) return showError("Type your email above, then tap Forgot password again.");
  try {
    await sendPasswordResetEmail(auth, email);
    showNote("If there's an account for that email, we sent it a link to reset your password.");
  } catch (err) {
    showError(messageFor(err));
  }
});

$("acct-logout").addEventListener("click", async () => {
  if (!(await askConfirm("Log out? Your todos stay saved in your account, and are removed from this device until you log in again.", "Log out"))) return;
  if (dirty) await upload();
  await unsubscribePush();
  await signOut(auth);
  window.daydot.clearLocal();
});
