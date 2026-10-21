// Arguments: temporary Playwright module, isolated localhost URL, fixture JSON, artifact directory.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.argv[2]);
const base = process.argv[3];
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const fixture = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
const artifacts = process.argv[5];
fs.mkdirSync(artifacts, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const login = await context.request.post(base + "/api/auth/login", {
      data: {
        email: "settings-admin@example.test",
        password: "isolated-settings-admin-password",
      },
    });
    assert.equal(login.status(), 200);
    const cookie = login.headers()["set-cookie"].split(";")[0];
    const page = await context.newPage();
    await page.goto(base + "/customers/" + fixture.id);
    await page
      .getByRole("button", {
        name: "Download CAF + documents PDF",
        exact: true,
      })
      .waitFor();
    assert(
      (await page.locator("body").innerText()).includes(fixture.customerId),
    );
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: "Download CAF + documents PDF",
        exact: true,
      })
      .click();
    const download = await downloaded;
    assert.equal(await download.failure(), null);
    assert.equal(download.suggestedFilename(), `CAF-${fixture.customerId}.pdf`);
    const target = path.join(artifacts, download.suggestedFilename());
    await download.saveAs(target);
    assert.equal(fs.readFileSync(target).subarray(0, 5).toString(), "%PDF-");
    await page.screenshot({
      path: path.join(artifacts, "caf-pdf-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(artifacts, "caf-pdf-mobile.png"),
      fullPage: true,
    });
    await page.goto(base + "/customers?q=" + fixture.customerId);
    await page
      .getByRole("cell", { name: fixture.customerId, exact: true })
      .waitFor();
    const historical = await context.request.get(
      base + "/api/applications?q=Legacy%20approved%20customer",
      { headers: { Cookie: cookie } },
    );
    assert.equal(historical.status(), 200);
    const legacy = (await historical.json()).items[0];
    assert(legacy);
    const legacyPdf = await context.request.get(
      base + `/api/applications/${legacy.id}/pdf`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(legacyPdf.status(), 200);
    fs.writeFileSync(path.join(artifacts, "legacy.pdf"), await legacyPdf.body());
    console.log(
      "PASS: real Chrome approved CAF Customer ID and combined PDF download.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
