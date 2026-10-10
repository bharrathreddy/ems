# Installation guide

The app is one Node.js program. It serves the screens and the API from the same address,
creates its own database tables when it starts, and works with **MariaDB (XAMPP)** and **MySQL 8 (Hostinger)**.

- Part A: run it on your computer with XAMPP
- Part B: put it live on Hostinger (Business or Cloud plan)
- Part C: updating, backups and problems

---

## Part A: Local setup with XAMPP (Windows)

### A1. Install

1. **XAMPP** from apachefriends.org (any 8.x version). It provides the database (MariaDB) and phpMyAdmin.
2. **Node.js 22 LTS** from nodejs.org. XAMPP does not include Node.js.
   After installing, open a new Command Prompt and check:
   ```
   node -v
   npm -v
   ```

### A2. Start the database

1. Open **XAMPP Control Panel**.
2. Click **Start** next to **MySQL** (it turns green). Also start **Apache** if you want phpMyAdmin.
3. Open http://localhost/phpmyadmin
4. Click **New**, enter database name `ems`, choose collation **utf8mb4_unicode_ci**, click **Create**.

You do not need to create any tables. The app creates them on first start.
(If the database does not exist, the app also tries to create it by itself.)

### A3. Set up the project

Unzip the project, e.g. to `C:\projects\ems`, then in Command Prompt:

```
cd C:\projects\ems
copy .env.example .env
npm install
```

Open `.env` in Notepad. For a default XAMPP install the database lines are already correct:

```
DB_HOST=localhost
DB_PORT=3306
DB_NAME=ems
DB_USER=root
DB_PASSWORD=
```

(If you set a root password in XAMPP, put it in `DB_PASSWORD`.)
Also set your school name and your developer login:

```
SEED_INSTITUTION_NAME=Sri Vidya High School
SEED_SUPERADMIN_EMAIL=you@example.com
SEED_SUPERADMIN_PASSWORD=YourPass@123
```

### A4. Run it

**For development** (screens reload as you edit code):

```
npm run dev
```

Open **http://localhost:5173/app/login** and sign in with your developer email and password. The school website is at **http://localhost:5173/**.

**To try the production version** (exactly what Hostinger will run):

```
npm run build
npm start
```

Open **http://localhost:3000** for the website and **http://localhost:3000/app** for the app.

On first start you will see `Migrations applied: ...`. In phpMyAdmin you can now see all the tables in `ems`.

### A5. Open it on your phone (same Wi-Fi)

1. Find your PC's IP: run `ipconfig` and look for **IPv4 Address**, e.g. `192.168.1.20`.
2. Run `npm run build` then `npm start`.
3. On the phone open `http://192.168.1.20:3000`. Allow Node.js through Windows Firewall if asked.

### A6. Run the automated tests (optional)

The tests create and delete databases whose names start with `ems_test`. With XAMPP's root user nothing extra is needed:

```
set TEST_DB_USER=root
set TEST_DB_PASSWORD=
npm test
```

You should see **198 passed**.

---

## Part B: Live on Hostinger

### What you need

- A **Business Web Hosting** or **Cloud** plan (Startup, Professional, Enterprise). These run Node.js apps from hPanel. Premium and Single plans cannot run Node.js.
- A domain or subdomain for the school, e.g. `office.srividya.edu.in`.
- Recommended: a free GitHub account, so every update is just a push.

### B1. Create the database

1. hPanel → **Websites** → your hosting → **Databases** → **MySQL Databases** (Management).
2. Create a database and user, e.g. database `u123456789_ems`, user `u123456789_ems`, with a strong password.
3. Note the **database name**, **username**, **password** and **host**. The host is shown on the same page; for apps on the same hosting it is usually `localhost`.

### B2. Put the code on GitHub (recommended)

1. Create a **private** repository on GitHub, e.g. `school-office`.
2. Upload the project. The included `.gitignore` already leaves out `node_modules`, `dist` and `.env`.
   **Never upload your `.env` file.**

(Alternative without GitHub: zip the project folder without `node_modules`, `dist` folders and `.env`, and use **Upload your files** in step B3.)

### B3. Create the Node.js app

1. hPanel → **Websites** → **Add Website** → **Node.js web app**.
2. Choose **Import Git repository**, connect GitHub, pick your repository.
   (Or **Upload your files** and upload the zip.)
3. Pick the domain or subdomain.
4. Deploy settings:

| Setting | Value |
|---|---|
| Framework preset | **Other** (if it suggests NestJS or Vite, change it to Other) |
| Branch | `main` |
| Node.js version | **22** |
| Package manager | **npm** |
| Build command | `npm run build` |
| Output directory | leave empty (if it is required, enter `.`) |
| Entry file | `server.js` |

5. **Environment variables**: click **Add** for each line below, or put them in a text file and use **Import .env**:

```
DB_HOST=localhost
DB_PORT=3306
DB_NAME=u123456789_ems
DB_USER=u123456789_ems
DB_PASSWORD=your-database-password
APP_URL=https://office.srividya.edu.in
JWT_ACCESS_SECRET=your-own-40-or-more-random-characters
AUTO_MIGRATE=true
SEED_INSTITUTION_NAME=Sri Vidya High School
SEED_SUPERADMIN_EMAIL=you@yourdomain.com
SEED_SUPERADMIN_PASSWORD=a-strong-password
```

   For `JWT_ACCESS_SECRET`, generate 40 to 64 random characters (any password generator). Never use an example value: the app refuses it
   and makes its own key instead. Secure cookies switch on by themselves because `APP_URL` starts with https. Do **not** set `PORT` (Hostinger provides it) and do **not** set `NODE_ENV`.

   Also add `STORAGE_DIR` pointing to a folder **outside** the app, e.g. `/home/u123456789/ems-storage`
   (your home path is shown in hPanel > Files > File Manager). Uploaded files are kept there, so
   redeploys do not delete them.

6. Click **Deploy**. The build takes a few minutes.

### B4. Check it

1. When the dashboard shows **Running**, open your domain: you see the school website.
2. Click **Login** (or open `/app/login`) and sign in with `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`.
3. If the page does not open, check **Runtime Logs** in the app dashboard. You should see
   `Migrations applied: ...` and `Ready on port ...`. The most common cause of errors is a wrong database variable.

HTTPS is provided by Hostinger. Turn on **Force HTTPS** for the domain if it is not already on.

### B5. First steps after going live

1. Sign in with the developer email. If you used a password from this guide, the app asks you to choose your own first.
2. **School settings**: details, colour, contact WhatsApp and email, then **Email sending (SMTP)**.
   Hostinger email works well: create a mailbox such as `office@yourschool.in` in hPanel and use
   host `smtp.hostinger.com`, port `465`, SSL on, the mailbox address and its password.
3. **Classes & years**: check the current year and add sections.
4. **Staff**: add staff and press **Send login details** to share on WhatsApp.
5. **Fees** (Release 2): sign in as the developer, open **Developer console**, and switch on **Fees** and
   **Payments & receipts**. Then open **Fee setup** and, in order: choose the default plan and save its due
   dates, enter the tuition fee for each class, add bus routes with their fee, and add one-time fees if any.
   If the school already collected fees this year before using the app, use **Bulk import → Opening fee balances**
   before collecting anything new.
7. **Website**: in **Website**, edit the home page sections (add real photos to the banner first), the About
   and Privacy pages, menus, events, gallery and videos. In **School settings** upload the logo and fill in address,
   phone, email and WhatsApp number. In **Website → Contact & social** paste the Google map and social links.
8. **HR, payroll and expenses**: see *Switching on payroll* in START-HERE.md.
9. **Transport, stock and the sales counter**: see *Switching on transport* and *Switching on stock and sales* in START-HERE.md.
6. **Teaching and timetable**: in **Classes & years** add subjects; in **Teaching grid** tick each class's subjects
   and choose the class teacher and subject teachers; in **Timetable → Bell schedules** create a schedule per group
   of classes, add periods and breaks, and tick the Saturdays that are off; then fill each section in **Timetable**.

---

## Part C: Updates, backups, problems

### Updating

- **GitHub deploy:** push to `main`. Hostinger rebuilds automatically. New database migrations run on start.
- **Zip deploy:** in the app dashboard, **Deployments** → **Redeploy** with the new zip.

Before a big update, back up the database first (below).

### Every year: year end

Only the Institution Admin (or the developer) sees **Academic → Year end**. From March onwards:
1. **Create the next academic year** (it stays "planned").
2. **Fee setup for next year**: press *Copy from this year*, then change what is different.
3. **Teaching grid** and **Bell schedules** for next year.
4. **Promote** each section. Everyone moves up by default; change only the exceptions. You can change decisions until the switch.
5. **Roll numbers** for the new sections.
6. On the first day of the new year, **Switch**. The old year becomes read-only; its unpaid fees can still be collected.

Back up the database before switching.

### Backups

- hPanel → **Files** → **Backups**: Hostinger takes automatic backups (frequency depends on plan).
- Before updates: hPanel → **Databases** → **phpMyAdmin** → select the database → **Export** → **Go**. Keep the `.sql` file somewhere safe.

### Rules for developers

- Database changes go in a **new** file in `apps/api/migrations/`, numbered next (e.g. `0003_students.sql`).
  Never edit a migration that has already run; the app refuses to start if one was changed.
- Write SQL that works on both MySQL 8 and MariaDB 10.4+ (collation `utf8mb4_unicode_ci`, no MySQL-only syntax).
  Read JSON columns with `readJson()`.

### Common problems

First run `npm run doctor`: it checks everything below and tells you what to fix.

| Problem | Fix |
|---|---|
| `Database is not configured` | `DB_NAME` and the other `DB_*` values are missing from `.env` (local) or hPanel environment variables. |
| `Access denied for user` | Wrong database user or password. On Hostinger, use the full prefixed names, e.g. `u123456789_ems`. |
| `connect ECONNREFUSED 127.0.0.1:3306` or `Startup failed:` with no message | XAMPP's MySQL is not started (green in the Control Panel). |
| Website says the server is an older version, or login works but the website does not | An older copy of the app is still running. Close its window or run `taskkill /F /IM node.exe`, then `npm run build` and `npm start`. |
| `Cannot find module './apps/api/dist/main.js'` | Run `npm run build` before `npm start`. |
| XAMPP MySQL will not start | Another MySQL is using port 3306. Stop it, or change XAMPP's port and `DB_PORT`. |
| `Database ... already contains tables that this app did not create` | Someone imported a .sql file manually, or the first start was interrupted. Create a new empty database and set `DB_NAME` to it. |
| `Migration ... was modified after it was applied` | An old migration file was edited. Restore it and put the change in a new numbered file. |
| Build fails on Hostinger | Open the failed deployment for logs. Check Node 22, build command `npm run build`, entry `server.js`, and that `NODE_ENV` is not set. |
| Site shows 403 after redeploy | Redeploy again; Hostinger regenerates its routing file. |
| Login works, but the page reloads to sign-in each time | Set `APP_URL` to your exact https address. |
| Everyone is signed out after each deploy | Set `JWT_ACCESS_SECRET` (40+ random characters) or `STORAGE_DIR` outside the app. |
