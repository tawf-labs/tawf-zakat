# 03 — VPS Nginx & Docker Compose Deployment Setup

## Context
Deploying to a Linux VPS requires proper reverse proxy configuration with WebSocket HTTP/1.1 Upgrade headers and optional containerization for reproducible multi-service deployment.

## Dependencies
- 01 — Backend Bun + Hono WebSocket Server & Event Bus
- 02 — Frontend WebSocket Client Context & Cache Invalidation

## Acceptance criteria
- [ ] `deploy/nginx.conf` contains reverse proxy rules for `/api/`, `/ws`, and static frontend assets with `Upgrade $http_upgrade` and `Connection "Upgrade"`.
- [ ] `docker-compose.yml` and production `Dockerfile` configured for Bun runtime and frontend static serving.
- [ ] `deploy/README.md` provides clear step-by-step instructions for VPS setup.
- [ ] End-to-end verification passing.
