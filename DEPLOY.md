# Deploy guide: about 15 minutes

For the owner. This puts the demo into the company Google account, runs it with four
made-up entries, and captures the screenshots.

Nothing here needs a password, key or token to be copied anywhere. Google asks for
permission once, in the browser, and that is all.

**Demo mode is on.** Every email the script sends goes to the account you are signed
in with, and to nobody else.

## Before you start (1 minute)

- Use a browser window signed in to the **company Google account only**. A private
  window, signed in to just that account, avoids Google picking the wrong one.
- Have these three files open in Notepad or any editor, from this folder:
  `src\Code.gs`, `src\Logic.gs`, `sample-data\form-questions.md`.

## Part 1: the form (4 minutes)

1. Go to `forms.google.com` and choose **Blank form**.
2. Title: `Work request (demo)`
3. Add these five questions. Type the titles exactly; they become the column names
   the script looks for. Turn on **Required** for each.

   | # | Question title | Type | Options |
   | --- | --- | --- | --- |
   | 1 | `Your name` | Short answer | |
   | 2 | `Location` | Dropdown | Front office, Warehouse, Shop floor |
   | 3 | `Request type` | Dropdown | IT, Facilities, Supplies |
   | 4 | `Priority` | Multiple choice | Low, Normal, Urgent |
   | 5 | `What do you need?` | Paragraph | |

4. If there is a **Publish** button at the top right, click it and confirm.

## Part 2: the sheet (1 minute)

5. In the form, open the **Responses** tab, click **Link to Sheets**, choose
   **Create a new spreadsheet**, and click **Create**.
6. The new sheet opens with a tab named **Form Responses 1**. Leave that name.

## Part 3: paste the script (3 minutes)

7. In the sheet: **Extensions > Apps Script**. A new tab opens with the editor.
8. Click **Untitled project** and name it `Work request alerts (demo)`.
9. The editor shows a file called `Code.gs` with a few lines in it. Select all of it,
   delete it, and paste in everything from `src\Code.gs`.
10. Click the **+** next to **Files**, choose **Script**, and name it `Logic`. Delete
    what is in it and paste in everything from `src\Logic.gs`.
11. Press **Ctrl+S** to save.

`src\appsscript.json` is not needed for the demo; skip it. (It only records the time
zone. To check the time zone Google is using: the gear icon, **Project Settings**.)

## Part 4: run setup and give permission (2 minutes)

12. In the toolbar, pick **setup** in the function dropdown and click **Run**.
13. Google says **Authorization required**. Click **Review permissions** and choose
    the company account.
14. Google may say it **hasn't verified this app**. That is normal for a script you
    wrote yourself. Click **Advanced**, then **Go to Work request alerts (demo)
    (unsafe)**.
15. If the permissions are listed with checkboxes, tick **Select all**. Click
    **Allow** (or **Continue**).

    What it asks for: to see and edit this one spreadsheet, to send email as you, to
    run when you are not there (the triggers), and to see your email address (so it
    knows where to send in demo mode).
16. The log at the bottom ends with **Execution completed**.
17. Back in the sheet, check:
    - three new columns on the right: **Status**, **Assigned To**, **Last Updated**;
    - two new tabs: **Routing** and **Run Log**;
    - one row in **Run Log**: `setup`, `OK`.

## Part 5: four test entries (3 minutes)

18. In the form editor, click the **Preview** (eye) icon. The live form opens.
19. Submit these four entries, one at a time (**Submit another response** between
    them):

    | Your name | Location | Request type | Priority | What do you need? |
    | --- | --- | --- | --- | --- |
    | Riley P. | Front office | IT | Normal | Laptop will not connect to the front desk printer |
    | Morgan T. | Warehouse | Facilities | Urgent | Dock door 2 will not close all the way |
    | Avery K. | Shop floor | Supplies | Low | Two boxes of nitrile gloves, size L |
    | Jamie W. | Shop floor | IT | Urgent | Label printer at station 3 prints blank labels |

20. Look at the sheet. Within a few seconds each new row gets **Status** `New` and an
    **Assigned To** name (Jordan M., Casey L., Taylor R., Jordan M.).
21. Look at the company inbox. Four alert emails have arrived, each starting with
    "Demo mode:".
22. In the sheet, use the Status dropdown to set Riley P.'s row to `In progress` and
    Avery K.'s row to `Done`.
23. In the Apps Script editor, pick **sendDailySummary** in the function dropdown and
    click **Run**. A summary email arrives with the subject
    `Open requests: 3 (2 urgent)`.
24. The **Run Log** tab now has 8 rows: 1 setup, 4 handleFormSubmit, 2 handleEdit,
    1 sendDailySummary, all `OK`.

## Part 6: the screenshots (3 minutes)

Capture with **Win+Shift+S** (rectangle), then save each one into
`screenshots\raw\` in this folder, as PNG, with exactly these names. Create the
`raw` folder if it isn't there. Captures in `raw\` are never put into git.

**Leave out of every capture:**

- any email address (anything with an `@`);
- the account picture or initial at the top right of every Google page;
- the browser's tabs, address bar, bookmarks and profile button.

Drawing the rectangle tightly around the part listed below does all of that.

| Save as | Where | Draw the rectangle around |
| --- | --- | --- |
| `1-sheet.png` | The sheet, **Form Responses 1** tab | The grid only: from the header row down to the fourth entry, columns A to I (Timestamp to Last Updated). Nothing above the grid. |
| `2a-alert-subject.png` | The inbox, alert email for Morgan T. (the URGENT one), opened | Only the subject line: `URGENT: New Facilities request from Morgan T.` |
| `2b-alert-body.png` | Same email | Only the message text, from the line starting "Demo mode:" down to the line starting "Its Status is now". Not the sender line above it (it shows addresses). Not the last line (the sheet link). |
| `3a-summary-subject.png` | The summary email, opened | Only the subject line: `Open requests: 3 (2 urgent)` |
| `3b-summary-body.png` | Same email | Only the message text, from "Open requests as of" down to the last request. Not the sender line. Not the last line (the sheet link). |
| `4-run-log.png` (optional) | The sheet, **Run Log** tab | The grid only: the header row and the 8 rows, columns A to D. |

Look at each capture once before saving: no `@`, no account picture.

## Part 7: hand back

That's the owner's part done. In the next coder session, the captures are turned
into the finished 1600x1200 images with:

```powershell
.\.venv\Scripts\python.exe tools\frame_screenshots.py
```

## Afterwards

The daily summary keeps arriving at about 8 am every day until it is turned off. To
stop it: in the Apps Script editor, click **Triggers** (the clock icon), and delete
the `sendDailySummary` trigger. Or delete all three triggers to switch the demo off
completely. Deleting the sheet does the same.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| `No tab named "Form Responses 1"` when running setup | The response tab has another name (for example in another language). Rename the tab to `Form Responses 1`, or change `RESPONSES_SHEET` near the top of `Code.gs`, then run setup again. |
| A permission error that mentions the spreadsheet or triggers | Delete the line `@OnlyCurrentDoc` near the top of `Code.gs`, save, and run setup again. Google will ask again, this time for all your spreadsheets rather than just this one. Tell AZG Engineering it happened. |
| A row never gets a Status | Open the **Run Log** tab and read the newest row. `Missing column(s)... Run setup() first` means step 12 was skipped. |
| No email arrives | Check the **Run Log** for an `ERROR` row, then the Spam folder. |
| The question titles don't match | The row gets Status `New` but fields in the email are blank. Fix the title in the form so it matches the table in Part 1 exactly, and fix the header cell in the sheet to match. |
