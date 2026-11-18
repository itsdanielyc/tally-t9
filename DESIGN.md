# Design decision log

Short, per keel-build: one line per UI decision, newest last. The Product
Frontend Design skill was not loaded for this build.

Ruling: the Product Frontend Design skill is not loaded — the run is limited
to reading this repository, and that skill lives outside it — cost if wrong:
a later design pass may restyle screens and refresh the visual baselines.

## Slice 1

- One light theme, system UI fonts, 14 px text on 20 px lines; inputs,
  buttons and table rows have fixed heights (32 px, 36 px rows) so the
  tier 2 geometry holds across the three operating systems' fonts.
- A top bar with the product name and section buttons (`nav` "Sections",
  `aria-current="page"` on the open one); a footer with the backend badge
  and platform, kept from the template because the L6 suite reads them.
- Transactions screen: the add form sits above the list so recording takes
  one glance; the form keeps the date and the Spending/Income choice after
  an add and puts the cursor back in Payee, for several entries in a row.
- Amounts are typed as positive numbers with a Spending/Income switch;
  the list shows signed amounts, spending in red and income in green, in
  tabular figures, right-aligned, with the currency code in the header.
- Dates show as YYYY-MM-DD in the list (unambiguous in every locale); the
  date input uses the system's own date control.
- Delete asks in place ("Confirm delete" / "Keep") rather than in a modal,
  so the row being deleted stays in view.
- Errors appear in one alert line under the form, and the field at fault
  is marked `aria-invalid` and focused.
- Each row's buttons are named after the row ("Edit Corner Shop on
  2026-03-09") so a screen reader and the tests can tell them apart.

## Slice 2

- Import is a three-card page, numbered in the order the person works:
  choose a file, match the columns, check and import. Nothing is saved
  until the "Import N transactions" button, whose label is the count.
- Every mapping control is a plain select or radio with its own label, all
  filled in from detection, so a well-formed export needs only one click.
- Changing the delimiter re-reads the file and re-guesses the columns;
  switching the header keeps the person's column choices.
- The preview shows the first ten readable rows exactly as they will be
  stored (ISO date, signed amount) with a status column; duplicates are
  greyed and say "Duplicate, skipped". Unreadable rows get their own table
  with the file's line number and the reason in words.
- A summary sentence above the preview gives the three counts (imported,
  skipped, unreadable) so the decision fits in one line.

## Slice 3

- Categories get their own screen with two cards: the categories (with a
  transaction count each) and the rules. Rename, merge and delete act in
  the row itself, like delete on the Transactions screen, so the category
  being changed stays in view.
- Delete says what it will do before it does it ("leaves 2 transactions
  uncategorised and removes its rules"); merge names the target in a select
  next to the row.
- Rules read as the sentence the brief uses: "Payee contains" text and a
  category. Applying rules is an explicit button with a count in the
  status, because it changes many transactions at once.
- The import preview gains a Category column showing what the rules will
  give each row before anything is saved.

## Slice 4

- The Month screen reads top to bottom as the question the brief asks:
  which month (Previous / Next and a month picker), income against
  spending against net in large figures, then each category, then the
  transactions those numbers add up from.
- Month names are written out in English ("March 2026") rather than by the
  system locale, so the heading and the tier 1 baseline are the same on
  every machine.
- Budgets are edited in the category's own row; "Left" shows the amount
  left, or "N over" in red, beside a simple bar (green, red when over), the
  only chart the brief allows.
- A category with a budget is listed even in a month with nothing spent,
  so its full budget shows as left.
