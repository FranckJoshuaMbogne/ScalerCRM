# Runbook: moving MY PERFECT FIT onto SCALER

MY PERFECT FIT's history comes in as CSV ("historical data source/format" in SPRINTS.md: CSV import). The order is: **customers → leads → orders**. Customers come first so leads and orders attach to the right customer file. Phones are the matching key.

## 1. Two weeks before go-live

- [ ] Get exports from the current system (or spreadsheets):
  - customers;
  - enquiries/leads, with their status;
  - orders or invoices, with amount paid.
  Ask for the full history and for the export date.
- [ ] Set up the business in SCALER:
  - branches (exact names as used in the files);
  - team members invited (owners in the lead file are matched by email or name);
  - pipeline stages and sources renamed to match their vocabulary, or the files' values mapped to SCALER's;
  - order stages.
- [ ] Download the three templates from **Settings → Import data**. Rename or rearrange the export columns to match. The importer also recognises common spellings ("Mobile No", "Customer Name", "Invoice No", "Bill Amount"…).

## 2. Rehearsal (in a copy, never production)

1. Create a "MPF rehearsal" business in the staging project, or a scratch database from `scripts/restore-drill.sh`.
2. For each file in turn, **Check file**, then read every problem listed:
   - invalid phones: usually missing digits or two numbers in one cell;
   - unknown stages, branches or sources: map them, or add them in Settings;
   - dates that aren't real: the file mixes MM/DD and DD/MM. SCALER reads DD/MM/YYYY.
3. Fix the source files (not SCALER) and check again until only rows that are truly unusable remain.
4. Import. Then compare:

   | Check | Expected |
   |-------|----------|
   | Customers created + matched | ≈ rows in the customer file (matched = same phone twice) |
   | Lead count by stage (Leads → filter) | Same as the old system's report |
   | Sum of order totals and paid amounts (Analytics → Executive, all time) | Same as the old system's sales report |
   | 10 random customers | Name, phone, orders and balance due match |

5. Write down every fix made to the files, so the real run repeats them.

## 3. Go-live day

1. Freeze the old system: no new entries from this point. Take its final export.
2. Apply the recorded fixes to the final files.
3. Import into production (Settings → Import data), in this order: customers, leads, orders.
   - Every import is in the audit log and in "Recent imports" with refused rows listed.
   - Re-running a file is safe: leads and orders with a reference already imported are skipped, and customers are matched by phone.
4. Run the comparison table above against production.
5. Turn on the ready-made automations they want (Automation). Imported history never triggers automations, round-robin or "assigned to you" notifications, so this can happen right after the import.
6. Connect WhatsApp and the lead sources (Integrations). Live leads now flow in.

## Things to know

- Imported leads and orders keep their original dates, so analytics show the real history. The lead timeline shows the import day for "created".
- Imported orders have one line: the description and total from the file. Item-level detail stays in the old system's archive.
- Opt-ins are **not** imported. WhatsApp marketing consent must be collected again, or imported with its evidence by support (it needs proof of when and how consent was given). Service messages (order updates) don't need it.
- Files are limited to 10 MB / 50,000 rows. Split larger exports by year.
