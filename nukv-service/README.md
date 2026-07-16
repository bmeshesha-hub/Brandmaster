# Brandmaster NuKV gateway

This RaptorIO service is the durable, collaborative storage layer for Brandmaster.
The browser never connects to NuKV directly. The supported flow is:

```text
Brandmaster UI -> Brandmaster Sync API -> this gateway -> DUKES -> NuKV
```

The gateway preserves the existing Brandmaster sync contract:

- `GET /brandmaster-sync/v1/workspace` returns the current workspace and revision.
- `PUT /brandmaster-sync/v1/workspace` accepts `{baseRevision, workspace, syncedBy}`.
- A stale `baseRevision` returns HTTP `409`, preventing one teammate from silently
  overwriting another.

## NuKV layout

NuKV is a key-value store, so the workspace is compressed and split into immutable
chunks. Only the small head record is updated in place.

```text
brandmaster:v1:workspace:head
brandmaster:v1:workspace:revision:<revision>:chunk:0000
brandmaster:v1:workspace:revision:<revision>:chunk:0001
...
```

The head contains the revision, chunk keys, checksum, byte counts, updater, and
timestamp. Saving writes all immutable chunks first and then uses NuKV CAS on the
head. Readers use strong consistency. Values never expire (`exp=0`) because this is
business data, not a cache. The current and immediately previous revision chunks are
retained so an in-flight reader can finish; older chunks are removed on the next
successful save. Chunks from a lost CAS race are removed immediately.

## Before deploying

1. Request a persistent NuKV keyspace and Fount logical cache name from the NuData
   team. Confirm production replication, backup/restore expectations, and retention.
2. Replace `brandmaster-nukv-logical-host` in `application.properties` with that
   Fount cache name through approved deployment configuration.
3. Put a random service-to-service secret in the approved secret store and expose it
   to both this gateway and the outer Sync API as `BRANDMASTER_GATEWAY_SECRET`.
4. Restrict network access so only the Sync API can call this service. Do not expose
   it directly to GitHub Pages or the public internet.
5. Configure the Raptor application identity files through the normal onboarding
   workflow. Do not copy the identity document from the NuKV sample application.

The supplied Maven project follows the official internal
`NuData/nukv-raptorio-svc-example`: it obtains a `CacheClient` for every operation,
always returns it to `CacheFactory`, uses `StringTranscoder`, and uses `gets`/`cas`
for conflict protection.

## Local verification

The corporate Raptor parent and DUKES dependencies require eBay Maven configuration
and a Java 17 runtime:

```bash
cd nukv-service
mvn test
```

The repository's regular `npm test` suite also tests the storage-independent sync
merge behavior. A real integration test requires a provisioned development NuKV
keyspace; NuKV is not available in Raptor L&P or Sandbox.
