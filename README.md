# WorkTime

WorkTime is a mobile-first work-time reporting application for workers and an accountant/admin.

## Stack

- React 19 + TypeScript + Vite
- Node.js + Express
- MongoDB + Mongoose
- bcryptjs for password/PIN verification
- Database-backed opaque session authentication
- Built-in OpenXML writer for real `.xlsx` exports (no spreadsheet runtime dependency)
- Vercel for hosting and serverless API deployment

## Production URLs

- Worker portal: `/worker`
- Accountant portal: `/admin`
- Root `/` redirects to `/worker`
- Unknown paths are handled by Vercel as real 404s.

## Official MongoDB database

The application now relies only on the database name inside `MONGODB_URI`.

Example:

```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER/worktimecluster?retryWrites=true&w=majority&appName=Cluster0
```

In this example, the selected database is `worktimecluster`.

If the Atlas cluster currently contains both `worktime` and `worktimecluster`, make sure the production `MONGODB_URI` points to the intended one before archiving or deleting the older database.

Expected collections:

- `admins`
- `workers`
- `sites`
- `entries`
- `sessions`

## Environment variables

```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER/worktimecluster?retryWrites=true&w=majority&appName=Cluster0
PIN_LOOKUP_SECRET=replace-with-a-long-random-secret
APP_TIMEZONE=Europe/Athens
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ChangeMe123!
```

`PIN_LOOKUP_SECRET` is required and must be at least 24 characters. Existing workers are migrated automatically on their first successful PIN login after this change.

## Initial admin bootstrap

On the first successful database connection:

1. If the `admins` collection already contains an admin, no bootstrap occurs.
2. If it is empty, the API reads `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
3. The password is hashed with bcrypt.
4. The admin is stored in MongoDB.
5. Future logins are verified against MongoDB, not directly against the environment password.

The initial password must be at least 10 characters.

## Authentication sessions

Authentication no longer uses JWTs. Login creates a cryptographically random opaque token. Only a SHA-256 hash of that token is stored in the `sessions` collection.

- Accountant sessions expire after 12 hours.
- Worker sessions expire after 30 days.
- MongoDB TTL cleanup removes expired session records.
- Logout revokes the current session.
- Old JWT-based sessions are intentionally invalid after this migration and users must sign in again.

## Worker authentication

Workers sign in with a numeric PIN.

- PIN length: 4–12 digits.
- The PIN itself is stored as a bcrypt hash.
- A deterministic HMAC key is stored separately for indexed lookup.
- Disabled workers cannot authenticate.

## Work-entry rules

A worker can create one entry per work date.

- Future dates are rejected.
- Previous dates are allowed.
- Previous-date submissions are marked `isLate=true`.
- `submittedAt` records the actual submission time.
- Sunday stores date + site only and records 0 hours.
- Time choices are restricted to 30-minute steps.

Current regular-hour windows:

- Monday–Friday: 08:00–16:00
- Saturday: 08:00–15:00
- Time outside the regular window is overtime.

The current data model allows only one entry per worker per date.

## Accountant permissions

The accountant can:

- Create/update/enable/disable workers.
- Change worker PINs.
- Create/update/enable/disable sites.
- View filtered timesheets.
- View regular/overtime totals.
- View hours grouped by worker.
- View late-submission counts and lists.
- Export filtered data as CSV or real XLSX.
- Add or edit an accountant note.

The accountant cannot edit worker-submitted date, site, start time, finish time, regular hours, or overtime hours.

## Reporting API

The accountant UI uses server-side filtering and pagination instead of loading thousands of rows into the browser.

Main endpoint:

```text
GET /api/admin/entries
```

Supported query parameters:

- `worker`
- `site`
- `date`
- `week` in `YYYY-Www` form
- `month` in `YYYY-MM` form
- `late=true`
- `page`
- `pageSize` (max 200)

The response contains:

- paginated items
- total row count
- page count
- total regular hours
- total overtime hours
- late count
- hours grouped by worker

Exports:

```text
GET /api/admin/entries/export?format=csv
GET /api/admin/entries/export?format=xlsx
```

Exports use the same filters as the report endpoint. A safety limit prevents exports above 50,000 rows without narrowing filters.

## Frontend structure

```text
src/
  App.tsx
  main.tsx
  api.ts
  i18n.ts
  types.ts
  components/
    Common.tsx
    EntriesTable.tsx
  pages/
    LoginPage.tsx
    WorkerPage.tsx
    AdminPage.tsx
  lib/
    date.ts
```

## Backend structure

```text
api/
  index.ts
  lib/
    auth.ts
    db.ts
    entries.ts
    errors.ts
    time.ts
```

`api/index.ts` stays the Vercel serverless entrypoint while reusable database, authentication, reporting, error, and time logic are separated into focused modules.

## PWA/cache maintenance

The previous service worker was removed during active development because stale cached application shells made mobile debugging and deployments harder to verify.

The web manifest remains and starts at `/worker`.

If offline support is added later, introduce a versioned cache strategy with explicit asset/runtime policies rather than restoring the old catch-all service worker.

## Build

```bash
npm install
npm run build
```

The build runs TypeScript checks for both frontend and API before Vite production bundling.

## Deployment checklist

Before every production deployment:

1. Confirm `MONGODB_URI` points to the correct Atlas cluster and database.
2. Confirm the database name in the URI is the intended production database.
3. Confirm `PIN_LOOKUP_SECRET` is at least 24 characters.
4. Confirm `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set for first bootstrap only.
5. Run `npm run build`.
6. Verify `/api/health` returns `database: "worktimecluster"`.
7. Test worker login at `/worker`.
8. Test accountant login at `/admin`.
9. Create a test entry and verify hours.
10. Test a late entry.
11. Test CSV and XLSX export.
12. Confirm unknown URLs return a real 404.

## Database maintenance checklist

Before deleting an old database:

1. Compare document counts for `admins`, `workers`, `sites`, and `entries`.
2. Export/backup the old database.
3. Verify production uses `worktimecluster`.
4. Verify worker and accountant logins against the production deployment.
5. Only then archive or delete the unused database.

## Known future maintenance

Not included in this maintenance pass:

- Login rate limiting.
- Admin password reset/change flow.
- Multi-site shifts in one day.
- Break/lunch deduction.
- Overnight shifts.
- HttpOnly-cookie authentication.
- Automated tests and CI.
