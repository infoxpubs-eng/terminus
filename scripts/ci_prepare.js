/* MétroQuiz — validation CI (GitHub Actions, à chaque push sur main).
   Vérifie : syntaxe du bundle index.html, VERSION cohérente avec le harnais,
   banques de questions (format, doublons, volume), synchronisation bundle_test.js
   et data/questions.json, validité de news.json. */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const root = path.join(__dirname, "..");
function fail(msg) { console.error("❌ CI ÉCHEC : " + msg); process.exit(1); }
function ok(msg) { console.log("✅ " + msg); }

/* ---- index.html : extraction du JS inline ---- */
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const lines = html.split("\n");
const so = lines.indexOf("<script>", lines.indexOf("</style>"));
const sc = lines.indexOf("</script>", so);
if (so === -1 || sc === -1) fail("script inline introuvable dans index.html");
const js = lines.slice(so + 1, sc).join("\n");
const tmpJs = path.join(__dirname, "_prod_check.js");
fs.writeFileSync(tmpJs, js);
try { cp.execSync("node --check " + JSON.stringify(tmpJs), { stdio: "pipe" }); }
catch (e) { fail("syntaxe invalide dans index.html :\n" + e.stderr); }
finally { try { fs.unlinkSync(tmpJs); } catch {} }
ok("syntaxe du bundle index.html valide (" + js.length + " octets)");

/* ---- VERSION ---- */
const v = js.match(/"(v\d+)"/);
if (!v) fail("VERSION introuvable dans index.html");
const htmlVersion = v[1];
const harness = fs.readFileSync(path.join(__dirname, "test.js"), "utf8");
const hv = harness.match(/VERSION === "(v\d+)"/);
if (!hv) fail("harnais : attente de VERSION introuvable");
if (htmlVersion !== hv[1]) fail("VERSION index.html (" + htmlVersion + ") ≠ VERSION attendue par le harnais (" + hv[1] + ") — mettre à jour scripts/test.js");
ok("VERSION cohérente : " + htmlVersion);

/* ---- banque de questions ---- */
function walkBalanced(s, from, o, c) {
  let depth = 0, state = null;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (state) { if (ch === "\\") { i++; continue; } if (ch === state) state = null; continue; }
    if (ch === '"' || ch === "'") { state = ch; continue; }
    if (ch === o) depth++;
    else if (ch === c) { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function extractBank(src, label) {
  const pat = src.indexOf('fr:[{cat:"');
  if (pat === -1) fail("banque QUESTIONS introuvable dans " + label);
  const open = src.lastIndexOf("{", pat);
  const close = walkBalanced(src, open, "{", "}");
  if (close === -1) fail("banque QUESTIONS non fermée dans " + label);
  try { return new Function("return " + src.slice(open, close + 1))(); }
  catch (e) { fail("banque QUESTIONS illisible dans " + label + " : " + e.message); }
}
function checkBank(bank, label) {
  for (const l of ["fr", "en", "es"]) {
    const arr = bank[l];
    if (!Array.isArray(arr) || arr.length < 1500) fail(label + " : " + l + " doit contenir ≥ 1500 questions (trouvé " + (arr && arr.length) + ")");
    const seen = new Set();
    for (const q of arr) {
      if (!(Array.isArray(q.a) && q.a.length === 4 && new Set(q.a).size === 4)) fail(label + " : options invalides : " + q.q);
      if (!(Number.isInteger(q.c) && q.c >= 0 && q.c <= 3)) fail(label + " : index de réponse invalide : " + q.q);
      if (seen.has(q.q)) fail(label + " : doublon d'énoncé : " + q.q);
      seen.add(q.q);
    }
  }
}
const bankHtml = extractBank(js, "index.html");
checkBank(bankHtml, "index.html");
ok("banque index.html : fr=" + bankHtml.fr.length + " en=" + bankHtml.en.length + " es=" + bankHtml.es.length + " — aucun doublon");

/* ---- bundle_test.js : même banque ---- */
const bt = fs.readFileSync(path.join(__dirname, "bundle_test.js"), "utf8");
if (!bt.startsWith("return ")) fail("scripts/bundle_test.js : format inattendu (doit commencer par 'return ')");
const bankTest = extractBank(bt, "scripts/bundle_test.js");
if (JSON.stringify(bankTest) !== JSON.stringify(bankHtml)) fail("scripts/bundle_test.js n'a pas la même banque de questions qu'index.html — régénérer les deux ensemble");
ok("bundle_test.js : banque identique à index.html");

/* ---- data/questions.json : sauvegarde synchronisée ---- */
const backup = JSON.parse(fs.readFileSync(path.join(root, "data", "questions.json"), "utf8"));
if (JSON.stringify(backup.langs) !== JSON.stringify(bankHtml)) fail("data/questions.json désynchronisé d'index.html — régénérer la sauvegarde");
ok("data/questions.json synchronisé (version " + (backup._version || "?") + ", date " + (backup._date || "?") + ")");

/* ---- news.json ---- */
const news = JSON.parse(fs.readFileSync(path.join(root, "news.json"), "utf8"));
if (!/^\d{4}-\d{2}-\d{2}$/.test(news.date || "")) fail("news.json : date invalide");
for (const l of ["fr", "en", "es"]) {
  const arr = (news.qs && news.qs[l]) || [];
  for (const q of arr) {
    if (!(Array.isArray(q.a) && q.a.length === 4 && new Set(q.a).size === 4) || !(Number.isInteger(q.c) && q.c >= 0 && q.c <= 3)) {
      fail("news.json " + l + " : question malformée : " + (q && q.q));
    }
  }
  console.log("ℹ️ news.json " + l + " : " + arr.length + " questions");
}
ok("news.json valide (date " + news.date + ")");
console.log("— ci_prepare OK —");
