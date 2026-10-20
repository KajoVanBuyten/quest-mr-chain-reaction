# Chain Reaction – Mixed-Reality-Kettenreaktion für Meta Quest 3

**Chain Reaction** ist ein Mixed-Reality-Physik-Sandkasten für die Meta Quest 3, der direkt im Meta Quest Browser läuft (WebXR).
Du baust Rube-Goldberg-Maschinen quer über deine echten Möbel: Dominosteine, Murmelrampen, Bowling-Pins, Bumper, Wippen und
explosive Fässer. Der Raumscan der Quest 3 wird zur Physikwelt – Tischplatten, Boden, Wände und das Raum-Mesh sind echte Kollisionskörper.
Leuchtende Trigger-Kugel platzieren, Start drücken und die Kettenreaktion in Bullet Time genießen.

**Live:** https://kajovanbuyten.github.io/quest-mr-chain-reaction/

## Features

- **Dein Raum ist das Level** – erkannte Ebenen (`plane-detection`) werden zu Rapier-Quadern, das Raum-Mesh (`mesh-detection`) zu vereinfachten Trimesh-Collidern (Teile, die schon eine Ebene abdeckt, werden weggelassen). Ohne Raumdaten gibt es einen Boden bei y = 0 als Fallback.
- **Platzieren per Hit-Test** auf echte Oberflächen, mit leuchtender Geister-Vorschau, die an der Oberflächennormalen ausgerichtet ist. Drehen per Thumbstick oder Handgelenk-Drehung.
- **Domino-Linie**: Über den Tisch ziehen, und eine geschwungene Reihe Dominosteine wird automatisch gelegt.
- **Greifen & Werfen** mit Händen (Pinch) und Controllern (Grip, nah oder per Strahl).
- **Bauteile**: Domino, Murmel (mit Leuchtspur), Rampe, Bowling-Pin, Bumper, Wippe, explosives Fass, Trigger-Kugel, Radierer.
- **Start, Reset, Bullet Time** (weiche Zeitlupe inkl. tieferem Sound) und **Replay** des letzten Laufs (inkl. Effekten und Sounds).
- **Effekte**: GPU-instanzierte Partikel (Funken, Staub, Konfetti), Explosion mit Schockwelle und Glow-Blitz, Leuchtspuren der Murmeln, holografischer Scan-Sweep über das Raum-Mesh beim Sessionstart.
- **Schatten auf echten Oberflächen**: In XR weiche Kontaktschatten (instanzierte Blob-Schatten, per Raycast auf Tisch, Boden oder Rampe projiziert); in der Desktop-Vorschau echte Schattenkarte.
- **Okklusion**: Standardmäßig verdeckt das Raum-Mesh (unsichtbar, nur Tiefe) virtuelle Teile. Optional (Häkchen *Depth occlusion* auf der Startseite) verdecken echte Gegenstände per `depth-sensing` (GPU) – sieht besser aus, kostet aber Bildrate.
- **Prozeduraler 3D-Sound** (WebAudio, räumliche Panner, HRTF für große Ereignisse): Domino-Klicks mit Tonhöhenvariation, Rollgeräusche, Booms, Bumper-„Boing", Combo-Töne, Fanfare – komplett synthetisiert, keine Audiodateien.
- **Punkte & Combos**: umgefallene Teile zählen, schwebender Combo-Zähler, „Perfect Run" mit Konfetti.
- **Vier Preset-Level**, die automatisch auf der größten erkannten Tischfläche (oder auf dem Boden vor dir) platziert werden.
- **Desktop-Vorschau**: Ohne Headset gibt es ein stilisiertes virtuelles Wohnzimmer mit OrbitControls, Maussteuerung und Bloom.

## Steuerung

### Controller

| Eingabe | Aktion |
| --- | --- |
| Rechter Trigger | Teil platzieren · gedrückt halten mit Domino-Linie = Linie ziehen · Menükachel drücken |
| Grip (links/rechts) | Teil greifen (nah oder per Strahl), loslassen = werfen |
| Rechter Stick ← → | Vorschau drehen |
| Rechter Stick ↑ ↓ | Werkzeug wechseln |
| A / B | Start / Reset |
| X / Y | Bullet Time / Replay |
| Linker Trigger | Nächstes Werkzeug |
| Rechter Stick drücken | Nächstes Level |

Das Werkzeug-Menü (Wrist-Menü) schwebt über dem linken Controller und wird mit dem rechten Strahl bedient.

### Hände (Hand-Tracking)

| Geste | Aktion |
| --- | --- |
| Linke Handfläche zu dir drehen | Werkzeug-Menü erscheint, Kachel mit rechtem Zeigefinger antippen |
| Rechter Pinch (ins Leere) | Zielen, Handgelenk drehen = Vorschau drehen, loslassen = platzieren |
| Rechter Pinch halten (Domino-Linie) | Linie ziehen |
| Pinch nah an einem Teil (beide Hände) | Greifen, bewegen, werfen |

### Desktop-Vorschau

| Eingabe | Aktion |
| --- | --- |
| Linksklick | Platzieren · auf ein Teil klicken und ziehen = greifen & werfen (Shift für statische Teile) |
| Rechte Maustaste ziehen / Mausrad | Kamera drehen / zoomen |
| 1 – 0 | Werkzeuge |
| Q / E | Vorschau drehen |
| Leertaste, R, T, P, L, Entf | Start, Reset, Bullet Time, Replay, Level, Alles löschen |

## Auf der Meta Quest 3 öffnen

1. Meta Quest Browser öffnen.
2. https://kajovanbuyten.github.io/quest-mr-chain-reaction/ aufrufen.
3. **Enter AR** drücken und die Berechtigungen (Raumdaten, Hand-Tracking) erlauben.
4. Tipp: Vorher in den Quest-Einstellungen unter *Physischer Raum → Raumeinrichtung* den Raum scannen, damit Tische, Wände und das Raum-Mesh erkannt werden. Ohne Raumscan läuft die App trotzdem – mit einem Boden-Fallback.

Wird `immersive-ar` nicht unterstützt, bietet die Seite einen **VR-Fallback** im virtuellen Wohnzimmer an.

## Lokale Entwicklung

```bash
npm install
npm run dev -- --host
```

Der Dev-Server nutzt `@vitejs/plugin-basic-ssl` und läuft deshalb über **HTTPS** (WebXR benötigt einen sicheren Kontext).
Auf der Quest im Browser `https://<IP-deines-PCs>:5173/` öffnen und die Zertifikatswarnung einmalig bestätigen.

```bash
npm run build     # Produktions-Build nach dist/
npm run preview   # Build lokal ansehen
```

Das Deployment auf GitHub Pages erfolgt automatisch über `.github/workflows/deploy.yml` bei jedem Push auf `main`
(oder manuell per *workflow_dispatch*). In den Repository-Einstellungen unter *Pages* als Quelle „GitHub Actions" wählen.

## Technik

- **Three.js** (WebGLRenderer + WebXR, ohne Framework), `RoomEnvironment` + PMREM als Environment-Map, PBR-Materialien mit Neon-Akzenten
- **Rapier** (`@dimforge/rapier3d-compat`) für die Physik – fester Zeitschritt (120 Hz) mit Interpolation, Zeitskalierung für Bullet Time
- **Vite** als Build-Tool, `base: './'` für GitHub Pages
- **WebXR-Features**: `local-floor` (benötigt), optional `hit-test`, `plane-detection`, `mesh-detection`, `anchors`, `hand-tracking`, `depth-sensing` – jedes Feature degradiert sauber, wenn es fehlt
- **Performance**: siehe Abschnitt *Performance*
- Alle Geometrien, Texturen und Sounds werden prozedural erzeugt – keine externen Assets zur Laufzeit

## Performance

Ziel sind stabile 72 fps (optional 90 fps) auf der Quest 3 im Passthrough-AR, auch mit Raum-Mesh und vollem Level.

- **Keine Echtzeit-Schattenkarte in XR**: stattdessen ein einziger instanzierter Draw-Call mit weichen Blob-Schatten. Keine `ShadowMaterial`-Flächen mehr über Boden und Tisch (sparte großflächige transparente Überzeichnung pro Auge).
- **Keine dynamischen Punktlichter in XR**: der Explosionsblitz ist ein additiver Glow-Sprite statt eines `PointLight`; Neon-Akzente über emissive Materialien. Bloom nur in der Desktop-Vorschau.
- **Depth Sensing nur auf Wunsch** und nur `gpu-optimized` (vorher wurde `cpu-optimized` bevorzugt, was den Tiefenpuffer jeden Frame auf die CPU kopiert, ohne dass three.js ihn nutzt).
- **Raum-Mesh**: wird nur neu verarbeitet, wenn sich der Inhalt wirklich ändert (Fingerprint statt `lastChangedTime`), entprellt und auf mehrere Frames verteilt (max. ~2 ms pro Frame). Collider werden per Vertex-Clustering vereinfacht, in Stücke von 3000 Dreiecken geteilt und Dreiecke auf erkannten Ebenen weggelassen. Alle Okkluder sind ein einziger Draw-Call. Der Scan-Sweep existiert nur während des Intros.
- **Physik**: fester 120-Hz-Schritt mit Interpolation (die Preset-Level sind darauf abgestimmt), aber höchstens 2 Teilschritte pro Frame – ein langsamer Frame verlangsamt die Simulation kurz, statt Nachholschritte aufzutürmen.
- **Weniger Draw-Calls** (ohne Multiview zählt jeder doppelt): leere Instanz-Pools, Partikel, Spuren und Linien-Vorschau werden nicht gezeichnet; Rampen sind pro Material zusammengefasst; ruhende Teile werden nicht neu hochgeladen.
- **Shader werden beim Sessionstart vorab kompiliert** (`compileAsync`), damit die erste Explosion nicht ruckelt.
- **UI & Audio**: Wrist-Menü nur sichtbar und max. ~15×/s neu gezeichnet (ohne Mipmaps), schwebende Texte werden wiederverwendet; Klick-/Rollgeräusche mit günstigen Equal-Power-Pannern, HRTF nur für große Ereignisse, Stimmenlimit und Impact-Budget pro Frame. Hit-Test nur für die rechte Hand.

### Optionen

| Option | Wirkung |
| --- | --- |
| Häkchen **Depth occlusion** (Startseite) | Okklusion über den Tiefensensor der Quest statt über das Raum-Mesh. Standard: aus. Wird im Browser gespeichert. |
| `?stats` | Performance-Anzeige: fps, Frame-Zeit, CPU-/Render-Zeit, Physik-Zeit, Draw-Calls, Dreiecke. In XR als kleines Panel unten im Blickfeld. |
| `?fps=90` | Ziel-Bildrate der XR-Session (Standard 72, sofern vom Gerät unterstützt). |
| `?scale=0.9` | Framebuffer-Skalierung in XR (Standard 1.0). |
| `?depth` | Häkchen *Depth occlusion* vorab setzen. |

Beispiel: `https://kajovanbuyten.github.io/quest-mr-chain-reaction/?stats&fps=90`

## Projektstruktur

```
src/
  main.js              Landingpage, WebXR-Erkennung, Bootstrapping
  app.js               Renderer, Szene, Licht, XR-Session-Lebenszyklus
  game.js              Werkzeuge, Platzierung, Greifen, Punkte, Level, Replay
  core/                Physik-Definitionen, Simulation, Level, Replay-Recorder
  render/              Instanzierte Darstellung der Teile, prozedurale Texturen
  fx/                  GPU-Partikel, Explosionen, Leuchtspuren
  audio/               Prozedurale Spatial-Audio-Engine
  world/               Desktop-Raum und XR-Raumrekonstruktion
  input/               Controller-/Hand-Eingabe und Desktop-Eingabe
  ui/                  Wrist-Menü, Desktop-HUD, schwebende Texte, Icons
```

## Lizenz

MIT – siehe [LICENSE](LICENSE). © 2026 Kajo Van Buyten
