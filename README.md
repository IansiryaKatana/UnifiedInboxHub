# Unified Inbox Hub

Unified Inbox Hub is a production-focused email operations workspace for managing multiple inboxes from one web interface.

## What It Does

- Connects and syncs Gmail and custom domain accounts.
- Organizes conversations by account, folder, and thread context.
- Supports authentication, account management, and connector-based inbox workflows.
- Uses Supabase for auth, database operations, and serverless functions.

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend services: Supabase (Postgres, Auth, Edge Functions)
- UI foundation: Radix UI and utility-first component patterns

## Local Development

1. Install dependencies:
   - `npm install`
2. Start the app:
   - `npm run dev`
3. Build for production:
   - `npm run build`
4. Run tests:
   - `npm run test`

## Required Environment Variables

At minimum, configure:

- Supabase client keys used by the frontend.
- Connector keys used by edge functions (for example `CONNECTOR_GATEWAY_URL`, `CONNECTOR_GATEWAY_TOKEN`, and `GOOGLE_MAIL_API_KEY`).

## Project Notes

- This codebase is actively aligned to live Supabase data and real CRUD flows.
- Keep schema migrations in `supabase/migrations` and function changes in `supabase/functions`.
