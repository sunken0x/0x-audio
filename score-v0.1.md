# Score — 0x Audio note format, v0.1

> **Scope.** This is an agreement about a file shape. It names no engine, no
> composer and no version of either. What writes a score, and what a score
> sounds like, are plug-ins that talk through this format and are deliberately
> outside it. Composers are out of scope by design.

A **score** is a list of note events plus a small header. It contains no audio and names
no samples. Swap the crate under the same score and you get a different piece — that
split is the whole point of the format.

Passive data. Nothing in a score runs.

## Shape

```json
{
  "0xaudio": "score/0.1",
  "bpm": 116,
  "ppq": 480,
  "length": 15360,
  "notes": [
    [0, 52, 1920, 102],
    [0, 71, 480, 96],
    [480, 67, 480, 90]
  ]
}
```

### Header

| field | type | required | meaning |
|---|---|---|---|
| `0xaudio` | string | yes | format tag, `"score/0.1"`. A reader must reject anything else. |
| `bpm` | number | yes | beats per minute |
| `ppq` | integer | yes | ticks per quarter note |
| `length` | integer | yes | total length in ticks; the loop point |
| `name` | string | no | display only, never semantic |

### A note

Four integers, positional, in this order:

```
[start, note, duration, velocity]
```

| position | range | meaning |
|---|---|---|
| `start` | ≥ 0 | ticks from the beginning |
| `note` | 0–127 | MIDI note number, 60 = middle C |
| `duration` | > 0 | ticks |
| `velocity` | 0–127 | 0 is silent, 127 loudest |

Notes are an array of arrays, not objects. A piece with a few hundred events is a few
kilobytes rather than tens, which matters when it goes on chain.

## The three decisions, and why

These were the open questions on the format. Settled here.

**Time is in integer ticks, not seconds and not floating-point beats.** Seconds weld the
score to one tempo. Floats accumulate drift, and two events written to land together
eventually do not — the bug appears minutes in and is miserable to trace. Integers at a
declared resolution are exact forever. This is what MIDI has done since 1983 and the
reason its files still open.

`ppq` default is **480**, which divides cleanly by 2, 3, 4, 5, 6 and 8, so triplets and
quintuplets are exact rather than rounded.

**Note is a MIDI note number, not a name like `"C4"`.** Names are the crate's business.
A number means the score does not care whether it is driving a piano or a drum kit — the
crate decides what 36 sounds like. Names would leak instrument detail into the score and
break the swap.

**Velocity is 0–127, not 0.0–1.0.** One integer convention throughout, no mixed units,
no float comparison. Players map to gain themselves; a reasonable default is
`velocity / 127`, and the reference player uses that.

## Converting to seconds

```
seconds = ticks / ppq * 60 / bpm
```

A player should schedule from this and never from wall-clock time.

## Looping

A score loops at `length`, not at the end of the last note. A note may sustain past
`length`; that is a deliberate overhang and a player should let it ring rather than cut
it.

`length` must be ≥ the largest `start` in the score. It need not be a whole number of
bars.

## What a score must not contain

- **Sample filenames or crate names.** The moment a score names a sample it is welded to
  one instrument and the format has failed at its only job.
- **Audio of any kind.**
- **Effects.** Deferred to v0.2 as a separate declared chain, so the same notes can be
  dressed differently.
- **Track or channel structure.** Multi-part arrangement is a v2 problem and is probably
  "several scores plus a manifest" rather than anything new here.

## Validity

A score is valid when:

1. `0xaudio` equals `"score/0.1"`
2. `bpm` > 0, `ppq` > 0, `length` ≥ 0
3. every note has exactly four integers
4. `0 ≤ note ≤ 127` and `0 ≤ velocity ≤ 127`
5. `start ≥ 0` and `duration > 0`
6. `length ≥ max(start)`

Notes need not be sorted. A player sorts on load.
