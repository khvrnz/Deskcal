# Syncing Desktop Calendar across your devices

The app ships with **no cloud backend baked in** — your notes are stored locally and
backed up daily on your own PC. If you want your calendar to sync between several
computers, pick **one** of the options below. You only set this up once per device,
and you use **your own** account/keys — nothing goes through anyone else's server.

---

## Option A — OneDrive / Google Drive folder (easiest, no API keys)

If your PCs are already signed into the same OneDrive or Google Drive:

1. Open the app → **⚙ Settings → Cloud sync → Provider** → choose **OneDrive** or **Google Drive**
   (or **Custom folder…** to point at any synced folder).
2. Done. Your notes live in that synced folder, so every device on the same drive
   account stays in sync (within whatever delay your drive client has — usually under a minute).

No accounts to create in the app, no keys. This is the recommended option for most people.

---

## Option B — Your own Firebase (true real‑time sync, ~1 second)

Use this if you want instant push sync and/or your PCs aren't on the same drive account.
Everything below is on **your** free Firebase project.

### 1. Create a Firebase project
- Go to <https://console.firebase.google.com> → **Add project** → follow the prompts (free "Spark" plan is fine).

### 2. Turn on Email/Password login
- **Build → Authentication → Get started → Sign‑in method → Email/Password → Enable → Save.**

### 3. Create a Realtime Database
- **Build → Realtime Database → Create Database** → choose a region → start in **locked mode**.
- Open the **Rules** tab, replace with this, and **Publish** (so each user only sees their own data):
  ```json
  {
    "rules": {
      "calendars": {
        "$uid": {
          ".read": "auth.uid === $uid",
          ".write": "auth.uid === $uid"
        }
      }
    }
  }
  ```
- Copy the database URL shown at the top, e.g.
  `https://yourproject-default-rtdb.<region>.firebasedatabase.app`

### 4. Get your Web API key
- **⚙ Project settings → General → "Web API Key"** (looks like `AIzaSy…`).
  *(A Firebase Web API key is not a secret — it's meant to live in client apps; your data is
  protected by the rules above.)*

### 5. Connect the app
- App → **⚙ Settings → Cloud sync → Provider → Firebase (login, realtime)**.
- Paste your **Web API key** and **Realtime Database URL** → **Save & connect**.
- **Create account** (first device), then **Sign in** with the same email/password on your
  other devices. Edits now sync in about a second.

Repeat step 5 on each device (same Firebase project + same login).

---

## Option C — Supabase (not built in yet)

The app doesn't include a Supabase provider today. If you'd prefer Supabase
(Postgres + Auth + Realtime), it can be added — open an issue on the project page.
Until then, use Option A or B above.

---

### Notes
- Your data file lives at `%APPDATA%\desktop-calendar\deskcal-data.json`, with daily
  backups in `…\backups\` — so nothing is lost even if you don't set up sync.
- You can switch providers anytime in Settings; switching to a backend that already has
  your data will pull it down, and an empty backend gets seeded from your local notes.
