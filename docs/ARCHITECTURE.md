# LOOPGRAM — Four Data Flows (audit + incremental migration)

Audited against the real code on 2026-10-13. Only existing services are used: TMDB v3, Upstash Redis (REST),
DynamoDB table `$DYNAMODB_TABLE_NAME`, Cloudflare R2 bucket `$R2_BUCKET_NAME` + `$R2_PUBLIC_URL`.

## Flow 1 — TMDB API (`src/lib/backend.server.ts › tmdb()`, `src/lib/tmdb-allowlist.ts`, `/api/tmdb/$`)
Existing: allowlisted paths/params (no SSRF, fixed origin api.themoviedb.org), server-only credentials,
L1 per-isolate cache (60s) → in-flight coalescing → Redis L2 (per-endpoint TTL) → TMDB, 3 bounded retries
honouring 429/Retry-After, 8s timeout, 7-day stale copy served on 429/5xx, CDN `s-maxage` + `stale-while-revalidate`.
Cache key = normalised path + sorted allowlisted query (language/region/page/append all included).
Added: cross-instance refresh lock (`lock:` SET NX 10s; losers serve the stale copy), 404 negative cache (5 min),
structured miss log.

## Flow 2 — Application API (`/api/content`)
Existing: stateless handlers, Zod validation, page ≤ 500, bounded results, request IDs, structured errors,
CDN cache headers, rate-limit check run in parallel with cached reads.
Added: per-class distributed limits (search 60/min, detail 90/min, lists 120/min, writes 60/min).
Bounded fan-out: `title` = 1 detail call (append) + 1 videos call + ≤10 YouTube oEmbed checks (cached).

## Flow 3 — Persistent DB (DynamoDB via `dynamo()`)
Existing: one `UpdateItem ADD` per title open, write-sharded over 10 keys (`TITLE#<type>#<id>` = shard 0, `…#S1..#S9`; total = sum), no scans on hot paths,
best-effort (failures never break the page). Redis `lg:popular` is a derived cache only.
Next steps:
rebuild `lg:popular` from DynamoDB via a background job, not in request paths.

## Flow 4 — Media/Storage (R2 + CDN, `/api/media/img`)
Existing: images mirrored once to R2 with immutable keys `tmdb/<size>/<file>` and `immutable` cache headers;
the app only returns a 302 to the R2 public/CDN URL (never proxies bytes). Default UI loads TMDB's CDN directly.
Playback: only TMDB-listed official YouTube videos, embeddability checked (`playback.server.ts`); no LOOPGRAM-hosted
full-length video exists, so none is shown.

## Decoupling
A normal page = client → `/api/content` → L1/Redis (TMDB only on miss). DynamoDB is touched only by the async
`track` POST; R2 only by the image route. No request chains all four.

## Not verifiable here
Real capacity numbers need load tests and production telemetry; none are claimed.
