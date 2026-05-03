const { chromium } = require("playwright");

(async function () {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  var ts = Date.now();
  var email = "btest_" + ts + "@test.com";
  var pass = "testpass123";

  // Sign up
  var signupRes = await page.request.post("http://localhost:3005/api/auth/sign-up/email", {
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3005" },
    data: JSON.stringify({ name: "Browser Test", email: email, password: pass }),
  });
  console.log("Signup:", signupRes.status());

  // Sign in
  var signinRes = await page.request.post("http://localhost:3005/api/auth/sign-in/email", {
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3005" },
    data: JSON.stringify({ email: email, password: pass }),
  });
  console.log("Signin:", signinRes.status());

  // Navigate to dashboard
  await page.goto("http://localhost:3005/dashboard", { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(3000);

  // Take screenshot
  await page.screenshot({ path: ".playwright/dashboard_empty.png", fullPage: true });
  console.log("Screenshot saved to .playwright/dashboard_empty.png");

  // Check for empty state elements
  var html = await page.content();

  console.log("Has 'No sessions yet':", html.includes("No sessions yet"));
  console.log("Has mic/icon area:", html.includes("rounded-full") && html.includes("muted"));
  console.log("Has 'New Session' button:", html.includes("New Session"));
  console.log("Has session/new link:", html.includes("session/new"));

  // Check no session cards
  var cardCount = await page.locator("a[href*='/session/']").count();
  console.log("Session cards count (should be 0):", cardCount);

  // Check for the empty state card (border-dashed is distinctive)
  var emptyCard = await page.locator(".border-dashed").count();
  console.log("Empty state card (border-dashed) found:", emptyCard > 0);

  // Click the New Session CTA button in empty state
  var ctaBtn = page.locator("a[href='/session/new']").first();
  if (await ctaBtn.isVisible()) {
    await ctaBtn.click();
    await page.waitForTimeout(2000);
    var url = page.url();
    console.log("After clicking CTA, URL:", url);
    console.log("Navigated to /session/new:", url.includes("/session/new"));
  } else {
    console.log("CTA button not visible");
  }

  // Check console errors
  var consoleErrors = [];
  page.on("console", function (msg) {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  await page.goto("http://localhost:3005/dashboard", { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log("Console errors:", consoleErrors.length === 0 ? "none" : consoleErrors);

  await browser.close();
  console.log("DONE");
})();
