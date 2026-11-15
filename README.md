# Daydot

A simple calendar and todo app: write todos on any day, keep lists like Homework or
Shopping, and get reminders. Live at https://mmmiks505.github.io/daydot/

- Works as a website and as a home-screen app on iPhone and Android, and offline.
- Free accounts (email and password, via Firebase) sync todos between devices.
- Reminders reach your phone while the app is closed via a GitHub Action
  (`.github/workflows/reminders.yml`) that runs about every 5 minutes.

## Running it locally

There's no build step. Serve the folder and open it:

```bash
python3 -m http.server 8770
```

## Files

- `index.html`, `style.css`, `app.js`: the app
- `sync.js`: accounts and syncing (Firebase project `daydot-todos`)
- `sw.js`: offline copy and reminder notifications
- `firestore.rules`: who can read and write what (`firebase deploy --only firestore:rules`)
- `scripts/send-reminders.mjs`: the reminder sender used by the GitHub Action
