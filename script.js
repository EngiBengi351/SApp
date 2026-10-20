/* ==========================================================
   Karteikarten-Lern-App – Hauptlogik (Vanilla JavaScript)

   Aufbau der Datei:
     1) Konstanten & Zustand
     2) Hilfsfunktionen (Speicher, IDs, Mischen, Toast, Modal)
     3) Decks verwalten (anlegen, umbenennen, löschen, wechseln)
     4) Karten verwalten (hinzufügen, löschen, suchen)
     5) Lern-Modus (3D-Flip, Fortschritt, Gewusst/Nicht gewusst)
     6) Import & Export (JSON-Sicherung)
     7) Dark/Light-Mode & Start

   Datenfluss-Kurzüberblick:
     Eingabe → state (Objekt im Speicher) → saveState() schreibt
     alles als JSON in den localStorage → render-Funktionen zeichnen
     die Oberfläche neu.
   ========================================================== */

(function () {
  "use strict";

  /* ---------- 1) Konstanten & Zustand ---------- */

  // Unterschlüssel im localStorage – hier liegen alle Decks & Karten.
  const STORAGE_KEY = "karteikarten_app_v1";

  // Separater Schlüssel für das Farbschema (Light/Dark).
  const THEME_KEY = "karteikarten_theme";

  // Gesamter Datenbestand. Aufbau:
  // { decks: [ { id, name, cards: [ { id, front, back } ] } ], activeDeckId }
  let state = { decks: [], activeDeckId: null };

  // Zustand der aktuellen Lernrunde (nur temporär, wird NICHT gespeichert):
  //   orderIds  – Reihenfolge (gemischt) der Karten-IDs dieser Runde
  //   index     – Zeiger auf die aktuelle Karte
  //   known     – Anzahl "Gewusst"
  //   unknown   – Anzahl "Nicht gewusst"
  //   unknownIds – IDs aller falsch beantworteten Karten (für Wiederholung)
  //   finished  – true, wenn die Runde durchgelaufen ist
  let session = {
    orderIds: [],
    index: 0,
    known: 0,
    unknown: 0,
    unknownIds: [],
    finished: false
  };

  // True, wenn die aktuelle Karte gerade umgedreht (Rückseite sichtbar) ist.
  let isFlipped = false;

  // Suchbegriff aus der Kartenübersicht.
  let searchTerm = "";

  /* ---------- 2) Hilfsfunktionen ---------- */

  // Kurzer Zugriff auf document.querySelector.
  const $ = (sel) => document.querySelector(sel);

  // Eindeutige ID erzeugen (Zeitstempel + Zufallsanteil).
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Den aktuellen Zustand dauerhaft im Browser speichern.
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Speichern fehlgeschlagen:", e);
      toast("Daten konnten nicht gespeichert werden (Speicher voll?).", "error");
    }
  }

  // Gespeicherte Daten laden und sanft validieren („reparieren").
  // Gibt true zurück, wenn etwas Brauchbares geladen wurde.
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.decks)) return false;

      // Nur gültige Decks/Karten übernehmen – defekte Einträge werden verworfen.
      state.decks = parsed.decks
        .filter((d) => d && typeof d === "object")
        .map((d) => ({
          id: typeof d.id === "string" ? d.id : uid(),
          name:
            typeof d.name === "string" && d.name.trim()
              ? d.name.trim().slice(0, 60)
              : "Deck",
          cards: Array.isArray(d.cards)
            ? d.cards
                .filter(
                  (c) =>
                    c &&
                    typeof c.front === "string" &&
                    typeof c.back === "string"
                )
                .map((c) => ({
                  id: typeof c.id === "string" ? c.id : uid(),
                  front: c.front,
                  back: c.back
                }))
            : []
        }));

      // Aktives Deck prüfen – sonst erstes Deck wählen.
      state.activeDeckId =
        parsed.activeDeckId &&
        state.decks.some((d) => d.id === parsed.activeDeckId)
          ? parsed.activeDeckId
          : state.decks.length
          ? state.decks[0].id
          : null;

      return true;
    } catch (e) {
      console.warn("Gespeicherte Daten konnten nicht geladen werden:", e);
      return false;
    }
  }

  // Das derzeit ausgewählte Deck (oder null).
  function getActiveDeck() {
    return state.decks.find((d) => d.id === state.activeDeckId) || null;
  }

  // Fisher-Yates-Mischung: liefert ein zufällig sortiertes Kopie-Array zurück.
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Kleine Benachrichtigung unten auf dem Bildschirm.
  function toast(message, type = "info") {
    const el = document.createElement("div");
    el.className = "toast toast-" + type;
    el.textContent = message; // textContent = kein Risiko für HTML-Injection
    $("#toastContainer").appendChild(el);

    // Nach 3,2 Sekunden ausblenden und entfernen.
    setTimeout(() => {
      el.classList.add("toast-hide");
      setTimeout(() => el.remove(), 320);
    }, 3200);
  }

  /* Allgemeiner Dialog (Modal).
     Erwartet: { title, text, input?, buttons: [{ label, value, className?, enter? }] }
     Löst auf mit { value, input } oder null (Abbruch per ESC/Klick neben das Fenster). */
  function showModal({ title, text = "", input = null, buttons = [] }) {
    const backdrop = $("#modalBackdrop");
    const textEl = $("#modalText");
    const inputEl = $("#modalInput");
    const actionsEl = $("#modalActions");

    $("#modalTitle").textContent = title;
    textEl.textContent = text;
    textEl.hidden = !text;

    // Optionales Eingabefeld (z. B. für Deck-Namen).
    inputEl.hidden = !input;
    inputEl.value = input && input.value ? input.value : "";
    inputEl.placeholder = input && input.placeholder ? input.placeholder : "";

    // Buttons aufbauen.
    actionsEl.innerHTML = "";
    let resolvePromise;
    const promise = new Promise((resolve) => (resolvePromise = resolve));

    const close = (result) => {
      backdrop.hidden = true;
      document.removeEventListener("keydown", onKey);
      resolvePromise(result);
    };

    buttons.forEach((b) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn " + (b.className || "btn-soft");
      btn.textContent = b.label;
      btn.addEventListener("click", () =>
        close({ value: b.value, input: inputEl.value.trim() })
      );
      actionsEl.appendChild(btn);
    });

    // ENTER bestätigt den mit enter:true markierten Button (sonst den ersten).
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      } else if (e.key === "Enter" && !inputEl.hidden) {
        e.preventDefault();
        const primary =
          buttons.find((b) => b.enter) || buttons[0];
        if (primary) close({ value: primary.value, input: inputEl.value.trim() });
      }
    };
    document.addEventListener("keydown", onKey);

    // Klick HINTER das Fenster = Abbruch.
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close(null);
    };

    backdrop.hidden = false;

    // Fokus aufs Eingabefeld, sonst auf den ersten Button.
    if (!inputEl.hidden) inputEl.focus();
    else actionsEl.querySelector("button")?.focus();

    return promise;
  }

  /* ---------- 3) Decks verwalten ---------- */

  // Auswahlfeld und Buttons der Deck-Leiste neu zeichnen.
  function renderDeckBar() {
    const select = $("#deckSelect");
    select.innerHTML = "";

    state.decks.forEach((deck) => {
      const opt = document.createElement("option");
      opt.value = deck.id;
      opt.textContent = `${deck.name} (${deck.cards.length})`; // z. B. "Biologie (24)"
      select.appendChild(opt);
    });

    select.value = state.activeDeckId || "";
    const noDeck = state.decks.length === 0;
    select.disabled = noDeck;

    // Umbenennen/Löschen brauchen ein aktives Deck.
    $("#btnRenameDeck").disabled = noDeck;
    $("#btnDeleteDeck").disabled = noDeck;
  }

  // Neues, leeres Deck anlegen (per Dialog mit Namenseingabe).
  async function createDeck() {
    const res = await showModal({
      title: "Neues Deck anlegen",
      text: "Gib deinem Deck einen Namen.",
      input: { placeholder: "z. B. Vokabeln Englisch" },
      buttons: [
        { label: "Anlegen", value: "ok", className: "btn-primary", enter: true },
        { label: "Abbrechen", value: "cancel", className: "btn-ghost" }
      ]
    });
    if (!res || res.value !== "ok") return;

    const name = (res.input || "").trim().slice(0, 60);
    if (!name) {
      toast("Bitte einen Namen eingeben.", "error");
      return;
    }

    const deck = { id: uid(), name, cards: [] };
    state.decks.push(deck);
    state.activeDeckId = deck.id;
    resetSession(); // neues Deck = neue Lernrunde
    saveState();
    renderAll();
    toast(`Deck „${name}“ erstellt.`, "success");
  }

  // Aktuelles Deck umbenennen.
  async function renameDeck() {
    const deck = getActiveDeck();
    if (!deck) return;

    const res = await showModal({
      title: "Deck umbenennen",
      text: "Neuer Name für dieses Deck:",
      input: { value: deck.name, placeholder: "Deck-Name" },
      buttons: [
        { label: "Speichern", value: "ok", className: "btn-primary", enter: true },
        { label: "Abbrechen", value: "cancel", className: "btn-ghost" }
      ]
    });
    if (!res || res.value !== "ok") return;

    const name = (res.input || "").trim().slice(0, 60);
    if (!name) {
      toast("Der Name darf nicht leer sein.", "error");
      return;
    }

    deck.name = name;
    saveState();
    renderAll();
    toast("Deck umbenannt.", "success");
  }

  // Aktuelles Deck (mit allen Karten) löschen – erst nach Rückfrage.
  async function deleteDeck() {
    const deck = getActiveDeck();
    if (!deck) return;

    const res = await showModal({
      title: "Deck löschen?",
      text: `„${deck.name}“ und alle ${deck.cards.length} Karten darin werden unwiderruflich gelöscht.`,
      buttons: [
        { label: "Endgültig löschen", value: "ok", className: "btn-danger", enter: true },
        { label: "Abbrechen", value: "cancel", className: "btn-ghost" }
      ]
    });
    if (!res || res.value !== "ok") return;

    state.decks = state.decks.filter((d) => d.id !== deck.id);

    // Neues aktives Deck bestimmen (Reihenfolge bleibt erhalten).
    state.activeDeckId = state.decks.length ? state.decks[0].id : null;

    resetSession();
    saveState();
    renderAll();
    toast("Deck gelöscht.", "success");
  }

  // Deck über das Auswahlfeld wechseln.
  function switchDeck(deckId) {
    state.activeDeckId = deckId;
    resetSession(); // Fortschritt der alten Runde verwerfen
    saveState();
    renderAll();
  }

  /* ---------- 4) Karten verwalten ---------- */

  // Neue Karte aus dem Formular zum aktiven Deck hinzufügen.
  function addCard(front, back) {
    const deck = getActiveDeck();
    if (!deck) return;

    const card = { id: uid(), front, back };
    deck.cards.push(card);

    // Laufende Lernrunde nicht zerstören: Die neue Karte wird ans
    // Runden-Ende angehängt, damit der bisherige Fortschritt erhalten bleibt.
    if (session.orderIds.length > 0 && !session.finished) {
      session.orderIds.push(card.id);
    }

    saveState();
    renderAll();
    toast("Karte hinzugefügt.", "success");
  }

  // Einzelne Karte löschen (nach Bestätigung).
  async function deleteCard(cardId) {
    const deck = getActiveDeck();
    if (!deck) return;

    const card = deck.cards.find((c) => c.id === cardId);
    if (!card) return;

    const res = await showModal({
      title: "Karte löschen?",
      text: `„${card.front.slice(0, 120)}“ wird entfernt.`,
      buttons: [
        { label: "Löschen", value: "ok", className: "btn-danger", enter: true },
        { label: "Abbrechen", value: "cancel", className: "btn-ghost" }
      ]
    });
    if (!res || res.value !== "ok") return;

    deck.cards = deck.cards.filter((c) => c.id !== cardId);

    // Die Karte auch aus der aktuellen Lernrunde streichen.
    const pos = session.orderIds.indexOf(cardId);
    if (pos !== -1) {
      session.orderIds.splice(pos, 1);
      if (pos < session.index) session.index--; // Zeiger nachziehen
      session.unknownIds = session.unknownIds.filter((id) => id !== cardId);
      if (session.orderIds.length === 0) session.finished = true;
      if (session.index >= session.orderIds.length) session.finished = true;
    }

    saveState();
    renderAll();
    toast("Karte gelöscht.", "success");
  }

  // Übersichtsliste zeichnen (inkl. Suchfilter).
  function renderCardList() {
    const deck = getActiveDeck();
    const list = $("#cardList");
    const emptyEl = $("#listEmpty");
    const cards = deck ? deck.cards : [];

    // Ohne Deck kann keine Karte angelegt werden → Formular sperren.
    const noDeck = !deck;
    $("#formNote").hidden = !noDeck;
    $("#cardForm").querySelectorAll("textarea, button").forEach((el) => {
      el.disabled = noDeck;
    });

    $("#cardCount").textContent = cards.length;
    list.innerHTML = "";

    // Filter: Suche prüft Vorder- UND Rückseite (Groß/klein egal).
    const term = searchTerm.trim().toLowerCase();
    const visible = term
      ? cards.filter(
          (c) =>
            c.front.toLowerCase().includes(term) ||
            c.back.toLowerCase().includes(term)
        )
      : cards;

    if (visible.length === 0) {
      emptyEl.hidden = false;
      emptyEl.textContent = noDeck
        ? "Kein Deck vorhanden – lege oben zuerst ein Deck an."
        : cards.length === 0
        ? "Noch keine Karten in diesem Deck – lege oben die erste an."
        : `Keine Treffer für „${searchTerm.trim()}“.`;
      return;
    }
    emptyEl.hidden = true;

    visible.forEach((card) => {
      const li = document.createElement("li");
      li.className = "card-item";

      // Struktur ist fest vorgegeben; Inhalte kommen NIE per innerHTML
      // (schützt vor XSS durch importierte Dateien).
      const body = document.createElement("div");
      body.className = "card-item-body";

      const labelF = document.createElement("span");
      labelF.className = "item-label";
      labelF.textContent = "Vorderseite";

      const front = document.createElement("p");
      front.className = "item-front";
      front.textContent = card.front;

      const labelB = document.createElement("span");
      labelB.className = "item-label";
      labelB.textContent = "Rückseite";

      const back = document.createElement("p");
      back.className = "item-back";
      back.textContent = card.back;

      body.append(labelF, front, labelB, back);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "icon-btn";
      delBtn.setAttribute("aria-label", "Karte löschen");
      delBtn.title = "Karte löschen";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", () => deleteCard(card.id));

      li.append(body, delBtn);
      list.appendChild(li);
    });
  }

  /* ---------- 5) Lern-Modus ---------- */

  // Runde zurücksetzen (ohne automatischen Neustart).
  function resetSession() {
    session = {
      orderIds: [],
      index: 0,
      known: 0,
      unknown: 0,
      unknownIds: [],
      finished: false
    };
    isFlipped = false;
  }

  // Neue Lernrunde starten.
  //   onlyIds – optional: nur diese Karten (z. B. nur die falschen).
  function startSession(onlyIds = null) {
    const deck = getActiveDeck();
    const ids = deck
      ? onlyIds
        ? onlyIds.filter((id) => deck.cards.some((c) => c.id === id))
        : deck.cards.map((c) => c.id)
      : [];

    session = {
      orderIds: shuffle(ids), // Karten in Zufallsreihenfolge
      index: 0,
      known: 0,
      unknown: 0,
      unknownIds: [],
      finished: ids.length === 0 // leeres Deck = sofort „fertig"
    };
    isFlipped = false;
  }

  // Lernansicht komplett neu zeichnen.
  function renderLearn() {
    const deck = getActiveDeck();
    const hasCards = !!deck && deck.cards.length > 0;

    // Automatischer Runden-Start, falls noch keine läuft.
    if (
      hasCards &&
      !session.finished &&
      (session.orderIds.length === 0 ||
        !session.orderIds.some((id) => deck.cards.some((c) => c.id === id)))
    ) {
      startSession();
    }

    const showSummary = hasCards && session.finished;
    const showCard = hasCards && !session.finished;

    // Leerzustände – unterscheiden: kein Deck vs. leeres Deck.
    const emptyEl = $("#learnEmpty");
    emptyEl.hidden = hasCards;
    if (!hasCards) {
      $("#learnEmptyText").textContent = state.decks.length
        ? "Noch keine Karten in diesem Deck."
        : "Kein Deck vorhanden – lege zuerst ein Deck an.";
      $("#btnEmptyToManage").hidden = !state.decks.length;
      $("#progressCard").hidden = true;
    } else {
      $("#progressCard").hidden = false;
    }

    $("#cardStage").hidden = !showCard;
    $("#answerControls").hidden = !showCard;
    $("#learnSummary").hidden = !showSummary;

    if (showCard) {
      // Aktuelle Karte suchen und Inhalte setzen.
      const cardId = session.orderIds[session.index];
      const card = deck.cards.find((c) => c.id === cardId);

      if (card) {
        $("#frontText").textContent = card.front;
        $("#backText").textContent = card.back;
      }

      // Karte immer wieder auf die Vorderseite zurückdrehen.
      isFlipped = false;
      $("#flipCard").classList.remove("is-flipped");
      $("#flipHint").hidden = false;
    }

    // Fortschritt & Zähler aktualisieren.
    const total = session.orderIds.length;
    const percent = total ? Math.min(100, (session.index / total) * 100) : 0;

    $("#progressLabel").textContent = showSummary
      ? `Runde beendet · ${total} Karten`
      : `Karte ${Math.min(session.index + 1, total)} von ${total}`;

    $("#progressFill").style.width = percent + "%";
    $("#progressBar").setAttribute("aria-valuenow", String(Math.round(percent)));

    $("#knownCount").textContent = `✔ ${session.known} gewusst`;
    $("#unknownCount").textContent = `✘ ${session.unknown} nicht gewusst`;

    // Zusammenfassung füllen.
    if (showSummary) {
      $("#sumKnown").textContent = session.known;
      $("#sumUnknown").textContent = session.unknown;
      $("#sumTotal").textContent = total;

      // Button „Nur Nicht-Gewusste" nur anbieten, wenn es welche gibt.
      $("#btnRepeatUnknown").hidden = session.unknownIds.length === 0;
      $("#btnRepeatUnknown").textContent =
        `Nur Nicht-Gewusste (${session.unknownIds.length})`;
    }
  }

  // Karte per Klick/Leertaste umdrehen.
  function toggleFlip() {
    if ($("#cardStage").hidden) return;
    isFlipped = !isFlipped;
    $("#flipCard").classList.toggle("is-flipped", isFlipped);
  }

  // Antwort bewerten und weiterzählen.
  function answerCurrent(known) {
    if (session.finished || $("#cardStage").hidden) return;

    const cardId = session.orderIds[session.index];

    if (known) {
      session.known++;
    } else {
      session.unknown++;
      session.unknownIds.push(cardId); // merken für die Wiederholungsrunde
    }

    session.index++;

    // Letzte Karte der Runde erreicht?
    if (session.index >= session.orderIds.length) {
      session.finished = true;
      const rate = session.orderIds.length
        ? Math.round((session.known / session.orderIds.length) * 100)
        : 0;
      toast(
        `Runde beendet: ${rate} % gewusst`,
        rate >= 70 ? "success" : "info"
      );
    }

    renderLearn();
  }

  // Wechsel zwischen den beiden Tabs (Lernen / Verwalten).
  function setView(view) {
    $("#learnView").hidden = view !== "learn";
    $("#manageView").hidden = view !== "manage";

    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    // Beim Betreten der Lernansicht ggf. eine Runde starten.
    if (view === "learn") renderLearn();
    if (view === "manage") renderCardList();
  }

  // Alles neu zeichnen (Deck-Leiste, Liste, Lernansicht).
  function renderAll() {
    renderDeckBar();
    renderCardList();
    renderLearn();
  }

  /* ---------- 6) Import & Export (JSON) ---------- */

  // Alle Decks als .json-Datei herunterladen.
  function exportCards() {
    if (!state.decks.length) {
      toast("Es gibt noch keine Karten zum Exportieren.", "error");
      return;
    }

    const payload = {
      app: "karteikarten",
      version: 1,
      exportedAt: new Date().toISOString(),
      decks: state.decks
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);

    // Temporären Download-Link klicken und wieder aufräumen.
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    a.href = url;
    a.download = `karteikarten-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    toast("Karten exportiert.", "success");
  }

  /* Importierte Daten „reinigen":
     - akzeptiert { decks: [...] }, ein einzelnes Deck oder ein Karten-Array
     - prüft jeden Datensatz und zählt ungültige Einträge
     - liefert { decks, total, skipped } zurück */
  function normalizeImport(raw) {
    let decksRaw = [];

    if (Array.isArray(raw)) {
      if (raw.length && Array.isArray(raw[0].cards)) {
        decksRaw = raw; // Array von Decks
      } else if (raw.length && "front" in raw[0]) {
        decksRaw = [{ name: "Importiertes Deck", cards: raw }]; // Array von Karten
      }
    } else if (raw && typeof raw === "object") {
      if (Array.isArray(raw.decks)) decksRaw = raw.decks;
      else if (Array.isArray(raw.cards)) decksRaw = [raw]; // ein einzelnes Deck
    }

    let skipped = 0;
    const decks = [];

    decksRaw.forEach((d, i) => {
      if (!d || typeof d !== "object" || !Array.isArray(d.cards)) return;

      const cards = [];
      d.cards.forEach((c) => {
        if (
          c &&
          typeof c.front === "string" &&
          typeof c.back === "string" &&
          c.front.trim() &&
          c.back.trim()
        ) {
          // IDs werden immer neu erzeugt → keine Kollisionen mit Bestand.
          cards.push({ id: uid(), front: c.front.trim(), back: c.back.trim() });
        } else {
          skipped++;
        }
      });

      const name =
        typeof d.name === "string" && d.name.trim()
          ? d.name.trim().slice(0, 60)
          : decksRaw.length > 1
          ? `Import ${i + 1}`
          : "Importiertes Deck";

      decks.push({ id: uid(), name, cards });
    });

    const total = decks.reduce((sum, d) => sum + d.cards.length, 0);
    return { decks, total, skipped };
  }

  // Verarbeitung der gewählten Datei.
  function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = ""; // Feld leeren → gleiche Datei kann erneut gewählt werden
    if (!file) return;

    const reader = new FileReader();

    reader.onerror = () =>
      toast("Die Datei konnte nicht gelesen werden.", "error");

    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch {
        toast("Ungültige Datei: keine gültige JSON-Struktur.", "error");
        return;
      }

      let result;
      try {
        result = normalizeImport(parsed);
      } catch {
        toast("Ungültige Datei.", "error");
        return;
      }

      if (!result.decks.length || result.total === 0) {
        toast("Keine gültigen Karten in der Datei gefunden.", "error");
        return;
      }

      // Ab hier fragt ein Dialog, wie importiert werden soll.
      askImportMode(result);
    };

    reader.readAsText(file, "utf-8");
  }

  // Rückfrage: ersetzen, anhängen oder abbrechen.
  async function askImportMode({ decks, total, skipped }) {
    const res = await showModal({
      title: "Karten importieren",
      text:
        `${total} Karten in ${decks.length} Deck(s) gefunden` +
        (skipped ? `, ${skipped} ungültige Einträge übersprungen` : "") +
        `. Ersetzen (alle aktuellen Daten werden überschrieben) oder ` +
        `anhängen (bestehende Karten bleiben, Duplikate bleiben erhalten)?`,
      buttons: [
        { label: "Alles ersetzen", value: "replace", className: "btn-danger" },
        { label: "Anhängen", value: "append", className: "btn-primary", enter: true },
        { label: "Abbrechen", value: "cancel", className: "btn-ghost" }
      ]
    });

    if (!res || res.value === "cancel") {
      toast("Import abgebrochen.");
      return;
    }

    let added = 0;

    if (res.value === "replace") {
      // Komplett austauschen.
      state.decks = decks;
      added = total;
    } else {
      // Anhängen: gleiche Deck-Namen zusammenführen, sonst neue Decks anlegen.
      // Duplikate werden NICHT gefiltert – sie werden einfach mit übernommen.
      decks.forEach((incoming) => {
        const existing = state.decks.find(
          (d) => d.name.toLowerCase() === incoming.name.toLowerCase()
        );

        if (existing) {
          existing.cards.push(...incoming.cards);
          added += incoming.cards.length;
        } else {
          state.decks.push(incoming);
          added += incoming.cards.length;
        }
      });
    }

    // Nach dem Import ein passendes aktives Deck wählen.
    if (!state.decks.some((d) => d.id === state.activeDeckId)) {
      state.activeDeckId = state.decks.length ? state.decks[0].id : null;
    }

    resetSession(); // Lernrunde neu aufbauen
    saveState();
    renderAll();
    setView("learn");

    toast(`${added} Karten importiert (${res.value === "replace" ? "ersetzt" : "angehängt"}).`, "success");
  }

  /* ---------- 7) Dark/Light-Mode & Start ---------- */

  // Gespeicherte Theme-Einstellung anwenden.
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    $("#themeIcon").textContent = theme === "dark" ? "☀️" : "🌙";
    $("#themeLabel").textContent = theme === "dark" ? "Light" : "Dark";
    localStorage.setItem(THEME_KEY, theme);
  }

  // Zwischen hell und dunkel wechseln.
  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  }

  // Alle Events anbinden.
  function bindEvents() {
    // Header-Aktionen
    $("#themeToggle").addEventListener("click", toggleTheme);
    $("#btnExport").addEventListener("click", exportCards);
    $("#btnImport").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", handleImportFile);

    // Deck-Leiste
    $("#deckSelect").addEventListener("change", (e) => switchDeck(e.target.value));
    $("#btnNewDeck").addEventListener("click", createDeck);
    $("#btnRenameDeck").addEventListener("click", renameDeck);
    $("#btnDeleteDeck").addEventListener("click", deleteDeck);

    // Tabs
    document.querySelectorAll(".tab").forEach((tab) =>
      tab.addEventListener("click", () => setView(tab.dataset.view))
    );

    // Lern-Modus
    $("#flipCard").addEventListener("click", toggleFlip);
    $("#btnKnown").addEventListener("click", () => answerCurrent(true));
    $("#btnUnknown").addEventListener("click", () => answerCurrent(false));
    $("#btnRepeatAll").addEventListener("click", () => {
      startSession();
      renderLearn();
    });
    $("#btnRepeatUnknown").addEventListener("click", () => {
      startSession(session.unknownIds); // nur die falschen Karten
      renderLearn();
    });
    $("#btnGoManage").addEventListener("click", () => setView("manage"));
    $("#btnEmptyToManage").addEventListener("click", () => setView("manage"));

    // Formular: neue Karte anlegen
    $("#cardForm").addEventListener("submit", (e) => {
      e.preventDefault(); // Seiten-Neuladen verhindern

      const front = $("#frontInput").value.trim();
      const back = $("#backInput").value.trim();

      if (!front || !back) {
        toast("Bitte Vorder- UND Rückseite ausfüllen.", "error");
        return;
      }

      addCard(front, back);
      e.target.reset(); // Formular leeren und wieder Fokus auf die Frage
      $("#frontInput").focus();
    });

    // Suche in der Kartenübersicht
    $("#searchInput").addEventListener("input", (e) => {
      searchTerm = e.target.value;
      renderCardList();
    });

    // Tastatur-Kürzel (nur wenn gerade nicht in einem Feld getippt wird):
    //   Leertaste/Enter = Karte umdrehen, G = gewusst, N = nicht gewusst
    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const modalOpen = !$("#modalBackdrop").hidden;
      if (typing || modalOpen) return;

      if (!e.key) return; // manche Tastatureignisse liefern keinen keycode

      if (e.code === "Space") {
        e.preventDefault();
        toggleFlip();
      } else if (e.key.toLowerCase() === "g") {
        answerCurrent(true);
      } else if (e.key.toLowerCase() === "n") {
        answerCurrent(false);
      }
    });
  }

  // Beim ersten Start: Standard-Deck mit ein paar Beispielen anlegen.
  function seedInitialData() {
    state.decks = [
      {
        id: uid(),
        name: "Beispiele",
        cards: [
          {
            id: uid(),
            front: "Was bedeutet das Kürzel HTML?",
            back: "HyperText Markup Language – die Auszeichnungssprache für Webseiten."
          },
          {
            id: uid(),
            front: "Wo speichert diese App deine Karten?",
            back: "Im localStorage des Browsers – lokal und offline, ohne Server."
          },
          {
            id: uid(),
            front: "Welches Format dient dem Import und Export?",
            back: "JSON – eine einfache, weit verbreitete Textdatei."
          }
        ]
      }
    ];
    state.activeDeckId = state.decks[0].id;
    saveState();
  }

  // Einstiegspunkt: Theme → Daten laden → Events → Oberfläche zeichnen.
  function init() {
    const storedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(storedTheme || (prefersDark ? "dark" : "light"));

    // Beim allerersten Besuch Beispiel-Daten anlegen.
    if (!loadState()) seedInitialData();

    bindEvents();
    renderAll();
    setView("learn");
  }

  // script.js ist mit "defer" geladen → DOM ist bereits verfügbar.
  init();
})();
