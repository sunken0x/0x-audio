# Conformance — 0x Audio v0.1

What it means to say a thing "adheres to 0x Audio", and how to prove it.

This document exists so a composer can be released with a claim that is **testable
rather than asserted**. If `validate.js` passes, the claim holds. If it does not, it
does not.

## Four roles

The standard defines two file shapes and recognises four roles. Only the first two are
constrained by the format; the other two are constrained only by what they read and
write.

| role | is | conforms when |
|---|---|---|
| **crate** | a file | it parses and every sample decodes |
| **score** | a file | it satisfies the validity rules |
| **composer** | code | every score it emits is a conforming score |
| **player** | code | it renders any conforming score against any conforming crate |

## The composer rule, stated plainly

**A composer conforms if and only if the scores it emits validate. Nothing else about
it is the standard's business.**

It may be generative, hand-written, seeded from a wallet, seeded from a coin toss. It
may be rewritten from scratch tomorrow. It may exist in several variants at once. The
standard has no opinion, records no version of it, and must never be changed to
accommodate one.

This is deliberate. Putting a composer inside a format standardises one aesthetic and
welds the format to its author. Engines are plug-ins that talk through the format. They
sit outside it, permanently.

The practical consequence for release: to claim a composer adheres, run its output
through the validator across a representative spread of its inputs and keep the result.
That is the whole gate.

## Crate conformance

A crate MUST:

1. begin with a 4-byte big-endian unsigned integer giving the manifest length
2. carry a manifest that is valid UTF-8 JSON of exactly that length
3. use a bare JSON array as the manifest, each entry `[slot, offset, length]`
4. keep every `offset + length` within the file
5. contain decodable audio at every declared slot

A crate SHOULD:

6. tile its offsets contiguously, no gaps and no overlap
7. name pitched slots in scientific pitch notation, middle C = C4
8. contain no slot that a player must be told to avoid

6 is a SHOULD, not a MUST, because a gap wastes bytes but breaks nothing. 7 and 8 are
SHOULDs only because v0.1 has no header in which to declare an exception; both become
MUSTs once v0.2 adds one.

A crate MUST NOT be assumed gzipped. Sniff for the `1f 8b` magic or go by filename.

## Score conformance

A score MUST:

1. carry `"0xaudio": "score/0.1"`
2. have `bpm > 0` and `ppq > 0`
3. give every note as exactly four integers, `[start, note, duration, velocity]`
4. keep `0 ≤ note ≤ 127` and `0 ≤ velocity ≤ 127`
5. keep `start ≥ 0` and `duration > 0`
6. have `length ≥ max(start)`

A score MUST NOT contain sample filenames, crate names, audio, or effects.

A score MAY arrive unsorted. A player sorts it.

## Player conformance

A player MUST:

1. accept any conforming crate and any conforming score
2. convert time as `seconds = ticks / ppq × 60 / bpm`, and schedule from that rather
   than from wall-clock time
3. run offline from `file://` with no network access

A player SHOULD:

4. map velocity to gain as `velocity / 127` unless it has a reason not to
5. pick the nearest available slot and pitch-shift when a score asks for a note the
   crate does not contain
6. let a note ring past `length` rather than cutting it at the loop point

A player MUST NOT require anything of a score beyond the rules above — in particular it
must not require sorted notes, a `name`, or any knowledge of what composed it.

## Proving it

```bash
node validate.js <file.bin|file.json>
```

The validator reads either shape, decides which it is, and prints numbered results
against the rules above. Exit code 0 means conforming, 1 means not.

`validate.js` checks structure. It cannot check whether audio decodes, because decoding
needs an audio context — the inspector does that half in a browser and reports it
alongside. A crate that passes the validator and decodes in the inspector has met every
rule in this document.

## What conformance does not mean

- Not that a crate sounds good.
- Not that a score is musical.
- Not that a player is efficient.
- Not that anything has been audited or is fit for any purpose.

It means the files are the shape the format says, so any conforming player can read any
conforming crate and score without prior arrangement. That is the only promise, and it
is the whole point.
