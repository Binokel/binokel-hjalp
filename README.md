# niemis-hjalp

Gemensam Hjälp- och feedbackdel för alla Binokels interna appar (Säljstödet, Personalappen, Insikt, Kunduppföljning, GlasFlow, Synpunkten, Optic Measure, Spargris, Anamnesportalen och Academy).

Daniel bestämde 2026-11-09 att alla appar ska ha en och samma Hjälp-knapp nere till höger, med **Fråga Iris** och **Ge feedback**. Delen är en enda fil, `hjalp.js`, som varje app läser in när den startar. En ändring här når alltså alla appar på en gång.

## Vad delen gör

- **Hjälp-knappen** nere till höger (rund 48 px med frågetecken på mobil, "Hjälp" med text från 768 px). En orange siffra visar hur många av dina egna punkter som är redo att testa.
- **Menyn:** Fråga Iris, Ge feedback, Min feedback och "N redo att testa" när det finns sådana.
- **Fråga Iris** öppnar Academys Iris (`/fraga?inbaddad=1&app=<app>`) som popup på dator och i en ny flik på mobil.
- **Ge feedback:** fritext, "Gäller den här sidan" eller "Gäller hela appen", skärmbild med förhandsvisning (om appen kan ta en), personväljare för butikens delade konto (om appen har en), kvittens och tydliga felmeddelanden.
- **Min feedback:** dina punkter med status. Punkter som är redo att testa visas först, med knapparna "Ja, det fungerar" och "Nej, fortfarande fel" (kommentar krävs).
- Allt ligger **ovanpå appens dialoger och popup-rutor** och går att använda medan en sådan är öppen, utan att appens dialog stängs.

## Koppla in en app

### 1. Scriptraden

Lägg raden i `index.html`, före appens eget script:

```html
<script src="https://binokel.github.io/niemis-hjalp/hjalp.js" defer></script>
```

Scriptet skapar `window.NiemisHjalp` och skickar händelsen `niemis-hjalp:klar` på `window` när det är laddat.

### 2. Adaptern

Delen vet ingenting om appens databas. Appen ger den en adapter med sina egna funktioner:

```js
window.NiemisHjalp.init({
  app: "saljstodet",            // a–z, 0–9 och -
  iris: true,                   // visar "Fråga Iris" (false döljer den)
  bottom: 16,                   // avstånd från nederkanten i px från 768 px bredd
  bottomMobile: 72,             // avstånd på mobil, så att knappen går fri från bottenmenyn
  feedback: {
    submit({ text, general, route, screenshot, reporterId }) {},  // => Promise<{ ok, message? }>
    listMine() {},              // => Promise<Array<{ id, text, status, createdAt, updatedAt, answer?, number? }>>
    approve(id) {},             // => Promise<void>, bara rapportören (kontrolleras på servern)
    reopen(id, note) {},        // => Promise<void>, note är alltid ifylld
    captureScreenshot() {},     // valfri => Promise<Blob|null>
    reporters() {},             // valfri => Promise<Array<{ id, name }>>, tom lista = personligt konto
  },
});
```

- `status` är en av `ny`, `redo_att_testa`, `godkand` och `ateroppnad`.
- `route` är bara sökvägen (`location.pathname`), aldrig frågesträngen.
- `screenshot` är `null` när feedbacken gäller hela appen eller när användaren tog bort bilden.
- `reporterId` är `null` om appen inte har `reporters` eller om listan är tom.
- Kasta ett fel eller svara `{ ok: false, message }` så visar delen meddelandet för användaren.

Övriga anrop:

```js
window.NiemisHjalp.refresh();       // hämta ny räkning, t.ex. efter inloggning
window.NiemisHjalp.hide();          // dölj knappen, t.ex. i kundvända vyer
window.NiemisHjalp.show();
window.NiemisHjalp.openFeedback();  // öppna Ge feedback från appens egen knapp
window.NiemisHjalp.openMine();      // öppna Min feedback, t.ex. från en banner
window.NiemisHjalp.reset();         // vid utloggning: stänger rutan och glömmer utkast, vald person och räkning
```

### 3. Exempel: React och Supabase

```tsx
// src/components/hjalp-adapter.tsx
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const STATUS: Record<string, string> = {
  new: "ny",
  ready_to_test: "redo_att_testa",
  approved: "godkand",
  reopened: "ateroppnad",
};

export function HjalpAdapter() {
  const { user } = useAuth();

  useEffect(() => {
    const start = () =>
      window.NiemisHjalp?.init({
        app: "saljstodet",
        iris: true,
        bottom: 16,
        bottomMobile: 72,
        feedback: {
          async submit({ text, general, route, screenshot, reporterId }) {
            let screenshot_path: string | null = null;
            if (screenshot) {
              const path = `${user!.id}/${crypto.randomUUID()}.png`;
              const { error } = await supabase.storage.from("feedback").upload(path, screenshot);
              if (error) return { ok: false, message: error.message };
              screenshot_path = path;
            }
            const { error } = await supabase.rpc("submit_feedback", {
              p_text: text,
              p_general: general,
              p_route: route,
              p_screenshot_path: screenshot_path,
              p_reporter_id: reporterId,
            });
            return error ? { ok: false, message: error.message } : { ok: true };
          },
          async listMine() {
            const { data, error } = await supabase.rpc("list_my_feedback");
            if (error) throw error;
            return data.map((r) => ({
              id: r.id,
              number: r.number,
              text: r.text,
              answer: r.answer,
              status: STATUS[r.status] ?? "ny",
              createdAt: r.created_at,
              updatedAt: r.updated_at,
            }));
          },
          async approve(id) {
            const { error } = await supabase.rpc("respond_to_feedback", { p_id: id, p_works: true });
            if (error) throw error;
          },
          async reopen(id, note) {
            const { error } = await supabase.rpc("respond_to_feedback", { p_id: id, p_works: false, p_note: note });
            if (error) throw error;
          },
          // valfria:
          // captureScreenshot: () => takeScreenshot(),        // t.ex. med html2canvas
          // reporters: () => loadStaffForSharedAccount(),     // [] för personliga konton
        },
      });

    if (window.NiemisHjalp) start();
    else window.addEventListener("niemis-hjalp:klar", start, { once: true });
  }, [user]);

  return null;
}
```

Montera `<HjalpAdapter />` en gång i appens rot, och ta bort appens egen feedbackknapp och Academys gamla `iris.js` (komponenten FragaIris) när den gemensamma är på plats, så att det bara finns en Hjälp-knapp. För TypeScript räcker en enkel deklaration, t.ex. `declare global { interface Window { NiemisHjalp?: any } }`.

## Statusflödet

```
Ny → Redo att testa → Godkänd
                    ↘ Återöppnad (med kommentar) → Redo att testa …
```

- **Ny:** punkten är skickad.
- **Redo att testa:** sätts av den som rättar, först när rättningen är publicerad och verifierad i produktion.
- **Godkänd:** sätts **bara av den som rapporterade**, med "Ja, det fungerar". Admin och agenter sätter aldrig Godkänd åt rapportören. Appen ska kontrollera det på servern.
- **Återöppnad:** rapportören svarar "Nej, fortfarande fel" och måste skriva en kommentar.

Listan hämtas alltid från appens adapter, så samma punkter syns på alla enheter.

## Regler

- **Ingen data om användaren.** Delen gör inga egna nätverksanrop, sätter inga cookies och sparar inget i webbläsaren. All data går via appens adapter och appens egen inloggning. Testerna kontrollerar att koden saknar `fetch`, `XMLHttpRequest`, `document.cookie`, `sendBeacon`, `WebSocket` och webbläsarlagring. Ett påbörjat utkast finns bara i minnet tills sidan laddas om.
- **Shadow DOM.** Appens CSS når inte in och delens CSS når inte ut.
- **Ovanpå allt (top layer).** Knappen och menyn är `popover="manual"` och visas med `showPopover()`. Rutorna är `<dialog>` som öppnas med `showModal()`. Webbläsare utan Popover API får `z-index: 2147483000`.
- **Appens dialoger påverkas inte.** Radix/shadcn-dialoger sätter `body { pointer-events: none }`, fångar fokus och stänger sig vid klick utanför. Därför har värdelementet `pointer-events: auto`, och `pointerdown`, `mousedown`, `touchstart`, `focusin`, `focusout` och `keydown` stoppas vid värdelementet så att de inte når `document`. Escape och fokusflyttar in i delen fångas även tidigt på `window`. När rutan stängs går fokus tillbaka dit användaren var, och appens dialog är fortfarande öppen.
- **Samma utseende i alla appar:** mörkblå `#2d3e66`, orange `#e6670c`, systemtypsnittet och mörkt läge enligt `prefers-color-scheme`.
- **Ren JavaScript (ES2018)** utan beroenden och utan byggsteg, under cirka 40 kB.

## Tester

```
node test/run.js
```

Testerna kör Playwright med Chromium, med iPhone 13-emulering och på dator, mot `test/app.html`. Sidan efterliknar en app med en Radix-dialog (`body { pointer-events: none }`, fokusfälla på `document`, stäng vid `pointerdown` utanför och Escape). Skärmbilder sparas i `test/skarmbilder/`. GitHub Actions kör samma tester (`.github/workflows/test.yml`).

## Publicera via GitHub Pages

Filen publiceras direkt från `main`, utan byggsteg:

1. Slå på GitHub Pages en gång (kräver administratörsbehörighet för repot):
   `gh api -X POST repos/Binokel/niemis-hjalp/pages -f "source[branch]=main" -f "source[path]=/"`
   eller under Settings → Pages: "Deploy from a branch", `main`, `/ (root)`.
2. Varje merge till `main` publiceras sedan automatiskt på https://binokel.github.io/niemis-hjalp/hjalp.js.
3. Kontrollera efter publicering att filen har den nya versionen (`NiemisHjalp.version`) och testa i minst en app på mobil och dator.

GitHub Pages cachar filer i upp till 10 minuter, så en ändring kan dröja några minuter innan den syns i apparna.

## Bra att veta
- Medan delens ruta är öppen, eller när man trycker på Hjälp-knappen, stoppas `focusout` i capture-fasen så att appens Radix-dialog inte tar tillbaka fokus. Det betyder att appens `onBlur` inte körs i det ögonblicket; spara inte data enbart i `onBlur` i fält som kan vara öppna samtidigt.
- Vit text ligger på den mörkare orangea färgen `#b54d00` (kontrast minst 4,5:1); den ljusare `#e6670c` används bara för ramar och fokus.

## Ändringar
- 1.0.1: tangentbordet i appen kan aldrig låsas om `showModal()` misslyckas; bättre kontrast för vit text på orange; README om att ta bort `iris.js` och appens egen knapp.

