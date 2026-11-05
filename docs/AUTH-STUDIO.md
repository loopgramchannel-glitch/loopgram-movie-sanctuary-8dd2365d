# Login & Studio

## Environment variables (placeholders only)
Public (safe in browser, served by getPublicConfig): GOOGLE_API_KEY (Firebase web key), FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_STORAGE_BUCKET
Secret (server only): FIREBASE_CLIENT_EMAIL=<sa@project.iam.gserviceaccount.com>, FIREBASE_PRIVATE_KEY=<-----BEGIN PRIVATE KEY-----...>, OWNER_UID=<uid>, plus existing AWS_*, R2_*, UPSTASH_*, ALGOLIA_ADMIN_API_KEY, TMDB_*, TURNSTILE_SECRET_KEY, CLOUDFLARE_API_TOKEN.

## Owner role
Owner = OWNER_UID, or a Firebase custom claim `{"role":"owner"}` set by a trusted admin script (Identity Toolkit `accounts:update` with `customAttributes`). Sign-up never sets roles. Studio cannot disable the owner.

## Firebase console checklist
- Authentication → Sign-in method: Email/Password ON (verified working).
- Authentication → Settings → Authorized domains: add the published domain + custom domain.
- Google Cloud → APIs → Credentials: restrict the web API key to your domains and to Identity Toolkit.
- Enable email enumeration protection.

## Secret rotation (required — keys were shared in chat)
Rotate in this order, then update each value in Lovable → Project Settings → Secrets and re-open Studio → Integrations & Health to confirm green:
1. Firebase service account key (GCP → IAM → Service accounts → Keys: add new, delete old)
2. AWS secret key (IAM → user → security credentials) — scope to SQS queue, DynamoDB table, CloudWatch log group only
3. R2 keys, Cloudflare API token, Turnstile secret
4. Algolia admin key, Upstash token, TMDB token

## Capacity (not validated)
3 billion logins/sec is ~6 TB/s of traffic; Firebase Auth default quotas are far below that (Identity Platform raises them, beyond ~thousands/sec needs a Google quota request). Logins go browser → Firebase directly, so this app adds no hop; Studio checks add one Identity Toolkit lookup per owner request.
Load-test plan: synthetic endpoint first, then 1 → 10 → 100 logins/sec against a staging Firebase project with a budget alert and abort at >1% errors or p95 > 1.5s. Nothing has been load-tested yet.
