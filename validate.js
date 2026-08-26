// 0x AUDIO — conformance validator, v0.1
//
//   node validate.js <file.bin | file.json>
//
// Reads either shape, works out which it is, checks it against conformance-v0.1.md
// and exits 0 for conforming, 1 for not. Importable too, so a composer can gate its
// own release on it:
//
//   import { validateScore } from "./validate.js";
//   const r = validateScore(myComposer(seed));
//   if (!r.ok) throw new Error(r.failures.join("\n"));
//
// Structure only. Whether audio actually decodes needs an audio context — the
// inspector does that half in a browser.

const MUST = "MUST", SHOULD = "SHOULD";

function report() {
  const rows = [];
  return {
    rows,
    check(level, rule, pass, detail) { rows.push({ level, rule, pass, detail }); },
    get failures() { return rows.filter(r => r.level === MUST && !r.pass).map(r => r.rule + (r.detail ? " — " + r.detail : "")); },
    get warnings() { return rows.filter(r => r.level === SHOULD && !r.pass).map(r => r.rule + (r.detail ? " — " + r.detail : "")); },
    get ok() { return this.failures.length === 0; },
  };
}

// ─── CRATE ─────────────────────────────────────────────────────────────────

export function validateCrate(bytes) {
  const r = report();

  if (bytes.length < 5) { r.check(MUST, "crate 1: has a 4-byte manifest length", false, "file is too short"); return r; }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = dv.getUint32(0);
  r.check(MUST, "crate 1: has a 4-byte big-endian manifest length", 4 + len <= bytes.length,
          4 + len > bytes.length ? `declares ${len} bytes, file holds ${bytes.length - 4}` : `${len} bytes`);
  if (4 + len > bytes.length) return r;

  let manifest = null, jsonErr = null;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + len))); }
  catch (e) { jsonErr = e.message; }
  r.check(MUST, "crate 2: manifest is valid UTF-8 JSON", manifest !== null, jsonErr);
  if (manifest === null) return r;

  const isArray = Array.isArray(manifest);
  r.check(MUST, "crate 3: manifest is a bare array of [slot, offset, length]", isArray,
          isArray ? `${manifest.length} entries` : "manifest is an object — that is a later spec version");
  if (!isArray) return r;

  const shaped = manifest.every(e => Array.isArray(e) && e.length === 3 &&
    typeof e[0] === "string" && Number.isInteger(e[1]) && Number.isInteger(e[2]));
  r.check(MUST, "crate 3: every entry is [string, integer, integer]", shaped);
  if (!shaped) return r;

  const audioStart = 4 + len;
  const over = manifest.filter(([, o, l]) => audioStart + o + l > bytes.length);
  r.check(MUST, "crate 4: every sample lies inside the file", over.length === 0,
          over.length ? over.map(e => e[0]).join(", ") + " run past the end" : null);

  // gzip is not assumed — flag it rather than fail, since the format allows either
  if (bytes[0] === 0x1f && bytes[1] === 0x8b)
    r.check(MUST, "crate: not gzipped at this layer", false, "file starts with the gzip magic — decompress first");

  let cursor = 0; const gaps = [];
  for (const [slot, o, l] of manifest) { if (o !== cursor) gaps.push(slot); cursor = o + l; }
  r.check(SHOULD, "crate 6: offsets tile contiguously", gaps.length === 0,
          gaps.length ? `discontinuity at ${gaps.join(", ")}` : `${cursor} audio bytes`);

  const NOTE = /^[A-G]#?-?\d+$/;
  const named = manifest.filter(([s]) => NOTE.test(s)).length;
  r.check(SHOULD, "crate 7: pitched slots use scientific pitch notation", named === manifest.length,
          named === manifest.length ? "all slots are note names"
            : `${manifest.length - named} slots are not note names — kit crate, or a naming mismatch`);

  // a slot far off the median size is the usual shape of a bad sample
  const sizes = manifest.map(e => e[2]).sort((a, b) => a - b);
  const median = sizes[sizes.length >> 1];
  const odd = manifest.filter(([, , l]) => l < median * 0.5);
  r.check(SHOULD, "crate 8: no slot looks truncated", odd.length === 0,
          odd.length ? odd.map(e => `${e[0]} (${e[2]}B vs median ${median}B)`).join(", ") : null);

  r.slots = manifest.map(e => e[0]);
  return r;
}

// ─── SCORE ─────────────────────────────────────────────────────────────────

export function validateScore(input) {
  const r = report();
  let s = input;
  if (typeof s === "string") {
    try { s = JSON.parse(s); }
    catch (e) { r.check(MUST, "score: is valid JSON", false, e.message); return r; }
  }
  if (typeof s !== "object" || s === null) { r.check(MUST, "score: is an object", false); return r; }

  r.check(MUST, 'score 1: carries "0xaudio": "score/0.1"', s["0xaudio"] === "score/0.1",
          s["0xaudio"] === undefined ? "field is missing" : `found ${JSON.stringify(s["0xaudio"])}`);
  r.check(MUST, "score 2: bpm > 0 and ppq > 0", s.bpm > 0 && s.ppq > 0, `bpm=${s.bpm} ppq=${s.ppq}`);

  const notes = s.notes;
  if (!Array.isArray(notes)) { r.check(MUST, "score 3: notes is an array", false); return r; }

  const badShape = [], badRange = [], badTime = [];
  notes.forEach((n, i) => {
    if (!Array.isArray(n) || n.length !== 4 || !n.every(Number.isInteger)) { badShape.push(i); return; }
    const [start, note, dur, vel] = n;
    if (note < 0 || note > 127 || vel < 0 || vel > 127) badRange.push(i);
    if (start < 0 || dur <= 0) badTime.push(i);
  });
  const show = a => a.slice(0, 5).join(", ") + (a.length > 5 ? ` …(${a.length})` : "");
  r.check(MUST, "score 3: every note is four integers", badShape.length === 0, badShape.length ? "notes " + show(badShape) : `${notes.length} notes`);
  r.check(MUST, "score 4: note and velocity within 0-127", badRange.length === 0, badRange.length ? "notes " + show(badRange) : null);
  r.check(MUST, "score 5: start >= 0 and duration > 0", badTime.length === 0, badTime.length ? "notes " + show(badTime) : null);

  const starts = notes.filter(n => Array.isArray(n) && Number.isInteger(n[0])).map(n => n[0]);
  const maxStart = starts.length ? Math.max(...starts) : 0;
  const length = s.length ?? maxStart;
  r.check(MUST, "score 6: length >= the last note's start", length >= maxStart, `length=${length} maxStart=${maxStart}`);

  // things a score must not carry
  const banned = ["crate", "samples", "sample", "audio", "effects", "file", "filename"];
  const found = banned.filter(k => k in s);
  r.check(MUST, "score: carries no crate, audio or effects field", found.length === 0,
          found.length ? "found " + found.join(", ") : null);

  return r;
}

// ─── CLI ───────────────────────────────────────────────────────────────────

function print(name, r) {
  console.log(`\n0x AUDIO — conformance: ${name}\n`);
  for (const row of r.rows) {
    const mark = row.pass ? "PASS" : (row.level === MUST ? "FAIL" : "WARN");
    console.log(`  ${mark}  ${row.rule}${row.detail ? "\n          " + row.detail : ""}`);
  }
  console.log("");
  if (r.ok && !r.warnings.length) console.log("  CONFORMS\n");
  else if (r.ok) console.log(`  CONFORMS with ${r.warnings.length} warning(s)\n`);
  else console.log(`  DOES NOT CONFORM — ${r.failures.length} failure(s)\n`);
  return r.ok ? 0 : 1;
}

const isMain = typeof process !== "undefined" && process.argv?.[1] &&
               import.meta.url.endsWith(process.argv[1].split("/").pop());

if (isMain) {
  const { readFileSync } = await import("node:fs");
  const path = process.argv[2];
  if (!path) { console.error("usage: node validate.js <file.bin | file.json>"); process.exit(2); }
  const buf = readFileSync(path);
  const looksJson = path.endsWith(".json") || buf[0] === 0x7b || buf[0] === 0x5b;
  const r = looksJson ? validateScore(buf.toString("utf8")) : validateCrate(new Uint8Array(buf));
  process.exit(print(path, r));
}
