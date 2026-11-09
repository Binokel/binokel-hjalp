// Tester för hjalp.js. Kör: node test/run.js
// Kräver Playwright med Chromium (lokalt förinstallerat, i GitHub Actions via npx playwright install).
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");
const launch = (o) => chromium.launch(o);

const ROOT = path.resolve(__dirname, "..");
const PAGE = "file://" + path.join(__dirname, "app.html");
const SHOTS = path.join(__dirname, "skarmbilder");
fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ok   " + name);
  } catch (e) {
    failures.push(name + ": " + e.message);
    console.log("  FEL  " + name + "\n       " + e.message.split("\n")[0]);
  }
}

const H = "#binokel-hjalp";
const sel = {
  button: H + " button[aria-haspopup=menu]",
  menu: H + " [role=menu]",
  item: (name) => H + ' [role=menuitem]:has-text("' + name + '")',
  dialog: H + " dialog",
  text: H + " #bh-text",
};

async function appDialogOpen(page) {
  return page.evaluate(() => !!document.getElementById("app-dialog") && window.__app.closedBy === null);
}
async function calls(page, fn) {
  return page.evaluate((f) => window.__mock.calls.filter((c) => c.fn === f), fn);
}
async function shadowActive(page) {
  return page.evaluate(() => {
    const host = document.getElementById("binokel-hjalp");
    if (document.activeElement !== host) return "utanför: " + (document.activeElement && document.activeElement.id);
    const a = host.shadowRoot.activeElement;
    return a ? a.tagName.toLowerCase() + (a.id ? "#" + a.id : "") : "ingen";
  });
}

async function suite(browser, label, contextOptions) {
  console.log("\n" + label);
  const ctx = await browser.newContext(contextOptions);
  const mobile = !!contextOptions.isMobile;
  ctx.setDefaultTimeout(5000);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(PAGE);
  await page.waitForSelector(sel.button);

  await test("knappen syns nere till höger i top layer", async () => {
    const b = page.locator(sel.button);
    await b.waitFor({ state: "visible" });
    const box = await b.boundingBox();
    const vp = page.viewportSize();
    ok(box.x + box.width > vp.width - 40, "inte till höger: " + JSON.stringify(box));
    ok(box.y + box.height > vp.height - (mobile ? 140 : 60), "inte nere: " + JSON.stringify(box));
    ok(box.height === 48, "höjden är " + box.height);
    if (mobile) ok(box.width === 48, "mobilknappen ska vara rund 48 px, bredd " + box.width);
    else ok(await page.locator(H + " .lbl").isVisible(), "texten Hjälp syns inte på dator");
    const top = await page.evaluate(() =>
      document.getElementById("binokel-hjalp").shadowRoot.querySelector(".fab").matches(":popover-open")
    );
    ok(top, "knappen ligger inte i top layer");
    const bg = await b.evaluate((el) => getComputedStyle(el).backgroundColor);
    ok(bg === "rgb(45, 62, 102)", "appens CSS når in, bakgrund " + bg);
    const font = await b.evaluate((el) => getComputedStyle(el).fontFamily);
    ok(!/Georgia/.test(font), "appens typsnitt når in: " + font);
    if (mobile) {
      // bottomMobile 72 px: knappen ska gå fri från appens bottenmeny (60 px)
      ok(vp.height - (box.y + box.height) >= 72, "går inte fri från bottenmenyn");
    }
  });

  await test("orange siffra visar antal redo att testa", async () => {
    await page.waitForFunction(() => {
      const b = document.getElementById("binokel-hjalp").shadowRoot.querySelector(".badge");
      return b && !b.hidden && b.textContent === "2";
    });
    const label = await page.locator(sel.button).getAttribute("aria-label");
    ok(label === "Hjälp, 2 redo att testa", "aria-label: " + label);
    const bg = await page.locator(H + " .badge").evaluate((el) => getComputedStyle(el).backgroundColor);
    ok(bg === "rgb(230, 103, 12)", "inte orange: " + bg);
  });

  await test("menyn öppnas med aria-expanded, piltangenter och Escape", async () => {
    await page.click(sel.button);
    await page.locator(sel.menu).waitFor({ state: "visible" });
    ok((await page.locator(sel.button).getAttribute("aria-expanded")) === "true", "aria-expanded inte true");
    const texts = await page.locator(H + " [role=menuitem]").allInnerTexts();
    const flat = texts.map((t) => t.replace(/\s+/g, " ").trim());
    ok(flat[0] === "Fråga Iris" && flat[1] === "Ge feedback" && flat[2] === "Min feedback", "menyrader: " + flat.join(" | "));
    ok(flat[3] && /2.*Redo att testa/.test(flat[3]), "raden redo att testa saknas: " + flat.join(" | "));
    const heights = await page.locator(H + " [role=menuitem]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    ok(heights.every((hh) => hh >= 48), "rader lägre än 48 px: " + heights);
    ok((await shadowActive(page)) === "button", "fokus inte på första raden");
    await page.keyboard.press("ArrowDown");
    const second = await page.evaluate(() => document.getElementById("binokel-hjalp").shadowRoot.activeElement.textContent);
    ok(second === "Ge feedback", "ArrowDown gick till " + second);
    await page.screenshot({ path: path.join(SHOTS, label + "-meny.png") });
    await page.keyboard.press("Escape");
    await page.locator(sel.menu).waitFor({ state: "hidden" });
    ok((await page.locator(sel.button).getAttribute("aria-expanded")) === "false", "aria-expanded inte false");
  });

  await test("Fråga Iris öppnar rätt adress (popup på dator, ny flik på mobil)", async () => {
    await page.click(sel.button);
    await page.click(sel.item("Fråga Iris"));
    const opened = await page.evaluate(() => window.__opened.slice());
    ok(opened.length >= 1, "window.open anropades inte");
    const first = opened[0];
    ok(first.url === "https://northern-lens-learning-quest.lovable.app/fraga?inbaddad=1&app=testapp", "adress: " + first.url);
    if (mobile) ok(first.target === "_blank", "mobil ska öppna ny flik: " + first.target);
    else ok(/popup/.test(first.features || ""), "dator ska öppna popup: " + first.features);
  });

  await test("Ge feedback ovanpå appens dialog: skriva, skärmbild, person, submit, appens dialog öppen", async () => {
    await page.click("#open-app-dialog");
    await page.waitForSelector("#app-dialog");
    await page.fill("#app-input", "Kundens text");
    await page.waitForTimeout(20);
    ok(await page.evaluate(() => getComputedStyle(document.body).pointerEvents === "none"), "testsidan satte inte body pointer-events:none");
    await page.click(sel.button);
    ok(await appDialogOpen(page), "appens dialog stängdes av klick på Hjälp");
    await page.click(sel.item("Ge feedback"));
    await page.locator(sel.dialog).waitFor({ state: "visible" });
    ok(await page.locator(H + " .shot img").isVisible(), "förhandsvisning av skärmbild saknas");
    // Tomt fält: felmeddelande, inget anrop
    await page.click(H + ' button[type=submit]');
    ok((await page.locator(H + " .err").first().innerText()).includes("Skriv vad det gäller"), "inget fel för tom text");
    ok((await calls(page, "submit")).length === 0, "submit anropades med tom text");
    await page.click(sel.text);
    await page.keyboard.type("Sparaknappen hamnar under tangentbordet.");
    ok((await shadowActive(page)) === "textarea#bh-text", "fokus drogs bort från rutan: " + (await shadowActive(page)));
    ok((await page.inputValue(sel.text)) === "Sparaknappen hamnar under tangentbordet.", "texten kom inte in");
    ok(await appDialogOpen(page), "appens dialog stängdes när rutan öppnades");
    // Person krävs
    await page.click(H + ' button[type=submit]');
    ok((await page.locator(H + " .err").first().innerText()).includes("Välj vem"), "personväljaren krävdes inte");
    await page.selectOption(H + " #bh-person", "p1");
    await page.screenshot({ path: path.join(SHOTS, label + "-ge-feedback-over-dialog.png") });
    await page.click(H + ' button[type=submit]');
    await page.locator(H + ' .ok:has-text("Din feedback har skickats")').waitFor();
    const s = (await calls(page, "submit"))[0];
    ok(s && s.text === "Sparaknappen hamnar under tangentbordet.", "fel text: " + JSON.stringify(s));
    ok(s.general === false, "general ska vara false");
    ok(s.route === new URL(PAGE).pathname, "route: " + s.route);
    ok(s.screenshot && s.screenshot.type === "image/png" && s.screenshot.size > 0, "skärmbild saknas: " + JSON.stringify(s.screenshot));
    ok(s.reporterId === "p1", "reporterId: " + s.reporterId);
    ok(await page.locator(H + ' .ok:has-text("Ärendenummer 42.")').isVisible(), "appens meddelande visas inte");
    await page.screenshot({ path: path.join(SHOTS, label + "-kvittens.png") });
    await page.click(H + ' .ok button:has-text("Stäng")');
    await page.locator(sel.dialog).waitFor({ state: "hidden" });
    ok(await appDialogOpen(page), "appens dialog stängdes efter feedbacken");
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === "app-input");
    await page.keyboard.type(" mer");
    ok((await page.inputValue("#app-input")) === "Kundens text mer", "kan inte skriva i appens dialog efteråt");
  });

  await test("Escape i rutan stänger bara rutan, inte appens dialog", async () => {
    await page.click(sel.button);
    await page.click(sel.item("Ge feedback"));
    await page.locator(sel.dialog).waitFor({ state: "visible" });
    await page.click(sel.text);
    await page.keyboard.type("Utkast");
    await page.keyboard.press("Escape");
    await page.locator(sel.dialog).waitFor({ state: "hidden" });
    ok(await appDialogOpen(page), "appens dialog stängdes av Escape: " + (await page.evaluate(() => window.__app.closedBy)));
    // Utkastet finns kvar i minnet
    await page.click(sel.button);
    await page.click(sel.item("Ge feedback"));
    ok((await page.inputValue(sel.text)) === "Utkast", "utkastet försvann");
  });

  await test("Gäller hela appen och Ta bort skärmbilden ger screenshot null", async () => {
    await page.click(H + ' label:has-text("Gäller hela appen")');
    ok(!(await page.locator(H + " .shot").isVisible()), "skärmbilden visas fortfarande vid hela appen");
    await page.selectOption(H + " #bh-person", "p2");
    await page.click(H + ' button[type=submit]');
    await page.locator(H + ' .ok:has-text("Din feedback har skickats")').waitFor();
    let s = (await calls(page, "submit"))[1];
    ok(s.general === true && s.screenshot === null && s.text === "Utkast" && s.reporterId === "p2", "fel fält: " + JSON.stringify(s));
    await page.click(H + ' .ok button:has-text("Stäng")');
    await page.click(sel.button);
    await page.click(sel.item("Ge feedback"));
    ok((await page.inputValue(sel.text)) === "", "texten rensades inte efter skickad feedback");
    await page.click(H + ' button:has-text("Ta bort skärmbilden")');
    ok((await page.locator(H + " .shot").count()) === 0, "skärmbilden togs inte bort");
    await page.fill(sel.text, "Utan bild");
    await page.click(H + ' button[type=submit]');
    await page.locator(H + ' .ok:has-text("Din feedback har skickats")').waitFor();
    s = (await calls(page, "submit"))[2];
    ok(s.general === false && s.screenshot === null, "skärmbild skickades trots borttagning: " + JSON.stringify(s));
    await page.click(H + ' .ok button:has-text("Stäng")');
  });

  await test("tydligt fel när appen svarar ok:false", async () => {
    await page.evaluate(() => (window.__mock.failSubmit = true));
    await page.click(sel.button);
    await page.click(sel.item("Ge feedback"));
    await page.fill(sel.text, "Det här misslyckas");
    await page.click(H + ' button[type=submit]');
    const err = page.locator(H + ' .err:has-text("Det gick inte att skicka feedbacken. Servern svarade inte.")');
    await err.waitFor();
    ok(await page.locator(H + ' button[type=submit]:has-text("Skicka")').isEnabled(), "Skicka låst efter fel");
    await page.evaluate(() => (window.__mock.failSubmit = false));
    await page.keyboard.press("Escape");
    await page.locator(sel.dialog).waitFor({ state: "hidden" });
    ok(await appDialogOpen(page), "appens dialog stängdes");
  });

  await test("Min feedback: status, redo att testa först, återöppna kräver kommentar, godkänn", async () => {
    await page.click(sel.button);
    await page.click(sel.item("Min feedback"));
    await page.locator(H + " .list").waitFor();
    const statuses = await page.locator(H + " .item").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
    ok(statuses.join(",") === "redo_att_testa,redo_att_testa,ateroppnad,ny,godkand", "ordning: " + statuses);
    const labels = await page.locator(H + " .st").allInnerTexts();
    ok(["Redo att testa", "Återöppnad", "Ny", "Godkänd"].every((l) => labels.includes(l)), "etiketter: " + labels);
    const colors = await page.locator(H + " .st").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    ok(new Set(colors).size === 4, "statusarna har inte fyra olika färger: " + colors);
    ok((await page.locator(H + ' .item[data-status=ny] button:has-text("Ja, det fungerar")').count()) === 0, "Ja-knapp på Ny");
    await page.screenshot({ path: path.join(SHOTS, label + "-min-feedback.png"), fullPage: false });
    // Återöppna utan kommentar
    const first = page.locator(H + ' .item[data-id="a1"]');
    await first.locator('button:has-text("Nej, fortfarande fel")').click();
    await first.locator('button:has-text("Skicka")').click();
    ok((await first.locator(".err").innerText()).includes("Skriv vad som fortfarande är fel"), "inget krav på kommentar");
    ok((await calls(page, "reopen")).length === 0, "reopen anropades utan kommentar");
    await first.locator("textarea").fill("Knappen syns fortfarande inte.");
    await page.screenshot({ path: path.join(SHOTS, label + "-ateroppna.png") });
    await first.locator('button:has-text("Skicka")').click();
    await page.locator(H + ' .ok:has-text("återöppnad")').waitFor();
    const r = (await calls(page, "reopen"))[0];
    ok(r.id === "a1" && r.note === "Knappen syns fortfarande inte.", "reopen: " + JSON.stringify(r));
    await page.locator(H + ' .item[data-id="a2"] button:has-text("Ja, det fungerar")').click();
    await page.locator(H + ' .ok:has-text("godkänd")').waitFor();
    const a = (await calls(page, "approve"))[0];
    ok(a && a.id === "a2", "approve: " + JSON.stringify(a));
    ok(await appDialogOpen(page), "appens dialog stängdes");
    await page.waitForFunction(() => document.getElementById("binokel-hjalp").shadowRoot.querySelector(".badge").hidden);
    await page.keyboard.press("Escape");
    await page.locator(sel.dialog).waitFor({ state: "hidden" });
    const label2 = await page.locator(sel.button).getAttribute("aria-label");
    ok(label2 === "Hjälp", "siffran försvann inte: " + label2);
  });

  await test("klick på appens dialog efteråt fungerar och klick utanför stänger den som vanligt", async () => {
    await page.click("#app-input");
    ok(await appDialogOpen(page), "appens dialog stängdes av klick i den");
    await page.mouse.click(5, 5);
    ok(!(await appDialogOpen(page)), "appens egen stäng-vid-klick-utanför fungerar inte längre");
  });

  await test("hide() och show()", async () => {
    await page.evaluate(() => window.BinokelHjalp.hide());
    await page.locator(sel.button).waitFor({ state: "hidden" });
    await page.evaluate(() => window.BinokelHjalp.show());
    await page.locator(sel.button).waitFor({ state: "visible" });
  });

  await test("openMine() och refresh() från appen", async () => {
    await page.evaluate(() => {
      window.__mock.items.push({ id: "b1", text: "Ny rättning", status: "redo_att_testa", createdAt: "2026-11-09T08:00:00Z", updatedAt: "2026-11-09T08:00:00Z" });
      return window.BinokelHjalp.refresh();
    });
    ok((await page.locator(H + " .badge").innerText()) === "1", "refresh uppdaterade inte siffran");
    await page.evaluate(() => window.BinokelHjalp.openMine());
    await page.locator(H + ' .item[data-id="b1"]').waitFor();
    await page.keyboard.press("Escape");
    await page.locator(sel.dialog).waitFor({ state: "hidden" });
  });

  ok(errors.length === 0, "sidfel: " + errors.join("; "));
  if (errors.length) failures.push(label + ": sidfel " + errors.join("; "));
  await ctx.close();
}

async function extra(browser) {
  console.log("\nÖvrigt");
  await test("utan Popover API: fast position med z-index, fungerar ovanpå appens dialog", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    ctx.setDefaultTimeout(5000);
    await ctx.addInitScript(() => {
      delete HTMLElement.prototype.popover;
    });
    const page = await ctx.newPage();
    await page.goto(PAGE);
    await page.click("#open-app-dialog");
    await page.waitForSelector("#app-dialog");
    await page.waitForTimeout(20);
    const z = await page.locator(H + " .fab").evaluate((el) => getComputedStyle(el).zIndex);
    ok(z === "2147483000", "z-index: " + z);
    await page.click(sel.button);
    await page.click(sel.item("Ge feedback"));
    await page.fill(sel.text, "Utan popover");
    await page.selectOption(H + " #bh-person", "p1");
    await page.click(H + ' button[type=submit]');
    await page.locator(H + ' .ok:has-text("Din feedback har skickats")').waitFor();
    ok(await appDialogOpen(page), "appens dialog stängdes");
    await page.screenshot({ path: path.join(SHOTS, "dator-utan-popover.png") });
    await ctx.close();
  });

  await test("mörkt läge och app utan skärmbild och personväljare", async () => {
    const ctx = await browser.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
    ctx.setDefaultTimeout(5000);
    const page = await ctx.newPage();
    await page.goto(PAGE + "?skarmbild=0&personer=0");
    await page.click(sel.button);
    await page.click(sel.item("Ge feedback"));
    await page.locator(sel.dialog).waitFor({ state: "visible" });
    ok((await page.locator(H + " .shot").count()) === 0, "skärmbild visas utan captureScreenshot");
    ok((await page.locator(H + " #bh-person").count()) === 0, "personväljare visas utan reporters");
    const bg = await page.locator(sel.dialog).evaluate((el) => getComputedStyle(el).backgroundColor);
    ok(bg === "rgb(27, 34, 51)", "mörkt läge används inte: " + bg);
    await page.fill(sel.text, "Mörkt läge");
    await page.screenshot({ path: path.join(SHOTS, "iphone-morkt-lage.png") });
    await page.click(H + ' button[type=submit]');
    await page.locator(H + ' .ok:has-text("Din feedback har skickats")').waitFor();
    const s = await page.evaluate(() => window.__mock.calls.find((c) => c.fn === "submit"));
    ok(s.reporterId === null && s.screenshot === null, "fel fält: " + JSON.stringify(s));
    await ctx.close();
  });

  await test("tom lista i Min feedback", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    ctx.setDefaultTimeout(5000);
    const page = await ctx.newPage();
    await page.goto(PAGE + "?tom=1");
    await page.click(sel.button);
    ok((await page.locator(H + " [role=menuitem]").count()) === 3, "raden redo att testa ska saknas");
    ok(await page.locator(H + " .badge").isHidden(), "siffran syns utan punkter");
    await page.click(sel.item("Min feedback"));
    await page.locator(H + ' p:has-text("Du har inte lämnat någon feedback än.")').waitFor();
    await ctx.close();
  });
}

function staticChecks() {
  console.log("\nKoden");
  const src = fs.readFileSync(path.join(ROOT, "hjalp.js"), "utf8");
  test("inga nätverksanrop, cookies eller lagring i hjalp.js", async () => {
    const banned = ["fetch", "XMLHttpRequest", "document.cookie", "sendBeacon", "WebSocket", "localStorage", "sessionStorage", "indexedDB", "EventSource", "import("];
    const hits = banned.filter((w) => src.includes(w));
    ok(hits.length === 0, "förbjudet: " + hits.join(", "));
  });
  test("storleken är under 40 kB", async () => {
    const size = Buffer.byteLength(src);
    ok(size < 40 * 1024, size + " byte");
    console.log("       " + size + " byte");
  });
  test("inga ES2020-konstruktioner (?. och ??)", async () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    ok(!/\?\.[a-zA-Z(\[]/.test(code) && !/\?\?/.test(code), "hittade ?. eller ??");
  });
}

(async () => {
  staticChecks();
  const browser = await chromium.launch();
  try {
    await suite(browser, "iphone", { ...devices["iPhone 13"] });
    await suite(browser, "dator", { viewport: { width: 1280, height: 800 } });
    await extra(browser);
  } finally {
    await browser.close();
  }
  console.log("\n" + passed + " godkända, " + failures.length + " fel");
  if (failures.length) {
    failures.forEach((f) => console.log("- " + f));
    process.exit(1);
  }
})();
