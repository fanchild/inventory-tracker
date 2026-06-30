# Inventory Purchase Tracker

A purchase-request system built entirely on GitHub (no separate backend server):

- **Frontend** (`index.html`, hosted on GitHub Pages) — a "New Purchase" form.
- **Ticket** — submitting the form opens a pre-filled GitHub Issue (using a structured issue form), which acts as the open ticket.
- **Approval** — a certified admin reviews the issue and adds the `approved` label.
- **Spreadsheet** — a GitHub Action verifies the approver is on the admin list, parses the issue, appends a row to a Google Sheet, and closes the issue.

## How it works

```
User fills form (index.html)
        │
        ▼
GitHub Issue opened (template: new-purchase.yml)
   labels: pending-approval, purchase-request
        │
        ▼
Admin reviews issue, adds "approved" label
        │
        ▼
GitHub Action (.github/workflows/approve-purchase.yml) fires
   1. Checks actor is in config/admins.json
   2. If not admin -> removes label, comments, stops
   3. If admin -> parses item/price/qty/link from issue body
   4. Appends row to Google Sheet
   5. Closes issue, labels "completed"
```

## Setup

### 1. Create the repo
Push this folder to a new GitHub repository.

### 2. Enable GitHub Pages
Repo Settings → Pages → Deploy from branch → `main` / root. Your form will be live at `https://<owner>.github.io/<repo>/`.

### 3. Point the form at your repo
In `index.html`, set:
```js
const REPO = "your-username/your-repo-name";
```

### 4. Set your admins
Edit `config/admins.json` and list the GitHub usernames allowed to approve purchases (these must be collaborators on the repo with permission to label issues).

### 5. Create a Google Cloud service account
1. In Google Cloud Console, create a project (or use an existing one) and enable the **Google Sheets API**.
2. Create a **Service Account**, then create a JSON key for it and download it.
3. Open your Google Sheet, add the service account's email (looks like `name@project.iam.gserviceaccount.com`) as an **Editor**.
4. Note the spreadsheet ID (the long string in the sheet's URL between `/d/` and `/edit`).
5. Make sure the sheet has a tab named `Purchases` (or change `SHEET_TAB_NAME` in the workflow env).

### 6. Add repo secrets
Repo Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `GCP_SA_KEY` | base64-encoded contents of the service account JSON key file (`base64 -i key.json \| pbcopy`, or `base64 -w0 key.json` on Linux) |
| `GOOGLE_SHEET_ID` | the spreadsheet ID from step 5 |

`GITHUB_TOKEN` is provided automatically by Actions — no setup needed.

### 7. Try it
Open your Pages URL, submit a test purchase, then approve it from the Issues tab by adding the `approved` label. Check the Action run under the **Actions** tab, and confirm the row landed in your sheet.

## Notes / things you may want to customize
- Anyone who can open an issue can submit a request — that's intentional (it's the "submission" step). Only people in `config/admins.json` can make an approval stick.
- If a non-admin adds the `approved` label, the workflow removes it and comments, so the ticket stays open.
- The sheet columns written are: `Date, Item Name, Unit Price, Quantity, Total, Link, Requested By, Approved By`. Adjust the `row` array in `scripts/add-to-sheet.js` and the sheet's header row to match if you want different columns.
- This relies on requesters and admins having GitHub accounts with at least read/triage access to the repo (private repos work fine — just invite your team as collaborators).
