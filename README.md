# Chain Reaction – Mixed-Reality-Kettenreaktion für Meta Quest 3

**Chain Reaction** ist ein Mixed-Reality-Physik-Sandkasten für die Meta Quest 3, der direkt im Meta Quest Browser läuft (WebXR).
Du baust Rube-Goldberg-Maschinen quer über deine echten Möbel: Dominosteine, Murmelrampen, Bowling-Pins, Bumper, Wippen und
explosive Fässer. Der Raumscan der Quest 3 wird zur Physikwelt – Tischplatten, Boden, Wände und das Raum-Mesh sind echte Kollisionskörper.
Leuchtende Trigger-Kugel platzieren, Start drücken und die Kettenreaktion in Bullet Time genießen.

**Live:** https://kajovanbuyten.github.io/quest-mr-chain-reaction/

## Features

- **Dein Raum ist das Level** – erkannte Ebenen (`plane-detection`) werden zu Rapier-Quadern, das Raum-Mesh (`mesh-detection`) zu Trimesh-Collidern. Ohne Raumdaten gibt es einen Boden bei y = 0 als Fallback.
- **Platzieren per Hit-Test** auf echte Oberflächen, mit leuchtender Geister-Vorschau, die an der Oberflächennormalen ausgerichtet ist. Drehen per Thumbstick oder Handgelenk-Drehung.
- **Domino-Linie**: Über den Tisch ziehen, und eine geschwungene Reihe Dominosteine wird automatisch gelegt.
- **Greifen & Werfen** mit Händen (Pinch) und Controllern (Grip, nah oder per Strahl).
- **Bauteile**: Domino, Murmel (mit Leuchtspur), Rampe, Bowling-Pin, Bumper, Wippe, explosives Fass, Trigger-Kugel, Radierer.
- **Start, Reset, Bullet Time** (weiche Zeitlupe inkl. tieferem Sound) und **Replay** des letzten Laufs (inkl. Effekten und Sounds).
- **Effekte**: GPU-instanzierte Partikel (Funken, Staub, Konfetti), Explosion mit Schockwelle und Lichtblitz, Leuchtspuren der Murmeln, holografischer Scan-Sweep über das Raum-Mesh beim Sessionstart.
- **Schatten auf echten Oberflächen**: Shadow-Catcher (`ShadowMaterial`) auf den erkannten Ebenen, damit virtuelle Objekte realistische Schatten auf Tisch und Boden werfen.
- **Okklusion**: Mit `depth-sensing` (GPU) verdecken echte Gegenstände virtuelle Teile (mit kleinem Tiefen-Bias gegen Flackern); ohne Depth Sensing dient das Raum-Mesh als Okkluder.
- **Prozeduraler 3D-Sound** (WebAudio, HRTF-Panner): Domino-Klicks mit Tonhöhenvariation, Rollgeräusche, Booms, Bumper-„Boing", Combo-Töne, Fanfare – komplett synthetisiert, keine Audiodateien.
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
- **Performance**: Instancing für alle kleinen Teile, ein Draw-Call für Partikel und Spuren, nur ein dynamisches Licht für Explosionen, `setFoveation(1)`, Bloom nur im Desktop-Modus
- Alle Geometrien, Texturen und Sounds werden prozedural erzeugt – keine externen Assets zur Laufzeit

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
