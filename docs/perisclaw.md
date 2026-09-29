# Perisclaw → Task Mgnt

Give a task to Perisclaw on WhatsApp. Perisclaw adds a row to a Google Sheet, and Task Mgnt turns that row into a task.

```
Admin on WhatsApp → Perisclaw → new row in Google Sheet
      → Task Mgnt reads new rows every 2 minutes
      → Gemini (AI) picks out: who · what · date/time · priority
      → clear rows become tasks · unclear rows wait in "Needs review"
```

## Setup (one time)

### A. Robot account (so the sheet can stay private)
1. Open https://console.cloud.google.com with your Google account, and create a project, e.g. **Task Mgnt**. There's a project picker at the top, then **New project**.
2. **Turn on the Sheets API:** ☰ → **APIs & Services → Library** → search **Google Sheets API** → **Enable**.
3. **Create the robot:** ☰ → **IAM & Admin → Service Accounts** → **Create service account**. Name it `task-mgnt-sheets` → **Create and continue**. Skip the roles → **Done**.
4. **Get its key:** click the new account → **Keys** tab → **Add key → Create new key → JSON → Create**. A `.json` file downloads. Keep it private.
5. **Give it to the app:** in Supabase → **Edge Functions → Secrets**, add `GOOGLE_SERVICE_ACCOUNT_JSON`. The value is the **entire content** of that .json file: open it in a text editor, select all, and paste.
6. **Share the sheet with the robot:** the Perisclaw page shows the robot's email, which looks like `task-mgnt-sheets@….iam.gserviceaccount.com`. In the sheet, click **Share**, add that email as **Viewer**, and untick "Notify".

### B. Gemini (the AI)
7. Get a free key at https://aistudio.google.com → **Get API key**. Add it in Supabase → Edge Functions → Secrets as `GEMINI_API_KEY`.

### C. Sheet and app
8. The sheet needs one header row, e.g. `Date | Task | Notes`. Any headers work, because the AI reads the whole row. Tell Perisclaw to add every task you give it as a new row there, in plain words, e.g. *"Ravi – send the TVS report by Friday 5 pm, urgent"*.
9. In the app, go to **Perisclaw** in the admin sidebar:
   - paste the sheet link
   - choose which admin the tasks are created as
   - click **Save & switch on**

   Rows already in the sheet are not turned into tasks automatically. They are listed as **Not added (old row)**, and you can still add any of them with **Add as task** in the Action column.

Without a robot account, the app can still read a sheet shared as "Anyone with the link → Viewer".

## How rows are handled
- **Added as task:** Gemini found exactly one matching team member, a task, and a due date today or later, and it's at least 75 % sure. The task is created as the chosen admin, the assignee gets the usual WhatsApp message. The task gets only the AI's title and description; the original row stays on the Perisclaw page.
- **Waiting for you:** anything unclear:
  - unknown or ambiguous person
  - no date, or a date in the past
  - low confidence, or not a task at all

  Old rows from before the sheet was connected also wait here.
- **Action column** (last column of the rows table):
  - **Add as task** opens the task form, pre-filled with what the AI understood. For an old row, the AI reads it first. Check the fields, then click **Add as Task**.
  - **Skip** marks the row as Skipped. A skipped row can still be added later.
  - Once a row is added, the status shows **Added as task** and the Action column shows its task number (e.g. **TM-125**). Click the number to open the task details.
- **Times:**
  - "at 3 pm" → 3–4 pm
  - "3–4 pm" → 3–4 pm
  - "by 5 pm" → 4–5 pm, so the task shows as Expired after 5 pm
  - no time → all day
- **No duplicates:** the same row content is never processed twice, even if rows move around in the sheet.
- **Rate limit:** up to 8 new rows are handled per run, to stay inside Gemini's free-tier limit. Extra rows wait for the next run, 2 minutes later.
- **Model:** `gemini-2.5-flash` by default. Set the secret `GEMINI_MODEL` to change it.
