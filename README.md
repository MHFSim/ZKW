# Undead Week

2D-Koop-Zombie-Survival im Browser. Ihr startet ganz unten in einem Geheimlabor und kämpft euch durch Kanalisation, U-Bahn, Stadt, Serpentinen, Bergdorf, Staudamm und Bergwald bis zur Funkstation auf dem Gipfel – allein oder mit bis zu **6 Spielern**. Ein Spieler hostet, die anderen treten per **4-stelligem Code** oder Einladungs-Link bei.

Inspiriert von *Zombie Kill of the Week – Reborn*, aber eine eigene Welt mit eigener Grafik, eigenem Sound und eigenem Code.

## Spielen

- **Online:** Nach jedem Push auf `main` wird das Spiel automatisch auf GitHub Pages veröffentlicht (Einstellungen → Pages → Quelle „GitHub Actions“).
- **Handy:** Nur Querformat. Für echtes Vollbild auf dem iPhone in Safari *Teilen → Zum Home-Bildschirm*; auf Android „App installieren“.

### Die Welt

| Bereich | Was dich erwartet |
|---|---|
| Labor „Ursprung“ | Start, erste Zuflucht, Werkbank, Training, Schließfach |
| Kanalisation · U-Bahn | Dunkel, Wasser, Spucker und Schlammwälzer; Notstrom im Leitstand |
| Industrie & Bahnhof · Stadtplatz | Regen, Straßenlaternen, Polizeistation als Zuflucht |
| Serpentinen · Bergdorf | Hotel Alpenrose (Zuflucht), Wilderer, Skifahrer |
| Staudamm & Kraftwerk | Generator – Strom öffnet Kontrollraum und Gondel |
| Bergwald · Gipfel „Hohe Wacht“ | Schnee, Erfrorene, Funkstation und Finale |

- **Türen kosten Geld** (insgesamt fast 20 000 ¢ bis zum Gipfel). Geld gibt es für Kills, Treffer und Funde.
- **Zufluchten** sind zombiefrei: Hier levelst du Fähigkeiten, verbesserst und craftest Waffen, kaufst und verkaufst, lagerst Sachen und **handelst mit Mitspielern**.
- **Tag und Nacht** wechseln (ein Tag = 6 Minuten), dazu Regen, Gewitter, Nebel und Schnee. Jede dritte Nacht kommt eine Horde.
- **Finale:** Drei Funkteile finden, die Funkstation verteidigen, den Mutanten besiegen und den Helikopter erreichen.

### Steuerung

| Aktion | Tastatur/Maus | Touch |
|---|---|---|
| Laufen | A / D | linker Daumen |
| Springen · Leiter hoch | Leertaste / W | SPRUNG · Stick nach oben |
| Leiter runter · durch Stege | S | Stick nach unten |
| Zielen, schießen | Maus, Linksklick | rechter Daumen, weit ziehen = Feuer |
| Aktion (Tür, Kauf, Station, Wiederbeleben) | E | AKTION |
| Nachladen · Wechseln · Heilen | R · Q/Mausrad/1–3 · H | LADEN · WAFFE · HEILEN |
| Granate · Molotow | G · F | WURF |
| Inventar · Karte · Pause | I · M · Esc | Symbole oben rechts |
| Speichern | F5 | Pause-Menü |

### Mehrspieler

- **Spielen → Neue Welt** (oder Welt laden): Du bist Host. Oben erscheint der Raum-Code, das Teilen-Symbol verschickt einen Einladungs-Link.
- **Beitreten** ist jederzeit möglich, aber Neue kommen erst ins Spiel, **wenn alle Spieler in einer Zuflucht stehen**. Bis dahin sehen sie, wie viele schon sicher sind.
- Die Verbindung läuft direkt zwischen den Browsern (WebRTC). Ein öffentlicher PeerJS-Dienst vermittelt nur den ersten Kontakt; ein eigener Server ist nicht nötig.
- Der Host berechnet die Welt (60 Ticks/s) und schickt Zustände über einen unzuverlässigen, ungeordneten Kanal – alte Pakete werden verworfen statt nachgeliefert. Die eigene Figur wird lokal vorhergesagt, andere Figuren werden weich interpoliert.

### Speichern

Jederzeit speicherbar (Pause → Speichern oder F5). Automatisch gespeichert wird beim Betreten einer Zuflucht, alle 3 Minuten, beim Verlassen eines Mitspielers und beim Schließen der Seite. Spielstände liegen im Browser (IndexedDB, 3 manuelle + 3 Auto-Slots) und lassen sich als `.uwsave`-Datei sichern und auf einem anderen Gerät hosten.

### Grafik

Alles wird per Code erzeugt: Texturen mit Normal-Maps für dynamisches Licht, Taschenlampen-Kegel, Mündungsfeuer, Laternen, Bloom, Vignette, Partikel für Regen, Schnee, Blut, Funken und Feuer. Die Qualität wird **nie automatisch** gesenkt; unter *Einstellungen* gibt es die Stufen Niedrig, Mittel, Hoch (Standard) und Ultra sowie einzelne Schalter.

## Entwicklung

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm run dev        # Vite-Dev-Server, http://localhost:5173
npm test           # Simulationstests (Vitest)
npm run typecheck
npm run build      # statischer Build in client/dist
```

Mehrspieler lokal ohne Internet testen:

```bash
npm run dev:peer   # lokaler PeerJS-Vermittlungsdienst auf Port 9000
VITE_PEER_HOST=127.0.0.1 VITE_PEER_PORT=9000 VITE_PEER_SECURE=false npm run dev
```

Dann das Spiel in zwei Browserfenstern öffnen: im ersten hosten, im zweiten mit dem Code beitreten.

### Aufbau

```
shared/   Reine TypeScript-Simulation: Karte, Physik, Waffen, Zombies, Welt, Netzprotokoll (getestet)
client/   Vite + Phaser 4: Darstellung, Licht, Audio-Synthese, Menüs, Netzwerk
  src/net/host.worker.ts   Host-Simulation im Web Worker
  src/net/host.ts          Host: PeerJS-Raum, Gäste, Speichern
  src/net/client.ts        Gast: Verbindung, Snapshots, Aktionen
  src/game/                GameScene (Welt, Licht, Effekte) und HudScene (HUD, Touch-Steuerung)
  src/ui/                  Menüs, Stationen, Inventar, Handel, Karte
scripts/peer-server.mjs    lokaler PeerJS-Server für Tests
```

## Lizenz

MIT
