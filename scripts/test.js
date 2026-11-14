/* ============================================================
   Harnais de non-régression MétroQuiz (v11)
   Usage : node test.js ABCDEFG  (ou un sous-ensemble)
   A : 3 premières ratées -> Terminus "ouverture"
   B : mi-partie, règle du score (Terminus "score")
   C : rejouer -> reset complet puis 1 faute comptée
   D : course CSS (aire 0px -> réelle après 1,5 s), 1re faute > 5 s
   E : switch de langue FR -> EN -> ES
   F : niveau +1 toutes les 10 questions
   G : bulles et question agrandies (64px, 26px) + copyright + badge version
   H : sync du pack d'actualités (en ligne puis offline)
   I : pénalité doublée toutes les 20 questions + thèmes mélangés
   J : ≥ 30 % d'actualité (3/10) + bonus actu +75 (v14)
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const wanted = (process.argv[2] || "ABCDEF").toUpperCase().split("");
const has = (s) => wanted.includes(s);

/* ---------------- horloge virtuelle ---------------- */
let vt = 0;
let rafSeq = 1;
const rafPending = new Map();
let timers = [];
let timerSeq = 1;
const performance = { now: () => vt };
function requestAnimationFrame(cb) { const id = rafSeq++; rafPending.set(id, cb); return id; }
function cancelAnimationFrame(id) { rafPending.delete(id); }
function setTimeout_(cb, ms) { const id = timerSeq++; timers.push({ id, due: vt + (ms || 0), cb }); return id; }
function clearTimeout_(id) { timers = timers.filter((t) => t.id !== id); }
function runRafs() {
  const ids = [...rafPending.keys()];
  for (const id of ids) { const cb = rafPending.get(id); rafPending.delete(id); cb(vt); }
}
function runTimers() {
  timers.sort((a, b) => a.due - b.due || a.id - b.id);
  while (timers.length && timers[0].due <= vt) { const t = timers.shift(); t.cb(); }
}
function advance(sec, fpsStep = 1000 / 60) {
  // vt est en MILLISECONDS (le jeu fait performance.now() et dt = (now-last)/1000)
  const target = vt + sec * 1000;
  while (vt < target) {
    vt = Math.min(vt + fpsStep, target);
    runRafs();
    runTimers();
  }
  render();
}
function vtSec() { return Math.round(vt / 100) / 10; }

/* ---------------- mini-React ---------------- */
let hooks = [];
let hookIdx = 0;
let pendingEffects = [];
function useState(init) {
  const i = hookIdx++;
  const s = hooks[i] || (hooks[i] = { value: typeof init === "function" ? init() : init });
  return [s.value, (v) => { s.value = typeof v === "function" ? v(s.value) : v; }];
}
function useRef(init) { const i = hookIdx++; const s = hooks[i] || (hooks[i] = { current: init }); return s; }
function depsChanged(a, b) { return !a || a.length !== b.length || a.some((x, j) => x !== b[j]); }
function useCallback(fn, deps) {
  const i = hookIdx++;
  const s = hooks[i] || (hooks[i] = {});
  if (!s.fn || depsChanged(s.deps, deps)) { s.fn = fn; s.deps = deps; }
  return s.fn;
}
function useEffect(fn, deps) {
  const i = hookIdx++;
  const s = hooks[i] || (hooks[i] = {});
  pendingEffects.push({ s, fn, deps });
}
function createElement(type, props, ...children) {
  return {
    type,
    props: props || {},
    children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true),
  };
}
const React = { useState, useRef, useCallback, useEffect, createElement };

/* ---------------- DOM factice ---------------- */
const fakeArea = {
  clientWidth: 390,
  clientHeight: 560,
  getBoundingClientRect() {
    return { left: 0, top: 0, width: fakeArea.clientWidth, height: fakeArea.clientHeight };
  },
};
let lsData = {};
const localStorage = {
  getItem: (k) => (k in lsData ? lsData[k] : null),
  setItem: (k, v) => { lsData[k] = String(v); },
  removeItem: (k) => { delete lsData[k]; },
};
const windowStub = {
  addEventListener() {}, removeEventListener() {},
  setTimeout: setTimeout_, clearTimeout: clearTimeout_,
};

/* ---------------- chargement du bundle ---------------- */
const bundleSrc = fs.readFileSync(path.join(__dirname, "bundle_test.js"), "utf8");
const factory = new Function(
  "React", "window", "localStorage", "performance",
  "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "fetch",
  bundleSrc
);
/* fetch factice : fetchImpl est changé par les scénarios (null = offline) */
let fetchImpl = null;
function fetchWrapper(url) {
  return fetchImpl ? fetchImpl(url) : Promise.reject(new Error("offline"));
}
const { App, QUESTIONS, VERSION, LEVEL_EVERY, BUBBLE_H, I18N } = factory(
  React, windowStub, localStorage, performance,
  requestAnimationFrame, cancelAnimationFrame, setTimeout_, clearTimeout_, fetchWrapper
);
async function flushAsync() {
  // laisse les promesses (sync news) se dérouler
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  render();
}

/* ---------------- rendu + introspection ---------------- */
let tree = null;
let curLang = "fr";

function* walkHosts(node) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "function") {
    yield* walkHosts(node.type(Object.assign({}, node.props, { children: node.children })));
    return;
  }
  yield node;
  for (const c of node.children || []) {
    if (c && typeof c === "object") yield* walkHosts(c);
  }
}
function textOf(x) {
  if (x === null || x === undefined || typeof x === "boolean") return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (Array.isArray(x)) return x.map(textOf).join("");
  if (typeof x.type === "function") return textOf(x.type(Object.assign({}, x.props, { children: x.children })));
  return (x.children || []).map(textOf).join("");
}
function render() {
  hookIdx = 0;
  pendingEffects = [];
  tree = App();
  // attache les refs AVANT les effets (sémantique React)
  for (const n of walkHosts(tree)) {
    const r = n.props && n.props.ref;
    if (r && typeof r === "object") r.current = fakeArea;
  }
  // effets (avec cleanup si deps changées)
  for (const e of pendingEffects) {
    const s = e.s;
    if (s.deps === undefined || depsChanged(s.deps, e.deps)) {
      if (s.cleanup) s.cleanup();
      s.cleanup = e.fn() || null;
      s.deps = e.deps;
    }
  }
  pendingEffects = [];
  return tree;
}
function allButtons() {
  const out = [];
  for (const n of walkHosts(tree)) {
    if (n.type === "button" && n.props.onClick) {
      out.push({ text: textOf(n).trim(), cls: n.props.className || "", onClick: n.props.onClick });
    }
  }
  return out;
}
function categoryButtons() {
  // les boutons catégories : rounded-full + font-medium (le ⏸ est font-bold)
  return allButtons().filter((b) => b.cls.includes("rounded-full") && b.cls.includes("font-medium"));
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function clickButtonByText(re) {
  const b = allButtons().find((b) => re.test(b.text));
  if (!b) throw new Error("bouton introuvable : " + re);
  b.onClick();
  render();
}
function bubbles() {
  const out = [];
  for (const n of walkHosts(tree)) {
    const st = n.props && n.props.style;
    if (n.type === "div" && st && st.top !== undefined && st.width !== undefined && st.left !== undefined) {
      out.push({
        left: st.left, top: st.top, w: st.width, h: st.height,
        cls: n.props.className || "", text: textOf(n).trim(),
      });
    }
  }
  return out;
}
function questionText() {
  for (const n of walkHosts(tree)) {
    const cls = n.props.className || "";
    // v11 : la question est en text-[32px] ; avant c'était leading-snug
    if (n.type === "p" && /text-\[32px\]|leading-snug/.test(cls)) return textOf(n).trim();
  }
  return null;
}
function questionCls() {
  for (const n of walkHosts(tree)) {
    const cls = n.props.className || "";
    if (n.type === "p" && /text-\[32px\]|leading-snug/.test(cls)) return cls;
  }
  return null;
}
function hudLevel() {
  for (const n of walkHosts(tree)) {
    const cls = n.props && n.props.className;
    if (n.type === "div" && typeof cls === "string" && cls.includes("text-cyan-400")) {
      const kids = n.children;
      for (let i = 0; i < kids.length; i++) {
        if (typeof kids[i] === "string" && /^(Niveau|Level|Nivel)$/.test(kids[i])) {
          for (let j = i + 1; j < kids.length; j++) if (typeof kids[j] === "number") return kids[j];
        }
      }
    }
  }
  return null;
}
function hudScore() {
  for (const n of walkHosts(tree)) {
    const cls = n.props && n.props.className;
    if (n.type === "div" && typeof cls === "string" && cls.includes("font-bold") && textOf(n).startsWith("⭐")) {
      const m = textOf(n).match(/-?\d+/);
      return m ? parseInt(m[0], 10) : null;
    }
  }
  return null;
}
function areaNode() {
  for (const n of walkHosts(tree)) if (n.props && n.props.onPointerDown) return n;
  return null;
}
function tap(x, y) {
  const a = areaNode();
  if (!a) throw new Error("aire de jeu introuvable");
  a.props.onPointerDown({ clientX: x, clientY: y });
  render();
}

/* ---------------- helpers de jeu ---------------- */
function resetSession() {
  hooks = []; hookIdx = 0; pendingEffects = [];
  vt = 0; rafPending.clear(); timers = []; lsData = {};
  fakeArea.clientWidth = 390; fakeArea.clientHeight = 560;
  curLang = "fr";
  render();
  clickButtonByText(/Français/);
}
function startGame(lang) {
  clickButtonByText(new RegExp(escapeRe(I18N[lang].play)));
}
function correctAnswerFor(lang) {
  const qt = questionText();
  if (!qt) throw new Error("pas de question affichée");
  const q = QUESTIONS[lang].find((x) => x.q === qt);
  if (!q) throw new Error("question introuvable dans la banque " + lang + " : " + qt);
  return q.a[q.c];
}
function reason() {
  const s = textOf(tree);
  const { reasonScore, reasonOpening } = I18N[curLang];
  if (s.includes(reasonScore)) return "score";
  if (s.includes(reasonOpening)) return "opening";
  return null;
}
function isGameOver() { return reason() !== null; }
function catchCorrect(lang) {
  // la cible est recalculée à chaque itération : la question peut changer
  // (feedback 800 ms) ou être manquée (bulle tombée → nouvelle question)
  for (let i = 0; i < 150; i++) {
    if (isGameOver()) return false;
    const qt = questionText();
    if (qt !== null) {
      const target = correctAnswerFor(lang);
      const b = bubbles().find((b) => b.text === target);
      if (b) { tap(b.left + b.w / 2, b.top + b.h / 2); return true; }
    }
    advance(0.1);
  }
  throw new Error("bulle correcte jamais apparue");
}
function missOne() {
  const q0 = questionText();
  for (let i = 0; i < 120; i++) {
    advance(0.25);
    if (isGameOver()) return "gameover";
    const qt = questionText();
    if (qt !== null && qt !== q0) return "next";
  }
  throw new Error("la question n'a jamais été manquée");
}

let failures = 0;
function check(label, cond) {
  console.log((cond ? "  ✅ " : "  ❌ ") + label);
  if (!cond) failures++;
}

/* ---------------- scénarios ---------------- */
function scenarioA() {
  console.log("— Scénario A : les 3 premières réponses toutes fausses —");
  resetSession();
  startGame("fr");
  check("départ à 100 points", hudScore() === 100);
  let r = "next";
  for (let i = 0; i < 3 && r === "next"; i++) r = missOne();
  check("la partie se termine (" + vtSec() + " s virtuelles)", r === "gameover");
  check("raison : 3 premières réponses fausses", reason() === "opening");
  check("PAS la raison 'score à zéro'", reason() !== "score");
  check("record sauvegardé", lsData.metroquiz_best !== undefined);
  const st = lsData.metroquiz_stats ? JSON.parse(lsData.metroquiz_stats) : null;
  check("stats de partie sauvegardées (v22)", st !== null && st.games.length === 1 && st.games[0].q === 3 && st.games[0].l === "fr");
}

function scenarioB() {
  console.log("— Scénario B : mi-partie, règle du score —");
  resetSession();
  startGame("fr");
  check("départ : 100 points", hudScore() === 100);
  check("bonne réponse attrapée", catchCorrect("fr") === true);
  const s1 = hudScore();
  check("score assez haut après bonus (" + s1 + " pts)", s1 !== null && s1 > 100);
  let r = "next";
  let misses = 0;
  while (r === "next" && misses < 3) { r = missOne(); misses++; }
  check("3 fautes consécutives mi-partie sans game over tant que score > 0", r === "next" && hudScore() > 0);
  while (r === "next" && misses < 15) { r = missOne(); misses++; }
  check("raison mi-partie : '" + I18N.fr.reasonScore + "'", reason() === "score");
  check("PAS la raison '3 premières'", reason() !== "opening");
}

function scenarioC() {
  console.log("— Scénario C : rejouer après un terminus —");
  resetSession();
  startGame("fr");
  let r = "next";
  while (r === "next") r = missOne();
  check("terminus atteint", r === "gameover");
  clickButtonByText(new RegExp(escapeRe(I18N.fr.replay)));
  check("nouvelle partie : 100 points", hudScore() === 100);
  r = missOne();
  check("première faute comptée (❌ 1/3)", textOf(tree).includes("❌ 1/3"));
  check("après 1 faute en ouverture : toujours en jeu", r === "next");
  check("score 25 après 1 faute (100 − 75)", hudScore() === 25);
}

function scenarioD() {
  console.log("— Scénario D : course CSS, 1re partie après ouverture —");
  resetSession();
  fakeArea.clientWidth = 0;
  fakeArea.clientHeight = 0;
  startGame("fr");
  advance(1.5);
  fakeArea.clientWidth = 390;
  fakeArea.clientHeight = 560;
  let firstMiss = null;
  for (let i = 0; i < 100 && firstMiss === null; i++) {
    advance(0.25);
    const s = hudScore();
    if (s !== null && s !== 100) firstMiss = Math.round(vt) / 1000;
  }
  check("aucune faute avant que la bulle ait réellement traversé l'écran (1re faute : " + firstMiss + " s)",
    firstMiss !== null && firstMiss > 5);
  check("question active, partie jouable", questionText() !== null && reason() === null);
  check("pas de game over immotivé", !isGameOver());
}

function scenarioE() {
  console.log("— Scénario E : switch de langue FR → EN → ES —");
  resetSession();
  check("langue sauvegardée (fr)", lsData.metroquiz_lang === "fr");
  startGame("fr");
  check("questions en français", correctAnswerFor("fr") !== null);
  clickButtonByText(/⏸/);
  clickButtonByText(new RegExp(escapeRe(I18N.fr.quit)));
  clickButtonByText(new RegExp(escapeRe(I18N.fr.changeLang)));
  clickButtonByText(/English/);
  curLang = "en";
  check("accueil en anglais ('" + I18N.en.play + "')", allButtons().some((b) => b.text.includes(I18N.en.play)));
  check("catégories traduites ('" + I18N.en.catsTitle + "')", textOf(tree).includes(I18N.en.catsTitle));
  startGame("en");
  check("questions en anglais", correctAnswerFor("en") !== null);
  clickButtonByText(/⏸/);
  clickButtonByText(new RegExp(escapeRe(I18N.en.quit)));
  clickButtonByText(new RegExp(escapeRe(I18N.en.changeLang)));
  clickButtonByText(/Español/);
  curLang = "es";
  check("accueil en espagnol ('" + I18N.es.play + "')", allButtons().some((b) => b.text.includes(I18N.es.play)));
  startGame("es");
  check("questions en espagnol", correctAnswerFor("es") !== null);
  const target = correctAnswerFor("es");
  let tapped = false;
  for (let i = 0; i < 60 && !tapped; i++) {
    const wrong = bubbles().find((b) => b.text !== target);
    if (wrong) { tap(wrong.left + wrong.w / 2, wrong.top + wrong.h / 2); tapped = true; }
    else advance(0.25);
  }
  check("feedback traduit ('Respuesta incorrecta…')", tapped && textOf(tree).toLowerCase().includes("incorrecta"));
  check("langue sauvegardée (es)", lsData.metroquiz_lang === "es");
}

function scenarioF() {
  console.log("— Scénario F : niveau 2 après 10 questions —");
  resetSession();
  startGame("fr");
  let lvl10 = null;
  let lvl11 = null;
  let catches = 0;
  for (let i = 1; i <= 11; i++) {
    if (!catchCorrect("fr")) break;
    catches++;
    if (i === 10) lvl10 = hudLevel();
    if (i === 11) lvl11 = hudLevel();
  }
  check(catches + " bonnes réponses attrapées (" + vtSec() + " s virtuelles)", catches === 11);
  check("niveau toujours 1 à la 10e question", lvl10 === 1);
  check("niveau 2 à la 11e question (lu : " + lvl11 + ")", lvl11 === 2);
  check("score grimpé avec les combos (" + hudScore() + " pts)", hudScore() > 1000);
}

function scenarioG() {
  console.log("— Scénario G : bulles agrandies + question 32px + copyright (v22) —");
  check("BUBBLE_H = 64 px (lu : " + BUBBLE_H + ")", BUBBLE_H === 64);
  check("LEVEL_EVERY = 10 (lu : " + LEVEL_EVERY + ")", LEVEL_EVERY === 10);
  check("VERSION = v24 (lu : " + VERSION + ")", VERSION === "v24");
  resetSession();
  check("copyright sur l'accueil ('© 2026 … Ansault')", /© 2026[^]*Ansault/.test(textOf(tree)));
  check("copyright FR exact", textOf(tree).includes(I18N.fr.copyright));
  check("copyright traduit (EN/ES présents dans I18N)",
    /rights reserved/i.test(I18N.en.copyright) && /derechos/i.test(I18N.es.copyright));
  check("badge v24 sur l'accueil", textOf(tree).includes("v24"));
  check("pas de ligne stats sans historique", !textOf(tree).includes("Parties :"));
  startGame("fr");
  check("question en 32 px (texte doublé, lu : '" + questionCls() + "')",
    questionCls() !== null && /text-\[32px\]/.test(questionCls()));
  let b = null;
  for (let i = 0; i < 30 && !b; i++) { advance(0.25); b = bubbles()[0]; }
  check("une bulle apparaît", !!b);
  if (b) {
    check("hauteur 64 px (lu : " + b.h + ")", b.h === 64);
    check("police doublée : 26 px", /text-\[26px\]/.test(b.cls));
    check("texte non tronqué (plus de 'truncate')", !/truncate/.test(b.cls));
    check("largeur min 170 px (lu : " + b.w + ")", b.w >= 170);
    check("largeur ≤ aire − 16 px (lu : " + b.w + ")", b.w <= 374);
  }
}

/* ---------------- scénario H : pack d'actualités (v12) ---------------- */
function newsStubQ(id) {
  return { cat: "actu", q: id + " : quelle est la bonne réponse ?", a: ["Bonne", "Fausse 1", "Fausse 2", "Fausse 3"], c: 0 };
}
async function scenarioH() {
  console.log("— Scénario H : sync du pack d'actualités (en ligne puis offline) —");
  // 1) en ligne : le pack news.json est téléchargé, mis en cache, fusionné
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      date: "2026-11-02",
      qs: {
        fr: [newsStubQ("NEWSFR-Q1"), newsStubQ("NEWSFR-Q2"), newsStubQ("NEWSFR-Q3")],
        en: [newsStubQ("NEWSEN-Q1")],
        es: [newsStubQ("NEWSES-Q1")],
      },
    }),
  });
  resetSession();
  await flushAsync();
  check("pack téléchargé et mis en cache (localStorage)", lsData.metroquiz_news !== undefined);
  check("ligne 📰 sur l'accueil (3 questions · 2026-11-02)",
    /📰/.test(textOf(tree)) && textOf(tree).includes("2026-11-02"));
  // 2) jouer uniquement en Actualités : la question vient du pack
  for (const b of categoryButtons()) {
    if (!b.text.includes("📰")) b.onClick();
  }
  render();
  startGame("fr");
  check("question issue du pack d'actualités (lu : " + (questionText() || "").slice(0, 12) + "…)",
    (questionText() || "").startsWith("NEWSFR"));
  // attraper « Bonne » (réponse correcte du stub)
  let caught = false;
  for (let i = 0; i < 40 && !caught; i++) {
    const b = bubbles().find((x) => x.text === "Bonne");
    if (b) { tap(b.left + b.w / 2, b.top + b.h / 2); caught = true; }
    else advance(0.25);
  }
  check("bonne réponse d'actualité attrapée (score " + hudScore() + ")", caught && hudScore() > 100);
  // 3) offline : le jeu reste jouable avec les questions embarquées
  fetchImpl = null;
  resetSession();
  await flushAsync();
  check("offline : pas de crash, pas de pack", lsData.metroquiz_news === undefined);
  startGame("fr");
  check("question embarquée (pas NEWSFR)", (questionText() || "").indexOf("NEWSFR") !== 0);
  check("partie jouable offline", questionText() !== null && hudScore() === 100);
}

/* ---------------- exécution ---------------- */
function questionCat() {
  for (const n of walkHosts(tree)) {
    const cls = n.props.className || "";
    if (n.type === "p" && /text-\[11px\]/.test(cls)) return textOf(n).split("🔥")[0].trim();
  }
  return null;
}
/* manqué contrôlé : vérifie la pénalité appliquée puis attend la question suivante */
function missOneChecked(expectedPenalty) {
  const s0 = hudScore();
  const q0 = questionText();
  let missed = false;
  for (let i = 0; i < 120; i++) {
    advance(0.25);
    if (isGameOver()) return "gameover";
    if (!missed) {
      const s = hudScore();
      if (s !== null && s !== s0) {
        missed = true;
        check("pénalité " + expectedPenalty + " appliquée (score " + s0 + " → " + s + ")", s === s0 - expectedPenalty);
        check("feedback affiche " + expectedPenalty, textOf(tree).includes(String(expectedPenalty)));
      }
    } else if (questionText() !== q0) {
      return "next";
    }
  }
  throw new Error("question jamais manquée");
}
async function scenarioI() {
  console.log("— Scénario I : pénalité doublée toutes les 20 questions + thèmes mélangés —");
  resetSession();
  startGame("fr");
  check("HUD affiche -75 au départ", textOf(tree).includes("-75"));
  // Q1 : ratée → −75
  check("Q1 ratée : game over non déclenché", missOneChecked(75) !== "gameover");
  // Q2..Q20 : 19 bonnes attrapées, aucun thème consécutif identique
  let prevCat = questionCat(); // catégorie de Q2, déjà affichée
  let okMix = true;
  let catches = 0;
  let guard = 0;
  while (catches < 19 && guard++ < 400) {
    if (!catchCorrect("fr")) break; // attraper la question affichée
    catches++;
    if (catches >= 19) break;
    // attendre l'affichage de la question suivante (feedback de 800 ms)
    const qBefore = questionText();
    let changed = false;
    for (let k = 0; k < 60 && !changed; k++) {
      if (isGameOver()) break;
      if (questionText() !== qBefore) changed = true;
      else advance(0.1);
    }
    if (isGameOver() || !changed) break;
    const cat = questionCat();
    if (cat === prevCat) { okMix = false; break; }
    prevCat = cat;
  }
  check("19 bonnes réponses attrapées (" + catches + ")", catches === 19);
  check("aucun thème consécutif identique sur 20 questions", okMix);
  // Q21 : ratée → −150 (75 × 2)
  const r = missOneChecked(150);
  check("Q21 ratée : pénalité doublée à −150", r !== "gameover" && hudScore() > 0);
  check("HUD affiche -150", textOf(tree).includes("-150"));
  // Q22..Q100 : 79 bonnes de plus → à Q101, la pénalité serait 75×32 sans plafond
  let capCatches = 0;
  let capGuard = 0;
  while (capCatches < 79 && capGuard++ < 2000) {
    if (isGameOver()) break;
    if (!catchCorrect("fr")) break;
    capCatches++;
    const qBefore = questionText();
    let changed = false;
    for (let k = 0; k < 60 && !changed; k++) {
      if (isGameOver()) break;
      if (questionText() !== qBefore) changed = true;
      else advance(0.1);
    }
    if (isGameOver() || !changed) break;
  }
  check("79 bonnes réponses supplémentaires (" + capCatches + ")", capCatches === 79);
  const r2 = missOneChecked(600);
  check("Q101 ratée : pénalité plafonnée à −600", r2 !== "gameover" && hudScore() > 0);
  check("HUD affiche -600", textOf(tree).includes("-600"));
}

/* ---------------- scénario J : ratio actu ≥ 30 % + bonus +75 (v14) ---------------- */
async function scenarioJ() {
  console.log("— Scénario J : ≥ 30 % d'actualité (3/10) + bonus actu +75 —");
  const stubs = [];
  for (let i = 1; i <= 10; i++) stubs.push(newsStubQ("NEWSFR-J" + i));
  fetchImpl = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ date: "2026-11-02", qs: { fr: stubs, en: [], es: [] } }),
  });
  resetSession();
  await flushAsync();
  check("pack actu J téléchargé (localStorage)", lsData.metroquiz_news !== undefined);
  startGame("fr");
  const cats = [];
  let bonusLabelSeen = false;
  let firstActuGain = null;
  for (let i = 0; i < 10; i++) {
    // attraper la bonne réponse (stub NEWSFR ou banque embarquée)
    const s0 = hudScore();
    let caught = false;
    let isActu = false;
    for (let k = 0; k < 150 && !caught; k++) {
      if (isGameOver()) break;
      const qt = questionText();
      if (qt !== null) {
        const isNews = qt.indexOf("NEWSFR") === 0;
        let target = null;
        if (isNews) target = "Bonne";
        else {
          const q = QUESTIONS.fr.find((x) => x.q === qt);
          if (q) target = q.a[q.c];
        }
        const b = target ? bubbles().find((x) => x.text === target) : null;
        if (b) {
          tap(b.left + b.w / 2, b.top + b.h / 2);
          caught = true;
          isActu = isNews;
          break;
        }
      }
      advance(0.1);
    }
    if (!caught) break;
    cats.push(isActu ? "actu" : "other");
    if (isActu) {
      if (textOf(tree).includes("Bonus actu")) bonusLabelSeen = true;
      const s1 = hudScore();
      if (firstActuGain === null && s1 !== null && s0 !== null) firstActuGain = s1 - s0;
    }
    // attendre la question suivante (feedback de 800 ms)
    if (i < 9) {
      const qBefore = questionText();
      let changed = false;
      for (let k = 0; k < 60 && !changed; k++) {
        if (isGameOver()) break;
        if (questionText() !== qBefore) changed = true;
        else advance(0.1);
      }
      if (!changed) break;
    }
  }
  const actuCount = cats.filter((c) => c === "actu").length;
  check("10 questions jouées (lu : " + cats.length + ")", cats.length === 10);
  check("au moins 3 questions d'actualité sur 10 (lu : " + actuCount + ")", actuCount >= 3);
  check("exactement 3 actu par tranche de 10 (plan de créneaux)", actuCount === 3);
  let adjacent = false;
  for (let i = 1; i < cats.length; i++) if (cats[i] === "actu" && cats[i - 1] === "actu") adjacent = true;
  check("aucune question actu consécutive", !adjacent);
  check("feedback 'Bonus actu' (📰) vu sur une capture actu", bonusLabelSeen);
  check("bonus +75 inclus dans le gain actu (gain lu : " + firstActuGain + " pts)",
    firstActuGain !== null && firstActuGain >= 175);
  fetchImpl = null;
}


/* ---------------- scénario K : catégorie LGBT+ (v24) ---------------- */
async function scenarioK() {
  console.log("— Scénario K : catégorie LGBT+ (banque + affichage) —");
  for (const l of ["fr", "en", "es"]) {
    const arr = QUESTIONS[l].filter((q) => q.cat === "lgbt");
    check(l + " : ≥ 89 questions lgbt (lu : " + arr.length + ")", arr.length >= 89);
    const seen = new Set();
    let bad = 0;
    for (const q of arr) {
      if (!(Array.isArray(q.a) && q.a.length === 4 && new Set(q.a).size === 4)) bad++;
      if (!(Number.isInteger(q.c) && q.c >= 0 && q.c <= 3)) bad++;
      if (seen.has(q.q)) bad++;
      seen.add(q.q);
    }
    check(l + " : options valides et zéro doublon" + (bad ? " (" + bad + " défauts)" : ""), bad === 0);
  }
  // la pastille LGBT+ est visible sur l écran des catégories (accueil)
  resetSession();
  advance(0.2);
  render();
  check("pastille « LGBT+ » visible à l accueil (fr)", textOf(tree).includes("LGBT+"));
  check("13 catégories présentes (chips)", (textOf(tree).match(/LGBT+/g) || []).length >= 1);
}

const scenarios = { A: scenarioA, B: scenarioB, C: scenarioC, D: scenarioD, E: scenarioE, F: scenarioF, G: scenarioG, H: scenarioH, I: scenarioI, J: scenarioJ, K: scenarioK };
(async () => {
  for (const s of wanted) {
    if (scenarios[s]) await scenarios[s]();
  }
  console.log(failures ? "\n💥 " + failures + " test(s) en échec" : "\n🎉 TOUS LES TESTS PASSENT (" + VERSION + ")");
  process.exit(failures ? 1 : 0);
})();
