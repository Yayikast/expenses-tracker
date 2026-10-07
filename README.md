# Expenses Tracker

A personal expense tracker. Upload Thai payment slips (Krungsri, Bangkok Bank, Paotang) or add things by hand, track money lent to and borrowed from friends, and see a monthly dashboard.

```
Your phone ──► App page on GitHub Pages (docs/)
                 │  Sign in with Google (account chooser)
                 ▼
             Google Apps Script API (src/)  ── only lets in the owner's Google account
                 ├── Google Sheet   (all records)
                 └── Google Drive   (slip images, one folder per month)
```

- **App screens:** `docs/`, a static site on GitHub Pages (free, no Google banner, installable on your home screen)
- **Back-end:** `src/`, Google Apps Script, uploaded with `clasp`
- **Sign-in:** Google sign-in. The back-end checks the Google token and only accepts the email that owns the script. After signing in, a device stays signed in for 30 days.
- **Slip reading:** QR code (read in the browser) + Google Drive OCR (text recognition). No AI and no paid services.

**What stays private:** `src/config.gs` (your Sheet and folder IDs) and `sample/` (your real slips) are git-ignored and never uploaded to GitHub. The API link and Client ID in `docs/config.js` are public, which is fine: without your Google account they can't open anything.

---

## Setup

### 1. Google side (back-end)

1. Make your Sheet and Drive folder **Restricted** (Share → General access).
2. Install **Node.js** (LTS) and then clasp: `npm install -g @google/clasp`
3. Turn on the Apps Script API: https://script.google.com/home/usersettings
4. In this folder:
   ```bash
   clasp login
   clasp create --type standalone --title "Expenses Tracker" --rootDir src
   copy setup\appsscript.json src\appsscript.json
   ```
5. If `src/config.gs` doesn't exist, copy `setup/config.example.gs` to `src/config.gs` and fill in `SHEET_ID`, `SLIP_FOLDER_ID` and `GOOGLE_CLIENT_ID` (from step 2).
6. `clasp push`, then in the Apps Script editor run **`setup`** once and allow the permissions.

### 2. Google Cloud login key (OAuth Client ID)

1. https://console.cloud.google.com → new project **Expenses Tracker**
2. **APIs & Services → OAuth consent screen → Get started**: External, your email; then **Audience → Test users** → add your email
3. **Clients → Create client → Web application**
   - Authorized JavaScript origin: `https://<username>.github.io`
   - Authorized redirect URI: `https://<username>.github.io/expenses-tracker/`
4. Copy the **Client ID** into `src/config.gs` **and** `docs/config.js`.

### 3. Deploy the API

In the Apps Script editor: **Deploy → New deployment → Web app**
- Execute as: **Me**
- Who has access: **Anyone** (the code itself checks your Google sign-in)

Copy the Web app URL (ends with `/exec`) into `API_URL` in `docs/config.js`.

**Updating later:** `clasp push`, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.

### 4. Publish the app on GitHub Pages

```bash
git init
git add .
git commit -m "Expenses tracker"
git branch -M main
git remote add origin https://github.com/<username>/expenses-tracker.git
git push -u origin main
```

On GitHub: repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, Branch **main**, folder **/docs** → **Save**. After about a minute the app is live at `https://<username>.github.io/expenses-tracker/`.

**Updating later:** `git add .`, `git commit -m "what changed"`, `git push`.

**On your phone:** open the link, sign in, then **Share → Add to Home Screen** (iPhone) or **⋮ → Add to Home screen** (Android).

---

## How to use it

| Screen | What it does |
|---|---|
| **Home** | Month picker, total spent with a bar showing how much of your income is used, income / left over (tap for savings history), change vs last month, monthly items still to pay or receive, **Spending** by category for this month or another period (tap the period: last 3 / 12 months, all time, or custom months; top 5, then **View more**, with budget notes), spending per month chart (tap a bar to jump to that month), recent items |
| **+ → Scan slips** | Pick one or more slips. Each one is read, then shown on a review card. Check it and tap **Save & next**, or **Skip** |
| **+ → Add manually** | For cash, income or anything without a slip |
| **Monthly items** | Things that happen every month, e.g. Mom ฿10,000 income or AIS ฿345. Add them in Settings → Monthly items (start month, optional last month). Each month they wait on Home as **pending** (not counted) until you tap **Received** / **Paid**. Tap one to change that month's amount only, or skip a month |
| **Split a bill** | On any expense, tap more than one category. Each one gets its own amount box, with the remaining amount shown underneath. Save unlocks once the parts add up exactly to the total. Tap a category again to remove it. |
| **+ → Lend or borrow** | "I lent", "They paid back", "I borrowed", "I paid back" |
| **History** | Search, filter by month / category / type, then tap an item to view the slip, edit or delete it |
| **Friends** | One balance per friend, netted: if you borrowed ฿50 from Matt and he borrowed ฿20 from you, it shows **You owe ฿30**; equal amounts show **Settled — ฿0**. Tap a friend to see every original lend/borrow record, then **They paid back** or **I paid back** to fill in the remaining amount for you |
| **Settings** | Appearance (System / Light / Dark, saved per device), monthly items, rename or hide categories, set monthly budgets, manage accounts, links to your Sheet and slips folder, sign out (this device or all devices) |

**Category guessing:** every time you save a payee with a category, the app remembers it (`PayeeRules` tab), so the next slip from the same shop is categorised automatically.

**Duplicates:** uploading the same slip twice shows a warning. The check uses the slip's reference number, or date + time + amount when there's no reference.

**Lending doesn't count as spending.** Lend, borrow and transfer (between your own accounts) are kept out of the monthly totals.

**Left over and savings.** Left over = income received − expenses for the month. Pending monthly items aren't counted until you mark them. Tap Left over to see every month and your total saved. Savings are worked out, never saved as a transaction.

**No double counting.** When you add a slip whose name matches a pending monthly item (e.g. "AIS Fibre" for AIS), the editor offers **Counts as monthly AIS**, so that month turns Paid instead of being counted twice. One month can only be linked to one transaction.

**Lost your phone?** Settings → **Sign out all devices**, or run `signOutEverywhere` from the Apps Script editor.

## Your data (the Google Sheet)

| Tab | Holds |
|---|---|
| `Transactions` | One row per transaction: id, date, time, type, amount, category, payee, person, note, method, account, source, slip_ref, slip_url, created_at, updated_at, splits, recurring (which monthly item and month it belongs to, e.g. `r_ab12cd34ef56:2026-10`) |
| `Categories` | name, type (expense / income), emoji, color, monthly budget, order, archived |
| `Accounts` | name, kind, usual payment method, order, archived |
| `PayeeRules` | payee → category (`exact` ones are learned automatically, `contains` ones are starter rules you can edit) |
| `Recurring` | Monthly items: name, type, usual amount, category, account, method, day, match, start_month, end_month, months (one-month changes, e.g. `2026-10: 9000 \| 2026-12: skip`). Created the first time you add one |
| `Summary` | Spending per month by category, made with a formula. Look but don't edit |

**Split bills** stay one row: `amount` is the total, `category` says `Split`, and `splits` lists the parts, e.g. `Food: 300 | Drink: 50 | Entertainment: 50`. The parts must add up to the amount. The app's dashboard and budgets count each part in its own category, while the Sheet's `Summary` tab shows split bills under "Split".

You can edit the Sheet by hand, but keep the header row as it is and leave the `id` column alone. Types are `expense`, `income`, `transfer`, `lend`, `lend_return`, `borrow`, `borrow_return`.

Slip images are saved as `2026-09/2026-09-30_2019_195.00_LINE MAN.jpg` in your Drive folder. Skipped slips go to the trash.

## Adding another bank later

All in `src/parsers.gs`:

1. Add the bank's code to `BANK_CODES` (e.g. `'004': 'Kasikorn'`) so the QR code identifies it.
2. Add a line to `detectBank()` that recognises the bank's name in the slip text.
3. Add a parser to `SLIP_PARSERS` (copy the Krungsri one as a start).
4. Add an account with the **same name** in Settings.
5. Save a sample slip's text in `tests/fixtures/` and add a case to `tests/parsers.test.js`.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Setup not finished" on the login screen | Fill in both values in `docs/config.js`, then `git push` |
| Google says `redirect_uri_mismatch` | The redirect URI in Google Cloud must be exactly `https://<username>.github.io/expenses-tracker/` (lowercase, slash at the end) |
| "…does not have access" | You picked a different Google account. Tap Sign in again and choose the one that owns the Sheet |
| "The server sent an unexpected reply" | The API deployment must have **Who has access: Anyone**, and you must deploy a **New version** after `clasp push` |
| "Couldn't read the text on this slip" | In the Apps Script editor, check **Services** lists **Drive API** |
| Permission errors after an update | Run `setup` once in the Apps Script editor to approve new permissions |

## Development

```bash
npm test                 # parser + server + sign-in tests (no Google needed)
npm run build-preview    # dev/out/index.html with a fake back-end, to try the screens (the QA circle switches test data)
```

```
docs/                 the app (GitHub Pages)
  index.html, styles.css, app.js
  config.js           API link + Google Client ID
  icon*, manifest     home-screen icon
src/                  Apps Script back-end (clasp pushes this folder)
  Code.gs             API entry point (doPost) and action list
  auth.gs             Google sign-in check, sessions, sign out
  api.gs              save / edit / delete, settings, duplicates, payee learning
  recurring.gs        monthly items: save / delete, one-month amounts and skips
  slip.gs             slip upload, Drive OCR, moving slips into month folders
  parsers.gs          reads Thai slip text and QR codes
  db.gs               Sheet helpers
  setup.gs            one-time Sheet setup
  config.gs           your IDs (git-ignored)
setup/                manifest backup + config example
tests/                tests and anonymised sample slip text
dev/                  local preview with a fake back-end
```
