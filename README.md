# Dienstplan

Staff scheduling & attendance (check-in/out, approvals, complaints, Freiwunsch/Urlaub, hours).
Multi-tenant (`organizations`), React + Vite + TypeScript + React Router, Supabase as backend.

```
dienstplan/
├── frontend/              React + Vite app  -> deploy to Cloudflare Pages
│   ├── public/            sw.js (Web Push service worker), favicon.ico
│   └── src/
│       ├── lib/           supabase client, auth, i18n, shifts/hours logic
│       ├── components/    Layout, LoginOverlay, Modal, schedule/ (Rack, Month, popup)
│       ├── pages/         Dashboard, Schedule, Hours, Manager, Admin, History, Settings, ResetPassword
│       └── styles/        style.css, dienstplan.css (unchanged look)
└── backend/
    └── sql/schema.sql     table structure of the Supabase project (reference)
```

## Dev

```bash
cd frontend
cp .env.example .env     # fill in Supabase URL, anon key, VAPID public key
npm install
npm run dev
```

## Deploy (Cloudflare Pages)

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` |

Pages serves `index.html` for unknown paths (SPA) automatically, so React Router deep links work.

Supabase dashboard -> Authentication -> URL Configuration: add `https://<your-domain>/reset`
to Redirect URLs (the password-reset page moved from `reset.html` to `/reset`).

## Routes

`/` Dashboard · `/schedule` · `/hours` · `/manager` (manager+) · `/history` (manager+) · `/admin` (admin) · `/settings` · `/reset`
