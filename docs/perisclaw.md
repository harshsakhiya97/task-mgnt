# Perisclaw → Task Mgnt

Give a task to Perisclaw on WhatsApp. Perisclaw adds a row to a Google Sheet, and Task Mgnt turns that row into a task.

```
Admin on WhatsApp → Perisclaw → new row in Google Sheet
      → Task Mgnt reads new rows every 2 minutes
      → Gemini (AI) picks out: who · what · date/time · priority
      → every row becomes a task (the admin can edit it later)
      → person not a user yet? → task added Unassigned + WhatsApp to admins
```

## Setup (one time)

### A. Robot account (so the sheet can stay private)
1. Open https://console.cloud.google.com with your Google account, and create a project, e.g. **Task Mgnt**. There's a project picker at the top, then **New project**.
2. **Turn on the Sheets API:** ☰ → **APIs & Services → Library** → search **Google Sheets API** → **Enable**.
3. **Create the robot:** ☰ → **IAM & Admin → Service Accounts** → **Create service account**. Name it `task-mgnt-sheets` → **Create and continue**. Skip the roles → **Done**.
4. **Get its key:** click the new account → **Keys** tab → **Add key → Create new key → JSON → Create**. A `.json` file downloads. Keep it private.
5. **Give it to the app:** in Supabase → **Edge Functions → Secrets**, add `GOOGLE_SERVICE_ACCOUNT_JSON`. The value is the **entire content** of that .json file: open it in a text editor, select all, and paste.
6. **Share the sheet with the robot:** the Perisclaw page shows the robot's email, which looks like `task-mgnt-sheets@….iam.gserviceaccount.com`. In the sheet, click **Share**, add that email as **Editor**, and untick "Notify". Editor lets the app write each row's task number into a **Task No** column (Viewer still works, but without task numbers).

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
- **Every new row becomes a task straight away,** created as the chosen admin, and the admin can edit it later:
  - person found → assigned to them; they get the usual WhatsApp message
  - **person not a user yet** (or no person named) → the task is added **Unassigned**, and every admin gets the `task_unassigned` WhatsApp message and a bell notification: *"task added in task list but user not found, kindly create user & assign this task to them"*. Create the user (Users page), then open the task and click **Assign**.
  - no date, or a date that has passed → due today
  - no clear task text → the title is taken from the row

  Anything the AI guessed is shown as a **Note** under the row's status. The task gets only the AI's title and description; the original row stays on the Perisclaw page.
- **Unassigned** card / filter: rows whose task still has nobody. Unassigned tasks also show an orange **Unassigned** badge in the task lists.
- **Waiting for you:** old rows from before the sheet was connected. Add them with **Add as task** if needed. Rows the AI could not read (even after the automatic retries) are under **Errors**.
- **Action column** (last column of the rows table):
  - **Add as task** opens the task form, pre-filled with what the AI understood. For an old row, the AI reads it first. Check the fields, then click **Add as Task**.
  - **Skip** marks the row as Skipped. A skipped row can still be added later.
  - Deleting a task that came from a row puts that row back to **Skipped**, so it can be added again if needed.
  - Once a row is added, the status shows **Added as task** and the Action column shows its task number (e.g. **TM-125**). Click the number to open the task details.
- **Times:**
  - "at 3 pm" → 3–4 pm
  - "3–4 pm" → 3–4 pm
  - "by 5 pm" → 4–5 pm, so the task shows as Expired after 5 pm
  - no time → all day
- **Task No column:** once a row becomes a task, the app writes its number (e.g. **TM-165**) into a **Task No** column in the sheet, and adds that column header if it's missing. When a row with a task number is edited later, that exact task is updated (if it's still the same task); a row without one becomes a new task. The Task No column is ignored when comparing rows, so writing the number doesn't count as an edit. Rows that already had tasks get their numbers on the next sync.
- **2-minute wait:** a new row shows as **Waiting 2 min** and becomes a task on the next sync after that. Perisclaw often corrects a row right after writing it; if that happens during the wait, only the corrected row is added.
- **Later edits:** if Perisclaw edits a row after it became a task (same title, or mostly the same text), the existing task is updated instead of adding a new one. Only fields nobody changed by hand are updated; if the description was edited by someone, the new details are added as a comment. A row reused for a completely different task becomes a new task.
- **No duplicates:** the same row content is never processed twice, even if rows move around in the sheet.
- **Gemini busy (error 503 / 429):** Google's free AI is sometimes overloaded. The app waits a moment and tries again, then tries the lighter `gemini-2.5-flash-lite` model. If it's still busy, the row shows as an error and is tried again automatically on the next runs, up to 5 times. After that, use **Add as task** on the row.
- **Rate limit:** up to 8 new rows are handled per run, to stay inside Gemini's free-tier limit. Extra rows wait for the next run, 2 minutes later.
- **Model:** `gemini-2.5-flash` by default. Set the secret `GEMINI_MODEL` to change it.
