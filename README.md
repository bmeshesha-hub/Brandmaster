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

### Supabase Corporate GitHub login

When Vercel provides `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, the hosted app requires an approved Corporate GitHub identity before rendering Brandmaster. Static offline and GitHub Pages builds without those variables keep the local-profile workflow.

Install the access-control migration and configure the Corporate GitHub custom OAuth provider by following [`supabase/README.md`](supabase/README.md). The migration enables Row Level Security, seeds `bmeshesha` as the first administrator, and separates authentication (a valid Corporate GitHub account) from authorization (an active row in `brandmaster_allowed_users`). Never expose Supabase secret/service-role keys or the Corporate GitHub Client Secret through a `NEXT_PUBLIC_` variable.

## Private GitHub collaboration

Brandmaster can synchronize directly with the private Corporate GitHub repository `bmeshesha/Brandmaster-data`; GitHub Desktop is not required. `brandmaster/workspace.json` is a lightweight `brandmaster.workspace-manifest.v1` manifest. The complete workspace is stored in deterministic, sub-megabyte files under `brandmaster/workspace-data/`: reference tables, UBQ index, validation settings, imports, decisions, and Root changes.

1. Give each collaborator access to `Brandmaster-data`.
2. Create a short-lived repository token. Prefer a fine-grained token limited to `Brandmaster-data` with **Contents: read and write**. A classic `repo` token also works but has broader access.
3. In Brandmaster, open **Validation modules → Shared GitHub workspace**, paste the token, and click **Connect Corporate GitHub**.
4. Connect once. Brandmaster saves the token in that browser, validates it after every restart, and immediately loads the shared workspace. Invalid or expired saved tokens are silently removed.
5. Work normally. Local edits are pushed after a short debounce, a full pull/merge/push runs every 45 seconds, and synchronization pauses while offline. **Sync & Pull now** remains available as a fallback.

The token is stored in localStorage on that browser so Team Sync survives refreshes; it is never written to IndexedDB, the workspace file, an export, or either repository. Disconnect removes it. The last synchronized revision and baseline are stored locally so Brandmaster can three-way merge concurrent changes. One overlap guard serializes manual, debounced, queue, cleanup, reconnect, and 45-second sync attempts.

Each successful write adds `sync.lastSyncedAt`, `sync.lastSyncedBy`, and a rolling 25-entry activity history to the manifest. Brandmaster creates Git blobs and a tree, then advances `main` with one atomic commit. Unchanged chunk SHAs are reused, so Git stores only changed workspace chunks.

### Optional automatic sync service

The `sync-service/` directory remains available for a future approved internal deployment. It would allow GitHub App sign-in without asking users for repository tokens.

To enable it in the future, register a Corporate GitHub App, deploy the service to an approved HTTPS host, configure `.env` from `sync-service/environment.template`, and grant the app Contents read/write access only to the private data repository. The template deliberately does not use the `.env.example` filename so frontend deployment tools do not mistake this optional service configuration for required Brandmaster web-app variables.

Run the service locally:

```bash
cd sync-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp environment.template .env
uvicorn app.main:app --reload --port 8080
```

For local HTTP development only, set `COOKIE_SECURE=false` and include `http://localhost:3000` in `ALLOWED_ORIGINS`. Production must use HTTPS and secure cookies. The GitHub-repository backend keeps authenticated sessions in memory. NuKV mode uses a signed, HTTP-only identity session that survives service restarts and never stores the user OAuth token in NuKV.

### NuKV team workspace

Brandmaster includes a production-oriented NuKV storage path for live team
collaboration. NuKV replaces the private data repository as storage; Corporate
GitHub remains the user identity provider. Users click **Sign in with Corporate
GitHub** and never create or paste a repository token.

```text
GitHub Pages or internal web host
  -> sync-service (Corporate GitHub OAuth and authorization)
  -> nukv-service (private RaptorIO gateway)
  -> DUKES / NuKV
```

The NuKV gateway is in [`nukv-service/`](nukv-service/README.md). It stores compressed
workspace revisions in immutable chunks and advances a small head key with NuKV CAS.
If two people save the same starting revision, only the first head update succeeds;
the second user pulls and merges. Reads use strong consistency and records do not
expire.

To activate NuKV mode:

1. Provision a persistent NuKV keyspace and Fount logical cache name.
2. Deploy `nukv-service` to RaptorIO with its service identity and approved secret.
3. Deploy `sync-service` with `STORAGE_BACKEND=nukv`, the gateway URL/secret, a random
   `SESSION_SECRET`, and the existing Corporate GitHub OAuth client settings.
4. Build Brandmaster with `NEXT_PUBLIC_SYNC_SERVICE_URL=https://<sync-api-host>` and
   `NEXT_PUBLIC_TEAM_SYNC_MODE=nukv`.
5. Add the final Brandmaster origin to `ALLOWED_ORIGINS` and the Sync API callback URL
   to the `brandmaster-sync` Corporate GitHub App.

When both NuKV environment variables are present, **Data Sources & Setup** displays the
Shared NuKV workspace instead of the personal-token GitHub panel. Queue claims,
cleanup confirmations, manual Sync & Pull, attribution, and update notifications use
the service. Without that environment variable, offline and repository-token modes
continue to work.

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
