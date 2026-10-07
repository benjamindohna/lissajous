# Lissajous

**See why some intervals sound consonant: two tones, drawn as one figure.**

**Live:** [lissajous-liard.vercel.app](https://lissajous-liard.vercel.app)

<!-- TODO: GIF Oktave → Quinte → Tritonus -->

Tone A drives the x-axis and tone B drives the y-axis, and their combined motion traces a Lissajous curve. Simple frequency ratios close into calm shapes almost immediately, like the octave (1:2) or the fifth (2:3). Dissonant ones such as the tritone (32:45) take much longer to repeat and look tangled. So you can watch consonance as well as hear it.

## Modes

- **Form** shows the whole figure, breathing slightly. When you change the interval it springs into the new shape.
- **Draw** sends a single point along the curve. A marimba hit sounds every time it crosses an axis, so the ratio turns into a rhythm.
- **Zen mode** (press `H`) hides everything except the figure.

You set the base tone with a slider (hold to hear it, drag to change the pitch) and the second tone as a ratio `a:b`. The ratio gets reduced automatically, and a tempo slider runs from slow motion up to the point where the beats merge into a sustained tone. There are five colour themes with bloom.

## Stack

Vite · TypeScript · Three.js (rendering + bloom) · Web Audio API (sine oscillators and a synthesized marimba, no samples)

```sh
npm install
npm run dev
```
