# Production deployment

Deploy source from Git. Upload `data/production-audio/` separately. Do not put secrets or WAV packages in Git.

## Server requirements

- Linux Ubuntu 22.04 or 24.04
- Node.js LTS (18+)
- 2 vCPU
- 2–4 GB RAM
- 20 GB SSD minimum

## Layout

```text
/opt/hs-audio-verify/
  source/                 # git clone
  data/
    production-audio/     # SCP / rsync only; not in Git
```

`source` comes from GitHub. `production-audio` never enters Git.

## First deploy

1. Clone (placeholder only):

```bash
git clone <REPOSITORY_URL>
cd hs-audio-verify
```

2. Install from the lockfile:

```bash
npm ci
```

3. Create env on the server only:

```bash
cp .env.example .env
```

Fill real Supabase values by hand. Never commit `SUPABASE_SERVICE_ROLE_KEY`.

4. Upload the local audio package to:

```text
data/production-audio/
```

5. Start:

```bash
NODE_ENV=production \
HS_AUDIO_SOURCE=production \
MINI_HOST=0.0.0.0 \
MINI_PORT=8767 \
npm run start:production
```

Optional checks:

```bash
npm run production:check-package
# after .env is filled on the server and exported into the process
npm run production:check-env
```

## Process manager

Use systemd later. Do not install a unit in this phase.

Example only:

```ini
[Unit]
Description=hs-audio-verify Mini
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/hs-audio-verify/source
Environment=NODE_ENV=production
Environment=HS_AUDIO_SOURCE=production
Environment=MINI_HOST=0.0.0.0
Environment=MINI_PORT=8767
EnvironmentFile=/opt/hs-audio-verify/source/.env
ExecStart=/usr/bin/npm run start:production
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Do not enable or start this unit until Phase 2.6+.
