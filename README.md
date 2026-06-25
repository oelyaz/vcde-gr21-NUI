# NUI · Hand- & Pose-Tracking

Interaktive Quarto-Website zum Thema **Natural User Interfaces (NUI)**: Sie erklärt
gestenbasierte Eingabe und macht sie direkt erlebbar - der Chrome-T-Rex lässt sich
per **Handgeste** oder **Körperpose** über die Webcam steuern, und die ganze Seite
ist per Hand-Cursor bedienbar. Tracking läuft mit **MediaPipe** vollständig
*on-device* im Browser; Maus und Tastatur funktionieren jederzeit als Fallback.

**Live:** https://oelyaz.github.io/vcde-gr21-NUI/

Visual Computing · Gruppe 21 · Restle · Seidl · Kastrati

## Projektstruktur

| Pfad | Inhalt |
|------|--------|
| `*.qmd` | Die Seiten der Website (Start, Grundlagen, Methode, Live-Demo, Evaluation, Über). |
| `nui/` | Eigene Front-end-Library (kein Framework): Steuerung, Filter, Overlay, Eval u.a. |
| `trex/` | Vendored Chrome-Dino-Runner (BSD), unverändert eingebettet. |
| `_quarto.yml` | Website-Konfiguration: Navbar, Theme, globales Kamera-Dock. |
| `references.bib` | Literaturverzeichnis. |
| `.github/workflows/` | `publish.yml` (Render + Deploy), `ci.yml` (Tests + Render-Check). |

### Die `nui/`-Module

| Datei | Aufgabe |
|-------|---------|
| `controller.js` | Herzstück: Kamera, MediaPipe-Erkennung (Hand/Pose), Zustandsmaschine, Hand-Cursor, Dock. |
| `filters.js` | Pure Mathe-Helfer: `clamp`, Abstände, 1-Euro-Filter, Hand-Features. |
| `eval.js` | Leichtes Mess-Harness (Latenz, Erkennung, Aktionen). |
| `evalpanel.js` | Zeigt die `eval.js`-Messwerte live auf der Evaluationsseite an. |
| `overlay.js` | Skelett-Overlay über dem Kamerabild. |
| `explainer.js` | Interaktive Demo-Module (Landmark-Explorer, Gesten-Playground). |
| `onboarding.js`, `help.js`, `signature.js` | Coachmark, Hilfe-Popout, visuelle Effekte. |
| `dock.html` | Globales Kamera-Dock, per `include-after-body` auf jeder Seite. |

## Lokal entwickeln

Voraussetzungen: [Quarto](https://quarto.org), [uv](https://docs.astral.sh/uv/)
(Python) und [Node.js](https://nodejs.org) (nur für die Tests).

```bash
# Python-Umgebung aus pyproject.toml / uv.lock einrichten
uv sync

# Website lokal mit Live-Reload starten
quarto preview
```

`quarto preview` öffnet die Seite unter `http://localhost:<port>`. **Die Kamera
braucht einen sicheren Kontext** (`http://localhost` oder HTTPS) — über `file://`
oder eine LAN-IP verweigert der Browser den Zugriff.

Eine einzelne Seite rendern: `quarto render evaluation.qmd`. Die puren Helfer
(`filters.js`, `eval.js`) sind mit `npm test` abgedeckt (Node-Test-Runner, keine
Extra-Pakete).

## Evaluation: echte Messwerte ablesen

`nui/eval.js` misst im laufenden Betrieb Inferenz- und Aktions-Latenz, erkannte
Gesten und ausgelöste Aktionen. Zwei Wege, die Zahlen zu sehen:

- **Auf der Seite:** Auf der [Evaluationsseite](https://oelyaz.github.io/vcde-gr21-NUI/evaluation.html)
  die Kamera im Dock starten, ein paar Gesten machen — das Panel **„Deine
  Live-Messung"** füllt sich mit echten Werten deiner Sitzung.
- **In der Konsole:** `window.nuiEval.report()` druckt eine Zusammenfassung,
  `window.nuiEval.reset()` startet ein frisches Messfenster.

## Deployment

Ein Push auf `main` startet `publish.yml`: Quarto rendert die Seiten (inkl. der
Python-Abbildungen) und deployt das Ergebnis nach `gh-pages` → GitHub Pages.
Pull Requests werden zusätzlich von `ci.yml` geprüft (Unit-Tests + Render-Check).

### Eigenen Fork einrichten

Damit der automatische Build im eigenen Fork funktioniert:

1. **Workflow-Berechtigungen:** Settings → Actions → General → *Workflow
   permissions* → „Read and write permissions" aktivieren und speichern. Im Reiter
   *Actions* die Workflows einmal bestätigen.
2. **GitHub Pages:** Settings → Pages → *Build and deployment* → Branch `gh-pages`
   wählen und speichern. (Der Branch entsteht nach dem ersten erfolgreichen
   Action-Durchlauf.)

Die Seite liegt danach unter `https://<username>.github.io/<repo-name>/`.

## Hinweise zur Quarto-Syntax

- **Formeln:** LaTeX-Notation, z. B. `$E = mc^2$`.
- **Python-Berechnungen:** Code-Blöcke mit ` ```{python} ` einleiten.
- **HTML/JS-Einbindung:** innerhalb von ` ```{=html} `-Blöcken.

## Troubleshooting

- **Kamera startet nicht:** Sicheren Kontext prüfen (`http://localhost`, nicht
  `file://`) und die Kamera-Freigabe in den Seiteneinstellungen erlauben.
- **Fehlende Python-Grafiken:** Im *Actions*-Protokoll prüfen, ob `matplotlib`,
  `numpy` oder `pandas` korrekt installiert wurden.
- **MediaPipe lädt nicht:** Browser-Konsole (F12) auf Netzwerkfehler prüfen — das
  Modell wird zur Laufzeit per CDN geladen, eine Internetverbindung ist nötig.

## Lizenz & Attribution

Eigener Code unter der Lizenz in [`LICENSE`](LICENSE). Der Chrome-Dino-Runner in
`trex/` stammt von den Chromium-Autoren (BSD). Tracking über *MediaPipe
Tasks-Vision* (Google, Apache-2.0), zur Laufzeit per CDN geladen.
