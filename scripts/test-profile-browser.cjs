// Arguments: temporary Playwright module, isolated app URL, isolated SMTP capture URL, screenshots directory.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.argv[2]);
const base = process.argv[3];
const mailBase = process.argv[4];
const artifacts = process.argv[5];
for (const url of [base, mailBase])
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
fs.mkdirSync(artifacts, { recursive: true });
const original = "BrowserProfilePassword2026!";
const updated = "BrowserUpdatedPassword2026!";
async function codeFor(email) {
  const messages = await (await fetch(mailBase + "/messages")).json();
  const message = messages
    .filter(
      (m) => m.includes("To: " + email) && m.includes("verification code"),
    )
    .at(-1);
  assert(message);
  assert(!message.includes(original));
  return message.match(/code is: (\d{6})/)[1];
}
(async () => {
  const auth = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "settings-admin@example.test",
      password: "isolated-settings-admin-password",
    }),
  });
  assert.equal(auth.status, 200);
  const cookie = auth.headers.get("set-cookie").split(";")[0];
  const franchises = await (
    await fetch(base + "/api/franchises", { headers: { Cookie: cookie } })
  ).json();
  const franchise = franchises.franchises.find(
    (f) => f.company.companyCode === "INFOBB2548",
  );
  assert(franchise);
  const suffix = Date.now();
  const email = `browser-profile-${suffix}@example.test`;
  const newEmail = `browser-verified-${suffix}@example.test`;
  const created = await fetch(base + "/api/users", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Profile Browser",
      email,
      password: original,
      role: "FRANCHISE_USER",
      companyId: franchise.companyId,
      franchiseId: franchise.id,
    }),
  });
  assert.equal(created.status, 201);
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  let page;
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    async function login(address, password) {
      await page.goto(base + "/login");
      await page.locator("#email").fill(address);
      await page.locator("#password").fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL("**/dashboard");
      await page
        .getByRole("link", { name: "Profile Settings", exact: true })
        .click();
      await page.waitForURL("**/profile");
      await page.locator("#profile-email").waitFor();
    }
    async function send(address) {
      await page.locator("#profile-email").fill(address);
      await page.locator("#email-password").fill(original);
      await page
        .getByRole("button", { name: "Send verification code", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "Verification code sent" })
        .waitFor();
      await page.locator("#email-code").fill(await codeFor(address));
      await page
        .getByRole("button", { name: "Verify email", exact: true })
        .click();
    }
    await login(email, original);
    await send(email);
    await page
      .getByRole("status")
      .filter({ hasText: "Your email has been verified" })
      .waitFor();
    await send(newEmail);
    await page
      .getByRole("link", { name: "Sign in again", exact: true })
      .waitFor();
    await login(newEmail, original);
    await page.locator("#current-password").fill(original);
    await page.locator("#new-password").fill(updated);
    await page.locator("#confirm-password").fill("DoesNotMatchPassword2026!");
    await page
      .getByRole("button", { name: "Save password", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "New passwords do not match" })
      .waitFor();
    await page.locator("#confirm-password").fill(updated);
    await page
      .getByRole("button", { name: "Save password", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Sign in again", exact: true })
      .waitFor();
    await login(newEmail, updated);
    await page.getByText(/^Email verified:/).waitFor();
    await page.screenshot({
      path: path.join(artifacts, "profile-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(artifacts, "profile-mobile.png"),
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.querySelector("main").scrollWidth <=
            document.querySelector("main").clientWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: Chrome profile navigation, real SMTP codes, current-email reverify, new-email confirmation/login, password mismatch/save/relogin and desktop/mobile layout.",
    );
  } catch (error) {
    if (page)
      await page
        .screenshot({
          path: path.join(artifacts, "profile-failure.png"),
          fullPage: true,
        })
        .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
