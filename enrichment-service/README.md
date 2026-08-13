# Brandmaster local enrichment service

This service is intentionally separate from the Brandmaster team workspace. It
stores jobs and review candidates under `enrichment-service/data/` and never
writes `brandmaster-data` or the team queue automatically.

The service is the backend for the local Brand enrichment page. It processes a
Root CSV in bounded batches and produces evidence-backed spelling and alias
recommendations for review.
