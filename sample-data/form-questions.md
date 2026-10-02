# Form questions

The Google Form for this demo. Form title: **Work request (demo)**.

The question titles must be typed exactly as shown, because they become the column
headers the script looks for. All five questions are required.

| # | Question title | Type | Options |
| --- | --- | --- | --- |
| 1 | `Your name` | Short answer | |
| 2 | `Location` | Dropdown | Front office, Warehouse, Shop floor |
| 3 | `Request type` | Dropdown | IT, Facilities, Supplies |
| 4 | `Priority` | Multiple choice | Low, Normal, Urgent |
| 5 | `What do you need?` | Paragraph | |

Google adds the `Timestamp` column by itself.

The script adds three more columns to the right when `setup()` runs:
`Status`, `Assigned To` and `Last Updated`.

## Who gets what

`setup()` creates a **Routing** tab with these rows. Change them in the sheet, not
in the code.

| Request type | Assignee | Email |
| --- | --- | --- |
| IT | Jordan M. | (blank) |
| Facilities | Casey L. | (blank) |
| Supplies | Taylor R. | (blank) |

The Email column is used only when `DEMO_MODE` is `false`. In demo mode every email
goes to the account that owns the script.

## Sample responses

`responses.csv` holds 15 made-up responses in the same column order as the form.
All names and requests are invented.
