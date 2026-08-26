# 0x Audio

An open file format for audio that lives on Ethereum.

There are sounds on chain already. There is no agreed way to read them, so anyone
who wants to use anyone else's samples has to ask the person who put them there.
That is the problem this fixes.

## The split

**Agreements** are passive data. Nothing in them runs.

| | file | what it is |
|---|---|---|
| **Crate** | `.crate` | A box of sounds. Samples plus a manifest describing them. |
| **Score** | `.score` | A list of note events. No audio, and it names no samples. |

**Tools** are code, and code is replaceable.

| | what it is |
|---|---|
| **Player** | Reads both and makes sound. No dependencies, no build step. It decides nothing. |
| **Inspector** | A face on the player. Doubles as the conformance checker. |

Swap the crate under the same score and you get a different piece. The crate is
the piano, the score is the sheet music, the composer is the pianist.

**Composers are deliberately outside the standard.** Standardise one and you weld
the format to a single aesthetic, and to its author.

## Reference crate

A grand piano, on chain, CC0, free for anyone to load.

| | |
|---|---|
| file | `audiomaps-piano-v1.bin` |
| store | EthFS FileStore `0xFe1411d6864592549AdE050215482e4385dFa0FB` |
| stored | 593,224 base64 characters |
| decoded | 444,916 bytes |
| contents | 19 Opus-in-Ogg samples, VCSL Kawai piano |

```
cast call 0xFe1411d6864592549AdE050215482e4385dFa0FB \
  "readFile(string)(string)" "audiomaps-piano-v1.bin" --rpc-url <mainnet rpc>
```

## Specs

- [`crate-v0.1.md`](crate-v0.1.md) — storage format
- [`score-v0.1.md`](score-v0.1.md) — note format
- [`conformance-v0.1.md`](conformance-v0.1.md) — what "adheres" means, per role
- [`player.js`](player.js) — reads both, makes sound
- [`inspector.html`](inspector.html) — conformance checker
- [`validate.js`](validate.js) — runnable checker

The standard exists. Tools are coming.

## Licence

CC0. No rights reserved. No attribution required, no permission to ask.
