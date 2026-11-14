// Daydot accounts: email + password sign-in with Firebase, and saving everything
// (todos, lists, settings) to the account so it shows up on every device.
// If this file can't load (offline), Daydot still works and saves in the browser.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, onSnapshot, serverTimestamp,
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
const auth = getAuth(app);
const db = getFirestore(app);

// For testing on this computer only: http://localhost:…/?emulator uses local test servers.
if (["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emulator")) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const $ = (id) => document.getElementById(id);
let user = null;
let ready = false;   // true once the account's data has been loaded
let dirty = false;   // local changes not uploaded yet
let timer = null;
let unsubscribe = null;
let mode = "login";

const userDoc = () => doc(db, "users", user.uid);
const setStatus = (text) => { $("sync-status").textContent = text; };

async function upload() {
  clearTimeout(timer);
  if (!user || !ready) return;
  try {
    await setDoc(userDoc(), { ...window.daydot.snapshot(), updatedAt: serverTimestamp() });
    dirty = false;
    setStatus("✓ Saved to your account");
  } catch {
    setStatus("Couldn't save. Trying again soon…");
    timer = setTimeout(upload, 15000);
  }
}

window.daydotSync = {
  queue() {
    if (!user || !ready) return;
    dirty = true;
    setStatus("Saving…");
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
  $("acct-out").hidden = !!u;
  $("acct-in").hidden = !u;
  if (!u) return;

  $("acct-email").textContent = u.email;
  setStatus("Loading your todos…");
  try {
    const snap = await getDoc(userDoc());
    if (snap.exists()) window.daydot.load(merge(snap.data(), window.daydot.snapshot()));
    ready = true;
    await upload();
    // Live updates: changes made on another device show up here.
    unsubscribe = onSnapshot(userDoc(), (s) => {
      if (!s.exists() || s.metadata.hasPendingWrites || dirty) return;
      window.daydot.load(s.data());
    });
  } catch {
    setStatus("Couldn't reach your account. Your todos are still saved on this device.");
  }
});

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

function openAccount(m) {
  setMode(m);
  $("acct-password").value = "";
  openOverlay("account-screen");
  setTimeout(() => $("acct-email-input").focus(), 50);
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
  await signOut(auth);
  window.daydot.clearLocal();
});
