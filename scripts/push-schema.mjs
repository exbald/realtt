import { execSync } from "child_process";

process.env.POSTGRES_URL = "postgresql://dev_user:dev_password@localhost:5432/postgres_dev";

console.log("Pushing schema to database...");
try {
  execSync("npx drizzle-kit push", {
    stdio: "inherit",
    env: process.env,
  });
  console.log("\nSchema push completed successfully!");
} catch (e) {
  console.error("Schema push failed:", e.message);
  process.exit(1);
}
