# Sentinel – Smart Gate Control

Gate entry for vehicles and visitors, with team-based access, visitor approvals, photos,
transporter/route dropdowns, dashboards and 30-day retention.

## What is inside
```
server.js          Node server (no framework) – login, rules, storage
public/index.html  The app screens
public/shim.js     Connects the screens to the server
render.yaml        One-click Render setup (web service + Postgres)
package.json       Only dependency: pg
```

## Deploy on Render (about 10 minutes)
1. Create a new GitHub repository and upload all these files (keep the `public` folder).
2. In Render choose **New → Blueprint**, pick the repository, and approve. Render creates the
   web service and the Postgres database from `render.yaml`.
3. When the deploy finishes, open **sentinel → Environment** and copy the value of **SETUP_KEY**.
4. Open your Render URL. On the first screen enter the setup key, your name, a user ID and a
   4–6 digit PIN. This creates the **Super Admin**.
5. Sign in, open **Users & Admins** and create team admins and members.
   Open **Transporters & Routes** and add the dropdown values (e.g. Tej, SSPL).

No Blueprint? Create a Postgres database and a Node web service by hand, then set
`DATABASE_URL`, `SESSION_SECRET` (any long random text), `SETUP_KEY`, and `NODE_ENV=production`.
Build command `npm install`, start command `npm start`.

## Run on your own computer
```
npm install
SETUP_KEY=mykey node server.js     # uses a local data.json file when DATABASE_URL is not set
```
Open http://localhost:3000

## Rules the server enforces
- Only the Super Admin creates users, resets PINs and edits transporters/routes.
- Only Security (and Super Admin) creates entries and marks vehicles/visitors out.
- Dispatch sees Loading vehicles, Inward sees Unloading vehicles, HR sees visitors, Security sees all.
- Contact numbers and photos go only to admins (and contact numbers to Security, who enter them).
- Vehicles need no approval. Visitors are approved/rejected by the admin of the routed team.
- Entries and photos older than 31 days are deleted automatically (checked every 6 hours).
- PINs are stored hashed. 8 wrong sign-ins lock that ID for 15 minutes.

## Before real use
- Use a paid Render plan with a paid database. Free tiers may sleep or expire, which risks losing data.
- 4–6 digit PINs are weak by nature; avoid 1234-style PINs.
- Photos are stored in the database; watch its size.
- A real SMS OTP for visitors can be added later through an SMS provider (MSG91, Twilio, etc.);
  the provider key can stay secret on this server.
