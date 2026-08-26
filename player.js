// 0x AUDIO — reference player, v0.1
//
// Reads a crate, reads a score, makes sound. Decides nothing.
//
// No dependencies, no build step, no network. Runs from file:// offline, which is
// the requirement for anything that goes on chain.
//
// The two parse functions are the normative part — they ARE the spec, and they are
// pure: bytes in, data out, no environment. Everything below them is one possible
// player and is replaceable.

// ─── CRATE ─────────────────────────────────────────────────────────────────
// [4-byte big-endian uint32 manifest length][manifest JSON][audio bytes]
// The manifest is a bare JSON array of [slot, offset, length] triples.

export function parseCrate(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error("parseCrate wants a Uint8Array");
  if (bytes.length < 5) throw new Error("crate too short");

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const manifestLen = dv.getUint32(0);                       // big-endian
  if (4 + manifestLen > bytes.length) throw new Error("manifest length overruns the file");

  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + manifestLen)));
  } catch (e) {
    throw new Error("manifest is not valid JSON: " + e.message);
  }

  // v0.1 is a bare array. A future version may use an object header instead, so
  // sniff the shape rather than assuming — do not let v0.2 break v0.1 readers.
  if (!Array.isArray(manifest)) {
    throw new Error("this crate has an object manifest; that is a later spec version");
  }

  const audioStart = 4 + manifestLen;
  const samples = manifest.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 3)
      throw new Error(`manifest entry ${i} is not [slot, offset, length]`);
    const [slot, offset, length] = entry;
    const from = audioStart + offset, to = from + length;
    if (to > bytes.length) throw new Error(`sample "${slot}" runs past the end of the file`);
    return { slot, offset, length, bytes: bytes.subarray(from, to) };
  });

  return { manifest, samples };
}

// ─── SCORE ─────────────────────────────────────────────────────────────────

export function parseScore(json) {
  const s = typeof json === "string" ? JSON.parse(json) : json;
  if (s["0xaudio"] !== "score/0.1") throw new Error('not a 0x Audio score/0.1');
  if (!(s.bpm > 0)) throw new Error("bpm must be > 0");
  if (!(s.ppq > 0)) throw new Error("ppq must be > 0");
  if (!Array.isArray(s.notes)) throw new Error("notes must be an array");

  const notes = s.notes.map((n, i) => {
    if (!Array.isArray(n) || n.length !== 4)
      throw new Error(`note ${i} must be [start, note, duration, velocity]`);
    const [start, note, duration, velocity] = n;
    if (!(start >= 0))              throw new Error(`note ${i}: start must be >= 0`);
    if (!(duration > 0))            throw new Error(`note ${i}: duration must be > 0`);
    if (!(note >= 0 && note <= 127))throw new Error(`note ${i}: note out of 0-127`);
    if (!(velocity >= 0 && velocity <= 127)) throw new Error(`note ${i}: velocity out of 0-127`);
    return { start, note, duration, velocity };
  }).sort((a, b) => a.start - b.start);          // a score need not arrive sorted

  const maxStart = notes.length ? notes[notes.length - 1].start : 0;
  const length = s.length ?? maxStart;
  if (length < maxStart) throw new Error("length is shorter than the last note's start");

  return { bpm: s.bpm, ppq: s.ppq, length, name: s.name || null, notes };
}

// ─── PITCH ─────────────────────────────────────────────────────────────────

const PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "A#3" -> 58. Scientific pitch notation, middle C is C4 = 60. */
export function noteToMidi(name) {
  const m = /^([A-G]#?)(-?\d+)$/.exec(name);
  if (!m) return null;
  return PC.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
}

// ─── PLAYBACK ──────────────────────────────────────────────────────────────
// One implementation of a player. Replaceable. Nothing above this line depends on
// it, and nothing here knows or cares what composed the score.

export class Player {
  /**
   * opts.transpose  semitones added to every crate slot before it is registered.
   *                 Needed when a crate was authored under a pitch-naming
   *                 convention other than the one this format mandates.
   * opts.skip       slot names to ignore. v0.1 crates cannot mark a slot unusable,
   *                 so a bad sample has to be named from outside.
   *
   * Both are facts about a particular crate, never about the format. They live in
   * crates/<name>.md, not in the spec.
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.transpose = opts.transpose ?? 0;
    this.skip = new Set(opts.skip || []);
    this.buffers = new Map();          // midi note -> AudioBuffer
    this.out = ctx.createGain();
    this.out.gain.value = opts.gain ?? 0.8;
    this.out.connect(ctx.destination);
    this.voices = [];
  }

  /** Decode a parsed crate. Slots that are not note names are kept by name. */
  async load(crate) {
    this.buffers.clear();
    for (const s of crate.samples) {
      if (this.skip.has(s.slot)) continue;
      let buf;
      try {
        // decodeAudioData detaches its input, so hand it a copy
        buf = await this.ctx.decodeAudioData(s.bytes.slice().buffer);
      } catch (e) {
        continue;                       // a sample that will not decode is skipped, not fatal
      }
      const midi = noteToMidi(s.slot);
      this.buffers.set(midi === null ? s.slot : midi + this.transpose, buf);
    }
    return this.buffers.size;
  }

  /** Nearest loaded sample, pitch-shifted by playbackRate. */
  _pick(midi) {
    if (this.buffers.has(midi)) return { buf: this.buffers.get(midi), rate: 1 };
    let best = null, dist = Infinity;
    for (const k of this.buffers.keys()) {
      if (typeof k !== "number") continue;
      const d = Math.abs(k - midi);
      if (d < dist) { dist = d; best = k; }
    }
    if (best === null) return null;
    return { buf: this.buffers.get(best), rate: Math.pow(2, (midi - best) / 12) };
  }

  noteOn(midi, velocity, when, seconds) {
    const pick = this._pick(midi);
    if (!pick) return;
    const src = this.ctx.createBufferSource();
    src.buffer = pick.buf;
    src.playbackRate.value = pick.rate;
    const g = this.ctx.createGain();
    g.gain.value = velocity / 127;                       // spec default mapping
    // release rather than a hard stop, or every note clicks
    const end = when + seconds;
    g.gain.setValueAtTime(g.gain.value, end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.35);
    src.connect(g); g.connect(this.out);
    src.start(when);
    src.stop(end + 0.4);
    this.voices.push(src);
  }

  /** Schedule a whole score. Returns its duration in seconds. */
  play(score, at = this.ctx.currentTime + 0.05) {
    const secPerTick = 60 / score.bpm / score.ppq;
    for (const n of score.notes) {
      this.noteOn(n.note, n.velocity, at + n.start * secPerTick, n.duration * secPerTick);
    }
    return score.length * secPerTick;
  }

  stop() {
    for (const v of this.voices) { try { v.stop(); } catch (e) {} }
    this.voices = [];
  }
}

// ─── CONVENIENCE, NON-NORMATIVE ────────────────────────────────────────────
// A piece that runs on chain inlines its crate and never calls this.

export const FILESTORE = "0xFe1411d6864592549AdE050215482e4385dFa0FB";

/** Read a crate out of EthFS by filename. Needs a JSON-RPC endpoint. */
export async function fetchCrate(filename, rpcUrl, fileStore = FILESTORE) {
  // readFile(string) -> string, ABI-encoded by hand so this stays dependency-free
  const selector = "0x60f9bb11";                        // readFile(string), verified
  const enc = new TextEncoder().encode(filename);
  const pad = (n) => n.toString(16).padStart(64, "0");
  let data = selector + pad(32) + pad(enc.length);
  let hex = "";
  for (const b of enc) hex += b.toString(16).padStart(2, "0");
  data += hex.padEnd(Math.ceil(enc.length / 32) * 64, "0");

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call",
                           params: [{ to: fileStore, data }, "latest"] }),
  });
  const { result, error } = await res.json();
  if (error) throw new Error("eth_call failed: " + error.message);

  // decode: offset, length, then the base64 text EthFS stores
  const body = result.slice(2);
  const len = parseInt(body.slice(64, 128), 16);
  let out = "";
  for (let i = 0; i < len; i++) out += String.fromCharCode(parseInt(body.slice(128 + i * 2, 130 + i * 2), 16));
  const bin = atob(out);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return parseCrate(bytes);
}
