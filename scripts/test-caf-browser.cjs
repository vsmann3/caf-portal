// Temporary local browser driver path, SSH-forwarded test URL, artifact directory.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.argv[2]);
const base = process.argv[3];
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const artifacts = process.argv[4];
fs.mkdirSync(artifacts, { recursive: true });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=",
  "base64",
);
(async () => {
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
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(base + "/login");
    await page.locator("#email").fill("counter1@example.test");
    await page.locator("#password").fill("isolated-settings-admin-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/dashboard");
    await page.route("**/api/addresses?pin=*", async (route) => {
      const pin = new URL(route.request().url()).searchParams.get("pin");
      if (pin === "110001")
        return route.fulfill({
          json: {
            locations: [
              {
                state: "Delhi",
                city: "New Delhi",
                locality: "Test postal office",
                district: "Central Delhi",
              },
            ],
          },
        });
      if (pin === "110002")
        return route.fulfill({
          json: {
            locations: [
              {
                state: "Delhi",
                city: "",
                locality: "Office A",
                district: "Central Delhi",
              },
              {
                state: "Delhi",
                city: "",
                locality: "Office B",
                district: "Central Delhi",
              },
            ],
          },
        });
      return route.fulfill({
        status: 502,
        json: {
          error: "PIN lookup unavailable. Select state and city manually.",
        },
      });
    });
    await page.goto(base + "/caf/new");
    assert.equal(
      await page.getByRole("button", { name: "Menu", exact: true }).isVisible(),
      false,
    );
    await page.locator("#customerType").selectOption("COMMERCIAL");
    assert(await page.locator("#gstNumber").isVisible());
    await page.locator("#customerType").selectOption("RESIDENTIAL");
    assert.equal(await page.locator("#gstNumber").count(), 0);
    await page.locator("#customerName").fill("Aditi Browser");
    await page.locator("#mobile").fill("9876001234");
    await page.locator("#service-username").waitFor();
    await page.waitForFunction(
      () => document.querySelector("#service-username").value === "aditi01234",
    );
    await page
      .locator("#installationaddress-line1")
      .fill("42 Browser Test Street");
    await page.locator("#installationaddress-pin").fill("110001");
    await page.waitForFunction(
      () =>
        document.querySelector("#installationaddress-city").value ===
        "New Delhi",
    );
    await page.locator("#installationaddress-pin").fill("110002");
    await page.getByLabel("Postal locality (reference)").waitFor();
    await page.getByLabel("Postal locality (reference)").selectOption("1");
    assert.match(
      await page
        .getByRole("status")
        .allTextContents()
        .then((v) => v.join(" ")),
      /Office B/,
    );
    await page.locator("#installationaddress-pin").fill("999999");
    await page
      .getByText("PIN lookup unavailable. Select state and city manually.", {
        exact: true,
      })
      .waitFor();
    await page
      .locator("#installationaddress-state")
      .selectOption("Maharashtra");
    assert.equal(
      await page.locator("#installationaddress-city").inputValue(),
      "",
    );
    await page
      .locator('#installationaddress-city option[value="__other"]')
      .waitFor({ state: "attached" });
    await page.locator("#installationaddress-city").selectOption("__other");
    await page.locator("#installationaddress-manual").fill("Missing City Test");
    await page.locator("#installationaddress-pin").fill("110001");
    await page.waitForFunction(
      () =>
        document.querySelector("#installationaddress-state").value === "Delhi",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText(/Draft fields saved/).waitFor();
    await page.reload();
    await page
      .locator("#resume option")
      .filter({ hasText: "Aditi Browser" })
      .waitFor({ state: "attached" });
    const draftId = await page
      .locator("#resume option")
      .filter({ hasText: "Aditi Browser" })
      .getAttribute("value");
    await page.locator("#resume").selectOption(draftId);
    assert.equal(
      await page.locator("#customerName").inputValue(),
      "Aditi Browser",
    );
    await page.locator("#idProofType").selectOption("PAN");
    await page.locator("#idNumber").fill("ABCDE1234F");
    for (let i = 0; i < 3; i++)
      await page
        .getByRole("button", { name: "+ Add document", exact: true })
        .click();
    for (const [i, category] of [
      "PASSPORT_PHOTO",
      "ID_PROOF",
      "ADDRESS_PROOF",
    ].entries()) {
      await page
        .getByLabel(`Document ${i + 1} category`, { exact: true })
        .selectOption(category);
      await page
        .getByLabel(`Document ${i + 1} file`, { exact: true })
        .setInputFiles({
          name: category + ".png",
          mimeType: "image/png",
          buffer: png,
        });
    }
    assert.equal(await page.getByText(/^Preview /).count(), 3);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('img[alt$=".png"]')].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    await page.getByRole("checkbox").last().check();
    await page.waitForFunction(
      () => document.querySelector("#service-username").value === "aditi01234",
    );
    await page.screenshot({
      path: path.join(artifacts, "caf-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator("#portal-navigation").isVisible(), false);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    assert(await page.locator("#portal-navigation").isVisible());
    await page.getByRole("button", { name: "Close menu", exact: true }).click();
    await page.screenshot({
      path: path.join(artifacts, "caf-mobile.png"),
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.querySelector("main").scrollWidth <=
            document.querySelector("main").clientWidth,
      ),
      "Mobile form must not scroll horizontally",
    );
    await page
      .getByRole("button", { name: "Review application", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Review before submitting" })
      .waitFor();
    await page
      .getByRole("button", { name: "Submit for approval", exact: true })
      .click();
    await page.waitForURL(/\/customers\/[^/]+$/);
    await page.getByText("aditi01234", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real Chrome login, conditional GST fields, username preview, PIN autofill/ambiguity/outage, state reset/manual city, draft resume, previews, mobile layout, review and submission.",
    );
  } catch (error) {
    if (page)
      await page
        .screenshot({
          path: path.join(artifacts, "caf-failure.png"),
          fullPage: true,
        })
        .catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
