# Brandmaster

Brandmaster is a local-first preparation tool for **Bulk Upload Brand Mappings**. It uses the current UBQ export as the source of truth for unmapped IDs, validates a smaller brand worklist, routes uncertain decisions for review, and exports the exact five-column upload CSV. It does not replace the real bulk uploader.

The validation engine is modular and offline-first. Normalization is always enabled. Previous decisions, aliases, the existing brand table, ACA, FPA, and offline rules can be independently enabled or disabled. Online search and AI are not connected and never appear as completed validation work.

## Run on a Mac

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. After the first load, the service worker caches the application shell. Imports, review history, learned decisions, and exports are stored in the browser; no database or API key is required.

For a production-style local build:

```bash
npm run build
npm start
```

For a fully static local copy whose application files are pre-cached for offline use:

```bash
npm run build:offline
npm run start:offline
```

Open `http://localhost:3000`. Keep the Terminal window open while using the app. After the build is created, this local server and all brand validation features work without internet access.

## Deploy to GitHub Pages

The corporate repository does not currently have an Actions runner, so Pages is published from a static `gh-pages` branch at `/bmeshesha/Brandmaster/`. Build and publish it from the Mac with:

```bash
npm run deploy:pages
```

After the first publication:

1. Open the repository on GitHub Enterprise.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Select the `gh-pages` branch and `/(root)`, then save.

Run `npm run deploy:pages` again whenever a new version on `main` should be published.

### Public GitHub Pages

The public `github` remote uses the standard `/Brandmaster/` project path. Publish that site separately with:

```bash
npm run deploy:pages:public
```

In `bmeshesha-hub/Brandmaster`, set **Settings → Pages → Deploy from a branch** to `gh-pages` and `/(root)`. The public URL is `https://bmeshesha-hub.github.io/Brandmaster/`.

GitHub Pages availability depends on the corporate GitHub Enterprise configuration. The published site stores reference tables, decisions, and imports in each user's browser; repository visitors do not share this local data.

## Deploy to a web server

Deploy as a standard Next.js application on Vercel, a Node server, or a container. The current app intentionally keeps data per browser so the exact same build works offline and online.

For shared/team deployment, replace `lib/storage.ts` with authenticated API calls while preserving the `AppData` contract. Recommended server modules are PostgreSQL for durable data, FastAPI for enrichment jobs, object storage for source files, and a background worker for rate-limited marketplace verification. Secrets must stay on the server.

## Private GitHub collaboration

Brandmaster can synchronize directly with the private Corporate GitHub repository `bmeshesha/Brandmaster-data`; GitHub Desktop is not required. The shared `brandmaster/workspace.json` file uses the `brandmaster.workspace.v1` schema and contains the complete workspace: reference tables, UBQ index, validation settings, imports, decisions, and Root changes.

1. Give each collaborator access to `Brandmaster-data`.
2. Create a short-lived repository token. Prefer a fine-grained token limited to `Brandmaster-data` with **Contents: read and write**. A classic `repo` token also works but has broader access.
3. In Brandmaster, open **Validation modules → Shared GitHub workspace**, paste the token, and click **Connect Corporate GitHub**.
4. Click **Sync & Pull** before work. A new browser pulls the team file; if no team file exists, Brandmaster creates it from the current browser workspace.
5. Perform validation and review work, then click **Sync & Pull** again. Brandmaster performs a three-way incremental merge using the last synchronized baseline, retains unrelated teammate changes, and retries up to four times if GitHub changes during the update.

The token is held only in React memory and is forgotten on refresh; it is never stored in localStorage, IndexedDB, the workspace file, or the source repository. The last synchronized revision and baseline are stored locally so Brandmaster can merge concurrent changes. While connected, the app checks GitHub every 45 seconds on every page and shows an in-app notification when a newer team version is available.

Each successful write adds `sync.lastSyncedAt`, `sync.lastSyncedBy`, and a rolling 25-entry activity history to `workspace.json`. GitHub's Contents API requires the complete JSON document on each write, but Git records only the resulting incremental diff.

### Optional automatic sync service

The `sync-service/` directory remains available for a future approved internal deployment. It would allow GitHub App sign-in without asking users for repository tokens.

To enable it in the future, register a Corporate GitHub App, deploy the service to an approved HTTPS host, configure `.env` from `sync-service/.env.example`, and grant the app Contents read/write access only to the private data repository.

Run the service locally:

```bash
cd sync-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8080
```

For local HTTP development only, set `COOKIE_SECURE=false` and include `http://localhost:3000` in `ALLOWED_ORIGINS`. Production must use HTTPS and secure cookies. The starter service keeps authenticated sessions in memory, so users sign in again after a service restart; use an approved shared session store before scaling to multiple instances.

## Workflow and CSV formats

1. **Import:** upload a UBQ-derived CSV or paste one/many brand names. Real `draft_brand_...` IDs are carried through unchanged. For pasted names, load a full UBQ reference to resolve IDs automatically, or enter the correct ID during review.
2. **Process & review:** an animated run displays every enabled validation module. Confirm uncertain actions and edit UnmappedBrandID, TargetBrandID, TargetBrandName, evidence, or notes. **Check with AI validator** generates a complete external-validator prompt for the current batch. Paste or import the returned `brandmaster.ai-review.v1` JSON, validate and preview every decision, then apply the complete revision set with one click. MERGE IDs are rejected unless they already exist in the local canonical brand data.
3. **Bulk output CSV:** inspect the five-column preview, download the finished file, and upload it in the real **Bulk Upload Brand Mappings** tool.

## Validation order

The first decisive local result stops the pipeline:

1. Normalize brand (required)
2. Previous decisions
3. Alias table
4. Existing/root brand table
5. ACA brand table
6. FPA brand table
7. Offline rules

ACA and FPA reference CSVs can be loaded from **Validation modules** and are stored in IndexedDB in the current browser profile. Each recommendation records its winning module in the review table.

Supported reference schemas:

- Previous decisions: `listing_brand`, `action`, `merge_target`, `fpa_brand_id`. Decisions are indexed by normalized brand name and take priority over every lower validation module. Conflicting normalized decisions are excluded.
- Existing/root brand table: `aliases`, `id`, `name`, `status`. Only ACTIVE records are loaded. Its `brand_...` IDs are authoritative MERGE targets; BLOCKED records and non-ID `sameAs` text are not used as targets.
- ACA: `BrandID`, `BrandName`, with optional `SubBrandID` and `SubBrandName`. ACA codes confirm brand recognition but are never emitted as bulk MERGE target IDs.
- FPA: `aliases`, `id`, `name`. Rows are grouped by canonical `brand_...` ID and aliases are attached to that canonical brand. FPA IDs are used for MERGE output.

Google, marketplace, official-website, and OpenAI integrations are explicitly marked **Not connected**. They are disabled, make no requests, collect no keys, and are excluded from processing progress until real server connectors are implemented and tested.

Required columns (flexible spelling): `UnmappedBrandID`, `UnmappedBrandName`. Optional columns: `Listing Count`, `SKU Count`.

Exports always use:

```text
UnmappedBrandID,UnmappedBrandName,Action,TargetBrandID,TargetBrandName
```

## Verification

```bash
npm test
npm run lint
npm run build
```
