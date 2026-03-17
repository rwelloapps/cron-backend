# Cron Service (Rwello Backend)

Scheduled jobs for mandates, subscriptions, billing, employee salary, and booking lifecycle (prepaid checks, slot expiry, no-show, auto-complete, settlement). All schedules use **Asia/Kolkata (IST)**.

## Requirements

- Node.js (same major as admin service)
- MongoDB (same instance as admin backend)
- `.env` in the **parent directory** (`Rwello Backend/.env`)

## Environment

The app loads `.env` from the parent folder: `require('path').join(__dirname, '..', '.env')`.

| Variable      | Description |
|---------------|-------------|
| `MONGODB_URL` | MongoDB connection string (required). Same as used by the admin service. |

## Run

From the **cron** directory:

```bash
npm install
npm start
```

Or:

```bash
node index.js
```

On success you should see:

- `MongoDB Connected`
- `[Cron] MongoDB ready, starting scheduler`
- `[Cron] Scheduler started (...)`

The process stays running and executes jobs on schedule.

## Schedule (IST)

| Job | Schedule | Description |
|-----|----------|-------------|
| Mandate check | 02:00 daily | Mandate checks |
| Subscription hold | 03:00 daily | Subscription hold processing |
| Billing cycle | 04:00 daily | Billing cycle payments |
| Employee salary | 05:00 daily | Employee salary processing |
| Subscription status sync | Every hour (:00) | Sync subscription status |
| Booking prepaid | Every minute | Confirm prepaid Razorpay payments for pending bookings |
| Slot block expiry | Every minute | Delete expired slot blocks |
| Booking no-show | Every 5 minutes | Mark no-shows, apply policy and refunds |
| Booking pending timeout | Every minute | Cancel pending-payment bookings after timeout |
| Booking auto-complete | Every minute | Mark in-progress bookings as completed after slot end + grace |
| Booking settlement | Every 5 minutes | Run wallet settlement for completed bookings |

## Project layout

- `index.js` – Loads env, waits for MongoDB, starts scheduler.
- `services/mongo_db.js` – MongoDB connection (uses same Mongoose as admin models).
- `services/bookingCronService.js` – Booking-related cron logic (prepaid, no-show, timeout, auto-complete, settlement, slot expiry).
- `jobs/*.js` – One file per job; each exports `run()`.

## Dependencies

- **admin** – Cron requires the `admin` service folder (same repo). It uses `admin/lib/cronMongoose.js` and `admin/models/*`, `admin/services/*`, etc., so the Mongoose instance that gets connected is the one used by admin models. Do not run the cron from a setup where the `admin` folder is missing or different.

## Stopping

Use `Ctrl+C`. The process closes the MongoDB connection and exits.
