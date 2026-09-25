import { OUT, WEB, chromium } from "./lib.mjs";

const out = OUT;
let failures = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// Pair (code entry).
await page.goto(`${WEB}/smartmirror/pairing`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Type a code" }).click();
await page.keyboard.type("ABCD1234");
await page.waitForURL(/\/smartmirror$/);
check("paired", true);

const tool = (name, args) =>
  page.evaluate(
    async ([n, a]) => {
      const r = await fetch(`/api/tools/${encodeURIComponent(n)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a),
      });
      return { status: r.status, body: await r.json() };
    },
    [name, args],
  );

const sessionBefore = (await ctx.cookies()).find((c) => c.name === "sm_session")?.value;

// Add pieces through the whole chain: BFF → cloud → OllaBridge Local relay → HomePilot agentic.invoke → SmartMirror MCP.
const pieces = [
  { category: "dress", subcategory: "slip dress", color: "black", material: "silk", metadata: { name: "Black silk slip dress" } },
  { category: "outerwear", subcategory: "blazer", color: "charcoal", metadata: { name: "Charcoal blazer" } },
  { category: "shoes", subcategory: "heels", color: "black", metadata: { name: "Black heels" } },
  { category: "top", subcategory: "blouse", color: "ivory", metadata: { name: "Ivory blouse" } },
  { category: "bottom", subcategory: "trousers", color: "navy", metadata: { name: "Navy trousers" } },
];
const before = (await tool("hp.smartmirror.wardrobe_list", {})).body.result?.length ?? 0;
for (const p of pieces) {
  const r = await tool("hp.smartmirror.wardrobe_add", p);
  if (r.status !== 200) console.log(JSON.stringify(r));
}
const list = await tool("hp.smartmirror.wardrobe_list", {});
check("wardrobe_add + wardrobe_list through the chain", list.status === 200 && list.body.result?.length === before + 5, `status=${list.status} n=${list.body.result?.length}`);


// Stylist: real SmartMirror stylist via the chain, persona grounded in its top outfit.
await page.goto(`${WEB}/smartmirror/stylist?prompt=dinner%20date&auto=1`, { waitUntil: "networkidle" });
await page.locator(".outfit").first().waitFor({ timeout: 30000 });
await page.locator(".stylist-note__text").first().waitFor({ timeout: 30000 });
const note = await page.locator(".stylist-note__text").textContent();
check("outfits from the real SmartMirror stylist", (await page.locator(".outfit").count()) >= 1);
check("persona grounded in an owned item", /^Grounded: - /.test(note), note);
check("no general-advice hint (tools connected)", !(await page.getByText("Your wardrobe isn’t connected yet").isVisible()));
await page.screenshot({ path: `${out}chain-stylist.png` });

// HomePilot's allow-list: the destructive profile_delete is not allowed in this harness.
const denied = await tool("hp.smartmirror.profile_delete", { confirm: "DELETE" });
check("disallowed tool rejected by HomePilot", denied.status === 403 && denied.body.code === "tool_not_allowed", JSON.stringify(denied.body));

const status = await page.evaluate(() => fetch("/api/session").then((r) => r.json()));
check("session remembers the HomePilot node", status.session?.nodeId === "dev_pc", JSON.stringify(status.session));
const health = await page.evaluate(() => fetch("/api/health").then((r) => r.json()));
check("health shows the HomePilot node", health.node?.id === "dev_pc" && health.homepilot === "ok", JSON.stringify(health.node));
check("session cookie refreshed with node", (await ctx.cookies()).find((c) => c.name === "sm_session")?.value !== sessionBefore);
check("no page errors", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
