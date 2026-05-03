const fs = require("fs");

var BASE = "http://localhost:3006";

function extractCookies(cookieHeader) {
  if (!cookieHeader) return "";
  var parts = cookieHeader.split(",");
  var result = "";
  for (var idx = 0; idx < parts.length; idx++) {
    var match = parts[idx].match(/([^=]+=[^;]+)/);
    if (match) result += (result ? "; " : "") + match[1];
  }
  return result;
}

async function request(method, path, body, cookie, noFollow) {
  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 30000);
  var opts = {
    method: method,
    headers: {
      "Content-Type": "application/json",
      "Origin": BASE,
    },
    redirect: noFollow ? "manual" : "follow",
    signal: controller.signal,
  };
  if (cookie) opts.headers.Cookie = cookie;
  if (body) opts.body = JSON.stringify(body);
  var res = await fetch(BASE + path, opts);
  var text = await res.text();
  var data;
  try { data = JSON.parse(text); } catch { data = text; }
  return {
    status: res.status,
    data: data,
    cookies: res.headers.get("set-cookie") || "",
  };
}

async function run() {
  var passed = 0;
  var failed = 0;

  function check(name, ok) {
    if (ok) { console.log("  ✅ " + name); passed++; }
    else { console.log("  ❌ " + name); failed++; }
  }

  console.log("=== Feature #12: Full verification ===\n");

  // Register user with no sessions
  var email = "fulltest12_" + Date.now() + "@test.com";
  var signup = await request("POST", "/api/auth/sign-up/email", { name: "Full Test", email: email, password: "testpass123" });
  check("1. Register new user", signup.status === 200);

  // Sign in
  var signin = await request("POST", "/api/auth/sign-in/email", { email: email, password: "testpass123" });
  var cookie = extractCookies(signin.cookies);
  check("2. Sign in", signin.status === 200);

  // Verify no sessions
  var sessions1 = await request("GET", "/api/sessions", null, cookie);
  check("3. No sessions initially", Array.isArray(sessions1.data) && sessions1.data.length === 0);

  // Dashboard returns 200
  var dash1 = await request("GET", "/dashboard", null, cookie);
  check("4. Dashboard page loads (200)", dash1.status === 200);

  // Unauthenticated redirect
  var unauth = await request("GET", "/dashboard", null, "", true);
  check("5. Unauthenticated redirect (307)", unauth.status === 307);

  // Source code verification
  var src = fs.readFileSync("./src/app/dashboard/page.tsx", "utf8");
  check("6. EmptyState component exists", src.includes("function EmptyState"));
  check("7. Has Mic icon illustration", src.includes("rounded-full bg-muted p-4 mb-4") && src.includes('className="h-8 w-8 text-muted-foreground"'));
  check("8. Has 'No sessions yet' message", src.includes("No sessions yet"));
  check("9. Has friendly description", src.includes("Create your first transcription session"));
  check("10. Has 'New Session' CTA button", src.includes("New Session"));
  check("11. CTA links to /session/new", src.includes('href="/session/new"'));
  check("12. EmptyState renders when sessions === 0", src.includes("sessions.length === 0"));
  check("13. Session grid renders when sessions > 0", src.includes("sessions.length > 0"));

  // Create a session
  var create = await request("POST", "/api/sessions", { title: "Test Session Empty State", targetLanguage: "es", sourceLanguage: "en" }, cookie);
  check("14. Create session", create.status === 201);

  // Verify session appears
  var sessions2 = await request("GET", "/api/sessions", null, cookie);
  check("15. Session now in list", sessions2.data.length === 1);
  check("16. Session title correct", sessions2.data[0].title === "Test Session Empty State");

  // Dashboard with sessions still works
  var dash2 = await request("GET", "/dashboard", null, cookie);
  check("17. Dashboard with sessions (200)", dash2.status === 200);

  // Delete session
  var del = await request("DELETE", "/api/sessions/" + create.data.id, null, cookie);
  check("18. Delete session", del.status === 200);

  // Verify back to empty
  var sessions3 = await request("GET", "/api/sessions", null, cookie);
  check("19. Back to empty after delete", sessions3.data.length === 0);

  // Cross-user isolation
  var otherEmail = "other12_" + Date.now() + "@test.com";
  await request("POST", "/api/auth/sign-up/email", { name: "Other", email: otherEmail, password: "testpass123" });
  var otherSignin = await request("POST", "/api/auth/sign-in/email", { email: otherEmail, password: "testpass123" });
  var otherCookie = extractCookies(otherSignin.cookies);
  var otherSessions = await request("GET", "/api/sessions", null, otherCookie);
  check("20. Other user sees empty sessions", otherSessions.data.length === 0);

  // No mock data patterns
  var mockHits = 0;
  var patterns = ["globalThis", "devStore", "mockDb", "fakeData", "isDevelopment"];
  var allFiles = [];
  function walk(dir) {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "test-results") continue;
      var p = dir + "/" + e.name;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) allFiles.push(p);
    }
  }
  walk("./src");
  for (var f of allFiles) {
    var content = fs.readFileSync(f, "utf8");
    for (var pat of patterns) {
      if (content.includes(pat)) { mockHits++; console.log("    MOCK HIT: " + pat + " in " + f); }
    }
  }
  check("21. No mock data patterns in src/", mockHits === 0);

  console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function(e) { console.error(e); process.exit(1); });
