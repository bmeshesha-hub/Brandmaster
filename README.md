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

The repository includes `.github/workflows/deploy-pages.yml`. Each push to `main` tests the app, builds it for the `/Brandmaster/` repository path, generates the full offline cache, and deploys the static files.

After the first push containing this workflow:

1. Open the repository on GitHub Enterprise.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Open **Actions** and select **Deploy Brandmaster to GitHub Pages** to monitor the deployment.

GitHub Pages availability depends on the corporate GitHub Enterprise configuration. The published site stores reference tables, decisions, and imports in each user's browser; repository visitors do not share this local data.

## Deploy to a web server

Deploy as a standard Next.js application on Vercel, a Node server, or a container. The current app intentionally keeps data per browser so the exact same build works offline and online.

For shared/team deployment, replace `lib/storage.ts` with authenticated API calls while preserving the `AppData` contract. Recommended server modules are PostgreSQL for durable data, FastAPI for enrichment jobs, object storage for source files, and a background worker for rate-limited marketplace verification. Secrets must stay on the server.

## Workflow and CSV formats

1. **Import:** upload a UBQ-derived CSV or paste one/many brand names. Real `draft_brand_...` IDs are carried through unchanged. For pasted names, load a full UBQ reference to resolve IDs automatically, or enter the correct ID during review.
2. **Process & review:** an animated run displays every enabled validation module. Confirm uncertain actions and edit UnmappedBrandID, TargetBrandID, TargetBrandName, evidence, or notes. The optional manual GPT-assist panel can copy uncertain names into an external GPT and accept pasted CREATE, SKIP, DELETE, and structured MERGE lists without an API key.
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
