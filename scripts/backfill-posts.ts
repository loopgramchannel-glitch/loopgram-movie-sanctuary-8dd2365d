// One-time, non-destructive: copy owner posts from Redis into DynamoDB (skips any that already exist).
// `bun scripts/backfill-posts.ts`
import { redis, dynamo } from "../src/lib/backend.server";
import { Posts } from "../src/lib/posts";

const raw = (await redis(["GET", "site:posts"])) as string | null;
const list = raw ? Posts.parse(JSON.parse(raw)) : [];
let added = 0, skipped = 0;
for (const p of list) {
  try {
    await dynamo("PutItem", {
      TableName: process.env["DYNAMODB_TABLE_NAME"],
      Item: {
        PK: { S: "OWNER#site" }, SK: { S: `POST#${p.id}` }, source: { S: "owner" },
        status: { S: p.published ? "PUBLISHED" : "DRAFT" }, body: { S: JSON.stringify(p) },
        updatedAt: { N: String(Date.now()) }, updatedBy: { S: "backfill" },
      },
      ConditionExpression: "attribute_not_exists(PK)",
    });
    added++;
  } catch (e) { if (String(e).includes("ConditionalCheckFailed")) skipped++; else throw e; }
}
console.log(`posts in Redis: ${list.length}, copied: ${added}, already saved: ${skipped}`);
