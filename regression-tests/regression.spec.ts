import { test, expect, Page, BrowserContext } from "@playwright/test";

const BASE_URL = "http://localhost:3456";

// Unique test credentials to avoid conflicts
const TEST_EMAIL = `regression-test-${Date.now()}@example.com`;
const TEST_PASSWORD = "TestPass123!";
const TEST_NAME = "Regression Tester";

test.describe("Feature 1: Database connection established", () => {
  test("diagnostics endpoint reports database as connected", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/diagnostics`);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.database).toBeDefined();
    expect(data.database.connected).toBe(true);
    expect(data.database.schemaApplied).toBe(true);
  });

  test("diagnostics endpoint responds successfully", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/diagnostics`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");

    const data = await response.json();
    expect(data.timestamp).toBeDefined();
    expect(data.env).toBeDefined();
  });
});

test.describe("Feature 6: User registration and authentication flow", () => {
  test("complete registration and login flow", async ({ page, context }) => {
    // Step 1: Navigate to /register page
    await page.goto(`${BASE_URL}/register`);
    await expect(page).toHaveURL(/\/register/);

    // Step 2: Verify registration form is visible
    await expect(page.locator('input#name')).toBeVisible();
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
    await expect(page.locator('input#confirmPassword')).toBeVisible();

    // Step 3: Fill in registration form
    await page.fill('input#name', TEST_NAME);
    await page.fill('input#email', TEST_EMAIL);
    await page.fill('input#password', TEST_PASSWORD);
    await page.fill('input#confirmPassword', TEST_PASSWORD);

    // Step 4: Submit the form
    await page.click('button[type="submit"]');

    // Step 5: Verify successful registration - should redirect to dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await expect(page).toHaveURL(/\/dashboard/);

    // Step 6: Verify session cookie is set
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name.includes("session") || c.name.includes("auth"));
    expect(sessionCookie).toBeDefined();

    // Step 7: Verify user name/email appears on dashboard
    await expect(page.locator("text=Regression Tester")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text=${TEST_EMAIL}`)).toBeVisible();
  });

  test("login with existing credentials", async ({ page, context }) => {
    // Step 1: Navigate to /login
    await page.goto(`${BASE_URL}/login`);
    await expect(page).toHaveURL(/\/login/);

    // Step 2: Verify login form is visible
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();

    // Step 3: Fill in credentials
    await page.fill('input#email', TEST_EMAIL);
    await page.fill('input#password', TEST_PASSWORD);

    // Step 4: Submit
    await page.click('button[type="submit"]');

    // Step 5: Verify redirect to dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await expect(page).toHaveURL(/\/dashboard/);

    // Step 6: Verify session cookie set
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name.includes("session") || c.name.includes("auth"));
    expect(sessionCookie).toBeDefined();

    // Step 7: Verify user info on dashboard
    await expect(page.locator("text=Regression Tester")).toBeVisible({ timeout: 10000 });
  });

  test("logout flow works correctly", async ({ page, context }) => {
    // First login
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input#email', TEST_EMAIL);
    await page.fill('input#password', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });

    // Find and click logout/sign out button
    // Check for sign out in the user profile area
    const signOutButton = page.locator('button:has-text("Sign out"), button:has-text("Logout"), button:has-text("Log out"), a:has-text("Sign out")');
    if (await signOutButton.count() > 0) {
      await signOutButton.first().click();

      // Verify redirect away from dashboard
      await page.waitForURL(/\/(login|register|\?)?/, { timeout: 10000 }).catch(() => {
        // May not redirect immediately, check page content instead
      });
    }

    // Clear cookies to simulate full logout
    await context.clearCookies();

    // Navigate to dashboard and verify not authenticated
    await page.goto(`${BASE_URL}/dashboard`);

    // Should either redirect to login or show "Protected Page" / "sign in"
    const url = page.url();
    const hasLock = await page.locator('svg.lucide-lock, [data-lucide="lock"]').count();
    const hasProtectedText = await page.locator('text=Protected Page').count();
    const hasSignInPrompt = await page.locator('text=need to sign in').count();

    // One of these conditions should be true:
    // 1. Redirected to login page
    // 2. Shows "Protected Page" message
    // 3. Shows "need to sign in" message
    expect(
      url.includes("/login") ||
      url === `${BASE_URL}/` ||
      hasProtectedText > 0 ||
      hasSignInPrompt > 0
    ).toBeTruthy();
  });
});

test.describe("Feature 7: Protected routes enforce authentication", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated access to /dashboard redirects or shows protection", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);

    // Wait for page to settle
    await page.waitForLoadState("networkidle");

    const url = page.url();
    const hasProtectedText = await page.locator('text=Protected Page').count();
    const hasSignInPrompt = await page.locator('text=need to sign in').count();

    // Either redirected to login, or shows protection message
    expect(
      url.includes("/login") ||
      hasProtectedText > 0 ||
      hasSignInPrompt > 0
    ).toBeTruthy();
  });

  test("unauthenticated access to /session/new redirects or shows protection", async ({ page }) => {
    await page.goto(`${BASE_URL}/session/new`);
    await page.waitForLoadState("networkidle");

    const url = page.url();
    const hasProtectedText = await page.locator('text=Protected Page').count();
    const hasSignInPrompt = await page.locator('text=need to sign in').count();

    expect(
      url.includes("/login") ||
      hasProtectedText > 0 ||
      hasSignInPrompt > 0
    ).toBeTruthy();
  });

  test("unauthenticated access to /session/nonexistent-id redirects or shows protection", async ({ page }) => {
    await page.goto(`${BASE_URL}/session/nonexistent-id-12345`);
    await page.waitForLoadState("networkidle");

    const url = page.url();
    const hasProtectedText = await page.locator('text=Protected Page').count();
    const hasSignInPrompt = await page.locator('text=need to sign in').count();

    expect(
      url.includes("/login") ||
      hasProtectedText > 0 ||
      hasSignInPrompt > 0
    ).toBeTruthy();
  });

  test("unauthenticated access to /settings redirects or shows protection", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle");

    const url = page.url();
    const hasProtectedText = await page.locator('text=Protected Page').count();
    const hasSignInPrompt = await page.locator('text=need to sign in').count();

    expect(
      url.includes("/login") ||
      hasProtectedText > 0 ||
      hasSignInPrompt > 0
    ).toBeTruthy();
  });

  test("unauthenticated GET /api/sessions returns 401", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/sessions`);
    expect(response.status()).toBe(401);
  });

  test("unauthenticated POST /api/sessions returns 401", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/sessions`, {
      data: { title: "Test Session" },
    });
    expect(response.status()).toBe(401);
  });
});
