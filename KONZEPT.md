# Lissajous – Töne als Figuren (Arbeitstitel)

Stand: 28.09.2026 – v1 gebaut (2D, Form + Zeichnen). Start: `npm run dev` → localhost:5190 bzw. Netzwerk-URL fürs Handy.

## Idee
Jeder Ton ist eine Schwingung auf einer Achse. Ton A schwingt auf X, Ton B auf Y
(später Ton C auf Z). Der Punkt, an dem sich beide treffen, zeichnet eine Kurve –
eine Lissajous-Figur. Einfache Verhältnisse (1:2, 2:3) schließen sich schnell zu
ruhigen Formen, dissonante (8:15, 32:45) brauchen lange und werden komplex.
Man sieht Konsonanz.

## Zwei Modi
### Form (schnell)
- Die ganze Figur steht auf einmal da, man hört die Töne als Dauerklang (Sinus).
- Die Figur „lebt": leichtes organisches Wabbeln/Flimmern der Linie und des Glows
  (Rauschen entlang der Kurve, langsam, subtil – wie Moleküldarstellungen).
- Wechsel des Verhältnisses = **Umsnappen**: jeder Kurvenpunkt federt mit
  unterdämpfter Feder (Überschwingen, Nachwippen) in die neue Form – kein Cut,
  keine Überblendung.
- Unten Preset-Buttons: Oktave 1:2, Quinte 2:3, Quarte 3:4, gr. Terz 4:5,
  kl. Terz 5:6, Tritonus 32:45 …

### Zeichnen (langsam)
- Der Punkt fährt die Kurve sichtbar ab; der Punkt selbst leuchtet am hellsten.
- Spur umschaltbar: **bleibt** (Punkt läuft die Form immer wieder ab) oder
  **Schweif** (Spur verblasst nach ~1–2 s, einstellbar).
- Ton als **Anschlag** (Marimba-/Holz-Klang, kurz aber hörbar, in der Tonhöhe
  des jeweiligen Tons), immer wenn die Schwingung einer Achse die Mitte kreuzt.
  Auf jeder Achse eine Mittelmarkierung, die beim Anschlag aufleuchtet.
  → 2:3 wird hörbar als Rhythmus 2 gegen 3.
- Bewegung ist Sinus: an den Wendepunkten langsamer, in der Mitte am schnellsten.

## Darstellung
- Achsen als freistehendes „L" links und unten, mit Abstand zur Figur (Padding),
  Achsen berühren sich nicht.
- Auf den Achsen laufen die beiden Einzelschwingungen als kleine Punkte mit.
- Dunkler Hintergrund, Glow (Bloom), Farbverlauf entlang der Spur.
- Zen-Modus: alles ausblenden, Vollbild, nur die Figur.

## Bedienung
- Grundton per Slider (halten = hören, schieben = Tonhöhe)
- Zweiter Ton per Verhältnis a:b (links = Grundton), eintippbar, wird gekürzt
- Phase, Tempo (Zeitlupe), Wiederkehrzeit als Zahl

## Später
- Drift (leichte Verstimmung → Figur dreht sich), rein vs. gleichstufig
- 3D mit drei Tönen (Dur 4:5:6, Moll 10:12:15), frei drehbar

## Tech
Vite + TypeScript + Three.js (2D und 3D im selben Renderer, Bloom),
Web Audio API (Sinus + synthetischer Marimba-Anschlag). Statisch → Vercel.
