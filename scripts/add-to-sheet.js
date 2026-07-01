// scripts/add-to-sheet.js
//
// Triggered by .github/workflows/approve-purchase.yml when the "approved"
// label is added to a purchase-request issue. Responsibilities:
//   1. Confirm the person who applied the label is a certified admin.
//   2. Parse the structured fields out of the issue body.
//   3. Append a row to the Google Sheet.
//   4. Close the issue and leave a confirmation comment (or bounce it back
//      with an explanation if the approver wasn't authorized).

const { google } = require("googleapis");
const path = require("path");

const {
  GITHUB_TOKEN,
  ACTOR,
  ISSUE_NUMBER,
  ISSUE_BODY,
  ISSUE_AUTHOR,
  REPO, // "owner/repo"
  GCP_SA_KEY, // base64-encoded service account JSON
  GOOGLE_SHEET_ID,
  SHEET_TAB_NAME = "Purchases",
} = process.env;

const [OWNER, REPO_NAME] = REPO.split("/");
const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO_NAME}`;

async function ghFetch(urlPath, options = {}) {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status} on ${urlPath}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

function isAdmin(username) {
  const { admins } = require(path.join(__dirname, "..", "config", "admins.json"));
  return admins.map((a) => a.toLowerCase()).includes((username || "").toLowerCase());
}

// GitHub issue forms render each field as a "### Label" heading followed by
// the answer. This pulls the value that follows a given heading.
function extractField(body, label) {
  const pattern = new RegExp(`### ${label}\\s*\\n+([^\\n#]+)`, "i");
  const match = body.match(pattern);
  return match ? match[1].trim() : "";
}

async function revertUnauthorizedApproval() {
  await ghFetch(`/issues/${ISSUE_NUMBER}/labels/approved`, { method: "DELETE" });
  await ghFetch(`/issues/${ISSUE_NUMBER}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body: `@${ACTOR} is not on the certified admin list, so this approval was reverted. A certified admin needs to add the \`approved\` label.`,
    }),
  });
}

async function appendToSheet(row) {
  const credentials = JSON.parse(Buffer.from(GCP_SA_KEY, "base64").toString("utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SHEET_TAB_NAME}!A:H`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

async function closeIssueAsCompleted(summaryComment) {
  await ghFetch(`/issues/${ISSUE_NUMBER}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: summaryComment }),
  });
  await ghFetch(`/issues/${ISSUE_NUMBER}/labels/pending-approval`, { method: "DELETE" }).catch(() => {});
  await ghFetch(`/issues/${ISSUE_NUMBER}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", labels: ["purchase-request", "approved", "completed"] }),
  });
}

async function main() {
  if (!isAdmin(ACTOR)) {
    await revertUnauthorizedApproval();
    process.exit(0);
  }

  const itemName = extractField(ISSUE_BODY, "Item Name");
  const category = extractField(ISSUE_BODY, "Category");
  const unitPriceRaw = extractField(ISSUE_BODY, "Price per Unit \\(USD\\)");
  const quantityRaw = extractField(ISSUE_BODY, "Quantity");
  const link = extractField(ISSUE_BODY, "Link to Item");

  const unitPrice = parseFloat(unitPriceRaw.replace(/[^0-9.]/g, ""));
  const quantity = parseInt(quantityRaw.replace(/[^0-9]/g, ""), 10);

  if (!itemName || Number.isNaN(unitPrice) || Number.isNaN(quantity)) {
    await ghFetch(`/issues/${ISSUE_NUMBER}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: `Could not parse this issue into a valid purchase (item: "${itemName}", price: "${unitPriceRaw}", quantity: "${quantityRaw}"). Please fix the fields and re-add the \`approved\` label.`,
      }),
    });
    await ghFetch(`/issues/${ISSUE_NUMBER}/labels/approved`, { method: "DELETE" }).catch(() => {});
    process.exit(1);
  }

  const total = (unitPrice * quantity).toFixed(2);
  const date = new Date().toISOString().slice(0, 10);

  const row = [date, itemName, category, unitPrice.toFixed(2), quantity, total, link, ISSUE_AUTHOR, ACTOR];
  await appendToSheet(row);

  await closeIssueAsCompleted(
    `✅ Approved by @${ACTOR} and logged to the spreadsheet: **${itemName}** x${quantity} @ $${unitPrice.toFixed(
      2
    )} = $${total}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
