# PI Verify v1.2

Mobile PWA + live admin for multi-site physical inventory (Bin-face and Perpetual audits).

## Deploy on Render
1. Replace the files in your Git repo with this folder's contents (keep the `public` folder).
2. Web Service, runtime **Node**, Build Command `npm install`, Start Command `node start.js`.
3. Environment variables:
   - `DATABASE_URL` = Internal Database URL of your Render Postgres (data is then kept safely, no disk needed).
   - `DB_SCHEMA` = `piverify` (keeps this app's tables separate when one database is shared with other apps).
4. First login MASTER / 1234, then Profile > Change my PIN.

How storage works: the app keeps working on local files and copies every change to Postgres within about 2 seconds.
At start-up it restores everything from Postgres first. If Postgres cannot be reached, the app refuses to start
rather than run on empty data. Changes made in the last 2 seconds before a crash could be lost; a normal redeploy saves first.

No `DATABASE_URL`? The app behaves exactly as before and uses files: set `DB_FILE=/data/data.json` with a paid Persistent Disk
mounted at `/data`. Without either, data is erased on restart.

## Setup
Manage > Sites (master), Upload stock dump (CSV or Excel, one site at a time), Create user.

## Rules
One counter per location; part locked after Completed; closed location recounted only after "Enable recount for all" (Recon);
recounts stored as R2/R3, never added. Reset scanning data / remove stock per site under Manage > Reset data.

## Data and backup
Master: Manage > Downloads > Backup all data. Old v1.0 data files are migrated automatically on first start.

## Lot size (v1.2)
Stock file columns: Location, Part, Qty, Lot size (optional). Lot size = pieces in one box or pack.
In a Perpetual audit each scan adds the lot size (a lot-10 part: 3 scans = 30 pieces) and the saved quantity is in pieces.
Blank or 1 means single pieces. Lines with a lot size that is not a positive number are rejected in the upload preview.

## Locations not in the stock file (v1.2)
A counter may scan a location that is not in the dump. It is accepted and marked "Not in dump".
Parts counted there are reported as Extra (system 0). In a Bin-face audit they are reported as Wrong location,
with the part's system location shown. The location belongs to that counter's site only, and disappears on Reset.

## Find correct location for counters (v1.3)
Counters have a Find tab: scan a part and the app shows the system location(s) where it belongs. Quantities are never shown to counters.
