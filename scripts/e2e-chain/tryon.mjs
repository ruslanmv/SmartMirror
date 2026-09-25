import { OUT, WEB, WORK, chromium } from "./lib.mjs";
import { existsSync, readdirSync } from "node:fs";

const out = OUT;
const PHOTO = new URL("./navy-skirt.jpg", import.meta.url).pathname; // any real photo stands in for a body photo
let failures = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
};

const browser = await chromium.launch();
const screen = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await screen.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${WEB}/smartmirror/pairing`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Type a code" }).click();
await page.keyboard.type("ABCD1234");
await page.waitForURL(/\/smartmirror$/);

const tool = (name, args) =>
  page.evaluate(async ([n, a]) => {
    const r = await fetch(`/api/tools/${encodeURIComponent(n)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) });
    return { status: r.status, body: await r.json() };
  }, [name, args]);
for (const p of [
  { category: "dress", subcategory: "slip dress", color: "black", metadata: { name: "Black silk slip dress" } },
  { category: "outerwear", subcategory: "blazer", color: "charcoal", metadata: { name: "Charcoal blazer" } },
  { category: "shoes", subcategory: "heels", color: "black", metadata: { name: "Black heels" } },
]) await tool("hp.smartmirror.wardrobe_add", p);

// ── W-3: phone → screen hand-off across devices ─────────────────────
// Without a camera (headless), "Use your phone" is the default source and starts at once.
const started = page.waitForResponse((r) => r.url().endsWith("/api/companion/start"));
await page.goto(`${WEB}/smartmirror/capture`, { waitUntil: "networkidle" });
const handoff = await (await started).json();
check("screen opened a remote capture session", handoff.mode === "remote" && typeof handoff.ticket === "string", handoff.mode);
await page.locator(".companion .qr svg").waitFor();
check("QR shown with 'goes to your HomePilot' note", await page.getByText("The photo goes straight to your HomePilot PC").isVisible());

const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // no cookies: a different device
const phone = await phoneCtx.newPage();
await phone.goto(`${WEB}/companion/${handoff.code}?t=${encodeURIComponent(handoff.ticket)}`, { waitUntil: "networkidle" });
check("phone page explains where the photo goes", await phone.getByText("goes to your own HomePilot PC").isVisible());
await phone.locator('input[type="file"]').setInputFiles(PHOTO);
await phone.getByRole("button", { name: "Send to mirror" }).click();
await phone.getByText("Sent to your mirror").waitFor({ timeout: 20000 });
check("phone sent the photo with only the ticket", true);

await page.getByRole("button", { name: "Use this photo" }).waitFor({ timeout: 20000 });
check("screen received the phone photo", true);
await page.screenshot({ path: `${out}chain-handoff.png` });
await page.getByRole("button", { name: "Use this photo" }).click();
await page.waitForTimeout(500);

// ── W-4 / SM-6: real try-on through HomePilot images.edit ──────────
await page.goto(`${WEB}/smartmirror/stylist?prompt=dinner%20date&auto=1`, { waitUntil: "networkidle" });
await page.locator(".outfit").first().waitFor({ timeout: 30000 });
await page.locator(".outfit").first().getByRole("button", { name: "Try it on" }).click();
await page.waitForURL(/\/smartmirror\/tryon/);
await page.getByRole("button", { name: "Start try-on" }).click();
await page.getByRole("button", { name: "Before / after" }).waitFor({ timeout: 60000 });
const src = await page.locator(".tryon .portrait img, .tryon img").first().getAttribute("src");
check("try-on preview rendered by HomePilot images.edit", src?.startsWith("data:image/jpeg;base64,"), src?.slice(0, 30));
check("labelled as an AI style preview", await page.getByText("not a fit guarantee").isVisible());
await page.screenshot({ path: `${out}chain-tryon.png` });
await page.getByRole("button", { name: "Before / after" }).click();
const before = await page.locator(".tryon .portrait img, .tryon img").first().getAttribute("src");
check("before/after toggles to the original photo", before !== src);

// The staged HomePilot input is gone once the job ended.
const staged = `${WORK}/uploads/mirror-inputs`;
check("HomePilot removed the staged input", !existsSync(staged) || readdirSync(staged).length === 0);
check("no page errors", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
