# ZK Sharia Coordinator - Deployment Guide

This guide covers deploying the ZK Sharia Council coordinator using Docker. The coordinator can be hosted on any server that supports Docker - including VPS providers, cloud platforms, or bare metal servers.

---

## Prerequisites

- Docker installed (20.10+)
- Docker Compose installed (2.0+)
- Basic Linux server administration knowledge
- Ethereum Sepolia RPC endpoint
- A server with at least 1GB RAM

---

## Quick Start (Docker Compose)

### 1. Prepare the Environment

```bash
cd sc/offchain-coordinator

# Copy the environment template
cp .env.example .env

# Edit .env with your values
nano .env
```

Required environment variables:
```bash
# Blockchain Configuration
RPC_URL=https://ethereum-sepolia.publicnode.com
PRIVATE_KEY=your_wallet_private_key_here
DAO_CONTRACT_ADDRESS=0x86ceb44b46681a22ba32f8e8b4c10e50eeb50df6

# Coordinator Configuration
PORT=3000
SHARIA_QUORUM=3
AUTO_PUBLISH=false
```

### 2. Prepare Circuit Files

Create a `circuits` directory and add your circuit files:

```bash
mkdir -p circuits

# Copy your circuit files to this directory:
# - ShariaVoteAggregator.wasm
# - sharia_0000.zkey
# - verification_key.json
```

See [Circuit Compilation](#circuit-compilation) below for instructions on building circuits.

### 3. Start the Service

```bash
# Build and start with Docker Compose
docker-compose up -d

# Check logs
docker-compose logs -f

# Check health
curl http://localhost:3000/health
```

### 4. Stop the Service

```bash
docker-compose down
```

---

## Bare Docker Deployment

If you prefer not to use Docker Compose:

### Build the Image

```bash
cd sc/offchain-coordinator
docker build -t sharia-zk-coordinator .
```

### Run the Container

```bash
docker run -d \
  --name sharia-zk-coordinator \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v "$(pwd)/circuits:/app/circuits:ro" \
  -v "$(pwd)/data:/app/data" \
  sharia-zk-coordinator
```

### Useful Commands

```bash
# View logs
docker logs -f sharia-zk-coordinator

# Restart container
docker restart sharia-zk-coordinator

# Stop container
docker stop sharia-zk-coordinator

# Remove container
docker rm sharia-zk-coordinator

# Execute commands inside container
docker exec -it sharia-zk-coordinator sh
```

---

## Production Server Setup

For a production deployment on a Linux VPS, follow these steps:

### 1. Server Requirements

- Ubuntu 20.04+ or Debian 11+ recommended
- At least 1GB RAM, 2GB recommended
- 10GB disk space
- Docker and Docker Compose installed

### 2. Install Docker

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Add user to docker group (optional, to run docker without sudo)
sudo usermod -aG docker $USER
newgrp docker
```

### 3. Deploy the Application

```bash
# Clone or copy your project files
cd /opt
git clone <your-repo> zkt-hackathon
cd zkt-hackathon/sc/offchain-coordinator

# Configure environment
cp .env.example .env
nano .env

# Create circuits directory
mkdir -p circuits data
# Copy your circuit files to circuits/

# Start with Docker Compose
docker compose up -d
```

### 4. Set Up nginx Reverse Proxy (Recommended)

For HTTPS and proper domain hosting:

```bash
# Install nginx
sudo apt install nginx certbot python3-certbot-nginx -y

# Create nginx config
sudo nano /etc/nginx/sites-available/sharia-coordinator
```

Add this configuration (replace `your-domain.com`):

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site and get SSL certificate:

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/sharia-coordinator /etc/nginx/sites-enabled/

# Test nginx config
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx

# Get SSL certificate with Let's Encrypt
sudo certbot --nginx -d your-domain.com
```

### 5. Optional: Systemd Service

If you want to manage the container with systemd instead of Docker Compose:

Create `/etc/systemd/system/sharia-coordinator.service`:

```ini
[Unit]
Description=ZK Sharia Coordinator
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/zkt-hackathon/sc/offchain-coordinator
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable sharia-coordinator
sudo systemctl start sharia-coordinator

# Check status
sudo systemctl status sharia-coordinator
```

---

## Circuit File Management

There are three ways to provide circuit files to the coordinator:

### Option 1: Volume Mount (Recommended)

Mount your local `circuits` directory to the container. This is the default in docker-compose.yml:

```yaml
volumes:
  - ./circuits:/app/circuits:ro
```

**Pros**: Easy to update files, keeps image small
**Cons**: Must maintain files separately

### Option 2: Build Into Image

Uncomment the COPY lines in Dockerfile to include circuits in the image:

```dockerfile
COPY circuits/ShariaVoteAggregator.wasm /app/circuits/
COPY circuits/sharia_0000.zkey /app/circuits/
COPY circuits/verification_key.json /app/circuits/
```

**Pros**: Self-contained image, easier deployment
**Cons**: Larger image size, harder to update circuits

### Option 3: Download on Startup (Advanced)

Create an entrypoint script that downloads circuits from IPFS or a URL on container start.

---

## Circuit Compilation

If you need to compile the circuits from source:

```bash
# Navigate to circuits directory
cd circuits

# Install dependencies
npm install

# Compile circuits
npm run build

# Copy files to coordinator directory
cp build/ShariaVoteAggregator_js/ShariaVoteAggregator.wasm ../offchain-coordinator/circuits/
cp build/sharia_0000.zkey ../offchain-coordinator/circuits/
cp build/verification_key.json ../offchain-coordinator/circuits/
```

---

## Verification

### Health Check

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": 1738080000000,
  "uptime": 60,
  "environment": "production",
  "memory": { "rss": 134217728, "heapTotal": 10485760 },
  "council": {
    "root": "0x...",
    "memberCount": 0
  },
  "coordinator": {
    "quorum": 3,
    "autoPublish": false
  }
}
```

### View Logs

```bash
# Docker Compose
docker-compose logs -f

# Bare Docker
docker logs -f sharia-zk-coordinator
```

---

## Security Considerations

### Private Key Storage

- Store private keys in environment variables only
- Never commit `.env` files to version control
- Use a separate wallet for coordinator (not your main wallet)
- Consider using a secrets manager for production (AWS KMS, HashiCorp Vault)

### Access Control

- Use firewall rules to restrict access to port 3000
- nginx reverse proxy provides HTTPS and basic protection
- Consider adding authentication middleware for the API

### Updates

- Regularly update the base Docker image (`docker pull node:20-alpine`)
- Rebuild and redeploy when updating the application

---

## Setup Supabase

### Create Project

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Note your project URL and anon/service keys

### Run Migration

**Option A: Using Supabase CLI**
```bash
# Install Supabase CLI
npm install -g supabase

# Link to project
supabase link --project-ref YOUR_PROJECT_ID

# Run migrations
supabase db push
```

**Option B: Manual SQL**
In Supabase dashboard → SQL Editor, run the contents of:
`supabase/migrations/001_council.sql`

### Insert Council Members

```sql
-- Insert council members
INSERT INTO council_members (address, name, email, is_active)
VALUES
  ('0x1234...', 'Council Member 1', 'member1@example.com', true),
  ('0x5678...', 'Council Member 2', 'member2@example.com', true),
  ('0x9abc...', 'Council Member 3', 'member3@example.com', true);
```

### Deploy Supabase Edge Functions

```bash
cd supabase

# Deploy the vote function
supabase functions deploy vote --no-verify-jwt
```

The function will be available at:
```
https://YOUR_PROJECT_ID.supabase.co/functions/vote
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend Layer                              │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────────┐  │
│  │   React/Web │────│  Supabase    │────│  Supabase Auth      │  │
│  │     UI      │    │  PostgreSQL  │    │  (Council Members)  │  │
│  └─────────────┘    └──────┬───────┘    └─────────────────────┘  │
│                            │                                       │
└────────────────────────────┼───────────────────────────────────────┘
                             │ Votes (via API)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Docker Service Layer                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Docker Container (coordinator)                   │  │
│  │  ┌────────────────┐  ┌───────────────┐  ┌─────────────────┐ │  │
│  │  │ Vote Aggregator│  │ Proof Generator│  │  Private Keys   │ │  │
│  │  │   (LevelDB)    │  │   (snarkjs)   │  │   (env vars)    │ │  │
│  │  └────────────────┘  └───────┬───────┘  └─────────────────┘ │  │
│  └───────────────────────────────────┼──────────────────────────┘  │
└──────────────────────────────────────┼───────────────────────────────┘
                                       │ Proof Submission
                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Blockchain Layer                             │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    ZKTCore (Ethereum Sepolia)                      │  │
│  │  submitShariaReviewProof() → verifyAndValidate()              │  │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Cost Estimates

| Service | Monthly Cost |
|---------|--------------|
| VPS (DigitalOcean, Linode, Hetzner) | $5-20 |
| Supabase Pro | $25/month (or free tier for dev) |
| Alchemy RPC | Free tier |
| Domain Name | ~$10/year |
| **Total** | ~$30-45/month |

---

## Troubleshooting

### Service Not Starting

```bash
# Check logs
docker-compose logs -f

# Verify environment file
cat .env

# Check if ports are in use
sudo netstat -tlnp | grep 3000
```

### Proof Generation Failing

- Check circuit files are accessible
- Verify WASM and zkey paths in environment variables
- Check memory allocation (minimum 512MB recommended)

### Database Connection Issues

- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` in .env
- Check RLS policies allow access
- Test connection: `curl https://your-project.supabase.co`

### Container Keeps Restarting

```bash
# Check logs for errors
docker logs sharia-zk-coordinator

# Check resource usage
docker stats

# Inspect container
docker inspect sharia-zk-coordinator
```

---

## Deployment Script

A helper script is provided to simplify deployment:

```bash
chmod +x deploy.sh
./deploy.sh
```

This will guide you through:
- Building the Docker image
- Testing locally
- Deployment options

---

## References

- [Docker Documentation](https://docs.docker.com)
- [Docker Compose Documentation](https://docs.docker.com/compose)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Ethereum Sepolia Faucet](https://sepoliafaucet.com)
