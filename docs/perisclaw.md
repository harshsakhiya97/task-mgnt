# Perisclaw → Task Mgnt

Give a task to Perisclaw on WhatsApp. Perisclaw adds a row to a Google Sheet, and Task Mgnt turns that row into a task.

```
Admin on WhatsApp → Perisclaw → new row in Google Sheet
      → Task Mgnt reads new rows every 2 minutes
      → Gemini (AI) picks out: who · what · date/time · priority
      → clear rows become tasks · unclear rows wait in "Needs review"
```

## Setup (one time)
1. **Sheet:** create a Google Sheet for Perisclaw to write to, with one header row such as `Date | Task | Notes`. Any headers work; the AI reads the whole row.
2. **Share it:** Share → General access → **Anyone with the link** → **Viewer**. The app can only read sheets shared this way.
3. **Perisclaw:** tell Perisclaw to add every task you give it as a new row in that sheet, in plain words, e.g. *"Ravi – send the TVS report by Friday 5 pm, urgent"*.
4. **Gemini key:** get a free key at https://aistudio.google.com → **Get API key**. In Supabase → **Edge Functions → Secrets**, add `GEMINI_API_KEY` = your key.
5. **In the app:** go to **Perisclaw** (admin sidebar), paste the sheet link, choose which admin the tasks are created as, and click **Save & switch on**.
   - Rows already in the sheet are skipped by default, so old rows don't become tasks. You can choose "Import them as tasks too".

## How rows are handled
- **Task created:** Gemini found exactly one matching team member, a task, and a due date today or later, and it's at least 75 % sure. The task is created as the chosen admin, the assignee gets the usual WhatsApp message, and the original row is kept in the task description.
- **Needs review:** anything unclear:
  - unknown or ambiguous person
  - no date, or a date in the past
  - low confidence, or not a task at all

  Click the row, fix the fields, then **Create Task**, or **Ignore this row**.
- **Times:**
  - "at 3 pm" → 3–4 pm
  - "3–4 pm" → 3–4 pm
  - "by 5 pm" → 4–5 pm, so the task shows as Expired after 5 pm
  - no time → all day
- **No duplicates:** the same row content is never processed twice, even if rows move around in the sheet.
- **Rate limit:** up to 8 new rows are handled per run, to stay inside Gemini's free-tier limit. Extra rows wait for the next run, 2 minutes later.
- **Model:** `gemini-2.5-flash` by default. Set the secret `GEMINI_MODEL` to change it.
