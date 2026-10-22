// Arguments: temporary Playwright module, isolated localhost URL, artifact directory.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.argv[2]);
const base = process.argv[3];
const artifacts = process.argv[4];
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
fs.mkdirSync(artifacts, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  try {
    const context = await browser.newContext();
    const login = await context.request.post(base + "/api/auth/login", {
      data: {
        email: "settings-admin@example.test",
        password: "isolated-settings-admin-password",
      },
    });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const responseChecks = [];
    const token = "browser-radius-canary-token";
    page.on("response", (response) => {
      if (response.url().endsWith("/api/settings/radius"))
        responseChecks.push(
          (async () => {
            const text = await response.text();
            assert(!text.includes(token), "Token leaked in settings response");
            assert(!text.includes('"apiKeyEncrypted"'));
            assert(!text.includes('"apiKey":'));
          })(),
        );
    });
    async function openSettings() {
      await page.goto(base + "/admin/super-settings");
      const section = page.locator("#radius");
      await section.locator("summary").click();
      await section
        .getByRole("button", { name: "Save", exact: true })
        .waitFor();
      await page.waitForFunction(
        () => !document.querySelector("#radius button").disabled,
      );
      return section;
    }
    let section = await openSettings();
    assert(
      (await section.innerText()).includes(
        "Delivery and activation are unavailable",
      ),
    );
    const secret = section.locator('input[type="password"]');
    assert.equal(await secret.inputValue(), "");
    await secret.fill(token);
    await section.getByRole("button", { name: "Save", exact: true }).click();
    await section
      .getByText(
        "Saved. RADIUS delivery is not implemented; no service will be provisioned.",
        { exact: true },
      )
      .waitFor();
    assert.equal(await secret.inputValue(), "");
    assert.equal(
      await secret.getAttribute("placeholder"),
      "Configured; leave blank to keep",
    );
    await page.screenshot({
      path: path.join(artifacts, "radius-configured.png"),
      fullPage: true,
    });
    section = await openSettings();
    assert.equal(
      await section.locator('input[type="password"]').inputValue(),
      "",
    );
    assert.equal(
      await section
        .locator('input[type="password"]')
        .getAttribute("placeholder"),
      "Configured; leave blank to keep",
    );
    assert(!(await page.content()).includes(token));
    await section.getByLabel("Remove stored token").check();
    assert.equal(
      await section.locator('input[type="password"]').isDisabled(),
      true,
    );
    await section.getByRole("button", { name: "Save", exact: true }).click();
    await section
      .getByText(
        "Saved. RADIUS delivery is not implemented; no service will be provisioned.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await section
        .locator('input[type="password"]')
        .getAttribute("placeholder"),
      "Not configured",
    );
    await page.route(
      "**/api/settings/radius",
      (route) =>
        route.request().method() === "PUT" ? route.abort() : route.continue(),
      { times: 1 },
    );
    await section.getByRole("button", { name: "Save", exact: true }).click();
    await section
      .getByText(
        "Unable to save RADIUS settings. Check the connection and try again.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await section
        .getByRole("button", { name: "Save", exact: true })
        .isEnabled(),
      true,
    );
    await section.getByRole("button", { name: "Save", exact: true }).click();
    await section
      .getByText(
        "Saved. RADIUS delivery is not implemented; no service will be provisioned.",
        { exact: true },
      )
      .waitFor();
    await page.screenshot({
      path: path.join(artifacts, "radius-cleared.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(artifacts, "radius-mobile.png"),
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "Settings page overflows the mobile viewport",
    );
    await Promise.all(responseChecks);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real Chrome RADIUS settings load, truthful status, write-only token save/reload, redacted API responses, explicit removal and recovery after network failure; no page errors",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
