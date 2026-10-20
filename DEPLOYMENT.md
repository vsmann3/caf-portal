# CAF Portal — Git, Staging & Deployment

## Git workflow (recommended)

Use protected branches:
- `dev` — active development (push features here)
- `staging` — tested features for QA on your staging server
- `main` (or `production`) — live production

Suggested flow:
1. Create feature branch from `dev`: `git checkout -b feature/your-feature dev`
2. Commit & push to your private repo
3. Merge to `dev` via PR
4. Promote `dev` -> `staging` for testing
5. After QA, promote `staging` -> `main` to deploy to live

## Push to your private GitHub repo

If Git is installed locally:
```bash
cd caf-portal
git init
git add .
git commit -m "Initial CAF portal"
git branch -M main
git remote add origin https://github.com/<your-org>/<your-repo>.git
git push -u origin main
git branch -M dev 2>/dev/null || git checkout -b dev
git push -u origin dev
git checkout -b staging
git push -u origin staging
git checkout dev
```

## Staging environment (separate server + DB)

Deploy a second instance on a different server/VM:
- Use a different `.env` (separate `DATABASE_URL`, `AUTH_SECRET`)
- Run with `docker compose up -d --build`
- Use a staging domain (e.g. `staging.caf.yourisp.com`) behind reverse proxy with SSL
- Keep staging DB isolated from production

## Production deployment

Deploy from `main` branch on your live server with production `.env`. Use backups before migrations.

## White-labeling (custom domains)

1. Super Admin → **Admin → Branding**
2. Select company, set **Domain** (e.g. `my.infolinkbroadband.com`)
3. Point DNS (A/CNAME) to your app server
4. Configure reverse proxy (Nginx/Traefik) to forward all hostnames to the app
5. Add branding (logo/colors). The app resolves tenant by `Host` header.

## RADIUS integration (IconWaveTech/JazzNetwork)

- Configure in **Admin → RADIUS Sync** (Super Admin only)
- On **CAF approval**, the app creates a `RadiusSync` record with payload (CAF, addresses, plan, ID, etc.) and attempts to push via pluggable adapter
- Payload is logged; real HTTP calls can be implemented once API docs are shared
- Queue/retry can be extended later
