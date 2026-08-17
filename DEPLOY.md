# Deployment

Infra lives in [k8s-apps](https://github.com/rohitpotato/k8s-apps) —
ArgoCD-managed, GitOps. This repo produces images and pushes tag updates.

## Image flow

```
push to main
      │
      ▼
.github/workflows/docker.yml
   ├─ build + push ghcr.io/{repo}/api:sha-<sha>
   ├─ build + push ghcr.io/{repo}/worker:sha-<sha>
   └─ build + push ghcr.io/{repo}/web:sha-<sha>
      │
      ▼
   update-k8s-apps job (needs K8S_APPS_TOKEN secret)
   sed image tags in:
      backend/production/lens-backend/deployment.yaml       (api)
      backend/production/lens-consumer/deployment.yaml      (worker)
      frontend/production/lens/rollout.yaml                 (web)
   commit + push to k8s-apps main
      │
      ▼
   ArgoCD auto-sync → rollout
```

**Required GitHub secret:** `K8S_APPS_TOKEN` — fine-grained PAT with
`contents:write` on `rohitpotato/k8s-apps`.

## Frontend runtime config

The web image ships `/config.js` with default `API_BASE_URL='/api'` — used
by local dev via Vite's proxy. In k8s, a `ConfigMap` overrides that file
so the same image works across environments:

```yaml
# k8s-apps: frontend/production/lens/config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: lens-web-config
data:
  config.js: |
    window.__LENS_CONFIG__ = {
      API_BASE_URL: 'https://api.lens.example.com'
    };
```

Mount over the shipped default:

```yaml
# in the rollout template.spec
volumes:
  - name: web-config
    configMap:
      name: lens-web-config
containers:
  - name: web
    volumeMounts:
      - name: web-config
        mountPath: /usr/share/nginx/html/config.js
        subPath: config.js
```

The nginx.conf sets `Cache-Control: no-store` on `config.js` and
`index.html` so overrides take effect without a browser cache flush.
Other assets (Vite-hashed) can cache aggressively.

## Migrations — initContainer on api deployment

The api image ships `drizzle-kit` (via workspace devDeps). Run migrations
as an initContainer before the api container starts:

```yaml
# k8s-apps: backend/production/lens-backend/deployment.yaml
spec:
  template:
    spec:
      initContainers:
        - name: migrate
          image: ghcr.io/rohitpotato/lens/api:sha-<tag>
          command: ["pnpm", "--filter", "@lens/db", "db:migrate"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef: { name: lens-secrets, key: DATABASE_URL }
      containers:
        - name: api
          image: ghcr.io/rohitpotato/lens/api:sha-<tag>
          ...
```

`drizzle-kit migrate` checks the `__drizzle_migrations` table and applies
only what's new. Idempotent — safe to run on every pod startup. Ordering
guaranteed because Kubernetes runs initContainers sequentially before
containers.

`pnpm run db:migrate` uses `--env-file-if-exists` so it works in both
local dev (reads `.env`) and k8s (falls through to `process.env`).

## Required env for each service

**api + migrate initContainer:**
- `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`
- `API_PORT` (default 3001), `LOG_LEVEL`
- `LENS_UPLOADS_PER_HOUR_PER_IP` (default 30), `LENS_DAILY_COST_USD` (default 5)

**worker:**
- Same as api, plus `WORKER_NAME` and `METRICS_PORT` (default 9091)

**web:** none at container level — runtime config via ConfigMap.

Secrets should flow via **External Secrets Operator** from Vault
(k8s-apps has `eso-secrets/lens-secrets.yaml`).

## Ports each container listens on

| Container | App port | Metrics port | Purpose |
|---|---|---|---|
| api | 3001 | (same, `/metrics`) | HTTP API + Prometheus scrape |
| worker | — | 9091 | `/metrics` (and `/health`) |
| web | 3000 | — | nginx static SPA |

`ServiceMonitor` needed on `lens-backend` service (port 3001, path
`/metrics`) — the k8s-apps PR currently only has it on the frontend
service. Also needed on `lens-consumer` (port 9091).

## Storage — MinIO

k8s-apps pulls redis and postgres via helm charts. MinIO similarly:

```yaml
# k8s-apps: minio/production/values.yaml (helm chart bitnami/minio or minio/minio)
```

For the S3 client in api + worker, `S3_FORCE_PATH_STYLE=true` and
`S3_ENDPOINT` should point at the MinIO service DNS
(e.g. `http://minio.default.svc.cluster.local:9000`).

## What's in k8s-apps already (per PR 3)

- `backend/production/lens-backend/` — deployment, service, ingress
- `backend/production/lens-consumer/` — deployment
- `frontend/production/lens/` — rollout, service, http-route, gateway, service-monitor
- `argocd/apps/production/lens/{lens-backend,lens-consumer,lens-frontend}.yaml`
- `eso-secrets/lens-secrets.yaml`

## What's still needed in k8s-apps

- **MinIO** helm chart (this repo's api + worker use it for object storage)
- **`ConfigMap` for `config.js`** + `volumeMount` in the rollout (frontend
  runtime API base URL — see above)
- **`initContainer` for migrations** on `lens-backend/deployment.yaml`
  (see above)
- **`ServiceMonitor`** for `lens-backend` (port 3001, path `/metrics`) and
  `lens-consumer` (port 9091, path `/metrics`) — Prometheus scrape
- **Vault + ESO setup** for the secrets referenced by `lens-secrets.yaml`
  (user handling)
