var http = require("http");
var https = require("https");

function request(method, path, body, cookie) {
  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: "localhost",
      port: 3002,
      path: path,
      method: method,
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://localhost:3002"
      }
    };
    if (cookie) opts.headers["Cookie"] = cookie;
    if (body) opts.headers["Content-Length"] = Buffer.byteLength(JSON.stringify(body));

    var req = http.request(opts, function(res) {
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        var text = Buffer.concat(chunks).toString();
        var data;
        try { data = JSON.parse(text); } catch(e) { data = text; }
        var sc = res.headers["set-cookie"] || [];
        resolve({ status: res.statusCode, data: data, cookies: sc });
      });
    });
    req.on("error", function(e) { reject(e); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function getSessionCookie(cookies) {
  for (var idx = 0; idx < cookies.length; idx++) {
    if (cookies[idx].indexOf("session_token") >= 0) {
      return cookies[idx].split(";")[0];
    }
  }
  return null;
}

async function main() {
  var results = [];
  var pass = 0;
  var fail = 0;

  function check(name, condition) {
    if (condition) {
      console.log("  PASS: " + name);
      pass++;
    } else {
      console.log("  FAIL: " + name);
      fail++;
    }
    results.push({ name: name, passed: condition });
  }

  var ts = Date.now();
  var userA = { email: "usera_" + ts + "@test.com", password: "TestPass123!", name: "User A" };
  var userB = { email: "userb_" + ts + "@test.com", password: "TestPass123!", name: "User B" };

  console.log("\n=== Feature #8: User Data Isolation Between Accounts ===\n");

  // Step 1: Register two users
  console.log("Step 1: Register two separate user accounts");
  var regA = await request("POST", "/api/auth/sign-up/email", {
    email: userA.email, password: userA.password, name: userA.name
  });
  console.log("  User A registration: " + regA.status);
  var cookieA = getSessionCookie(regA.cookies);
  check("User A registered", regA.status === 200 || regA.status === 201);

  var regB = await request("POST", "/api/auth/sign-up/email", {
    email: userB.email, password: userB.password, name: userB.name
  });
  console.log("  User B registration: " + regB.status);
  var cookieB = getSessionCookie(regB.cookies);
  check("User B registered", regB.status === 200 || regB.status === 201);

  var finalCookieA = cookieA;
  var finalCookieB = cookieB;

  if (!finalCookieA) {
    console.log("  Logging in User A...");
    var loginA = await request("POST", "/api/auth/sign-in/email", {
      email: userA.email, password: userA.password
    });
    finalCookieA = getSessionCookie(loginA.cookies);
    check("User A logged in", loginA.status === 200 && !!finalCookieA);
  }

  if (!finalCookieB) {
    console.log("  Logging in User B...");
    var loginB = await request("POST", "/api/auth/sign-in/email", {
      email: userB.email, password: userB.password
    });
    finalCookieB = getSessionCookie(loginB.cookies);
    check("User B logged in", loginB.status === 200 && !!finalCookieB);
  }

  console.log("  Cookie A: " + (finalCookieA ? "present" : "MISSING"));
  console.log("  Cookie B: " + (finalCookieB ? "present" : "MISSING"));

  if (!finalCookieA || !finalCookieB) {
    console.log("ERROR: Cannot proceed without auth cookies");
    process.exit(1);
  }

  // Step 2: User A creates a session
  console.log("\nStep 2: User A creates session USER_A_PRIVATE_SESSION");
  var createA = await request("POST", "/api/sessions", {
    title: "USER_A_PRIVATE_SESSION", targetLanguage: "es"
  }, finalCookieA);
  console.log("  Create status: " + createA.status);
  var sessionAId = createA.data && createA.data.id;
  check("Session created by User A", createA.status === 201 && !!sessionAId);
  console.log("  Session ID: " + sessionAId);

  // Set User A settings
  console.log("  Setting User A settings...");
  var settingsA = await request("PATCH", "/api/settings", {
    defaultTargetLanguage: "fr", selectedMicrophoneId: "mic-user-a-device"
  }, finalCookieA);
  check("User A settings saved", settingsA.status === 200);

  // Step 3: User B gets sessions
  console.log("\nStep 3: User B gets their session list");
  var listB = await request("GET", "/api/sessions", null, finalCookieB);
  check("User B session list returns 200", listB.status === 200);
  var bSessions = Array.isArray(listB.data) ? listB.data : [];
  check("User B sees 0 sessions (not User A data)", bSessions.length === 0);

  var hasLeaked = false;
  for (var idx2 = 0; idx2 < bSessions.length; idx2++) {
    if (bSessions[idx2].title === "USER_A_PRIVATE_SESSION") hasLeaked = true;
  }
  check("USER_A_PRIVATE_SESSION NOT visible to User B", !hasLeaked);

  // Step 4: User B tries to GET User A session
  console.log("\nStep 4: User B tries GET /api/sessions/[session-a-id]");
  var getAbyB = await request("GET", "/api/sessions/" + sessionAId, null, finalCookieB);
  console.log("  Status: " + getAbyB.status);
  check("Cross-user session GET returns 404", getAbyB.status === 404);
  check("Response does not contain session title", !(getAbyB.data && getAbyB.data.title));

  // Step 5: User B tries to DELETE User A session
  console.log("\nStep 5: User B tries DELETE /api/sessions/[session-a-id]");
  var delAbyB = await request("DELETE", "/api/sessions/" + sessionAId, null, finalCookieB);
  console.log("  Status: " + delAbyB.status);
  check("Cross-user DELETE returns 404", delAbyB.status === 404);
  check("Deletion denied (response has error)", !!(delAbyB.data && delAbyB.data.error));

  // Step 6: User A session still exists
  console.log("\nStep 6: User A verifies their session still exists");
  var getA = await request("GET", "/api/sessions/" + sessionAId, null, finalCookieA);
  check("User A session still exists (200)", getA.status === 200);
  check("Session title is still USER_A_PRIVATE_SESSION", !!(getA.data && getA.data.title === "USER_A_PRIVATE_SESSION"));

  // Step 7: Settings isolation
  console.log("\nStep 7: Verify User B settings are separate from User A");
  var settingsB = await request("GET", "/api/settings", null, finalCookieB);
  check("User B settings returns 200", settingsB.status === 200);
  check("User B language is en (default)", !!(settingsB.data && settingsB.data.defaultTargetLanguage === "en"));
  check("User B mic is null (default)", !!(settingsB.data && settingsB.data.selectedMicrophoneId === null));

  // Verify User A settings unchanged
  var settingsACheck = await request("GET", "/api/settings", null, finalCookieA);
  check("User A language is fr", !!(settingsACheck.data && settingsACheck.data.defaultTargetLanguage === "fr"));
  check("User A mic is mic-user-a-device", !!(settingsACheck.data && settingsACheck.data.selectedMicrophoneId === "mic-user-a-device"));

  // User B sets different settings
  console.log("  Setting User B settings...");
  var setB = await request("PATCH", "/api/settings", {
    defaultTargetLanguage: "de", selectedMicrophoneId: "mic-user-b-device"
  }, finalCookieB);
  check("User B settings saved", setB.status === 200);

  // Re-check User A settings unaffected
  var settingsARecheck = await request("GET", "/api/settings", null, finalCookieA);
  check("User A language still fr after User B update", !!(settingsARecheck.data && settingsARecheck.data.defaultTargetLanguage === "fr"));
  check("User A mic still mic-user-a-device after User B update", !!(settingsARecheck.data && settingsARecheck.data.selectedMicrophoneId === "mic-user-a-device"));

  // Unauthenticated access tests
  console.log("\nStep 8: Unauthenticated access tests");
  var unauthList = await request("GET", "/api/sessions");
  check("Unauthenticated GET /api/sessions returns 401", unauthList.status === 401);

  var unauthGet = await request("GET", "/api/sessions/" + sessionAId);
  check("Unauthenticated GET /api/sessions/[id] returns 401", unauthGet.status === 401);

  var unauthDel = await request("DELETE", "/api/sessions/" + sessionAId);
  check("Unauthenticated DELETE /api/sessions/[id] returns 401", unauthDel.status === 401);

  var unauthSettings = await request("GET", "/api/settings");
  check("Unauthenticated GET /api/settings returns 401", unauthSettings.status === 401);

  var unauthPatchSettings = await request("PATCH", "/api/settings", { defaultTargetLanguage: "xx" });
  check("Unauthenticated PATCH /api/settings returns 401", unauthPatchSettings.status === 401);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS: " + pass + " passed, " + fail + " failed out of " + (pass + fail) + " checks");
  console.log("=".repeat(60));

  if (fail > 0) {
    console.log("\nFailed checks:");
    for (var j = 0; j < results.length; j++) {
      if (!results[j].passed) console.log("  FAIL: " + results[j].name);
    }
    process.exit(1);
  }
}

main().catch(function(err) {
  console.error("Test error:", err);
  process.exit(1);
});
