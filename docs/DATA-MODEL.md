# LOOPGRAM — Two content sources (status 2026-10-24)

Table `LoopgramContent`: PK (string) + SK (string). No GSIs. Everything below lives side by side.

| Item | PK | SK | source | Notes |
|---|---|---|---|---|
| View counter shards | `TITLE#<type>#<id>[#S1..9]` | `STATS` | — | existing, unchanged |
| TMDB saved answer (Source A) | `TMDB#<cacheKey>` | `RESPONSE` | `tmdb` | permanent, no TTL; detail items carry `tmdbType`/`tmdbId` |
| Owner post (Source B) | `OWNER#site` | `POST#<postId>` | `owner` | `status` DRAFT/PUBLISHED, `updatedBy`, `updatedAt` |

## Source A — TMDB
`tmdb()` → L1 → Redis → TMDB → validate (`validateTmdbBody`) → merge (`mergeCatalog`, never erases good fields,
`stripOwnerFields`) → DynamoDB. Reads fall back to DynamoDB when TMDB is off, revoked (401/403), rate-limited or down.

## Source B — Owner posts
Studio save → `requireOwner` → URL must map to `media/…` in R2 (`mediaKeyFromUrl`, no traversal) → R2 probe:
file must exist and its first bytes must be a real video/picture (`sniffMime`) → `publishGate` → DynamoDB write
→ Redis cache refresh → audit. Rejected posts are never saved or shown. Retries reuse the same post id (no duplicates).

## Not done yet (honest list)
- Scheduled bulk TMDB ingestion and Algolia indexing of owner posts.
- Server-side transcoding / thumbnail generation / malware scanning (needs a media-processing service — approval required).
- Video dimension checks are browser-side only.
- SQS + CloudWatch blocked by IAM permissions; Cloudflare token lacks zone access.
- No measured capacity. 3 billion users is a goal; staged load tests need your approval and a budget.
- Backups: turn on DynamoDB Point-in-Time Recovery in the AWS console (needs your approval).
