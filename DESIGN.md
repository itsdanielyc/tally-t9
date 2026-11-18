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
