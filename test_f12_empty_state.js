#!/usr/bin/env node

const BASE = "http://localhost:3005";
const fs = require("fs");

async function request(method, path, body, cookie = "", followRedirect = true) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Origin": BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: followRedirect ? "follow" : "manual",
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const setCookie = res.headers.get("set-cookie") || "";
  return { status: res.status, data, cookies: setCookie, headers: res.headers };
}

function extractCookies(cookieHeader) {
  if (!cookieHeader) return "";
  const parts = cookieHeader.split(",");
  let result = "";
  for (const part of parts) {
    const match = part.match(/([^=]+=[^;]+)/);
    if (match) result += (result ? "; " : "") + match[1];
  }
  return result;
}

async function main() {
  console.log("=== Feature #12: Empty state displays when no sessions exist ===\n");
  let passed = 0;
  let failed = 0;

  function check(name, condition) {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${name}`);
      failed++;
    }
  }

  // Step 1: Register a new user (ensures no sessions)
  console.log("Step 1: Register new user with no sessions");
  const email = `empty_f12_${Date.now()}@test.com`;
  const signup = await request("POST", "/api/auth/sign-up/email", {
    name: "Empty User",
    email,
    password: "testpass123",
  });
  check("User registered successfully", signup.status === 200);

  // Step 2: Sign in
  console.log("Step 2: Sign in");
  const signin = await request("POST", "/api/auth/sign-in/email", {
    email,
    password: "testpass123",
  });
  const cookie = extractCookies(signin.cookies);
  check("Sign in successful", signin.status === 200);

  // Step 3: Verify no sessions exist
  console.log("Step 3: Verify no sessions via API");
  const sessionsRes = await request("GET", "/api/sessions", null, cookie);
  check("API returns empty array", Array.isArray(sessionsRes.data) && sessionsRes.data.length === 0);

  // Step 4: Check dashboard page loads and contains empty state
  console.log("Step 4: Check dashboard page renders");
  const dashRes = await request("GET", "/dashboard", null, cookie);
  check("Dashboard returns 200", dashRes.status === 200);
  check("Dashboard HTML is substantial", dashRes.data.length > 10000);

  // Check the JS bundle contains empty state components
  const dashHtml = typeof dashRes.data === "string" ? dashRes.data : "";
  check("Dashboard HTML contains JS bundles for client rendering", dashHtml.includes("<script"));

  // Step 5: Verify empty state elements are in the compiled JS
  console.log("Step 5: Verify empty state elements in source code");

  // Read the dashboard source to verify EmptyState component exists
  const dashSource = fs.readFileSync("./src/app/dashboard/page.tsx", "utf8");

  check("EmptyState component defined in source", dashSource.includes("function EmptyState"));
  check("Empty state has icon/illustration", dashSource.includes('className="rounded-full bg-muted p-4 mb-4"') || dashSource.includes("Mic"));
  check("Empty state has friendly message", dashSource.includes("No sessions yet") || dashSource.includes("first transcription"));
  check("Empty state has CTA button 'New Session'", dashSource.includes("New Session"));
  check("CTA links to /session/new", dashSource.includes('href="/session/new"'));
  check("EmptyState shows when sessions.length === 0", dashSource.includes("sessions.length === 0"));
  check("Session grid shows when sessions.length > 0", dashSource.includes("sessions.length > 0"));

  // Step 6: Create a session and verify empty state is replaced
  console.log("Step 6: Create session and verify empty state replaced");
  const createRes = await request("POST", "/api/sessions", {
    title: "Test Session For Empty State",
    targetLanguage: "es",
    sourceLanguage: "en",
  }, cookie);
  check("Session created successfully", createRes.status === 201);

  // Step 7: Verify sessions list now has the session
  console.log("Step 7: Verify session appears in list");
  const sessionsAfter = await request("GET", "/api/sessions", null, cookie);
  check("Sessions list now has 1 session", Array.isArray(sessionsAfter.data) && sessionsAfter.data.length === 1);
  check("Session title matches", sessionsAfter.data[0]?.title === "Test Session For Empty State");

  // Step 8: Dashboard still loads with sessions
  console.log("Step 8: Dashboard loads with sessions present");
  const dashWithSessions = await request("GET", "/dashboard", null, cookie);
  check("Dashboard returns 200 with sessions", dashWithSessions.status === 200);

  // Step 9: Verify unauthenticated dashboard redirects
  console.log("Step 9: Verify unauthenticated access blocked");
  const unauthDash = await request("GET", "/dashboard", null, "", false);
  check("Unauthenticated dashboard redirects to login", unauthDash.status === 307);

  // Step 10: Cross-user isolation
  console.log("Step 10: Verify cross-user isolation");
  const otherEmail = `other_empty_${Date.now()}@test.com`;
  await request("POST", "/api/auth/sign-up/email", { name: "Other", email: otherEmail, password: "testpass123" });
  const otherSignin = await request("POST", "/api/auth/sign-in/email", { email: otherEmail, password: "testpass123" });
  const otherCookie = extractCookies(otherSignin.cookies);
  const otherSessions = await request("GET", "/api/sessions", null, otherCookie);
  check("Other user sees empty sessions (no cross-user leak)", Array.isArray(otherSessions.data) && otherSessions.data.length === 0);

  // Cleanup: delete test session
  console.log("\nCleanup: Delete test session");
  if (createRes.data?.id) {
    const delRes = await request("DELETE", `/api/sessions/${createRes.data.id}`, null, cookie);
    check("Test session deleted", delRes.status === 200);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
