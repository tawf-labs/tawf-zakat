import { crowdfundingPostgres } from "../crowdfunding-store";
import { registration, publicUser } from "../crowdfunding";
import { randomUUID } from "node:crypto";
import { campaignFileStoreFromEnv, externalizeCampaignFiles } from "../crowdfunding-documents";

const url = process.env.CROWDFUNDING_DATABASE_URL;
if (!url || process.env.NODE_ENV === "test") throw new Error("Explicit CROWDFUNDING_DATABASE_URL required outside tests");
const { sql, store } = crowdfundingPostgres(url);
try {
  const command = process.argv[2];
  if (command === "migrate") {
    await sql.unsafe(await Bun.file(new URL("../../migrations/crowdfunding.sql", import.meta.url)).text());
    console.log("Crowdfunding migration applied");
  } else if (command === "operator") {
    const input = registration.parse({ name: process.env.CROWDFUNDING_OPERATOR_NAME, email: process.env.CROWDFUNDING_OPERATOR_EMAIL, password: process.env.CROWDFUNDING_OPERATOR_PASSWORD, kind: "INDIVIDUAL" });
    const passwordHash = await Bun.password.hash(input.password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
    const user = await store.transaction(s => {
      if (Object.values(s.users).some(u => u.email === input.email)) throw new Error("Email already registered; existing accounts are never promoted by provisioning");
      const { password, ...fields } = input;
      const user = { ...fields, id: randomUUID(), passwordHash, role: "OPERATOR" };
      s.users[user.id] = user;
      return publicUser(user);
    });
    console.log(JSON.stringify(user));
  } else if (command === "externalize-files") {
    // Idempotent: moves ciphertext still held inline in the aggregate row into CAMPAIGN_FILE_DIR.
    const runtime = { files: campaignFileStoreFromEnv() };
    console.log(`Moved ${await store.transaction(s => externalizeCampaignFiles(runtime, s.campaigns))} file(s) out of the aggregate row`);
  } else throw new Error("Usage: crowdfunding-admin.ts migrate|operator|externalize-files");
} finally { await sql.end(); }
