# Fret & Field

[Open the live practice room](https://beat-buddy-ai.onrender.com/) · Hosted on Render's free plan; the first visit after inactivity may take about a minute to load. AI coaching requires the shared access code.

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
The cursor uses a shared elapsed-time mapping for recording and replay. It moves
linearly between rendered measure boundaries instead of following note-dependent
animations on either staff. Measure widths use equal layout weights; alphaTab
retains fixed space for clefs and signatures. Pauses and seeks follow media time.

Use **Download MusicXML** below the score to open the same notation in another
notation editor. MIDI is not used as an intermediate format; MusicXML carries the
clef, written durations, rests and ties directly. alphaTab does not transcribe audio,
infer better rhythms, or calibrate hardware latency. The clean transcription track,
optional embedded metronome experiment, and headphone routing remain available.

Checks: `node tests/score-layout.cjs` round-trips XML through the actual alphaTab
importer across 120 tempo/meter combinations; `node tests/score-playback.cjs`
checks the media bridge, rate changes, seek feedback, and rerenders. Existing
`audio-clock.cjs`, `audio-routing.cjs`, `playback-clock.cjs` and Python tests still apply.

## Reference scale practice

Choose one of the seven **Practice piece** scales (C, D, E, F, G, A, B major),
select the written octave or one/two octaves below, and set a practice tempo.
The meter comes from the piece. All supplied files contain eight quarter notes in
a single nominal 4/4 measure; the catalog preserves their pitches and durations,
and the MusicXML exporter normalizes them into two complete measures. Originals
are preserved in `static/references/`; `catalog.json` contains their parsed events
and key signatures. The built-in catalog remains fixed; external MusicXML can be added with the upload button for the current session.

Record gives four count-in beats, then drives the reference cursor from the
capture AudioContext clock. The recorder worklet captures exactly the piece's
sample duration and stops automatically at its final barline. The optional
embedded click is limited to the piece too. Cancelling the count-in and stopping
early remain supported. Free recording still has its original 60-second limit.

After analysis, alphaTab renders a single system with **Reference** above **You
played**, sharing barlines and musical time. Missing input appears as rests. The
MusicXML download includes both parts (feedback colors are app annotations).
**Try a demo melody** uses the selected scale when one is selected.

Attack timing allowance is 20–300 ms, default ±100 ms, saved with each take.
`practice.js` aligns the ordered expected and detected events with insertion and
deletion handling, then compares absolute MIDI pitch (including octave) and raw
attack times, before notation quantization. Green means pitch and attack match,
red means wrong/missed, amber means an early/late attack, and purple means extra.
A written report identifies each issue and timing offset. Sounding duration,
articulation and fingering are not graded. Hardware/input-detection latency is
not automatically compensated; a shared timing shift can reflect latency.

Tests: `node tests/practice.cjs` covers the catalog and comparison; the existing
score/media tests include stacked tracks and live capture clocks, and audio routing
tests verify the reference capture duration and count-in/click limits.


## AI coaching setup

Copy `.env.example` to `.env` and set **OPENAI_API_KEY** and **OPENAI_MODEL** to
credentials and a model available in your API account. Restart with
`uv run python app.py`. The server loads `.env` through python-dotenv; existing
process environment variables take precedence. `.env` is git-ignored. Do not
put credentials in templates or JavaScript.

After a reference take (including a practice demo), click **Get AI coaching**.
Nothing is sent to the provider until this button is pressed. The request contains
the generated reference and recorded MusicXML, raw detected pitches/attack times,
the comparison report, meter, and tolerance settings. It contains no audio. Advice
appears as plain text and is discarded when the take or score changes. Requests
have a 60-second provider timeout and no automatic retries; failed requests can be
retried explicitly. Aborting the browser request prevents stale advice from being
shown but may not cancel an already running provider request or its charge.

**Edit `prompts/coaching_system.txt` to change the coaching style.** It is read on
each request, so prompt edits do not require a server restart. It asks for strengths,
evidence-based problem areas, a short practice plan, and an appropriate next
challenge; external-piece suggestions are labeled as requiring uploads. It treats
XML metadata as data, distinguishes raw timing from quantized notation, and avoids
claims about unobserved fingering or long-term progress.

`coaching.py` contains the provider adapter, separate from the route and prompt.
OpenAI uses the [Responses API](https://developers.openai.com/api/reference/python/resources/responses/methods/create)
with `store=False`. Change **OPENAI_MODEL** to switch models. For another compatible
provider, set **OPENAI_BASE_URL**, replace the API key/model, and optionally set
**COACH_API_MODE=chat_completions** for a Chat Completions endpoint. Providers with
other protocols need a new adapter implementing `generate(payload)`. Credentials
and endpoint changes require a server restart. Provider access, pricing and feature
compatibility depend on the chosen account/model.

Public deployments require a shared coaching access code (see below). This gates
provider requests but is not a per-user quota: anyone with the code can request
coaching. Rotate it in server settings if needed. The code is held in the password
field for the current page only; it is not saved to browser storage.

## Deploy from GitHub to Render

The Flask backend needs a Python web service; GitHub Pages cannot run it.
The included `render.yaml` creates one **free** Render web service, installs locked
dependencies using `uv sync --locked --no-dev`, and runs Gunicorn with a health
check at `/healthz`. No database or persistent disk is required.

1. Push the code to `scole02/beat-buddy-ai` on GitHub.
2. Sign in to Render, choose **New → Blueprint**, and connect that repository.
3. Set **COACH_ACCESS_CODE** to a long random code to share with your students,
   **OPENAI_API_KEY** to your provider key, and **OPENAI_MODEL** to your chosen model.
   Enter these as secret environment variables in Render, never in GitHub.
4. Deploy and open the service's HTTPS URL. Use HTTPS for microphone access.
   Add this URL to the GitHub repository's About/Website field or your profile.

`APP_PUBLIC=true` makes coaching fail closed if the access code is missing, even
when an API key is configured. Recording, uploads and comparisons remain public.
Without provider credentials the app still works, but coaching returns a setup
error. For other providers, use the configuration options described above.

Render's free service sleeps after 15 idle minutes and can take about a minute to
wake. It has limited CPU/memory, so transcription may take longer than locally.
Uploads and recordings are processed in memory and are not retained by the server.
See [Render's free plan limits](https://render.com/docs/free).

To run the production server locally: `uv run gunicorn app:app` (port 8000, or
set `PORT`). `uv run python app.py` still starts the local development server.

## Uploading reference pieces

Use **Upload MusicXML** next to the reference selector. Supports uncompressed
`.musicxml`/`.xml` under 1 MB, one melody part/staff/voice, a fixed meter/key,
sixteenth-grid note values, rests and ties. Written tempo markings are overridden
by the selected practice tempo. The piece must fit within 60 seconds at that tempo;
choose a shorter excerpt or a faster tempo if needed.

Multiple parts/voices, chords, tuplets, pickups, repeats, microtones and transposing
parts are rejected with an explanation instead of being silently flattened. Export
a single melody in concert pitch, expand repeats, and pad pickups with leading
rests before importing. Compressed `.mxl` is not supported yet. Uploads are parsed
in memory using defusedxml and are available only in the current page session;
re-upload after refreshing. They are not added permanently to the built-in catalog.

Tests: `uv run python -m unittest discover -s tests` includes mocked provider calls,
configuration/error handling and upload validation. `node tests/coaching-ui.cjs`
checks on-demand requests, plain-text output, duplicate clicks and stale responses.
No live provider calls are made by the tests.
