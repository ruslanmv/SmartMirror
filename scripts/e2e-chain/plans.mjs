import { OUT, WEB, chromium } from "./lib.mjs";

const out = OUT;
let failures = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
};
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${WEB}/smartmirror/pairing`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Type a code" }).click();
await page.keyboard.type("ABCD1234");
await page.waitForURL(/\/smartmirror$/);

// A small wardrobe with no shoes, through the real tool path. Earlier suites
// share the database, so start by removing what they added.
const tool = (name, args) =>
  page.evaluate(
    async ([name, args]) => {
      const r = await fetch(`/api/tools/${name}`, { method: "POST", body: JSON.stringify(args) });
      return { status: r.status, body: await r.json() };
    },
    [name, args],
  );
const existing = (await tool("hp.smartmirror.wardrobe_list", {})).body.result ?? [];
for (const it of existing) await tool("hp.smartmirror.wardrobe_remove", { item_id: it.id });
const add = async (item) => (await tool("hp.smartmirror.wardrobe_add", item)).status;
for (const it of [
  { category: "dress", subcategory: "slip dress", color: "black", metadata: { name: "Black slip dress" } },
  { category: "top", subcategory: "blouse", color: "ivory", metadata: { name: "Ivory blouse" } },
  { category: "bottom", subcategory: "trousers", color: "navy", metadata: { name: "Navy trousers" } },
  { category: "outerwear", subcategory: "blazer", color: "charcoal", metadata: { name: "Charcoal blazer" } },
]) check(`added ${it.metadata.name}`, (await add(it)) === 200);

await page.evaluate(() => localStorage.setItem("sm:settings", JSON.stringify({ shoppingSuggestions: true, speakReplies: false })));
await page.goto(`${WEB}/smartmirror/stylist`, { waitUntil: "networkidle" });
await page.fill("#prompt", "black look for dinner");
await page.click("button[type=submit]");
await page.locator(".outfit").first().waitFor({ timeout: 30000 }).catch(() => {});
await page.locator(".complete-look").waitFor({ timeout: 30000 });
check("gap: shoes", /black shoes/i.test(await page.locator(".complete-look__what").first().innerText()));
await page.getByRole("button", { name: "Where to buy" }).first().click();
await page.locator(".complete-look__offer .qr svg").waitFor({ timeout: 20000 });
check("link-out offer from the PC", (await page.locator(".complete-look__title").innerText()).includes("black shoes"));
await page.screenshot({ path: `${out}chain-complete-look.png` });
await page.getByRole("button", { name: "I bought it" }).click();
check("marked bought", await page.getByText("Marked as bought").waitFor({ timeout: 10000 }).then(() => true, () => false));

await page.fill("#prompt", "");
await page.getByRole("button", { name: "Pack for a trip" }).click();
await page.waitForURL(/looks\?set=/, { timeout: 30000 });
await page.locator(".plan-card").waitFor({ timeout: 20000 });
const labels = await page.locator(".plan-day__label").allInnerTexts();
check("trip plan has 3 days", labels.map((l) => l.toLowerCase()).join(",") === "day 1,day 2,day 3", labels.join(","));
check("days show owned pieces", (await page.locator(".plan-day .swatch-tile").count()) >= 5);
await page.screenshot({ path: `${out}chain-plans.png` });
await page.locator(".plan-card").getByRole("button", { name: /Delete/ }).click();
await page.waitForTimeout(1500);
check("plan deleted on the PC", (await page.locator(".plan-card").count()) === 0);
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
