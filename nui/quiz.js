// nui/quiz.js
// A small, self-contained self-test quiz for the Evaluation page. Unlike the
// Mentimeter live quiz (which only works during the talk), this one runs any
// time, fully client-side: pick an answer, get immediate feedback and a short
// explanation, and a running score. No dependencies, no storage.
//
// Built from real <input type="radio"> groups inside <fieldset>/<legend>, so it
// is keyboard-operable and screen-reader friendly out of the box. A no-op if the
// container markup is absent.

const QUESTIONS = [
  {
    q: "Was bezeichnet ein „Natural User Interface“ (NUI)?",
    options: [
      "Eingabe per Maus und Tastatur",
      "Berührungslose, körperbasierte Eingabe – z. B. Gesten, Pose oder Sprache",
      "Ein besonders aufgeräumtes grafisches Menü",
      "Eine Sprachausgabe zur Barrierefreiheit",
    ],
    correct: 1,
    explain: "NUI meint berührungslose, körperbasierte Eingabe – relevant dort, wo Kontakt unmöglich, unhygienisch oder unpraktisch ist.",
  },
  {
    q: "In welcher Reihenfolge arbeitet die Tracking-Pipeline?",
    options: [
      "Bild → Landmarks (CNN) → Klassifikation/Heuristik → Mapping → Aktion",
      "Aktion → Mapping → Bild → Landmarks",
      "Ein einzelnes großes Netz erledigt alles in einem Schritt",
      "Bild → Aktion, direkt ohne Zwischenstufen",
    ],
    correct: 0,
    explain: "Es ist eine klassische CV-Pipeline aus spezialisierten Stufen, nicht ein einzelnes Netz.",
  },
  {
    q: "Welche Hardware braucht die hier gezeigte Steuerung?",
    options: [
      "Eine Tiefenkamera wie die Kinect",
      "Ein VR-Headset",
      "Eine gewöhnliche Webcam – das Tracking läuft on-device im Browser",
      "Einen Cloud-Server mit GPU",
    ],
    correct: 2,
    explain: "Eine normale Webcam plus MediaPipe genügt, vollständig on-device und ohne Installation.",
  },
  {
    q: "Was beschreibt das „Midas-Touch“-Problem?",
    options: [
      "Die Kamera sieht bei wenig Licht schlecht",
      "Weil die Kamera immer „sieht“, kann unbeabsichtigt jede Bewegung als Befehl gelten",
      "Der Arm ermüdet bei langer Nutzung (Gorilla-Arm)",
      "Die Latenz ist zu hoch zum flüssigen Spielen",
    ],
    correct: 1,
    explain: "Dagegen helfen Confidence-Gate, Debounce/Hysterese, Cooldowns und explizites Engagement – ganz weg ist es aber nie.",
  },
  {
    q: "Warum bleiben Maus und Tastatur immer aktiv?",
    options: [
      "Aus reiner Gewohnheit",
      "Als Pflicht-Fallback: Bedienbarkeit unabhängig von Licht, Kamera und Tagesform",
      "Weil die Gestensteuerung grundsätzlich nicht funktioniert",
      "Um Strom zu sparen",
    ],
    correct: 1,
    explain: "Der Fallback sichert Bedienung und Bewertung unabhängig von den NUI-typischen Schwächen.",
  },
];

const root = document.getElementById("nui-quiz");
if (root) {
  let answered = 0;
  let correct = 0;

  // Live score line; aria-live so a screen reader announces each update.
  const score = document.createElement("p");
  score.className = "nui-quiz-score";
  score.setAttribute("role", "status");
  score.setAttribute("aria-live", "polite");

  function renderScore() {
    score.textContent = answered
      ? `${correct} von ${answered} richtig` + (answered === QUESTIONS.length ? ` – alle ${QUESTIONS.length} Fragen beantwortet.` : "")
      : `0 von ${QUESTIONS.length} beantwortet`;
  }

  function buildQuestion(item, qi) {
    const fs = document.createElement("fieldset");
    fs.className = "nui-quiz-q";

    const legend = document.createElement("legend");
    legend.textContent = `${qi + 1}. ${item.q}`;
    fs.appendChild(legend);

    const fb = document.createElement("p");
    fb.className = "nui-quiz-fb";
    fb.setAttribute("role", "status");
    fb.setAttribute("aria-live", "polite");
    fb.hidden = true;

    item.options.forEach((text, oi) => {
      const id = `nui-quiz-${qi}-${oi}`;
      const label = document.createElement("label");
      label.className = "nui-quiz-opt";
      label.htmlFor = id;

      const input = document.createElement("input");
      input.type = "radio";
      input.name = `nui-quiz-q${qi}`;
      input.id = id;
      input.value = String(oi);

      const span = document.createElement("span");
      span.textContent = text;

      label.append(input, span);
      fs.appendChild(label);

      input.addEventListener("change", () => {
        // Lock the question after the first answer so the score stays honest.
        const inputs = fs.querySelectorAll("input");
        for (const el of inputs) el.disabled = true;
        const labels = fs.querySelectorAll(".nui-quiz-opt");
        labels[item.correct].classList.add("is-correct");
        const isRight = oi === item.correct;
        if (!isRight) label.classList.add("is-wrong");

        answered++;
        if (isRight) correct++;
        fb.hidden = false;
        fb.dataset.ok = isRight ? "true" : "false";
        fb.textContent = (isRight ? "Richtig. " : "Nicht ganz. ") + item.explain;
        renderScore();
      });
    });

    fs.appendChild(fb);
    return fs;
  }

  function render() {
    answered = 0; correct = 0;
    root.textContent = "";
    QUESTIONS.forEach((item, qi) => root.appendChild(buildQuestion(item, qi)));

    const foot = document.createElement("div");
    foot.className = "nui-quiz-foot";
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "nui-btn nui-btn-ghost";
    resetBtn.textContent = "Zurücksetzen";
    resetBtn.addEventListener("click", render);
    foot.append(score, resetBtn);
    root.appendChild(foot);

    renderScore();
  }

  render();
}
