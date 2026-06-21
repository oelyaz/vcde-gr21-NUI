# Interaktive NUI-Website
Dieses Repository enthält unsere Quarto-Webseite zum Thema Natural User Interfaces.
Quarto übernimmt das Rendern der Seiten, Python wird für Auswertungen und
Abbildungen genutzt. Für interaktive 3D-Visualisierungen ist Babylon.js eingebunden.

---
https://oelyaz.github.io/vcde-gr21-NUI/
---

## Konfigurationsschritte (Setup)
Für eine eigene Arbeitsumgebung reichen diese Schritte. Am besten in der Reihenfolge
durchgehen, sonst scheitert später oft der Pages-Build.

- **Repository forken**
Oben rechts auf GitHub auf "Fork" klicken. Dadurch landet eine Kopie des Projekts im
eigenen GitHub-Account.

- **Konfiguration der Workflow-Berechtigungen**
In Forks sind Schreibrechte für automatisierte Prozesse meist deaktiviert. Für den
Website-Build müssen sie einmal aktiviert werden:

  - Navigieren Sie zu Settings > Actions > General.
    
  - Suchen Sie den Abschnitt Workflow permissions.

  - Aktivieren Sie die Option "Read and write permissions" und bestätigen Sie mit Save.

  - Wechseln Sie zum Reiter Actions und bestätigen Sie die Aktivierung der Workflows durch Klick auf "I understand my workflows, go ahead and enable them".

- **Aktivierung von GitHub Pages**

  - Navigieren Sie zu Settings > Pages.

  - Wählen Sie unter dem Punkt "Build and deployment" bei Branch den Branch gh-pages aus.

  - Bestätigen Sie die Auswahl mit Save.
(Hinweis: Der Branch gh-pages entsteht erst nach dem ersten erfolgreichen Durchlauf
der GitHub Action, außer er wird vorher manuell erstellt.)

## Workflow für Bearbeitung und Deployment
Nach einem Push ins Repository startet automatisch die CI/CD-Pipeline:

- Python-Umgebung: Quarto führt enthaltene Code-Segmente aus und erzeugt die passenden Abbildungen.

- Rendering: Die Markdown-Inhalte werden als statische HTML-Seiten ausgegeben.

- Deployment: Die aktualisierte Website wird unter folgendem URL-Schema bereitgestellt: https://<ihr-username>.github.io/<repo-name>/

## Richtlinien zur Quarto-Syntax:
- Mathematische Formeln: Verwenden Sie die LaTeX-Notation, z. B. $E = mc^2$.

- Python-Berechnungen: Code-Blöcke müssen mit ```{python} eingeleitet werden.

- HTML/3D-Inhalte: Die Integration von Babylon.js-Skripten erfolgt innerhalb von ```{=html} Blöcken.

## Fehleranalyse (Troubleshooting)
- Fehlende Python-Grafiken: Im Protokoll unter "Actions" prüfen, ob matplotlib oder numpy korrekt installiert wurden.

- Inaktiver 3D-Canvas: Wenn die 3D-Umgebung nicht lädt, in der Browser-Konsole (Taste F12) nach einem 404 (Not Found) Fehler suchen. Meist stimmt dann der Verweis auf Babylon.js oder eine Asset-Datei nicht.
