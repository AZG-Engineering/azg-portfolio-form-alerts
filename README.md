# Google Form to Sheet to automatic alerts

A Google Form feeds a response sheet. A script attached to that sheet does the
follow-up nobody has to remember:

- **On each new response:** sets Status to `New`, fills in who it is assigned to
  (from a Routing tab), and emails that person an alert.
- **On each Status change:** records it in a Run Log, with before and after.
- **Once a day:** emails a summary of everything still open, grouped by assignee,
  urgent first, oldest first.
- **Always:** writes every run and every error to a `Run Log` tab, so "did it send?"
  has an answer.

**Demo built with made-up sample data.** The names and requests in `sample-data\` are
invented, and no email address appears in any file here.

Built by AZG Engineering.

## Demo mode

`DEMO_MODE` at the top of `src\Code.gs` is `true`. In demo mode every email goes to
the Google account that owns the script, whoever the request is assigned to. No
made-up person is ever emailed. The owner's address is read from Google when the
script runs; it is never stored.

## What's in the folder

| Path | What it is |
| --- | --- |
| `src\Code.gs` | Settings, `setup()`, and the three triggers. Reads and writes the sheet, sends mail. |
| `src\Logic.gs` | The decisions: who gets what, what the emails and log lines say. No Google calls, so it is testable anywhere. |
| `src\appsscript.json` | Apps Script manifest (time zone, V8 runtime). Optional for the demo. |
| `sample-data\responses.csv` | 15 made-up form responses. |
| `sample-data\form-questions.md` | The form's questions and the default routing. |
| `tests\` | 46 tests, run with Node. No Google account needed. One of them replays the walkthrough in `DEPLOY.md`. |
| `DEPLOY.md` | The owner's 15-minute guide: create the form, paste the script, run it, capture screenshots. |
| `tools\frame_screenshots.py` | Turns the raw captures into finished 1600x1200 images. |
| `screenshots\` | The finished images, once the captures exist. |

## How to run it

**The tests** (Node 20 or newer, no packages to install):

```powershell
node --test
```

They load the two `.gs` files into Node with stand-ins for Google's services (a fake
spreadsheet, fake mail, fake triggers) and check what the script does: which cells
it writes, who each email goes to, and what lands in the Run Log.

**The real thing** runs inside Google, attached to the form's response sheet. Follow
`DEPLOY.md`. In short: create the form, link it to a sheet, paste the two `.gs` files
into Extensions > Apps Script, run `setup()` once, and approve Google's permission
prompt in the browser.

**The screenshots**, after the captures in `DEPLOY.md` Part 6 are saved to
`screenshots\raw\`:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-tools.txt
.\.venv\Scripts\python.exe tools\frame_screenshots.py
```

`--self-test` checks the framing tool with placeholder images.

## How to change it

| To change | Where |
| --- | --- |
| Who handles which request type | The **Routing** tab in the sheet. No code change. |
| Send to real people instead of the owner | Fill in the Email column on the Routing tab, then set `DEMO_MODE` to `false` in `Code.gs`. An assignee with no address still falls back to the owner, and the email says so. |
| The form's questions | Change the form, then make `COLUMNS` in `Code.gs` match the new question titles. Add the field to `rowToRecord` and the email text in `Logic.gs` if it should appear in emails. |
| The list of statuses | `STATUS` and `STATUS_LIST` in `Logic.gs`, then run `setup()` again to refresh the dropdown. "Done" is what closes a request (`isOpen`). |
| When the summary goes out | `SUMMARY_HOUR` in `Code.gs` (hour of the day, script time zone), then run `setup()` again. |
| The wording of the emails | `buildAlertEmail` and `buildSummaryEmail` in `Logic.gs`. The tests show the exact text, so update them too. |
| The name of the response tab | `RESPONSES_SHEET` in `Code.gs`. |
| How much log is kept | `MAX_LOG_ROWS` in `Code.gs` (newest 500 by default). |

After any change to `Logic.gs` or `Code.gs`, run `node --test`, then paste the changed
file into the Apps Script editor again.

`setup()` is safe to run again at any time. It adds only what is missing and replaces
the script's own three triggers.

## How it behaves at the edges

- **The trigger fires twice for one response** (Google sometimes does this): the
  second run sees the row already has a Status and sends nothing.
- **A request type with no Routing row:** the row is left unassigned and the alert
  goes to the owner, saying there is no rule.
- **A response arrives before `setup()` was run:** an `ERROR` row in the Run Log says
  to run setup. Nothing is silently skipped.
- **Mail fails** (for example the daily quota): the error is written to the Run Log
  and passed on, so Google also reports the failed run.
- **Only single Status cells are logged.** Pasting over several cells at once, or
  editing other columns, writes no log row.
- **Blank Status counts as open** in the summary.

## Limits

- Google caps email per day: about 100 recipients a day on a free account, more on
  Google Workspace. The script does not queue or retry.
- The daily summary goes to the script owner only.
- One form and one response tab per script.
- Not tested inside Google by the builder (no account access by design). The tests
  cover the logic and the sheet, mail and trigger calls against stand-ins; the
  first real run is step 12 of `DEPLOY.md`.

## Permissions

`Code.gs` starts with `@OnlyCurrentDoc`, which limits the script to the one
spreadsheet it is attached to. Google will ask to: see and edit that spreadsheet,
send email as the owner, run triggers, and see the owner's email address.

## Dependencies and licences

Nothing is copied into this repository from a third party: no templates, icons or
code.

Needed to run the script: nothing to install. It uses only Google's built-in Apps
Script services (SpreadsheetApp, MailApp, ScriptApp, Session, Utilities).

Needed to run the tests: Node 20 or newer. They use only Node's built-in test
runner and modules. There are no npm packages and no `package.json`.

Needed only for the screenshot framing tool (`requirements-tools.txt`), installed
by pip into `.venv`:

| Package | Version | Licence | Used for |
| --- | --- | --- | --- |
| Pillow | 12.3.0 | MIT-CMU | `tools\frame_screenshots.py`: composing the 1600x1200 images |

Pillow has no other Python dependencies. Everything a buyer would run, the two
`.gs` files, has no third-party dependency at all.

The framed screenshots use the Segoe UI font that ships with Windows.
