# binokel-hjalp – regler för agenter

Den här filen (`hjalp.js`) läses in av alla Binokels interna appar. En ändring här går ut till alla appar direkt efter merge, så var försiktig.

## Arbetssätt
- Följ skillen `binokel-utveckling`. All kommunikation, alla texter i gränssnittet, README och PR-texter skrivs på svenska.
- **Minsta möjliga diff.** Ändra bara det uppgiften kräver. Ingen omformatering eller städning vid sidan av.
- Arbeta på en egen gren, aldrig direkt på `main`. Aldrig force-push eller omskriven historik på `main`.
- **Testerna ska vara gröna** före varje push: `node test/run.js`. Lägg till ett test för varje ny funktion eller rättad bugg. Uppdatera skärmbilderna i `test/skarmbilder/` när utseendet ändras.
- Skapa PR med REST (`gh api repos/Binokel/binokel-hjalp/pulls -f title=… -f head=<gren> -f base=main -f body=…`) först när GitHub Actions (`Tester`) är grönt.
- **Oberoende granskning** av en annan agent i en separat session (eller Daniel) innan merge. En subagent i den egna sessionen räknas inte som oberoende.
- Höj `VERSION` i `hjalp.js` vid varje ändring som når apparna.
- Rapportera statusnivån exakt: utvecklat, testat, pushat, granskat, mergat, publicerat, verifierat i appar.

## Regler för koden
- **Inga data.** Delen gör aldrig egna nätverksanrop (inget `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`), sätter inga cookies och använder ingen webbläsarlagring. All data går via appens adapter. Testet `inga nätverksanrop, cookies eller lagring` ska fortsätta passera – skriv inte ens de orden i kommentarer.
- Ingen användardata i `innerHTML`; använd `textContent` (hjälpfunktionen `h`). `html` får bara användas för delens egna fasta ikoner.
- En fil, ren ES2018 utan beroenden och utan byggsteg, under cirka 40 kB. Inga `?.` eller `??`.
- Shadow DOM, top layer (Popover API och `<dialog>`/`showModal()`), reserv med `z-index: 2147483000`.
- Ändra inte skyddet mot appens dialoger (`shield()`) utan att testerna för Radix-sidan fortfarande passerar på både iPhone och dator.
- **Bara rapportören sätter Godkänd.** Delen anropar `approve` bara från rapportörens egen lista; appen kontrollerar det på servern.
- Publikt API: `init`, `refresh`, `hide`, `show`, `openFeedback`, `openMine`. Ändra det bara bakåtkompatibelt – alla appar använder det.
