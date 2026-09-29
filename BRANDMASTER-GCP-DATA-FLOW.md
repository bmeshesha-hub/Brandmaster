# Brandmaster GCP Data Usage and Flow

## Purpose

This document describes the proposed use of GCP BigQuery as the shared data store and transformation layer for Brandmaster data. Brandmaster is the initial source. The design can later support additional approved data sources and reporting consumers.

This is a target design for the GCP onboarding request, not a statement that the GCP integration is already implemented. The current Brandmaster repository describes browser/local storage, GitHub workspace synchronization, and a staging application; it does not document a production BigQuery connection. The ingestion method, GCP project, datasets, identities, network path, and security controls must be confirmed with GCP Admin, Cloud Security, and the application/data owners.

## Use case

Brandmaster collects, validates, reviews, and distributes brand data. The proposed GCP environment will receive approved Brandmaster output, retain it in BigQuery, and use BigQuery SQL or other approved BigQuery capabilities to validate, normalize, join, and prepare reporting datasets. Looker and other approved reporting tools will query curated BigQuery datasets for dashboards and analysis.

Brandmaster is the first data source. Additional approved applications or data feeds may be onboarded later after ownership, data classification, access, and governance are reviewed.

## High-level architecture

```text
Brandmaster
    │ approved export or service integration (to be selected)
    ▼
GCP ingestion boundary
    │ authenticated, least-privilege service identity
    ▼
BigQuery raw dataset
    │ SQL transformations, validation, and scheduled/manual jobs
    ▼
BigQuery curated dataset / reporting views
    │ authorized views or dataset-level access
    ▼
Looker and other approved reporting tools

Future approved sources ──► same reviewed ingestion and data governance path
```

BigQuery is the system of record for the GCP copy of the data. Brandmaster remains the originating application and source for its operational workflow unless the application owners define otherwise.

## Data flow

1. **Prepare and approve the source data.** Brandmaster produces brand data or an agreed export. The application and data owners identify which fields are needed for reporting and confirm classification, permitted use, and any exclusions.
2. **Ingest into GCP.** An approved integration transfers the data to the GCP project. Options may include a scheduled file export to Cloud Storage followed by a BigQuery load, or an authenticated service/API integration. GCP Admin and Security should select the supported pattern. Do not place credentials in browser code or public repositories.
3. **Land source data in BigQuery.** Load the received data into a restricted raw dataset. Preserve source identifiers and useful ingestion metadata (for example, source name and ingestion timestamp). Define whether each load is a full snapshot or incremental update, how duplicate records are handled, and how failed loads are retried.
4. **Validate and transform in BigQuery.** Use BigQuery SQL, scheduled queries, or an approved orchestration tool to check required fields and types, normalize values, identify duplicates or invalid records, and produce stable reporting tables or views. Keep source/raw data separate from transformed outputs so results can be traced and transformations can be rerun.
5. **Publish curated data.** Write validated results to a curated dataset. Expose only the columns and rows needed by reporting through curated tables or authorized views. Document field definitions, refresh timing, and known data limitations.
6. **Report.** Looker and other approved reporting tools query the curated dataset using approved identities and least-privilege permissions. Users should not receive broad raw-dataset access by default.
7. **Monitor and improve.** Monitor load and transformation success, data freshness, query cost, and access. Notify the owning team of failures and define a process to correct and replay data.

## Proposed BigQuery organization

Use separate datasets to control access and clarify lifecycle. Names below are illustrative and should follow company naming standards.

| Dataset (example) | Purpose | Typical access |
| --- | --- | --- |
| `brandmaster_raw` | Source-aligned ingested records and load metadata | Ingestion identity writes; data owners and approved engineers read |
| `brandmaster_curated` | Validated and transformed reporting tables | Transformation identity writes; analysts and reporting identities read as approved |
| `brandmaster_views` (optional) | Consumer-facing views with selected fields | Reporting identities query; underlying tables remain restricted |

The GCP team should confirm whether datasets should be separated by environment (for example, development/staging and production), project, or both. Start with non-production data and access until production use is explicitly approved.

## Data and transformation practices

- Agree on a schema and field definitions with the Brandmaster data owner before the first load.
- Include stable brand identifiers where available; define how updates, deletions, and merges are represented.
- Record ingestion time and source/version information to support lineage and troubleshooting.
- Make transformations repeatable and version controlled. Store SQL and deployment configuration in an approved repository.
- Validate row counts, required fields, uniqueness rules, and key relationships after each load.
- Define refresh frequency, late-arriving data behavior, retention, and recovery/replay procedure.
- Separate raw input from curated output; do not overwrite source data during transformation.
- Avoid exporting or exposing fields that reporting does not need.

## Access, security, and governance

- Use dedicated service identities for ingestion and transformation; grant only the permissions each job requires.
- Use individual or group-based access for human users. Avoid shared user credentials.
- Grant Looker/reporting identities query access to curated datasets or authorized views, not broad project administration or raw-data access by default.
- Apply the approved internal data classification and required controls, including audit logging and retention policies.
- Keep secrets in an approved secret-management service; never embed them in the Brandmaster frontend, source code, or reports.
- Confirm encryption, network connectivity, identity model, data residency, audit scope, and any cross-project access requirements with GCP Admin and Cloud Security.
- If data classification or the data fields change, reassess access and approval requirements before onboarding the change.

## Operations and ownership

| Area | Proposed responsibility |
| --- | --- |
| Brandmaster source, schema, and business meaning | Brandmaster application/data owner and McLaren Performance Team |
| GCP project, IAM, networking, and policy | Project admins with GCP Admin / platform teams |
| Ingestion and transformation jobs | Assigned application/data engineering owners |
| Curated data definitions and quality rules | Brand data owner with reporting stakeholders |
| Looker models, dashboards, and audience access | Reporting owners, coordinated with data owners |
| Cost, freshness, and job failure monitoring | Project/application owners, with platform guidance |

The named project admins and service owners should be confirmed before provisioning. Application ownership does not automatically imply GCP project administration.

## Initial rollout

1. Confirm business owner, GCP project admins, billing account, VPC, environment, and project name.
2. Confirm source fields, data classification, permitted reporting use, and whether the first rollout is staging/non-production.
3. Choose and approve the ingestion pattern and service identity.
4. Create the project resources and restricted raw/curated datasets.
5. Implement a small pilot load and BigQuery validation/transformation.
6. Review sample curated results with the data owner; verify access boundaries and data quality.
7. Connect Looker or another approved reporting tool to curated data and validate report access.
8. Define production readiness, refresh schedule, monitoring, retention, support, and cost expectations before any production data use.
9. Onboard further sources through the same review and approval process.

## Decisions to resolve with GCP onboarding

- Which GCP project/VPC and environment are appropriate for this use case?
- Which billing account will fund the project, and what monthly spend is expected?
- Is the initial GCP workload explicitly a pilot/non-production workload?
- What mechanism should Brandmaster use to deliver data (scheduled export, Cloud Storage landing, API/service integration, or another approved pattern)?
- Which BigQuery datasets, regions, retention rules, and refresh cadence are required?
- Which service identities and human groups need access, and who approves grants?
- Which Looker instance/project and reporting identity will query the curated data?
- What monitoring, alerting, cost controls, and operational support are required?
- Does any future source or dataset require additional review or a different classification?

## Current implementation status

The Brandmaster application repository currently documents local/browser storage, private GitHub workspace synchronization, and a staging application. It does not document an implemented BigQuery connector or GCP data pipeline. The flow above should therefore be treated as proposed architecture for review and planning. BigQuery ingestion, datasets, transformations, reporting access, and operational controls remain to be designed and implemented.
