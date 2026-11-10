/* Niemis Hjälp – en gemensam Hjälp-knapp med "Fråga Iris" och "Ge feedback" för alla Binokels appar.
   https://binokel.github.io/niemis-hjalp/hjalp.js
   Regler: ren ES2018 utan beroenden. Delen gör inga egna nätverksanrop, sätter inga cookies och
   sparar inget i webbläsaren. All data går via appens adapter (window.NiemisHjalp.init({ feedback })).
   Allt ritas i Shadow DOM och läggs i webbläsarens top layer (Popover API och <dialog>), så att det
   syns och går att använda ovanpå appens egna dialoger. Se README.md. */
(function () {
  "use strict";
  if (window.NiemisHjalp && window.NiemisHjalp.version) return;

  var VERSION = "1.1.0";
  var IRIS_URL = "https://northern-lens-learning-quest.lovable.app/fraga?inbaddad=1&app=";
  var Z = 2147483000;
  var STATUS = {
    ny: "Ny",
    redo_att_testa: "Redo att testa",
    godkand: "Godkänd",
    ateroppnad: "Återöppnad",
  };
  var ORDER = { redo_att_testa: 0, ateroppnad: 1, ny: 2, godkand: 3 };

  var hasPopover = typeof HTMLElement !== "undefined" && Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover");
  var hasDialog = typeof HTMLDialogElement === "function" && typeof HTMLDialogElement.prototype.showModal === "function";

  var cfg = null;
  var host = null;
  var root = null;
  var btn = null;
  var badge = null;
  var menu = null;
  var dlg = null;
  var dlgTitle = null;
  var dlgBody = null;
  var hidden = false;
  var menuOpen = false;
  var dlgOpen = false;
  var readyCount = 0;
  var draft = { text: "", general: false, reporterId: "" };
  var shotUrl = null;
  var busyShot = false;
  var lastOutside = null; // senast fokuserade element i appen (utanför vår del)
  var prevFocus = null; // appens fokus innan vår del tog det, återställs när rutan stängs

  // ---------- Hjälpfunktioner ----------

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null || attrs[k] === false) continue;
        if (k === "text") el.textContent = attrs[k];
        else if (k === "on") for (var ev in attrs.on) el.addEventListener(ev, attrs.on[ev]);
        else if (k === "html") el.innerHTML = attrs[k]; // bara för våra egna fasta ikoner, aldrig data
        else el.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
      }
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function icon(path) {
    return (
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + path + "</svg>"
    );
  }
  var ICON_HELP = icon('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>');
  var ICON_CLOSE = icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

  function popShow(el) {
    if (hasPopover) {
      try {
        if (el.matches(":popover-open")) el.hidePopover();
        el.showPopover();
      } catch (e) {
        el.classList.add("open");
      }
    } else el.classList.add("open");
  }
  function popHide(el) {
    if (hasPopover) {
      try {
        if (el.matches(":popover-open")) el.hidePopover();
      } catch (e) {
        /* redan stängd */
      }
    }
    el.classList.remove("open");
  }

  function isMobile() {
    return window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
  }

  function errText(e) {
    if (!e) return "";
    if (typeof e === "string") return e;
    if (e.message) return String(e.message);
    return "";
  }

  function fmtDate(v) {
    if (!v) return "";
    var d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return "";
    try {
      return d.toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  function fb() {
    return (cfg && cfg.feedback) || {};
  }

  // ---------- Stil ----------

  var CSS =
    ":host{all:initial;pointer-events:auto!important;--navy:#2d3e66;--navy2:#24325a;--orange:#e6670c;--orange-strong:#b54d00;" +
    "--bg:#fff;--fg:#1f2a44;--muted:#5b6680;--line:#d9dee8;--hover:#eef1f7;--field:#fff;" +
    "--s-ny-bg:#eceef2;--s-ny:#4a5468;--s-redo-bg:#fdebdc;--s-redo:#9a4209;--s-ok-bg:#e1f3e6;--s-ok:#1e6b3a;" +
    "--s-ater-bg:#fde4ea;--s-ater:#a1203f;--err-bg:#fde4ea;--err:#a1203f;" +
    "}" +
    // Typsnittet sätts på det inre elementet: appens egna regler för värdelementet (t.ex. *{font-family:… !important})
    // vinner över :host, men når inte in i Shadow DOM.
    ".w{font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--fg);text-align:left;letter-spacing:normal}" +
    "@media (prefers-color-scheme:dark){:host{--bg:#1b2233;--fg:#eef1f7;--muted:#a8b1c4;--line:#34405c;--hover:#26304a;" +
    "--field:#141a28;--s-ny-bg:#2c3446;--s-ny:#c9cfdb;--s-redo-bg:#4a2a12;--s-redo:#ffb27a;--s-ok-bg:#163a24;--s-ok:#8fdcaa;" +
    "--s-ater-bg:#4a1a28;--s-ater:#ff9db3;--err-bg:#4a1a28;--err:#ff9db3}}" +
    "*{box-sizing:border-box;pointer-events:auto}" +
    "[hidden]{display:none!important}" +
    "button,textarea,select,input{font:inherit;color:inherit}" +
    // Knapp och meny: popover="manual" i top layer. Utan Popover API: fast position med högt z-index.
    ".pop{position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;color:var(--fg);display:none}" +
    ".pop:popover-open,.pop.open{display:block}" +
    ".nopop .pop{z-index:" + Z + "}" +
    ".fab{right:calc(16px + env(safe-area-inset-right));bottom:calc(var(--bm) + env(safe-area-inset-bottom))}" +
    ".fab button{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;width:48px;height:48px;" +
    "padding:0;border:0;border-radius:999px;background:var(--navy);color:#fff;font-weight:700;cursor:pointer;" +
    "box-shadow:0 6px 20px rgba(20,30,55,.35);-webkit-tap-highlight-color:transparent}" +
    ".fab button:hover{background:var(--navy2)}" +
    ".fab .lbl{display:none}" +
    "@media (min-width:768px){.fab{bottom:calc(var(--bd) + env(safe-area-inset-bottom))}" +
    ".fab button{width:auto;padding:0 20px 0 14px}.fab .lbl{display:inline}}" +
    ".badge{position:absolute;top:-6px;right:-6px;min-width:22px;height:22px;padding:0 6px;border-radius:999px;" +
    "background:var(--orange-strong);color:#fff;font:700 12px/22px system-ui,sans-serif;text-align:center;border:2px solid #fff}" +
    "button:focus{outline:none}button:focus-visible,select:focus-visible,textarea:focus-visible,input:focus-visible" +
    "{outline:3px solid var(--orange);outline-offset:2px}" +
    ".menu{right:calc(16px + env(safe-area-inset-right));bottom:calc(var(--bm) + 60px + env(safe-area-inset-bottom));" +
    "min-width:240px;max-width:calc(100vw - 32px);padding:6px;background:var(--bg);border:1px solid var(--line);border-radius:16px;" +
    "box-shadow:0 12px 32px rgba(20,30,55,.3)}" +
    "@media (min-width:768px){.menu{bottom:calc(var(--bd) + 60px + env(safe-area-inset-bottom))}}" +
    ".menu button{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:0 14px;border:0;border-radius:10px;" +
    "background:transparent;color:var(--fg);text-align:left;cursor:pointer;font-weight:600}" +
    ".menu button:hover,.menu button:focus-visible{background:var(--hover)}" +
    ".menu .ready{color:var(--s-redo)}" +
    ".dot{display:inline-block;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:var(--orange-strong);color:#fff;" +
    "font:700 12px/22px system-ui,sans-serif;text-align:center}" +
    // Rutorna: <dialog> med showModal(). Bottenark på mobil, centrerad ruta på dator.
    ".dlg{position:fixed;inset:auto 0 0 0;margin:0;width:100%;max-width:100%;max-height:92vh;max-height:92dvh;padding:0;border:0;" +
    "border-radius:18px 18px 0 0;background:var(--bg);color:var(--fg);box-shadow:0 -8px 40px rgba(20,30,55,.35);overflow:auto;" +
    "padding-bottom:env(safe-area-inset-bottom)}" +
    ".dlg:not([open]){display:none}" +
    ".dlg::backdrop{background:rgba(15,22,40,.5)}" +
    ".nodlg .dlg{z-index:" + (Z + 2) + "}" +
    ".nodlg .shade{position:fixed;inset:0;background:rgba(15,22,40,.5);z-index:" + (Z + 1) + "}" +
    "@media (min-width:768px){.dlg{inset:0;margin:auto;width:min(560px,calc(100vw - 48px));max-height:85vh;border-radius:18px}}" +
    ".head{position:sticky;top:0;display:flex;align-items:center;gap:8px;padding:12px 12px 8px 20px;background:var(--bg);z-index:1}" +
    ".head h2{flex:1;margin:0;font-size:19px;line-height:1.3;font-weight:700}" +
    ".x{width:48px;height:48px;border:0;border-radius:999px;background:transparent;color:var(--fg);cursor:pointer;display:inline-flex;" +
    "align-items:center;justify-content:center}.x:hover{background:var(--hover)}" +
    ".body{padding:4px 20px 20px}" +
    "label,.lab{display:block;font-weight:600;margin:14px 0 6px}" +
    "textarea,select{display:block;width:100%;min-height:48px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;" +
    "background:var(--field);font-size:16px}" +
    "textarea{min-height:120px;resize:vertical}" +
    "[aria-invalid=true]{border-color:var(--err)}" +
    ".seg{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0;padding:0;border:0;min-width:0}" +
    ".seg label{flex:1 1 140px;display:flex;align-items:center;gap:10px;min-height:48px;margin:0;padding:0 12px;border:1px solid var(--line);" +
    "border-radius:10px;font-weight:500;cursor:pointer}" +
    ".seg input{width:20px;height:20px;margin:0;accent-color:var(--navy)}" +
    ".seg label:has(input:checked){border-color:var(--navy);box-shadow:inset 0 0 0 1px var(--navy)}" +
    ".shot{margin-top:14px;padding:10px;border:1px solid var(--line);border-radius:10px}" +
    ".shot img{display:block;max-width:100%;max-height:220px;margin:0 auto 8px;border-radius:6px;border:1px solid var(--line)}" +
    ".row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}" +
    ".b{min-height:48px;padding:0 18px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--fg);" +
    "font-weight:600;cursor:pointer}" +
    ".b:hover{background:var(--hover)}" +
    ".b.p{background:var(--navy);border-color:var(--navy);color:#fff}.b.p:hover{background:var(--navy2)}" +
    ".b.o{background:var(--orange-strong);border-color:var(--orange-strong);color:#fff}" +
    ".b[disabled]{opacity:.55;cursor:default}" +
    ".hint{color:var(--muted);font-size:14px;margin:6px 0 0}" +
    ".err{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:var(--err-bg);color:var(--err);font-weight:600}" +
    ".ok{padding:8px 0}.ok p{margin:0 0 8px}" +
    ".list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}" +
    ".item{padding:12px 14px;border:1px solid var(--line);border-radius:12px}" +
    ".item.r{border-color:var(--orange);box-shadow:inset 3px 0 0 var(--orange)}" +
    ".meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:13px}" +
    ".st{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:700}" +
    ".st-ny{background:var(--s-ny-bg);color:var(--s-ny)}.st-redo_att_testa{background:var(--s-redo-bg);color:var(--s-redo)}" +
    ".st-godkand{background:var(--s-ok-bg);color:var(--s-ok)}.st-ateroppnad{background:var(--s-ater-bg);color:var(--s-ater)}" +
    ".txt{margin:8px 0 0;white-space:pre-wrap;word-break:break-word}" +
    ".ans{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:var(--hover);white-space:pre-wrap;word-break:break-word}" +
    ".q{margin:10px 0 0;font-weight:600}" +
    "@media print{.pop,.dlg{display:none!important}}";

  // ---------- Montering ----------

  function mount() {
    if (host || !document.body) return;
    var el = document.createElement("div");
    if (!el.attachShadow) return; // utan Shadow DOM kan appens CSS krocka – då ingen knapp
    host = el;
    host.id = "niemis-hjalp";
    host.setAttribute("data-niemis-hjalp", VERSION);
    // Appens modala dialog (Radix/shadcn) sätter body{pointer-events:none}. Värdelementet tar tillbaka klicken.
    host.style.setProperty("pointer-events", "auto", "important");
    root = host.attachShadow({ mode: "open" });
    var wrap = h("div", { class: "w" + (hasPopover ? "" : " nopop") + (hasDialog ? "" : " nodlg") });
    root.appendChild(h("style", { text: CSS }));
    root.appendChild(wrap);

    badge = h("span", { class: "badge", "aria-hidden": "true", hidden: true });
    btn = h(
      "button",
      { type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "bh-meny", on: { click: toggleMenu } },
      [h("span", { html: ICON_HELP, style: "display:inline-flex" }), h("span", { class: "lbl", text: "Hjälp" }), badge]
    );
    var fab = h("div", { class: "pop fab", part: "knapp" }, [btn]);
    menu = h("div", { class: "pop menu", id: "bh-meny", role: "menu", "aria-label": "Hjälp" });
    if (hasPopover) {
      fab.setAttribute("popover", "manual");
      menu.setAttribute("popover", "manual");
    }
    dlgTitle = h("h2", { id: "bh-titel" });
    dlgBody = h("div", { class: "body" });
    dlg = h("dialog", { class: "dlg", "aria-labelledby": "bh-titel", "aria-modal": "true" }, [
      h("div", { class: "head" }, [
        dlgTitle,
        h("button", { type: "button", class: "x", "aria-label": "Stäng", html: ICON_CLOSE, on: { click: closeDialog } }),
      ]),
      dlgBody,
    ]);
    dlg.addEventListener("close", onDialogClosed);
    dlg.addEventListener("cancel", function () {
      // Escape stänger rutan. Texten finns kvar i minnet (draft) tills sidan laddas om.
      saveDraftFromForm();
    });
    wrap.appendChild(fab);
    wrap.appendChild(menu);
    wrap.appendChild(dlg);
    document.body.appendChild(host);

    shield();
    applyPosition();
    renderMenu();
    if (!hidden) popShow(fab);

    // Klick utanför menyn stänger den (menyns egna klick stoppas vid värdelementet och syns inte här).
    document.addEventListener("pointerdown", function () {
      if (menuOpen) closeMenu(false);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refresh();
    });
  }

  // Ovanpå appens dialoger: appar med Radix/shadcn lyssnar på document efter pointerdown (stäng vid klick
  // utanför), focusin/focusout (fokusfälla som drar tillbaka fokus) och keydown (Escape, i capture-fasen).
  // Händelser i vår Shadow DOM bubblar via värdelementet till document. Vi stoppar dem vid värdelementet,
  // så att appens dialog inte ser dem: den stänger sig inte och tar inte tillbaka fokus. Två fall går inte
  // att stoppa vid värdelementet och fångas därför tidigt på window, bara när de rör vår del:
  //  - keydown: Radix lyssnar efter Escape i capture-fasen på document, alltså innan händelsen når oss.
  //  - focusout: den skickas från appens fält (inte från oss) när fokus flyttas in till vår del.
  function shield() {
    ["pointerdown", "mousedown", "touchstart", "focusin", "focusout", "keydown"].forEach(function (type) {
      host.addEventListener(type, function (e) {
        e.stopPropagation();
      });
    });
    window.addEventListener(
      "keydown",
      function (e) {
        // Medan vår modala ruta är öppen hör alla tangenter till den, även om fokus hamnat på body
        // (t.ex. när en knapp låses under sparning). Annars skulle Escape stänga appens dialog.
        if (!inside(e) && !(dlgOpen && hasDialog && dlg.open)) return; // dlg.open: misslyckas showModal låses aldrig appens tangentbord
        e.stopPropagation(); // standardbeteendet (skriva, Tab, Enter, Escape för <dialog>) påverkas inte
        onKey(e);
      },
      true
    );
    window.addEventListener(
      "focusin",
      function (e) {
        if (!inside(e) && e.target !== document.body) lastOutside = e.target;
      },
      true
    );
    window.addEventListener(
      "focusout",
      function (e) {
        if (e.relatedTarget === host && !inside(e)) e.stopPropagation();
      },
      true
    );
    // Radix döljer allt utanför sin dialog för skärmläsare (aria-hidden) och vissa appar sätter inert.
    // Vår del ska fortsätta vara nåbar, så de attributen tas bort från värdelementet.
    new MutationObserver(function () {
      if (host.hasAttribute("aria-hidden")) host.removeAttribute("aria-hidden");
      if (host.hasAttribute("inert")) host.removeAttribute("inert");
    }).observe(host, { attributes: true, attributeFilter: ["aria-hidden", "inert"] });
  }

  function inside(e) {
    var p = e.composedPath ? e.composedPath() : [];
    return p.indexOf(host) >= 0;
  }

  function applyPosition() {
    if (!host || !cfg) return;
    host.style.setProperty("--bd", cfg.bottom + "px");
    host.style.setProperty("--bm", cfg.bottomMobile + "px");
  }

  // ---------- Knapp och meny ----------

  function menuItems() {
    return Array.prototype.slice.call(menu.querySelectorAll("button"));
  }

  function renderMenu() {
    if (!menu) return;
    menu.textContent = "";
    var a = fb();
    var items = [];
    if (cfg && cfg.iris) items.push(["Fråga Iris", openIris, ""]);
    if (a.submit) items.push(["Ge feedback", openFeedback, ""]);
    if (a.listMine) items.push(["Min feedback", openMine, ""]);
    if (a.listMine && readyCount > 0) items.push([readyCount + " redo att testa", openMine, "ready"]);
    items.forEach(function (it) {
      var b = h("button", { type: "button", role: "menuitem", tabindex: "-1", class: it[2] || null }, [
        it[2] ? h("span", { class: "dot", text: String(readyCount), "aria-hidden": "true" }) : null,
        h("span", { text: it[2] ? "Redo att testa" : it[0] }),
      ]);
      if (it[2]) b.setAttribute("aria-label", it[0]);
      b.addEventListener("click", function () {
        closeMenu(false);
        it[1]();
      });
      menu.appendChild(b);
    });
  }

  function renderBadge() {
    if (!btn) return;
    badge.hidden = readyCount <= 0;
    badge.textContent = readyCount > 9 ? "9+" : String(readyCount);
    btn.setAttribute("aria-label", readyCount > 0 ? "Hjälp, " + readyCount + " redo att testa" : "Hjälp");
    btn.title = "Hjälp";
  }

  function toggleMenu() {
    if (menuOpen) closeMenu(true);
    else openMenu();
  }

  function rememberFocus() {
    var a = document.activeElement;
    if (a && a !== host && a !== document.body) prevFocus = a;
    else if (lastOutside && lastOutside.isConnected) prevFocus = lastOutside;
  }

  function openMenu() {
    if (!menu || hidden) return;
    rememberFocus();
    renderMenu();
    menuOpen = true;
    btn.setAttribute("aria-expanded", "true");
    popShow(menu);
    var first = menuItems()[0];
    if (first) first.focus();
  }

  function closeMenu(focusBtn) {
    if (!menu) return;
    var was = menuOpen;
    menuOpen = false;
    btn.setAttribute("aria-expanded", "false");
    popHide(menu);
    if (was && focusBtn) btn.focus();
  }

  function onKey(e) {
    if (!menuOpen || dlgOpen) return;
    var items = menuItems();
    var i = items.indexOf(root.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      var n = items.length;
      var next = e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
      if (items[next]) items[next].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      var t = items[e.key === "Home" ? 0 : items.length - 1];
      if (t) t.focus();
    } else if (e.key === "Tab") {
      closeMenu(false);
    }
  }

  // ---------- Fråga Iris ----------

  function openIris() {
    var url = IRIS_URL + encodeURIComponent(cfg.app);
    if (isMobile()) {
      window.open(url, "_blank", "noopener");
      return;
    }
    var w = 420;
    var hh = 640;
    var left = Math.max(0, (window.screenX || 0) + (window.outerWidth || w) - w - 24);
    var top = Math.max(0, (window.screenY || 0) + (window.outerHeight || hh) - hh - 48);
    var popup = window.open(url, "binokel-iris", "popup,width=" + w + ",height=" + hh + ",left=" + left + ",top=" + top);
    if (popup) popup.focus();
    else window.open(url, "_blank", "noopener");
  }

  // ---------- Rutan ----------

  function showDialog(title) {
    dlgTitle.textContent = title;
    if (!dlgOpen) {
      var modal = false;
      if (hasDialog) {
        try {
          dlg.showModal();
          modal = true;
        } catch (err) {
          modal = false; // t.ex. om elementet inte är anslutet; visa rutan utan top layer i stället
        }
      }
      if (!modal) {
        dlg.setAttribute("open", "");
        dlg.parentNode.insertBefore(h("div", { class: "shade" }), dlg);
      }
      dlgOpen = true;
    }
  }

  function closeDialog() {
    saveDraftFromForm();
    if (hasDialog) {
      if (dlg.open) dlg.close();
    } else {
      dlg.removeAttribute("open");
      onDialogClosed();
    }
  }

  function onDialogClosed() {
    dlgOpen = false;
    var shade = root.querySelector(".shade");
    if (shade) shade.remove();
    dlgBody.textContent = "";
    if (shotUrl) {
      URL.revokeObjectURL(shotUrl);
      shotUrl = null;
    }
    // Tillbaka till där användaren var, t.ex. fältet i appens öppna dialog.
    var back = prevFocus;
    prevFocus = null;
    setTimeout(function () {
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
      else if (btn && !hidden) btn.focus();
    }, 0);
  }

  var formRefs = null;
  function saveDraftFromForm() {
    if (!formRefs || !formRefs.ta.isConnected) return;
    draft.text = formRefs.ta.value;
    draft.general = formRefs.general.checked;
    if (formRefs.sel) draft.reporterId = formRefs.sel.value;
  }

  // ---------- Ge feedback ----------

  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function (resolve) {
        setTimeout(function () {
          resolve(null);
        }, ms);
      }),
    ]);
  }

  async function openFeedback() {
    var a = fb();
    if (!a.submit || busyShot) return;
    if (dlgOpen) closeDialog();
    closeMenu(false);
    var shot = null;
    var shotFailed = false;
    if (typeof a.captureScreenshot === "function") {
      // Skärmbilden tas innan rutan öppnas, med vår egen knapp dold, så att den visar appen.
      busyShot = true;
      host.style.visibility = "hidden";
      try {
        shot = await withTimeout(Promise.resolve(a.captureScreenshot()), 8000);
        if (!(shot instanceof Blob)) shot = null;
      } catch (e) {
        shot = null;
        shotFailed = true;
      }
      host.style.visibility = "";
      busyShot = false;
    }
    renderFeedback(shot, shotFailed);
  }

  function renderFeedback(shot, shotFailed) {
    var a = fb();
    showDialog("Ge feedback");
    dlgBody.textContent = "";
    var ta = h("textarea", {
      id: "bh-text",
      rows: "5",
      maxlength: "5000",
      placeholder: "Beskriv vad som är fel eller vad som kan bli bättre.",
    });
    ta.value = draft.text || "";
    var page = h("input", { type: "radio", name: "bh-galler", value: "sida" });
    var general = h("input", { type: "radio", name: "bh-galler", value: "app" });
    page.checked = !draft.general;
    general.checked = !!draft.general;
    var shotBox = null;
    var shotNote = h("p", { class: "hint", hidden: true, text: "Skärmbilden skickas bara när feedbacken gäller den här sidan." });
    if (shot) {
      if (shotUrl) URL.revokeObjectURL(shotUrl);
      shotUrl = URL.createObjectURL(shot);
      shotBox = h("div", { class: "shot" }, [
        h("img", { src: shotUrl, alt: "Skärmbild av sidan" }),
        h("button", {
          type: "button",
          class: "b",
          text: "Ta bort skärmbilden",
          on: {
            click: function () {
              shot = null;
              shotBox.remove();
              shotNote.hidden = true;
            },
          },
        }),
      ]);
    }
    var sync = function () {
      if (shotBox) shotBox.hidden = general.checked;
      shotNote.hidden = !(shot && general.checked);
    };
    page.addEventListener("change", sync);
    general.addEventListener("change", sync);

    var selWrap = h("div", { hidden: true });
    var sel = null;
    var people = [];
    var err = h("p", { class: "err", role: "alert", hidden: true });
    var send = h("button", { type: "submit", class: "b p", text: "Skicka" });
    var form = h("form", { novalidate: true }, [
      h("label", { for: "bh-text", text: "Vad vill du berätta?" }),
      ta,
      h("fieldset", { class: "seg" }, [
        h("legend", { class: "lab", text: "Vad gäller det?" }),
        h("label", {}, [page, "Gäller den här sidan"]),
        h("label", {}, [general, "Gäller hela appen"]),
      ]),
      shotBox,
      shotFailed ? h("p", { class: "hint", text: "Skärmbilden gick inte att ta. Du kan skicka utan den." }) : null,
      shotNote,
      selWrap,
      err,
      h("div", { class: "row" }, [send, h("button", { type: "button", class: "b", text: "Avbryt", on: { click: closeDialog } })]),
    ]);
    dlgBody.appendChild(form);
    formRefs = { ta: ta, general: general, sel: null };
    sync();

    if (typeof a.reporters === "function") {
      selWrap.hidden = false;
      selWrap.appendChild(h("p", { class: "hint", text: "Hämtar personer …" }));
      Promise.resolve()
        .then(function () {
          return a.reporters();
        })
        .then(function (list) {
          selWrap.textContent = "";
          people = Array.isArray(list) ? list : [];
          if (!people.length) {
            selWrap.hidden = true;
            return;
          }
          sel = h("select", { id: "bh-person", required: true }, [h("option", { value: "", text: "Välj ditt namn" })]);
          people.forEach(function (p) {
            sel.appendChild(h("option", { value: String(p.id), text: String(p.name) }));
          });
          if (draft.reporterId) sel.value = draft.reporterId;
          sel.addEventListener("change", function () {
            sel.removeAttribute("aria-invalid");
            err.hidden = true;
          });
          selWrap.appendChild(h("label", { for: "bh-person", text: "Vem lämnar feedbacken?" }));
          selWrap.appendChild(sel);
          formRefs.sel = sel;
        })
        .catch(function () {
          selWrap.textContent = "";
          selWrap.appendChild(h("p", { class: "hint", text: "Det gick inte att hämta listan med personer." }));
        });
    }

    ta.addEventListener("input", function () {
      ta.removeAttribute("aria-invalid");
      err.hidden = true;
    });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      err.hidden = true;
      var text = ta.value.trim();
      if (!text) {
        ta.setAttribute("aria-invalid", "true");
        err.textContent = "Skriv vad det gäller innan du skickar.";
        err.hidden = false;
        ta.focus();
        return;
      }
      if (sel && !sel.value) {
        sel.setAttribute("aria-invalid", "true");
        err.textContent = "Välj vem som lämnar feedbacken.";
        err.hidden = false;
        sel.focus();
        return;
      }
      send.disabled = true;
      send.textContent = "Skickar …";
      var isGeneral = general.checked;
      var res;
      try {
        res = await a.submit({
          text: text,
          general: isGeneral,
          // Bara sökvägen: en frågesträng kan innehålla känsliga uppgifter.
          route: location.pathname,
          screenshot: isGeneral ? null : shot || null,
          reporterId: sel && sel.value ? sel.value : null,
        });
      } catch (ex) {
        res = { ok: false, message: errText(ex) };
      }
      if (!dlgOpen) return;
      if (res && res.ok) {
        // Personen på butikens delade konto minns till nästa gång (bara i minnet).
        draft = { text: "", general: false, reporterId: sel && sel.value ? sel.value : draft.reporterId };
        renderThanks(res.message);
        refresh();
        return;
      }
      send.disabled = false;
      send.textContent = "Skicka";
      var m = res && res.message ? String(res.message) : "";
      err.textContent = "Det gick inte att skicka feedbacken." + (m ? " " + m : " Försök igen om en stund.");
      err.hidden = false;
    });
    setTimeout(function () {
      ta.focus();
    }, 0);
  }

  function renderThanks(message) {
    formRefs = null;
    dlgTitle.textContent = "Tack!";
    dlgBody.textContent = "";
    var close = h("button", { type: "button", class: "b p", text: "Stäng", on: { click: closeDialog } });
    dlgBody.appendChild(
      h("div", { class: "ok", role: "status" }, [
        h("p", { text: "Din feedback har skickats." }),
        message ? h("p", { text: String(message) }) : null,
        h("p", { class: "hint", text: "Du ser vad som händer med den under Min feedback." }),
        h("div", { class: "row" }, [
          close,
          fb().listMine ? h("button", { type: "button", class: "b", text: "Visa min feedback", on: { click: openMine } }) : null,
        ]),
      ])
    );
    close.focus();
  }

  // ---------- Min feedback ----------

  function openMine() {
    var a = fb();
    if (!a.listMine) return;
    closeMenu(false);
    formRefs = null;
    showDialog("Min feedback");
    loadMine();
  }

  async function loadMine(notice) {
    var a = fb();
    dlgBody.textContent = "";
    dlgBody.appendChild(h("p", { class: "hint", role: "status", text: "Hämtar din feedback …" }));
    var list;
    try {
      list = await a.listMine();
    } catch (e) {
      if (!dlgOpen) return;
      dlgBody.textContent = "";
      dlgBody.appendChild(h("p", { class: "err", role: "alert", text: "Det gick inte att hämta din feedback. " + errText(e) }));
      dlgBody.appendChild(h("div", { class: "row" }, [h("button", { type: "button", class: "b p", text: "Försök igen", on: { click: function () { loadMine(); } } })]));
      return;
    }
    if (!dlgOpen) return;
    list = (Array.isArray(list) ? list : []).filter(function (x) {
      return x && STATUS[x.status];
    });
    setCount(countReady(list));
    list.sort(function (x, y) {
      var d = ORDER[x.status] - ORDER[y.status];
      if (d) return d;
      return String(y.updatedAt || y.createdAt || "").localeCompare(String(x.updatedAt || x.createdAt || ""));
    });
    dlgBody.textContent = "";
    if (notice) dlgBody.appendChild(h("p", { class: "ok", role: "status", text: notice }));
    if (!list.length) {
      dlgBody.appendChild(h("p", { text: "Du har inte lämnat någon feedback än." }));
      return;
    }
    var ready = countReady(list);
    if (ready) {
      dlgBody.appendChild(
        h("p", { class: "hint", text: ready === 1 ? "1 punkt är redo att testa. Prova i appen och svara." : ready + " punkter är redo att testa. Prova i appen och svara." })
      );
    }
    var ul = h("ul", { class: "list" });
    list.forEach(function (item) {
      ul.appendChild(renderItem(item));
    });
    dlgBody.appendChild(ul);
  }

  function renderItem(item) {
    var a = fb();
    var isReady = item.status === "redo_att_testa";
    var li = h("li", { class: "item" + (isReady ? " r" : ""), "data-id": String(item.id), "data-status": item.status }, [
      h("div", { class: "meta" }, [
        h("span", { class: "st st-" + item.status, text: STATUS[item.status] }),
        item.number != null ? h("span", { text: "#" + item.number }) : null,
        h("span", { text: fmtDate(item.createdAt) }),
      ]),
      h("p", { class: "txt", text: String(item.text || "") }),
      item.answer ? h("p", { class: "ans" }, [h("strong", { text: "Svar: " }), String(item.answer)]) : null,
    ]);
    if (!isReady || !a.approve || !a.reopen) return li;

    var err = h("p", { class: "err", role: "alert", hidden: true });
    var yes = h("button", { type: "button", class: "b p", text: "Ja, det fungerar" });
    var no = h("button", { type: "button", class: "b", text: "Nej, fortfarande fel" });
    var noteId = "bh-not-" + String(item.id).replace(/[^a-zA-Z0-9_-]/g, "");
    var note = h("textarea", { id: noteId, rows: "3", maxlength: "2000" });
    var sendNo = h("button", { type: "button", class: "b o", text: "Skicka" });
    var reopenBox = h("div", { hidden: true }, [
      h("label", { for: noteId, text: "Vad är fortfarande fel? (måste fyllas i)" }),
      note,
      h("div", { class: "row" }, [
        sendNo,
        h("button", {
          type: "button",
          class: "b",
          text: "Avbryt",
          on: {
            click: function () {
              reopenBox.hidden = true;
              buttons.hidden = false;
              err.hidden = true;
              no.focus();
            },
          },
        }),
      ]),
    ]);
    var buttons = h("div", { class: "row" }, [yes, no]);
    li.appendChild(h("p", { class: "q", text: "Fungerar det nu?" }));
    li.appendChild(buttons);
    li.appendChild(reopenBox);
    li.appendChild(err);

    var fail = function (e, b, label) {
      err.textContent = "Det gick inte att spara svaret. " + (errText(e) || "Försök igen.");
      err.hidden = false;
      b.disabled = false;
      b.textContent = label;
    };
    yes.addEventListener("click", async function () {
      err.hidden = true;
      yes.disabled = true;
      yes.textContent = "Sparar …";
      try {
        await a.approve(item.id);
      } catch (e) {
        return fail(e, yes, "Ja, det fungerar");
      }
      refresh();
      if (dlgOpen) loadMine("Tack! Punkten är markerad som godkänd.");
    });
    no.addEventListener("click", function () {
      buttons.hidden = true;
      reopenBox.hidden = false;
      note.focus();
    });
    note.addEventListener("input", function () {
      note.removeAttribute("aria-invalid");
      err.hidden = true;
    });
    sendNo.addEventListener("click", async function () {
      var text = note.value.trim();
      if (!text) {
        note.setAttribute("aria-invalid", "true");
        err.textContent = "Skriv vad som fortfarande är fel innan du skickar.";
        err.hidden = false;
        note.focus();
        return;
      }
      err.hidden = true;
      sendNo.disabled = true;
      sendNo.textContent = "Skickar …";
      try {
        await a.reopen(item.id, text);
      } catch (e) {
        return fail(e, sendNo, "Skicka");
      }
      refresh();
      if (dlgOpen) loadMine("Tack! Punkten är återöppnad och går tillbaka till den som rättar.");
    });
    return li;
  }

  // ---------- Räkning ----------

  function countReady(list) {
    return (list || []).filter(function (x) {
      return x && x.status === "redo_att_testa";
    }).length;
  }

  function setCount(n) {
    readyCount = n > 0 ? n : 0;
    renderBadge();
    if (!menuOpen) renderMenu();
  }

  var refreshSeq = 0;
  function refresh() {
    var a = fb();
    if (!a.listMine) {
      setCount(0);
      return Promise.resolve(0);
    }
    var seq = ++refreshSeq;
    return Promise.resolve()
      .then(function () {
        return a.listMine();
      })
      .then(function (list) {
        if (seq === refreshSeq) setCount(countReady(list));
        return readyCount;
      })
      .catch(function () {
        return readyCount; // tyst: knappen fungerar ändå
      });
  }

  // ---------- Publikt API ----------

  function init(options) {
    var o = options || {};
    var app = String(o.app || "").toLowerCase();
    if (!/^[a-z0-9-]{1,40}$/.test(app)) {
      if (window.console) console.warn("[NiemisHjalp] app ska vara a–z, 0–9 och -. Använder 'annan'.");
      app = "annan";
    }
    var num = function (v, d) {
      var n = typeof v === "number" ? v : parseInt(v, 10);
      return n >= 0 && n <= 400 ? n : d;
    };
    var bottom = num(o.bottom, 16);
    cfg = {
      app: app,
      iris: o.iris !== false,
      bottom: bottom,
      bottomMobile: num(o.bottomMobile, bottom),
      feedback: o.feedback && typeof o.feedback === "object" ? o.feedback : {},
    };
    var go = function () {
      mount();
      applyPosition();
      renderMenu();
      renderBadge();
      refresh();
    };
    if (document.body) go();
    else document.addEventListener("DOMContentLoaded", go);
    return api;
  }

  function need() {
    if (!cfg) throw new Error("[NiemisHjalp] Anropa init() först.");
  }

  var api = {
    version: VERSION,
    init: init,
    refresh: function () {
      if (!cfg) return Promise.resolve(0);
      return refresh();
    },
    hide: function () {
      hidden = true;
      if (!btn) return;
      closeMenu(false);
      popHide(btn.parentNode);
    },
    show: function () {
      hidden = false;
      if (btn) popShow(btn.parentNode);
    },
    openFeedback: function () {
      need();
      mount();
      if (!menuOpen && !dlgOpen) rememberFocus();
      return openFeedback();
    },
    openMine: function () {
      need();
      mount();
      if (!menuOpen && !dlgOpen) rememberFocus();
      openMine();
    },
    // Vid utloggning: stäng allt och glöm utkast, vald person och räkning, så att nästa person
    // på samma enhet inte ser något av det.
    reset: function () {
      refreshSeq++;
      draft = { text: "", general: false, reporterId: "" };
      formRefs = null; // så att stängningen inte sparar tillbaka den gamla texten som utkast
      if (btn) closeMenu(false);
      if (dlg && dlgOpen) {
        if (hasDialog) {
          if (dlg.open) dlg.close();
        } else {
          dlg.removeAttribute("open");
          onDialogClosed();
        }
      }
      setCount(0);
    },
  };
  window.NiemisHjalp = Object.freeze(api);
  try {
    window.dispatchEvent(new CustomEvent("niemis-hjalp:klar"));
  } catch (e) {
    /* gamla webbläsare */
  }
})();
