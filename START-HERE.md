# Start here (version 0.14.0)

This one package contains everything so far: students and parents, fees and receipts,
teaching grid and timetable, the public school website, year end, attendance, the dashboard, exams and report cards, Excel/PDF exports, fee reminder emails, HR, payroll and expenses, and (new in 0.11.0) transport, stock and the sales counter.

## Updating an existing copy (XAMPP on Windows)

1. **Stop every running copy of the app.** Close all Command Prompt windows that run it, or run:
   ```
   taskkill /F /IM node.exe
   ```
   (An old copy still running on port 3000 is the most common reason the website shows an error.)
2. In XAMPP Control Panel, make sure **MySQL is green** (running).
3. Keep your **`.env`** file (copy it somewhere safe). **Delete everything else** in the project folder, then extract
   this package so `package.json` sits directly in the project folder. Never extract over old files: if Windows asks
   to replace or skip files, the folder was not empty.
4. In Command Prompt, in the project folder:
   ```
   npm install
   npm run doctor
   npm run build
   npm start
   ```
5. Wait for: `Ready (version 0.14.0). Website: http://localhost:3000/ ...`
6. Open:
   - Website: **http://localhost:3000/**
   - Staff and parent app: **http://localhost:3000/app/login**

Your existing data stays. Database updates are applied automatically on start.

## Development mode (no build, refreshes as you edit)

```
npm run dev
```
- Website: http://localhost:5173/
- App: http://localhost:5173/app/login

Use either `npm start` **or** `npm run dev`, not both at once (both use port 3000).

Since 0.11.1, `npm run dev` compiles into its own folder, so stopping it can no longer break `npm start`.
`npm run build` now ends with **API build complete: ... files**. If it does not, scroll up for the error.
If `npm start` says *The last build did not finish*, run `npm run build` again.

## Switching on attendance (new in 0.7.0)

1. Sign in as the developer, open **Developer console**, switch on **Attendance**.
2. **School settings → Staff check-in location**: stand inside the school with your phone and press *Use my current location*.
3. **Attendance → Holidays**: add festivals and vacations. (Saturdays off are set in Timetable → Bell schedules.)
4. Make sure every section has a **class teacher** (Teaching grid).

## Switching on exams (new in 0.9.0)

1. **Developer console**: switch on **Exams** and **Marks**.
2. **Teaching grid**: every class needs its subjects, and every subject a teacher (they enter the marks).
3. **Exams → Settings**: check the grade scales and the result rules per class (marks, grades or both; pass mark).
4. **Exams → Exams & schedule**: set exam dates. Add unit tests or pre-finals if you hold them.
5. Students' photos (optional): staff tap the round photo on a student's page.

The cycle: the subject teacher enters marks in **Marks** and submits → the principal approves in **Exams → Approvals**
→ the principal **publishes** each section → parents see results and the report card.

## Access & roles (new in 0.14.0)

Developer only, under **Administration → Access & roles**.

- A module switched on in the Developer console is on for the school, but each person sees it only if their **role** allows it.
- **Roles tab**: pick a role (Principal, Institution Admin, Teacher, Parent…). For each module choose **No access**, **View**
  or **View & edit**. **Advanced** shows each action (for example Collect fees, Void receipts, Approve marks) and, for
  student data, whose records it covers (everyone's, their class-teacher sections, sections they teach, own children).
  Press **Save**: it applies at once, even to people already signed in.
- **New role**: start empty or copy a role, then change it. Give it to staff on the Staff screen (Edit → Roles).
  Built-in roles cannot be deleted but can be changed or switched off. A new role can be deleted when nobody has it.
- **People tab**: find a person to give them more than their role, or take something away. Everything else follows their role.
- Every change is in the Activity log. The developer login always has full access.

## Login as and the activity log (new in 0.13.0)

Both are for the developer login only, under **Administration** in the menu.

- **Login as**: choose Staff, Drivers, Parents or Students, find the person, press **Login as**. You see and can do exactly
  what they see and do. Whatever you save shows their name (for example on a receipt or attendance), and the activity
  log records that you did it. They are not told. A brown bar at the top shows whose login you are using; press
  **Back to my login** to return. It works per browser tab: other tabs stay in your own login.
- **Activity log**: sign-ins, sign-outs and wrong passwords; every change with before and after; every Excel/PDF download
  and receipt, payslip or report card opened. Filter by dates (India time), type, area, person, or only what was done
  through Login as. Tap an entry for details. Download as Excel or PDF. Entries older than 2 years are deleted automatically.

## Wording (new in 0.12.1)

Screens, messages and guides now say **parents** instead of families (the student's **Parents** tab, Parent mobile,
Parent login, notices to "All parents"). Nothing changes in your data. Names saved before, such as "Kumar family",
stay as they are; change one with **Edit** on the student's Parents tab (Account name). Excel import files made with
the old template (column "Family Mobile") still import.

## Security update (new in 0.12.0)

A full security check was done; SECURITY.md lists what was checked, what was fixed, and what to do on Hostinger.
What you will notice:

- If your developer password is one printed in the guides (such as `ChangeMe@123`), the app asks you to choose your own at the next sign-in.
- If `JWT_ACCESS_SECRET` in `.env` is still the example value, the app uses its own random key (saved in the `storage` folder)
  and says so when it starts. Everyone signs in again once. To use your own key, put 40+ random characters in `JWT_ACCESS_SECRET`.
- Very common passwords (for example `Password@123`) are no longer accepted when someone sets a new password.

## Switching on transport (new in 0.11.0)

1. **Developer console**: switch on **Transport** (Fees must be on: bus routes and the bus fee live in Fee setup).
2. **Staff**: add each driver as a staff member with the role **Driver**, and send them their login.
3. **Transport → Vehicles**: add each bus with its registration number, seats, driver and helper.
4. **Transport → Routes & stops**: open a route, choose its bus, add the stops in the order the bus reaches them
   in the morning with the pickup and drop times, and save. Then choose each student's stop in the list below.
   (A student is put on a route on their page: **Fees** tab → **Bus route**.)
5. Parents now see the bus card on their child's page. Drivers see **My bus** with their students and parents' phones.
6. **Transport → Fuel & service**: add each fuel fill with the odometer reading (for km per litre) and each repair.
   They are saved in **Expenses** under "Transport & fuel" and follow the approval rule.

## Switching on stock and sales (new in 0.11.0)

1. **Developer console**: switch on **Stock & sales counter**.
2. **Stock → Items**: add books, uniform items, stationery, cleaning and lab items. Count today's stock as you add each one.
   Turn on **Sold to students** and give the price for anything parents buy. Set an alert level for items you must not run out of.
3. **Stock → Book sets**: one set per class with its textbooks and notebooks, at the set price.
4. **Sales counter**: find the student, tap their class set (shown first) and any single items, choose cash or UPI, press **Receive**.
   The receipt opens as a PDF. Sales are paid at the counter; they are not added to fee dues.
5. New stock: open the item → **Stock in** (and save it as an expense if you paid for it). Items given to staff or classes: **Give out**.

Who can do what by default: the Accountant manages stock and sales and logs fuel; the Receptionist sells at the counter;
the Transport Manager manages vehicles, stops and the log; drivers see only their own bus.

## Switching on payroll (new in 0.10.0)

1. **Developer console**: switch on **HR**, **Payroll** and **Expenses**.
2. **Staff**: open each person, **HR details → Edit**, and fill in bank, account number and IFSC (needed for the bank list).
3. **Payroll → Pay items**: Basic pay is there already. Add what your school uses, for example DA (% of Basic),
   HRA (% of Basic), Conveyance (fixed), PF (12% of Basic, up to ₹1,800), ESI (0.75% of Gross), Professional tax (fixed ₹200),
   and Employer PF under "Paid by the school". Nothing is added for you: each school's rules differ.
4. **Payroll → Templates**: make one per type of post (e.g. High school teacher, Primary teacher, Office staff, Driver).
5. **Payroll → Staff salaries**: open each person, pick a template, change the amounts if needed, choose the start month, save.
6. **Payroll → Rules**: how loss-of-pay days are counted (days in the month, always 30, or school working days).
7. Every month: **Monthly payroll → Prepare** the month, type loss-of-pay days (or press *Fill loss-of-pay from attendance*),
   check the payslips, **Finalise and send payslips**, then **Mark salaries as paid** after the bank transfer.
   Staff see their payslip under **My payslips**.
8. **Leave → Balances & types**: check the leave types and days per year. Staff now choose a type when they apply.
9. **Expenses → Settings**: choose who must approve (no approval, above a limit, or every expense) and the categories.

Who can do what by default: the Accountant prepares payroll and records expenses; the HR Manager keeps HR details and salaries;
the Institution Admin finalises payroll; the Principal and Institution Admin approve expenses. There is no screen for changing roles yet; the developer can change it if your school works differently.

## New in 0.9.1

- **iPhone:** tapping a typing box no longer zooms the page in. Pinch-zoom still works on every phone.
- **Excel and PDF** buttons on Students, Staff, Attendance (month report and absentees), Leave, Exam results,
  Fee dues, Fee collection and Leaving students. Each person only gets the rows and details they can see on screen.
- **Fee reminder emails:** Fee dues → **Email reminders** → switch on, choose how many days before the due date
  and how often to repeat overdue reminders. Needs **School settings → Email sending (SMTP)**. Each row also has an
  **Email** button to send one reminder now. Parents without an email are listed so you can use WhatsApp instead.
- **Search engines:** `/robots.txt` and `/sitemap.xml` are created automatically from the published website.
  Set `APP_URL` to your real address on Hostinger so the sitemap uses it.

Also in 0.11.0: a student's Overview tab shows the school bus card instead of an old "coming soon" line.

Also fixed in 0.10.0: on/off switches showed the wrong position (an "off" switch could look on). They now show correctly.

## If something does not work

Run:
```
npm run doctor
```
It checks Node.js, the build, `.env`, the port, MySQL, the database and the website, and says what to fix.
If you still need help, send the doctor output and the last lines printed by `npm start`.

## Hostinger

Push the new code (or upload the zip). Hostinger runs `npm run build` and restarts the app by itself.
After it starts, open your domain: the website appears first; staff and parents log in at `/app/login`.
