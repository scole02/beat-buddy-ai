# Fret & Field

A Flask guitar practice app. Record a melody with your laptop microphone, stop,
and see the detected pitches and estimated note lengths on a bass- or treble-clef staff. Includes a live input meter,
recording playback, a demo melody processed by the same backend, and note timing
and frequency details. Recordings are processed in memory and are not saved.

## Run with uv

Requires [uv](https://docs.astral.sh/uv/getting-started/installation/) and Python 3.11+.

```sh
uv sync
uv run python app.py
```

In this workspace, uv was bootstrapped at `.venv-app/bin/uv`. If `uv` is not on
your shell's PATH, use `.venv-app/bin/uv` in place of `uv` in these commands.

Open **http://localhost:5000**. Choose **Start recording**, allow microphone access,
play individual guitar notes, then choose **Stop & see notes**. Try **Demo melody**
to exercise recording playback and backend transcription without microphone access.

Microphone recording needs localhost or HTTPS. An HTTP LAN address will not work;
see [MDN secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).
For best results, use a current Chrome, Edge, Firefox, or Safari browser in a normal
tab. Embedded browser microphone permissions may differ. A take stops at 60 seconds.

## What this first version detects

- One note at a time, in the sounding range E1–E6; reference tuning A4 = 440 Hz.
- NumPy-based YIN periodicity estimation with energy gating and note segmentation.
- All analysis runs in Flask. AudioWorklet captures mono PCM in the browser and
  sends a 16-bit WAV after recording stops. There is no transcription service.
- Bass-clef notation and note labels show actual sounding pitch (e.g. E2).
- Takes recorded in the app carry their selected BPM. Note lengths are estimated
  from detected durations at that tempo, rounded to the nearest sixteenth note.
  The staff uses filled/hollow heads, stems, flags, dots, and ties. The demo uses the selected tempo and demonstrates several note values.
  API uploads without a tempo remain pitch sketches with open, stemless heads.
  Staff positions follow estimated onsets on a sixteenth-note grid; measured timings are preserved for playback.

Chords, strumming, automatic tempo detection, explicit rest engraving, song
matching, and saved sessions are not implemented. Duration estimates may differ
from intended rhythm for muted notes, ringing strings, and uneven playing. Distortion, background music, overlapping notes, very fast
playing, and weak fundamentals can reduce accuracy. Repeated pitches need a small
gap to be separated reliably. Detection confidence is a periodicity measure, not a
calibrated probability. Real microphone performance should be checked with your guitar.

The interface uses Google Fonts when available, with local serif/sans-serif fallbacks.

## Test

```sh
uv run python -m unittest discover -s tests -v
```

Tests cover guitar-range harmonic tones across sample rates, silence, noise,
melody order, repeated notes with gaps, approximate timing, and API validation.

`app.py` binds to loopback with debug disabled. It uses Flask's local development
server; a public deployment needs a production WSGI server and HTTPS.

## Scarlett Solo 4th Gen USB input

1. Connect the Solo to your computer with a USB data cable and confirm that your
   operating system exposes it as an audio input.
2. Connect the guitar to the front 6.35 mm **Input 1** and enable **INST**.
3. Click **Find inputs**, grant browser audio permission, and select the Scarlett
   in **Audio input**. Choose **Input 1 / mono · Solo guitar**.
4. Set hardware gain while playing firmly, avoiding clipping, then start recording.
   For a microphone attached to the Solo's XLR socket, select **Input 2** when using
   a stereo interface source. If your OS lists **Input 2 Mic** as its own device,
   choose that device and **Input 1 / mono**: the OS has already isolated the input.

The browser requests unprocessed audio and a 48 kHz sample rate. Web Audio records
at 48 kHz, and the uploaded mono WAV remains 16-bit PCM; this is not native 24-bit
or ASIO capture. The interface's hardware gain and INST switch are controlled on
hardware/Focusrite software, not from the web app. No WebUSB access is needed.

Channels are separated before recording and metering. Input 2 requires the browser
and operating system to expose two channels; a mono-only source is rejected for
that selection. If your OS or Focusrite's Combine Inputs setting mixes channels
before they reach the browser, the app cannot separate them afterward. Disable
Combine Inputs to isolate guitar from microphone. Select the hardware recording
source rather than a loopback/monitor source. A disconnected explicitly selected
device produces an error instead of silently recording the default microphone.

Browser exposure depends on OS audio configuration and installed drivers. On Windows,
Focusrite Control 2 includes the driver. Consult the official
[downloads](https://downloads.focusrite.com/focusrite/scarlett-4th-gen/scarlett-solo-4th-gen)
and [Solo channel compatibility guide](https://support.focusrite.com/hc/en-gb/articles/14653126009490-Scarlett-Solo-4th-Gen-one-or-two-input-app-compatibility).

Audio routing checks (requires Node.js): `node tests/audio-routing.cjs`. These cover
separate guitar/mic channels, mono fallback, missing channels, and disconnected devices.

Playback shows a vertical cursor synchronized to the audio, including seeking and
pause. Scores wrap after three measures; the playback cursor follows rows vertically.

Use the Bass clef / Treble clef toggle above the score to redraw the current take.
Both clefs display sounding pitch (no octave transposition), and playback continues
at the same position when switching. Bass clef is the default.

## Metronome and count-in

- Choose 40–240 BPM and use **Play metronome** to audition the tempo without
  opening an audio input or recording anything. Stop the preview to change tempo.
- Select a **Headphone output**, or select headphones/Scarlett as your system
  output. Output selection is available when the browser supports AudioContext
  `setSinkId`; **Find inputs** grants device access and refreshes output names too.
- **Start recording** stops the preview and starts a fresh, audible four-beat
  count-in at the selected BPM. Begin playing on the next beat. Cancel is available
  during the count-in. Only audio after the four count-in beats enters the take.
- **Keep metronome playing during recording** is on by default. Turning it off
  leaves the count-in active but silences subsequent clicks. The independent
  preview button works regardless of this checkbox. The volume slider works
  during preview, count-in, and recording; zero volume also silences the count-in.
- Use **Play metronome with recording** below the audio player to replay a take
  against the tempo and meter used when it was recorded. The click follows
  playback pauses, seeks, and resumes.
- Clicks run on the Web Audio render clock rather than JavaScript timers, with
  an accent every four beats. The recording start uses the same clock and capture
  stops at 60 seconds of actual recorded audio, excluding the count-in.
- The click node connects only to audio output and is never digitally mixed into
  the recording. Use headphones: a laptop mic can still pick up clicks from speakers.
  Avoid loopback inputs or OS mixes containing the output. Hardware output/input
  latency and human timing can still affect alignment; this version has no latency
  calibration. Tempo is fixed per take and remains attached to its score even if
  you change the tempo for the next take.
- Values include sixteenth, eighth, quarter, half, whole, and dotted values. Notes
  longer than a whole note are represented as tied components. Notes are split and tied at measure boundaries; rests are included in the MusicXML score.
  Timestamps and the playback cursor follow the recording.

Additional checks: `node tests/audio-clock.cjs` exercises count-in exclusion,
recording limits, cancellation, and sample-clock metronome timing.

## Time signatures and wrapped scores

Headphone output is located directly below Audio input. Choose **Beats per
measure** (1–12) and the **beat note** (half, quarter, eighth, or sixteenth).
BPM always counts that selected note: 6/8 at 120 BPM has six eighth-note clicks
per measure. The first beat is accented. The count-in remains exactly four clicks,
then the recording starts on beat one of a fresh measure, regardless of meter.

Each take stores its meter with its tempo. Scores have three measures per row,
with additional rows for longer recordings, repeated clefs/time signatures, bar
numbers, and ties across barlines and row breaks. The final measure is padded with rests without stretching the recording to fit it. Estimated onsets and lengths snap to a sixteenth-note grid for
notation; audio playback uses the original timing, and its cursor follows the rows.
Changing the meter controls configures the next take; it does not reinterpret an
existing take. Silence is represented with explicit rest glyphs.

## Timing tolerance

The 0–25% slider favors undotted sixteenth, eighth, quarter, half, and whole
lengths within the chosen percentage of their ideal duration. At 100 BPM in 4/4,
25% accepts 0.450–0.750 seconds as a quarter note. Outside this window, the existing
sixteenth-grid rounding applies. 0% disables the extra preference, not duration
quantization. Barline splits can still require dots/ties. Changing the slider
recalculates an existing take without retranscribing or altering the audio; its
original tempo and meter are retained. New recordings use the selected tolerance.
alphaTab moves and wraps the playback cursor using the recorded audio clock and score rhythm.


## alphaTab and MusicXML

The app uses **alphaTab 1.8.4** for music engraving, three-bar systems, rest and tie
rendering, score ticks, and the playback cursor. The pinned browser bundle and
Bravura fonts are served locally from `static/vendor/alphatab/`, with their MPL-2.0
and SIL OFL licenses. No npm runtime, CDN, soundfont, or new Python dependency is
required; Flask continues to run with uv.

`static/musicxml.js` converts detected notes into one MusicXML voice. Durations and
onsets use the existing sixteenth-note quantization and tolerance settings. Gaps
become rests, notes split and tie across barlines, and every measure is filled.
Quantized notes are trimmed at the next attack; if attacks collide on the same grid
position, the higher-confidence detection wins. Measured detection data stays intact.
MusicXML uses equivalent quarter-note BPM for reliable import, including 6/8 and
half-note beat units. Bass/treble clefs show sounding pitch, including C2 and D2.

`static/score-view.js` loads the XML through alphaTab and anchors each measure to
its absolute time (`measure index × beats per measure × 60 / BPM`). It uses
alphaTab's external-media mode with the existing recording player. Pauses, seeks,
buffering and playback-rate changes update the engine; there is no independent
score animation timer. A partial final measure is not stretched to fill the audio.
Music engraving uses rhythmic spacing, so cursor pixel speed may vary between
notes, while the score's musical time remains tied to the recording.

Use **Download MusicXML** below the score to open the same notation in another
notation editor. MIDI is not used as an intermediate format; MusicXML carries the
clef, written durations, rests and ties directly. alphaTab does not transcribe audio,
infer better rhythms, or calibrate hardware latency. The clean transcription track,
optional embedded metronome experiment, and headphone routing remain available.

Checks: `node tests/score-layout.cjs` round-trips XML through the actual alphaTab
importer across 120 tempo/meter combinations; `node tests/score-playback.cjs`
checks the media bridge, rate changes, seek feedback, and rerenders. Existing
`audio-clock.cjs`, `audio-routing.cjs`, `playback-clock.cjs` and Python tests still apply.
