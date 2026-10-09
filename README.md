# 🔧 Mealie PowerTools

<a href="https://www.buymeacoffee.com/geekykid12" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-orange.png" alt="Buy Me A Coffee" style="height: 30px !important;width: 107px !important;" ></a>


A self-hosted admin dashboard for your [Mealie](https://github.com/mealie-recipes/mealie) recipe server. PowerTools gives you capabilities that go beyond Mealie's built-in UI — bulk operations, data quality auditing, full recipe editing, ingredient parser review, and server-wide admin controls.

## Features

| Section | What you can do |
|---|---|
| **Dashboard** | Live stats, quick navigation |
| **Recipes** | Search, full edit (ingredients, instructions, times, notes), delete, per-recipe ingredient parse |
| **Ingredient Parser** | Parse individual or multiple recipes with NLP, brute-force, or AI engines; review every recipe’s ingredient rows before saving, validate Foods and Units against Mealie, and create missing Foods or Units |
| **Bulk Operations** | Select multiple recipes, filter by name/tags/categories, view cookbook membership, assign or remove tags/categories, add recipes to cookbooks, or bulk-delete |
| **Tags & Categories** | Create, rename, delete — with usage counts and one-click "delete all unused" |
| **Cookbooks** | Create, delete, browse, and manually manage cookbook recipes; review AI cookbook suggestions before saving |
| **Data Quality** | Full audit: images, descriptions, ingredients, instructions, times, tags, parsed status, duplicates — with per-recipe and bulk auto-repair |
| **Image Manager** | Find recipes missing images, set images by URL or file upload |
| **Activity** | Recently added, modified, or cooked recipes |
| **Households** | View all households, manage members, create/edit/disable users per household |
| **Admin** | Create users, manage roles, trigger backups |

---

## Requirements

- Docker
- A running [Mealie](https://github.com/mealie-recipes/mealie) instance (v3.x)
- A Mealie API token (admin recommended for full access)

PowerTools supports Mealie v3.x API responses and publishes Docker images for
`linux/amd64` and `linux/arm64`.

---

## Installation

There are three ways to run PowerTools depending on your setup.

### Option 1 — Docker Run (simplest)

No compose file needed. Just pull and run:

```bash
docker run -d \
  --name mealie-powertools \
  --restart unless-stopped \
  -p 3000:3000 \
  ghcr.io/geekykid12/mealie-powertools:latest
```

Open `http://<your-server-ip>:3000` in your browser.

> This works regardless of how Mealie is running. PowerTools doesn't need to be on the same Docker network as Mealie — it proxies API calls server-side using whatever URL you enter in the connection screen.

---

### Option 2 — Docker Compose, attach to existing Mealie (recommended)

Use this if Mealie is already running. Putting PowerTools on the same Docker network as Mealie lets you use the internal container hostname instead of an IP address.

**1. Download the Compose file:**
```bash
curl -LO https://raw.githubusercontent.com/geekykid12/mealie-powertools/main/docker-compose.attach.yml
```

**2. Find your Mealie network name:**
```bash
docker inspect mealie --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'
```

**3. Edit `docker-compose.attach.yml`** — replace `mealie_default` with your network name (it appears twice in the file).

**4. Pull and start PowerTools:**
```bash
docker compose -f docker-compose.attach.yml pull
docker compose -f docker-compose.attach.yml up -d
```

PowerTools starts on port 3000. In the connection screen, use `http://mealie:9000/api` as the Mealie URL (internal hostname) or `http://<mealie-ip>:<port>/api` if you prefer the IP.

The existing-Mealie compose file expects the Mealie container network to be
attached externally. If your Mealie installation uses a different network name,
replace `mealie_default` in the downloaded file before starting it.

---

### Option 3 — Docker Compose, fresh install (Mealie + PowerTools together)

Use this if you don't have Mealie running yet and want to start both together.

```bash
curl -LO https://raw.githubusercontent.com/geekykid12/mealie-powertools/main/docker-compose.yml
docker pull ghcr.io/geekykid12/mealie-powertools:latest
docker compose up -d
```

Compose pulls the published PowerTools image from GHCR automatically. To force
an image refresh first, run `docker compose pull` before `docker compose up -d`.

This starts both Mealie (port 9000) and PowerTools (port 3000). Default Mealie login: `changeme@example.com` / `MyPassword`.

In the PowerTools connection screen, use `http://mealie:9000/api` as the Mealie URL.

The bundled Mealie service uses the default development credentials shown above.
Change them before using this setup for anything beyond local testing.

---

## Updating

```bash
docker pull ghcr.io/geekykid12/mealie-powertools:latest
docker compose up -d
```

For an existing-Mealie installation, run the same commands with
`-f docker-compose.attach.yml`.

Or for Docker Run:
```bash
docker pull ghcr.io/geekykid12/mealie-powertools:latest
docker stop mealie-powertools && docker rm mealie-powertools
docker run -d --name mealie-powertools --restart unless-stopped -p 3000:3000 \
  ghcr.io/geekykid12/mealie-powertools:latest
```

Versioned images are also available, for example:

```bash
docker pull ghcr.io/geekykid12/mealie-powertools:1.2.3
```

---

## Connecting to Mealie

1. Open PowerTools at `http://<your-server-ip>:3000`
2. Enter your Mealie URL — format: `http://<mealie-ip>:<port>/api`
   - Same Docker network: `http://mealie:9000/api`
   - Different machine or reverse proxy: `http://<mealie-host>:<port>/api`
3. Enter your Mealie API token
   - Generate one in Mealie → Profile → API Tokens
   - An admin token is recommended for full PowerTools access

> **How it works:** PowerTools runs a proxy server internally. Your browser talks to PowerTools on port 3000, and PowerTools forwards API calls to Mealie server-side. This means there are no CORS issues regardless of where each service is hosted, and you never need to expose the Mealie API port directly to your browser.

After a successful connection, the Mealie URL and API token are saved in the
browser so a page refresh can reconnect automatically. Use **Forget saved
credentials** in the sidebar to remove them. Credentials are stored locally in
the browser; use a browser profile you trust and avoid sharing its storage.

## Parser and AI settings

The parser engine is selected in **Admin** and applies to both individual and
bulk parsing. The available engines are NLP, Brute Force, and AI. Parsed results
are reviewed per recipe, with each ingredient shown as an editable row. Foods
and Units are matched against Mealie’s existing data; missing relations can be
created from the review screen before saving.

AI-powered cookbook, tag, and category suggestions use the provider settings in
**Admin**. Ollama and other slower providers are supported. The server-side AI
request timeout defaults to 10 minutes and can be overridden when starting the
container:

```bash
docker run -d --name mealie-powertools --restart unless-stopped \
  -p 3000:3000 -e AI_UPSTREAM_TIMEOUT_MS=900000 \
  ghcr.io/geekykid12/mealie-powertools:latest
```

---

## Tested With

- Mealie v3.x (tested with v3.27.0)
- Docker 24+
- Docker images: Linux AMD64 and ARM64

---

## License

MIT
