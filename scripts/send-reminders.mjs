// Runs on GitHub every few minutes (.github/workflows/reminders.yml).
// Signs in as Daydot's reminder bot, finds reminders that are due, and sends them
// to each person's devices with Web Push. Then notes which ones it sent.
import webpush from "web-push";

const API_KEY = "AIzaSyDryNUQWjMIeTrK2EjvA9RuCdV2VqUd_Ck";
const BASE = "https://firestore.googleapis.com/v1/projects/daydot-todos/databases/(default)/documents";
const { BOT_EMAIL, BOT_PASSWORD, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
const LATE_LIMIT = 3 * 3600 * 1000; // skip reminders more than 3 hours overdue

webpush.setVapidDetails("https://mmmiks505.github.io/daydot/", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Firestore's REST format wraps every value with its type; these convert to and from it.
function fromValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  return undefined;
}
const fromFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));
function toValue(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === "string") return { stringValue: x };
  if (typeof x === "boolean") return { booleanValue: x };
  if (typeof x === "number") return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, toValue(v)])) } };
}

async function signIn() {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: BOT_EMAIL, password: BOT_PASSWORD, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Bot sign-in failed: " + (data.error && data.error.message));
  return data.idToken;
}

const token = await signIn();
const auth = { Authorization: `Bearer ${token}` };
const now = Date.now();
let pageToken = "";
let sentCount = 0;

do {
  const res = await fetch(`${BASE}/reminders?pageSize=300${pageToken ? "&pageToken=" + pageToken : ""}`, { headers: auth });
  const page = await res.json();
  if (!res.ok) throw new Error("Couldn't read reminders: " + JSON.stringify(page.error));
  pageToken = page.nextPageToken || "";

  for (const d of page.documents || []) {
    const data = fromFields(d.fields || {});
    const items = Array.isArray(data.items) ? data.items : [];
    const subs = data.subs && typeof data.subs === "object" ? data.subs : {};
    const oldSent = data.sent && typeof data.sent === "object" ? data.sent : {};
    // Only keep notes about reminders that still exist.
    const sent = {};
    for (const it of items) { const k = `${it.id}:${it.at}`; if (oldSent[k]) sent[k] = true; }
    let subsChanged = false;

    for (const it of items) {
      const k = `${it.id}:${it.at}`;
      if (sent[k] || it.at > now || now - it.at > LATE_LIMIT) continue;
      for (const [key, sub] of Object.entries(subs)) {
        try {
          await webpush.sendNotification(sub, JSON.stringify({ title: it.title, body: it.body, tag: it.id }));
          sentCount++;
        } catch (err) {
          // The device unsubscribed or the address expired: forget it.
          if (err.statusCode === 404 || err.statusCode === 410) { delete subs[key]; subsChanged = true; }
          else console.log("Push failed:", err.statusCode || err.message);
        }
      }
      sent[k] = true;
    }

    const changed = subsChanged || JSON.stringify(sent) !== JSON.stringify(oldSent);
    if (!changed) continue;
    const fields = { sent: toValue(sent) };
    let mask = "updateMask.fieldPaths=sent";
    if (subsChanged) { fields.subs = toValue(subs); mask += "&updateMask.fieldPaths=subs"; }
    const up = await fetch(`https://firestore.googleapis.com/v1/${d.name}?${mask}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (!up.ok) console.log("Couldn't save sent notes:", up.status);
  }
} while (pageToken);

console.log(`Sent ${sentCount} reminder notification(s).`);
