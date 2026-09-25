import { OUT, WEB, chromium } from "./lib.mjs";

const out = OUT;
const PHOTO = new URL("./navy-skirt.jpg", import.meta.url).pathname;
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

await page.goto(`${WEB}/smartmirror/wardrobe`, { waitUntil: "networkidle" });
const started = page.waitForResponse((r) => r.url().endsWith("/api/companion/start"));
await page.getByRole("link", { name: "Add clothes" }).click();
await page.waitForURL(/\/wardrobe\/add/);
const handoff = await (await started).json();
check("garment hand-off opened", handoff.mode === "remote" && handoff.purpose === "garment");
await page.locator(".add-clothes .qr svg").waitFor();

const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await phone.goto(`${WEB}/companion/${handoff.code}?m=garment&t=${encodeURIComponent(handoff.ticket)}`, { waitUntil: "networkidle" });
check("phone in closet-scan mode", await phone.getByText("Photograph one piece of clothing").isVisible());
await phone.locator('input[type="file"]').setInputFiles(PHOTO);
await phone.getByRole("button", { name: "Send to mirror" }).click();
await phone.getByText("1 sent · next piece").waitFor({ timeout: 20000 });
check("phone ready for the next piece", true);

const card = page.locator(".draft").first();
await card.waitFor({ timeout: 15000 });
check("draft appears on the screen with its photo", (await card.locator("img").getAttribute("src"))?.startsWith("data:image/jpeg"));
check("colour suggested by the PC", (await card.locator('[aria-label="Colour"] .sm-chip[aria-pressed="true"]').textContent()) === "navy");
check("asks what it is (baseline has no category)", await card.getByText("What is it?").isVisible());
await page.screenshot({ path: `${out}closet-review.png` });

await card.getByRole("button", { name: "Bottom" }).click();
await card.getByRole("button", { name: "Add to wardrobe" }).click();
await page.getByText("Nothing to confirm").waitFor({ timeout: 15000 });
check("confirmed with one press", true);

await page.goto(`${WEB}/smartmirror/wardrobe`, { waitUntil: "networkidle" });
await page.locator(".garment-card").first().waitFor();
const imgs = await page.locator(".garment-card img").evaluateAll((els) => els.map((e) => e.getAttribute("src") ?? ""));
check("wardrobe shows the photographed piece", imgs.some((s) => s.startsWith("data:image/jpeg")), `${imgs.length} images`);
await page.screenshot({ path: `${out}closet-wardrobe.png` });
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
