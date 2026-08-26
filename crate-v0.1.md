# Crate — 0x Audio storage format, v0.1

> **Scope.** This is an agreement about a file shape. It names no engine, no
> composer and no version of either. What writes a score, and what a score
> sounds like, are plug-ins that talk through this format and are deliberately
> outside it. Composers are out of scope by design.

A **crate** is a box of sounds: audio samples plus a manifest describing them, in one
file. Passive data. Nothing in a crate runs.

This spec **documents what is already on Ethereum mainnet** rather than inventing a
format. Every claim below was read off chain on 2026-08-04 and is reproducible with the
commands given.

## The reference crate

| | |
|---|---|
| filename | `audiomaps-piano-v1.bin` |
| store | EthFS FileStore `0xFe1411d6864592549AdE050215482e4385dFa0FB` |
| stored size | 593,224 base64 characters |
| decoded size | 444,916 bytes |
| contents | 19 Opus-in-Ogg samples, VCSL Kawai piano |

Reproduce:

```
cast call 0xFe1411d6864592549AdE050215482e4385dFa0FB \
  "readFile(string)(string)" "audiomaps-piano-v1.bin" --rpc-url <mainnet rpc>
```

The FileStore is deployed at the **same address on every chain** EthFS supports, so this
address is not mainnet-specific.

## Container layout

```
[4-byte big-endian uint32]   manifest length in bytes
[manifest JSON, UTF-8]       length as above
[audio bytes]                all samples concatenated, no separators
```

That is the whole container. No magic number, no version field, no trailer.

## Manifest

The manifest is a **bare JSON array**. Each entry is a three-element array:

```json
[["A2", 0, 25402], ["A4", 25402, 22260], ["B3", 47662, 27032], ...]
```

| position | type | meaning |
|---|---|---|
| 0 | string | slot name |
| 1 | integer | byte offset into the audio section |
| 2 | integer | byte length |

Offsets are relative to the start of the audio section, not the file. They tile
contiguously: entry *n*'s offset equals entry *n−1*'s offset plus its length, with no
gaps and no overlap. The sum of all lengths equals the audio section exactly
(444,541 bytes for the reference crate).

### What the manifest does NOT contain

There is **no header object**. No `name`, no `author`, no `licence`, no `version`, no
`format`, no `mapping`, no `samples` key. An earlier draft of this spec proposed all six
and none of them exist on chain.

This is a real limitation, not an omission in the writing:

- **Licence is not machine-readable.** The crate is CC0 by intent, but nothing in the
  file says so.
- **The codec is not declared.** It is Opus in an Ogg container — verified by reading
  the first bytes of each sample, which begin `OggS` and contain `OpusHead` — but a
  reader has to sniff for that rather than being told.
- **The crate cannot say whether it is pitched or a kit.** See below.

v0.2 should add a header. It cannot be retrofitted to this file, which is permanent, so
**v0.1 readers must treat a bare array as valid** and any future header as an
alternative top-level shape (object instead of array). Sniff the type, do not assume.

## Reading a crate

```js
function parseCrate(bytes) {                     // NORMATIVE
  const dv  = new DataView(bytes.buffer, bytes.byteOffset);
  const len = dv.getUint32(0);                   // big-endian
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len)));
  const audio    = 4 + len;
  return manifest.map(([slot, offset, length]) => ({
    slot,
    bytes: bytes.subarray(audio + offset, audio + offset + length),
  }));
}
```

`parseCrate` is the spec: pure, synchronous, no network, no environment. It must work
from `file://` offline.

Fetching from EthFS is a **convenience helper and is explicitly non-normative**.
On-chain pieces inline their crate and never make a network call.

### The container is NOT gzipped

Read the bytes straight after base64 decoding. Do not gunzip.

Other EthFS files do use gzip — the naming convention `.gz` marks them — and an earlier
draft of this read sequence had a gunzip step at position 3. Applied to this crate it
fails. Decide by the filename, or by sniffing for the `1f 8b` gzip magic, never by
assumption.

## Pitch naming — the one rule the format must fix

A slot name only means something if both sides agree which octave number belongs to
middle C. Two conventions are in wide use and they differ by exactly one octave:

| convention | middle C | used by |
|---|---|---|
| Scientific pitch notation | **C4** = MIDI 60 | MIDI, Tone.js, most code |
| Yamaha / Roland style | **C3** = MIDI 60 | many samplers, hardware, sample libraries |

**0x Audio mandates scientific pitch notation. C4 is MIDI 60.**

A crate authored under the other convention reads one octave low, and a player that
trusts the labels renders the whole instrument flat. This is not corruption and not a
bug in anyone's file — it is two valid traditions colliding, which is exactly the kind
of thing a standard exists to settle.

Since v0.1 has no header, a crate cannot declare which convention it used. Until v0.2
adds that field, a mismatch has to be carried out of band as a per-crate offset. See
`crates/` for the ones we know about.

## Slots a player should not use

A crate may contain a sample that is present, decodes, and is still not fit to play —
truncated, badly gained, wrong take. v0.1 has **no field to mark one**, so a player has
no way to learn this from the file.

Consequence: a conformance checker reading a crate straight will report a sample count
that differs from what a player actually loads. That is expected in v0.1.

**v0.2 must add a per-slot usable flag.** Which specific slots are bad in which specific
crate is a fact about that crate, not about the format, and does not belong in this
document.

## Pitched crates and kit crates

Unresolved, and v0.1 cannot express it.

A **pitched** crate maps slot names to pitches and a player interpolates between them.
A **kit** crate maps slots to unrelated one-shots where the name is a label, not a
pitch, and interpolation is meaningless.

The reference crate is pitched. Without a `mapping` field a reader cannot tell, and
must be told out of band. This is the single strongest argument for a v0.2 header.

## Filenames

EthFS is a flat, case-sensitive dictionary. A missing key does not warn — it reverts, or
loads blank, **after** deploy.

- Always probe with `fileExists(string)` before assuming a name exists.
- Convention going forward: lowercase, versioned, predictable.
- Existing files keep their names. They are permanent.

## Open

1. v0.2 header: licence, codec, mapping, pitch-naming convention, and a per-slot
   usable flag.
2. Whether kit slots use the General MIDI drum map or arbitrary named slots.
