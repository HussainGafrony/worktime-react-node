# WorkTime

WorkTime is a small full-stack app for recording worker hours and managing them from an accountant/admin dashboard.

## Tech stack

- React + TypeScript + Vite
- Node.js + Express
- MongoDB + Mongoose
- bcryptjs
- ExcelJS
- Vercel

## Main pages

- Worker: `/worker`
- Admin: `/admin`
- Health check: `/api/health`

## Main features

### Worker

- Login with PIN
- Choose date and work site
- Enter start and finish time
- Submit older dates
- Future dates are blocked
- One entry per worker per day
- Sunday records date + site with 0 hours
- View recent entries

### Admin

- Login with email and password
- Create/edit/enable/disable workers
- Change worker PIN
- Create/edit/enable/disable sites
- View and filter timesheets
- Filter by worker, site, date, week, or month
- View regular and overtime totals
- View late submissions
- Edit accountant note only
- Export CSV
- Export Excel
- Optional demo-data button controlled by an environment variable

## Work-hour rules

- Monday-Friday regular hours: 08:00-16:00
- Saturday regular hours: 08:00-15:00
- Hours outside the regular period are overtime
- Sunday has 0 working hours

## Environment variables

```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER/worktimecluster?retryWrites=true&w=majority&appName=Cluster0
PIN_LOOKUP_SECRET=replace-with-a-long-random-secret
APP_TIMEZONE=Europe/Athens
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ChangeMe123!
VITE_ENABLE_SEED_DATA=false
```

`PIN_LOOKUP_SECRET` must be at least 24 characters.

Set:

```env
VITE_ENABLE_SEED_DATA=true
```

to show the demo-data icon in the admin dashboard. The backend checks the same flag before allowing demo data to be created.

## Authentication

The app stores login sessions in MongoDB.

- Admin session: 12 hours
- Worker session: 30 days
- Logout removes the current session
- Disabled users cannot keep using the app

Worker PINs and the admin password are stored as hashes.

## MongoDB collections

- `admins`
- `workers`
- `sites`
- `entries`
- `sessions`

The database name comes from `MONGODB_URI`.

## Project structure

```text
src/
  App.tsx
  api.ts
  i18n.ts
  types.ts
  components/
  lib/
  pages/

api/
  index.ts
  lib/
    auth.ts
    db.ts
    entries.ts
    errors.ts
    seed.ts
    time.ts
    xlsx.ts
```

The code is split by responsibility, but the flow stays simple:

1. React calls an API route.
2. Express validates the request.
3. Mongoose reads or writes MongoDB.
4. The API returns JSON to React.

## Build

```bash
npm install
npm run build
```

The build checks TypeScript for both frontend and backend, then creates the Vite production build.

## Quick test checklist

After deployment, test:

1. `/api/health`
2. Admin login
3. Worker login
4. Create worker
5. Create site
6. Submit a normal weekday entry
7. Submit an older entry and confirm it is late
8. Submit Sunday and confirm 0 hours
9. Confirm duplicate day is blocked
10. Check filters and pagination
11. Edit accountant note
12. Export CSV
13. Export Excel
14. Enable and test demo-data button if needed

## Current limits

The app intentionally keeps the business model simple:

- One work site per worker per day
- No lunch/break deduction
- No overnight shifts
- No admin password-reset screen
- No login rate limiting yet
