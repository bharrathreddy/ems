# Security check (version 0.12.0)

A full pass over the app against this checklist: secrets, environment settings, admin routes, logins,
who can see what, form input and XSS, rate limits, API endpoints, CORS, security headers, debug output,
dependencies, exposed files, the database, password hashing and git history.

Each fix below has an automated test (`apps/api/test/r11-security.e2e-spec.ts`); all 167 tests pass.
No review can promise zero bugs, but nothing on the checklist is open on the app side.

## What was fixed

| # | Finding | Risk | Fix |
|---|---|---|---|
| 1 | The login signing key (`JWT_ACCESS_SECRET`) in `.env.example` is a public example. A copy that kept it would let anyone who knows it create a login as any user. | High | Example or short keys are refused. The app then makes its own random key once, keeps it in the storage folder (never in the code or the zip), and says so at start-up. `.env.example` now leaves the key empty. |
| 2 | The default developer password `ChangeMe@123` is printed in the guides and did not have to be changed. | High | Any developer login still using a password from the guides must choose a new one at the next sign-in, on new and existing installs. Well-known passwords are refused when choosing one. |
| 3 | Two libraries had published security advisories: Kysely (database) and Nodemailer (email); plus js-yaml and uuid (moderate). | High / moderate | Updated to fixed versions. `npm audit --omit=dev` (what the live app runs) now reports **0 vulnerabilities**. |
| 4 | Secure cookies needed `COOKIE_SECURE=true` to be set by hand. | Medium | Turned on automatically when `APP_URL` starts with `https://`. |
| 5 | Login tokens did not name their signing method, and a token's session was not checked against its user. | Low (defence in depth) | Tokens must use HS256; the session must belong to the same user. |
| 6 | Website links starting with `//` (for example `//evil.example`) were accepted as page paths and would open another site. | Low | Refused in the editor and in page text. |
| 7 | Email subjects were HTML-escaped (a name with `&` showed as `&amp;`) and could contain line breaks. | Low | Subjects are plain text on one line; email bodies stay escaped. |
| 8 | Missing `Permissions-Policy` header; `X-Powered-By: Express` revealed the server type. | Low | Header added (location for staff check-in only; no microphone, payment or USB); fingerprint removed. |
| 9 | An empty `apps/api/.env` file was included in the zip. | Low | Removed and excluded from packages. |

## What was checked and found sound

- **Secrets and git history.** No passwords or keys in the code or in any commit; `.env` is never committed or zipped.
  The saved email (SMTP) password is masked in the API and kept out of the audit log.
- **Admin routes.** Every API route needs a login unless it is deliberately public: sign-in, password reset,
  the public website, its images, and the version check. Developer tools are developer-only, and year end is for
  the Institution Admin only.
- **Logins.** Passwords are hashed with scrypt at OWASP's recommended strength. Accounts lock for 15 minutes after
  5 wrong passwords. Sign-in tokens last 15 minutes and are kept in memory, not in browser storage. Refresh tokens rotate,
  are httpOnly cookies, and reuse is detected. Reset links expire, work once, and sign the person out everywhere.
  Error messages never say whether an account exists.
- **Who sees what.** Permissions with scopes (own classes, own children, own payslips), field rules (teachers do not
  see parents' phone numbers), and module switches are checked on the server for every request, including exports.
- **Form input and XSS.** Every input is checked against a strict schema; unknown fields are dropped. The screens never
  insert raw HTML. Page text uses a safe formatter, links must be `https://` or a page path, and the map embed must
  be a Google Maps address. Uploads are checked by their real content and size, not by file name.
- **SQL injection.** Every database query uses bound parameters; no SQL is built from text.
- **Rate limits.** 300 requests a minute per address overall; sign-in 10, forgot-password 5, reset 10 and the
  website contact form 5 a minute (plus a hidden spam trap).
- **CORS.** Only the app's own address (`APP_URL`) may call the API from a browser.
- **Security headers.** Strict Content-Security-Policy (no outside scripts, no framing by other sites), HSTS,
  X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy.
- **Debug mode.** Errors never show stack traces or SQL to users; API docs are off unless `API_DOCS=true`.
- **Exposed files.** Only the built screens and public website images are served. `.env`, the storage folder,
  source code and private uploads (imports, bills, student photos) cannot be opened from the web.

## Still to do on your side

These live outside the app, so only you can do them:

1. **Hostinger environment variables.** Set `JWT_ACCESS_SECRET` to 40+ random characters, or set `STORAGE_DIR` to a
   folder outside the app so the app's own key survives redeploys. Otherwise everyone is signed out after each deploy.
2. **HTTPS.** Set `APP_URL=https://your-domain` and turn on **Force HTTPS** in hPanel.
3. **Database user.** On Hostinger use the database's own user with a long password, never a shared or root login.
   On your PC, XAMPP's `root` with no password is fine only while nobody else can reach that computer's port 3306.
4. **Accounts around the app.** Turn on two-step login for hPanel, GitHub and the school email account.
5. **Your GitHub repository.** I could only check the history in this workspace. On GitHub, open
   **Settings → Code security** and turn on **Secret scanning**, which checks your full history for leaked keys.
6. **Backups.** Export the database before each update (see INSTALL.md, Part C).

## Login as and the activity log (0.13.0)

- Only the developer login can use Login as or open the activity log; the server checks this on every request.
- A Login as session cannot start another one, cannot open another developer's login, and stops working at once if
  the developer's own login is turned off. It uses its own cookie, so the developer's own sign-in is never replaced.
- Every entry made through Login as stores both the person and the developer. Log entries are deleted after 2 years.

## Known limits

- There is no two-step login (one-time codes) inside the app yet.
- Someone who knows a staff member's email could lock that account for 15 minutes by typing wrong passwords. That is
  the usual trade-off for lockout; the login log records it.
- Build and test tools (Jest, the Nest command line) still have advisories in their own sub-packages. They are used
  only to build and test, never to serve the app.
