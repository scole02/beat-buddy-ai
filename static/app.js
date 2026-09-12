const $ = (id) => document.getElementById(id);
let mode = 'idle', stream, context, source, worklet, analyser, splitter;
let chunks = [], frameId, timeoutId, startedAt, recordingRate, playbackURL;
let mixedChunks = [], captureClick = false;
let stopAcknowledged;
let toleranceRequest, toleranceTimer, toleranceRevision = 0;
let recordingMeter = {numerator: 4, denominator: 4};
let previewContext, previewClick, recordingClick, playbackContext, playbackClick, metroStarting = false;
let recordingStartTime = 0, recordingTempo = 100, recorderStopped = false;
let selectedClef = 'bass', latestScore = null;
let playbackFrame, scoreDuration = 0, scoreView;
const MAX_SECONDS = 60;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function preserveViewport(position = {left: window.scrollX, top: window.scrollY}) {
  // Score teardown/rendering can trigger browser scroll anchoring. Restore only
  // across the next two layout frames, not later while the user is navigating.
  const restore = () => window.scrollTo(position.left, position.top);
  requestAnimationFrame(() => { restore(); requestAnimationFrame(restore); });
}
function setMode(next) {
  mode = next;
  document.body.classList.toggle('is-recording', mode === 'recording');
  document.body.classList.toggle('is-counting', mode === 'countin');
  $('record-button').disabled = !['idle', 'recording', 'countin'].includes(mode) || metroStarting;
  $('demo-button').disabled = mode !== 'idle';
  ['audio-device', 'audio-channel', 'refresh-inputs'].forEach(id => $(id).disabled = mode !== 'idle');
  $('record-label').textContent = ({idle: 'Start recording', starting: 'Connecting…', countin: 'Cancel count-in', recording: 'Stop & see notes', stopping: 'Finishing…', processing: 'Finding your notes…'})[mode];
  $('state-tag').textContent = ({idle: 'READY', starting: 'CONNECTING', countin: 'COUNT-IN', recording: 'RECORDING', stopping: 'FINISHING', processing: 'PROCESSING'})[mode];
  updateMetronomeControls();
}
function setTimer(seconds) {
  const tenths = Math.floor(seconds * 10) % 10;
  $('timer').innerHTML = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}<span>.${tenths}</span>`;
}
function drawWave(data) {
  const canvas = $('waveform'), width = canvas.clientWidth, height = canvas.clientHeight;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round'; ctx.lineWidth = 3;
  const bars = Math.floor(width / 7), inset = width * .08;
  for (let i = 0; i < bars; i++) {
    let amplitude = 0;
    if (data) {
      const from = Math.floor(i * data.length / bars), to = Math.floor((i + 1) * data.length / bars);
      for (let j = from; j < to; j++) amplitude = Math.max(amplitude, Math.abs(data[j]));
    }
    const envelope = Math.sin(Math.PI * i / bars);
    const bar = data ? Math.max(2, Math.min(height * .9, amplitude * height * 3)) : 2 + Math.pow(envelope, 3) * (4 + (Math.sin(i * 1.7) + 1) * 5);
    const x = inset + i * (width - inset * 2) / bars;
    ctx.strokeStyle = data ? '#718958' : '#c6d1b8';
    ctx.beginPath(); ctx.moveTo(x, (height - bar) / 2); ctx.lineTo(x, (height + bar) / 2); ctx.stroke();
  }
}
function animate() {
  if (mode !== 'recording') return;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  drawWave(data);
  const rms = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
  const level = Math.min(12, Math.round(rms * 65));
  [...$('meter').children].forEach((bar, i) => bar.classList.toggle('on', i < level));
  $('input-state').textContent = rms > .25 ? 'Too loud' : rms > .008 ? 'Receiving' : 'Quiet';
  const seconds = Math.min(MAX_SECONDS, Math.max(0, context.currentTime - recordingStartTime));
  setTimer(seconds);
  frameId = requestAnimationFrame(animate);
}
async function cleanup() {
  clearTimeout(timeoutId); cancelAnimationFrame(frameId);
  recordingClick?.port.postMessage('stop'); recordingClick?.disconnect(); recordingClick = undefined;
  resetBeatDisplay();
  stream?.getTracks().forEach(track => track.stop());
  source?.disconnect(); splitter?.disconnect(); worklet?.disconnect(); analyser?.disconnect();
  if (context && context.state !== 'closed') await context.close().catch(() => {});
  stream = context = source = worklet = analyser = splitter = undefined;
  [...$('meter').children].forEach(bar => bar.classList.remove('on'));
  $('input-state').textContent = 'Standby'; drawWave();
}
async function stopPlaybackMetronome() {
  playbackClick?.port.postMessage('stop'); playbackClick?.disconnect(); playbackClick = undefined;
  const oldContext = playbackContext; playbackContext = undefined;
  if (oldContext && oldContext.state !== 'closed') await oldContext.close().catch(() => {});
  resetBeatDisplay();
}
async function startPlaybackMetronome() {
  const audio = $('audio-playback'), result = latestScore?.result;
  if (!$('playback-click').checked || audio.paused || audio.seeking || audio.readyState < 3 || !result?.tempo || playbackContext) return;
  let newContext;
  try {
    newContext = playbackContext = new AudioContext({sampleRate: 48000});
    await routeClickOutput(newContext);
    await newContext.resume();
    await newContext.audioWorklet.addModule('/static/metronome-worklet.js');
    if (playbackContext !== newContext) return;
    if (audio.paused || audio.seeking || audio.readyState < 3 || !$('playback-click').checked) {
      await stopPlaybackMetronome(); return;
    }
    // Anchor beats to the recording's zero point so resumed and sought playback stays in time.
    playbackClick = createClickTrack(newContext, result.tempo * audio.playbackRate,
      newContext.currentTime - audio.currentTime / audio.playbackRate, 0, result.time_signature || {numerator: 4, denominator: 4});
  } catch (error) {
    // A cancelled initialization must never stop a newer playback session.
    if (playbackContext !== newContext) return;
    await stopPlaybackMetronome();
    status(error.message || 'Could not start the playback metronome.', true);
  }
}
async function startRecording() {
  setMode('starting');
  $('audio-playback').pause();
  status('Allow microphone access in your browser to start your take.');
  try {
    recordingTempo = readTempo();
    recordingMeter = readMeter();
    await stopMetronomePreview();
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('Use a current browser on localhost or an HTTPS connection to record audio.');
    context = new AudioContext({sampleRate: 48000});
    await routeClickOutput(context);
    await context.resume();
    const selectedDevice = $('audio-device').value;
    const channel = Number($('audio-channel').value);
    stream = await navigator.mediaDevices.getUserMedia({audio: {
      ...(selectedDevice ? {deviceId: {exact: selectedDevice}} : {}),
      channelCount: channel === 1 ? {exact: 2} : {ideal: 2},
      sampleRate: {ideal: 48000},
      echoCancellation: false, noiseSuppression: false, autoGainControl: false
    }});
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();
    if (channel === 1 && settings.channelCount !== 2) throw new Error('This browser is not exposing two separate channels. Select Input 1 / mono, or configure the interface as a stereo input in your system audio settings.');
    $('mic-label').textContent = `${track.label || 'Audio input'} · Input ${channel + 1}`;
    $('device-info').textContent = `${settings.sampleRate ? settings.sampleRate / 1000 + ' kHz device input · ' : ''}48 kHz recording · Input ${channel + 1}${settings.channelCount === 1 ? ' (mono supplied by browser)' : ''}. Echo cancellation, noise suppression, and automatic gain are requested off.`;
    await context.audioWorklet.addModule('/static/recorder-worklet.js');
    await context.audioWorklet.addModule('/static/metronome-worklet.js');
    recordingRate = context.sampleRate;
    chunks = []; mixedChunks = []; recorderStopped = false;
    captureClick = $('capture-click').checked;
    const countInStart = context.currentTime + .15;
    recordingStartTime = countInStart + 4 * 60 / recordingTempo;
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser(); analyser.fftSize = 2048;
    worklet = new AudioWorkletNode(context, 'pcm-recorder', {numberOfInputs: captureClick ? 2 : 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', processorOptions: {startTime: recordingStartTime, maxDuration: MAX_SECONDS, includeClick: captureClick}});
    worklet.port.onmessage = ({data}) => {
      if (data === 'stopped') { recorderStopped = true; stopAcknowledged?.(); }
      else if (data?.type === 'started') {
        if (mode === 'countin') {
          setMode('recording'); animate();
          $('record-hint').textContent = 'Go ahead. Play on the beat.';
          status(`Recording at ${recordingTempo} BPM. The count-in is excluded from your take.`);
          $('beat-display').textContent = ($('record-click').checked || captureClick) ? 'Recording · beat 1' : 'Recording · click off';
        }
      } else if (data?.type === 'limit') { if (mode === 'recording') stopRecording(); }
      else if (data?.type === 'mix') mixedChunks.push(data.samples);
      else if (data instanceof Float32Array) chunks.push(data);
    };
    // Worklet outputs silence: the input is never fed back to the speakers.
    // Split before any mono mixing so the mic/other channel cannot bleed into guitar audio.
    splitter = context.createChannelSplitter(2);
    source.connect(splitter);
    splitter.connect(analyser, channel, 0);
    splitter.connect(worklet, channel, 0);
    worklet.connect(context.destination);
    stream.getAudioTracks()[0].onended = () => {
      if (mode === 'recording') stopRecording();
      else if (mode === 'countin') cancelCountIn('Audio input disconnected. Reconnect it and try again.');
    };
    setMode('countin'); setTimer(0);
    $('timer').textContent = 'Get ready';
    recordingClick = createClickTrack(context, recordingTempo, countInStart, ($('record-click').checked || captureClick) ? 0 : 4, recordingMeter, 4);
    if (captureClick) recordingClick.connect(worklet, 0, 1);
    $('playback').hidden = true;
    $('record-hint').textContent = 'Four beats in. Start playing on the next beat.';
    status(`Counting in at ${recordingTempo} BPM. Use headphones to keep the click out of the input.`);
  } catch (error) {
    await cleanup(); setMode('idle');
    const messages = {OverconstrainedError: 'The selected device or channel is unavailable. Reconnect it and find inputs again, or select Input 1 / mono.', NotAllowedError: 'Microphone access was denied. Allow the microphone in your browser’s site settings, then try again.', NotFoundError: 'No microphone was found. Connect a microphone and try again.', NotReadableError: 'Your microphone is unavailable. Close other apps using it and try again.'};
    status(messages[error.name] || error.message || 'Could not start recording. Please try again.', true);
  }
}
function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767), true));
  return new Blob([buffer], {type: 'audio/wav'});
}
async function stopRecording() {
  if (mode !== 'recording') return;
  const viewport = {left: window.scrollX, top: window.scrollY};
  setMode('stopping'); clearTimeout(timeoutId); cancelAnimationFrame(frameId);
  preserveViewport(viewport);
  // Flush the worklet's final partial buffer before closing the audio context.
  if (!recorderStopped) await new Promise(resolve => {
    const fallback = setTimeout(resolve, 1500);
    stopAcknowledged = () => { clearTimeout(fallback); resolve(); };
    worklet.port.postMessage('stop');
  });
  stopAcknowledged = undefined;
  const total = Math.min(chunks.reduce((n, chunk) => n + chunk.length, 0), Math.floor(recordingRate * MAX_SECONDS));
  const samples = new Float32Array(total); let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, total - offset); samples.set(part, offset); offset += part.length;
    if (offset === total) break;
  }
  chunks = [];
  const mixedSamples = captureClick ? new Float32Array(total) : null;
  offset = 0;
  for (const chunk of mixedChunks) {
    const part = chunk.subarray(0, total - offset);
    mixedSamples?.set(part, offset); offset += part.length;
    if (offset === total) break;
  }
  mixedChunks = [];
  await cleanup();
  setTimer(total / recordingRate);
  if (total / recordingRate < .15) {
    setMode('idle'); status('That take was too short. Record a few notes, then stop again.', true); return;
  }
  await processAudio(encodeWav(samples, recordingRate), false, recordingTempo, recordingMeter,
    mixedSamples ? encodeWav(mixedSamples, recordingRate) : null);
}
async function processAudio(blob, demo, tempo = null, meter = {numerator: 4, denominator: 4}, mixedBlob = null) {
  invalidateToleranceUpdate();
  setMode('processing');
  $('record-hint').textContent = 'Listening back to your melody…';
  status('Finding pitches and placing them on the staff…');
  if (playbackURL) URL.revokeObjectURL(playbackURL);
  await stopPlaybackMetronome();
  $('playback-click').disabled = !!mixedBlob;
  if (mixedBlob) $('playback-click').checked = false;
  $('playback-click').parentElement.title = mixedBlob ? 'The metronome is already embedded in this recording.' : '';
  $('playback').querySelector('span').textContent = mixedBlob ? 'YOUR RECORDING · METRONOME INCLUDED' : 'YOUR RECORDING';
  playbackURL = URL.createObjectURL(mixedBlob || blob);
  const audio = $('audio-playback');
  audio.pause(); audio.src = playbackURL; audio.load();
  $('playback').hidden = false;
  cancelAnimationFrame(playbackFrame); scoreDuration = 0; latestScore = null;
  const viewport = {left: window.scrollX, top: window.scrollY};
  scoreView?.clear();
  // Clear old notation so a failed request cannot pair a previous score with new audio.
  $('score-result').hidden = true; $('score-empty').hidden = false;
  $('note-count').textContent = 'PROCESSING';
  $('score-subtitle').textContent = 'Finding the notes in this take…';
  $('score-footer-text').textContent = 'Listening comes first. The notation follows.';
  preserveViewport(viewport);
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 90000);
  try {
    const body = new FormData(); body.append('audio', blob, 'recording.wav');
    if (tempo !== null) {
      body.append('tempo', String(tempo));
      body.append('timing_tolerance', $('timing-tolerance').value);
      body.append('meter_numerator', String(meter.numerator));
      body.append('meter_denominator', String(meter.denominator));
    }
    const response = await fetch('/api/transcribe', {method: 'POST', body, signal: controller.signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not analyze this recording. Please try again.');
    renderResult(result, demo);
    const usingInterface = !demo && /scarlett|focusrite/i.test($('mic-label').textContent);
    status(usingInterface && !result.notes.length
      ? 'No clear notes found. Check the guitar cable, INST switch, selected input, and gain. Play a note and look for activity on the interface meter.'
      : usingInterface && result.clipped
        ? 'The input clipped. Lower the gain on your interface and record again.'
        : result.message);
    $('record-hint').textContent = result.notes.length ? 'A little progress, one take at a time.' : 'A fresh take is a fresh start.';
  } catch (error) {
    $('note-count').textContent = 'TRY AGAIN'; $('score-subtitle').textContent = 'The recording could not be analyzed.';
    $('record-hint').textContent = 'Your audio is available to play back below.';
    status(error.name === 'AbortError' ? 'Analysis took too long. Try a shorter recording.' : error.message || 'Could not reach the server. Please try again.', true);
  } finally { clearTimeout(deadline); setMode('idle'); }
}
function renderResult(result, demo) {
  latestScore = {result, demo};
  showTolerance();
  const bass = selectedClef === 'bass';
  const notes = result.notes;
  const meter = result.time_signature || {numerator: 4, denominator: 4};
  const bpm = result.tempo || 100;
  $('note-count').textContent = `${notes.length} NOTE${notes.length === 1 ? '' : 'S'} DETECTED`;
  $('score-subtitle').textContent = `${demo ? 'Demo melody' : 'Your latest take'} · ${result.duration.toFixed(1)} seconds${result.tempo ? ` · ${result.tempo} BPM · ${meter.numerator}/${meter.denominator}` : ''}`;
  $('score-footer-text').textContent = notes.length ? `${bass ? 'Bass' : 'Treble'} clef · notes shown at sounding pitch. Each bar = ${(meter.numerator * 60 / bpm).toFixed(3)} seconds at normal playback speed.` : 'Try a slower melody in a quieter room.';
  $('score-result').hidden = !notes.length; $('score-empty').hidden = !!notes.length;
  $('rhythm-caption').textContent = result.tempo ? `Estimated note lengths · ${result.timing_tolerance || 0}% undotted-note tolerance` : 'Pitch sketch · record with a tempo for note values';
  $('note-list').replaceChildren();
  if (!notes.length) return;
  scoreDuration = result.duration;
  try {
    if (!scoreView) scoreView = new AlphaScoreView($('staff'), $('audio-playback'), message => status(message, true));
    const viewport = {left: window.scrollX, top: window.scrollY};
    scoreView.render(result, selectedClef);
    preserveViewport(viewport);
  } catch (error) {
    $('score-footer-text').textContent = 'Score rendering failed. Your recorded audio is still available.';
    status(error.message || 'Could not load the notation library.', true);
  }
  notes.forEach(note => {
    const chip = document.createElement('div'); chip.className = 'note-chip';
    const label = document.createElement('strong'); label.textContent = note.label.replace('#', '♯');
    const detail = document.createElement('span'); detail.textContent = `${note.duration.toFixed(2)}s · ${note.frequency} Hz`;
    if (note.notation) {
      const value = document.createElement('span');
      value.textContent = note.notation.map(part => `${part.dotted ? 'Dotted ' : ''}${part.value}`).join(' + ') + ` · ${note.duration_pulses ?? note.duration_beats} beat${(note.duration_pulses ?? note.duration_beats) === 1 ? '' : 's'}`;
      chip.append(value);
    }
    chip.append(label, detail); $('note-list').append(chip);
  });
  updatePlaybackCursor();
}
async function demoMelody() {
  if (mode !== 'idle') return;
  let bpm, meter;
  try { bpm = readTempo(); meter = readMeter(); } catch (error) { status(error.message, true); return; }
  $('audio-playback').pause(); setMode('processing');
  await stopMetronomePreview();
  const rate = 22050, beat = 60 / bpm * meter.denominator / 4;
  const melody = [[48, 1], [50, .5], [52, .5], [53, 2], [55, 1], [57, 1], [59, 4], [60, 1]];
  const duration = melody.reduce((sum, note) => sum + note[1], 0) * beat + .2;
  const samples = new Float32Array(Math.ceil(rate * duration));
  let position = 0;
  melody.forEach(([midi, beats]) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12), start = Math.round(position * rate);
    const length = beats * beat - Math.min(.015, beats * beat * .03);
    for (let i = 0; i < Math.floor(rate * length); i++) {
      const t = i / rate, envelope = Math.min(1, t / .005) * Math.exp(-.25 * t) * Math.min(1, (length - t) / .008);
      samples[start + i] = .3 * envelope * (Math.sin(2 * Math.PI * frequency * t) + .35 * Math.sin(4 * Math.PI * frequency * t) + .15 * Math.sin(6 * Math.PI * frequency * t));
    }
    position += beats * beat;
  });
  setTimer(duration); await processAudio(encodeWav(samples, rate), true, bpm, meter);
}
async function listInputs(requestPermission = false) {
  if (mode !== 'idle') return;
  let permissionStream;
  if (requestPermission) setMode('starting');
  try {
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Audio input selection requires localhost or HTTPS in a supported browser.');
    if (requestPermission) permissionStream = await navigator.mediaDevices.getUserMedia({audio: true});
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(device => device.kind === 'audioinput');
    populateOutputs(devices);
    const previous = $('audio-device').value;
    $('audio-device').replaceChildren(new Option('System default', ''));
    inputs.forEach((device, index) => {
      if (device.deviceId) $('audio-device').add(new Option(device.label || `Audio input ${index + 1}`, device.deviceId));
    });
    if (previous && !inputs.some(device => device.deviceId === previous)) {
      $('audio-device').add(new Option('Selected input disconnected — reconnect or choose another', previous));
    }
    $('audio-device').value = previous;
    if (requestPermission) status('Choose your Scarlett or microphone above. On Solo 4th Gen, guitar is Input 1.');
  } catch (error) {
    if (requestPermission) status(error.name === 'NotAllowedError' ? 'Allow audio input access in your browser to list device names.' : error.message, true);
  } finally {
    permissionStream?.getTracks().forEach(track => track.stop());
    if (requestPermission) setMode('idle');
  }
}
$('refresh-inputs').addEventListener('click', () => listInputs(true));
$('audio-device').addEventListener('change', () => {
  $('mic-label').textContent = $('audio-device').selectedOptions[0].textContent;
  status('Input selected. Check the channel, then start recording.');
});
navigator.mediaDevices?.addEventListener('devicechange', () => listInputs());
listInputs();
$('record-button').addEventListener('click', () => mode === 'countin' ? cancelCountIn() : mode === 'recording' ? stopRecording() : startRecording());
$('demo-button').addEventListener('click', demoMelody);
window.addEventListener('resize', () => { if (mode !== 'recording') drawWave(); });
window.addEventListener('pagehide', () => { scoreView?.destroy(); previewContext?.close(); playbackContext?.close(); recordingClick?.disconnect(); playbackClick?.disconnect(); stream?.getTracks().forEach(track => track.stop()); context?.close(); if (playbackURL) URL.revokeObjectURL(playbackURL); });
drawWave();

function updatePlaybackCursor() {
  scoreView?.sync();
}
function animatePlayback() {
  cancelAnimationFrame(playbackFrame);
  updatePlaybackCursor();
  if (!$('audio-playback').paused && !$('audio-playback').ended) playbackFrame = requestAnimationFrame(animatePlayback);
}
$('audio-playback').addEventListener('play', () => { animatePlayback(); startPlaybackMetronome(); });
$('audio-playback').addEventListener('playing', () => { startPlaybackMetronome(); animatePlayback(); });
$('audio-playback').addEventListener('waiting', stopPlaybackMetronome);
['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'ratechange', 'waiting'].forEach(event => $('audio-playback').addEventListener(event, updatePlaybackCursor));
['pause', 'ended', 'emptied'].forEach(event => $('audio-playback').addEventListener(event, () => {
  cancelAnimationFrame(playbackFrame); updatePlaybackCursor(); stopPlaybackMetronome();
}));

function selectClef(clef) {
  selectedClef = clef;
  $('bass-clef').setAttribute('aria-pressed', String(clef === 'bass'));
  $('treble-clef').setAttribute('aria-pressed', String(clef === 'treble'));
  $('empty-clef').textContent = clef === 'bass' ? '𝄢' : '𝄞';
  if (latestScore) renderResult(latestScore.result, latestScore.demo);
}
$('bass-clef').addEventListener('click', () => selectClef('bass'));
$('treble-clef').addEventListener('click', () => selectClef('treble'));

function readTempo() {
  const bpm = Number($('tempo').value);
  if (!Number.isInteger(bpm) || bpm < 40 || bpm > 240) throw new Error('Choose a whole-number tempo between 40 and 240 BPM.');
  return bpm;
}
function updateMetronomeControls() {
  const locked = mode !== 'idle' || metroStarting;
  $('metronome-play').disabled = locked;
  $('metronome-play').textContent = metroStarting ? 'Connecting…' : previewContext ? '■ Stop metronome' : '▶ Play metronome';
  $('metronome-play').setAttribute('aria-pressed', String(!!previewContext));
  $('tempo').disabled = locked || !!previewContext;
  $('meter-numerator').disabled = locked || !!previewContext;
  $('meter-denominator').disabled = locked || !!previewContext;
  $('audio-output').disabled = locked || !!previewContext || !window.AudioContext?.prototype.setSinkId;
  $('record-click').disabled = locked;
  $('capture-click').disabled = locked;
  $('timing-tolerance').disabled = locked;
  $('demo-button').disabled = locked;
  ['audio-device', 'audio-channel', 'refresh-inputs'].forEach(id => $(id).disabled = locked);
  $('record-button').disabled = !['idle', 'recording', 'countin'].includes(mode) || metroStarting;
}
function resetBeatDisplay() {
  document.querySelectorAll('.beat-dots i').forEach(dot => dot.classList.remove('active'));
  $('beat-display').textContent = 'Ready · 4-beat count-in';
}
function createClickTrack(audioContext, bpm, startTime, beatLimit = 0, meter = readMeter(), countInBeats = 0) {
  const node = new AudioWorkletNode(audioContext, 'metronome', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
    processorOptions: {bpm, startTime, beatLimit, beatsPerMeasure: meter.numerator, countInBeats, volume: Number($('click-volume').value) / 100 * .5}
  });
  node.port.onmessage = ({data}) => {
    if (data?.type !== 'beat') return;
    if (node !== previewClick && node !== recordingClick && node !== playbackClick) return;
    const inCount = data.beat < countInBeats;
    const beatNumber = inCount ? data.beat : (data.beat - countInBeats) % meter.numerator;
    document.querySelectorAll('.beat-dots i').forEach((dot, i) => dot.classList.toggle('active', i === beatNumber));
    if (mode === 'countin' && data.beat < 4) {
      $('timer').textContent = String(data.beat + 1);
      $('beat-display').textContent = `Count-in · ${data.beat + 1} of 4`;
    } else $('beat-display').textContent = `${node === playbackClick ? `Playback · bar ${Math.floor(data.beat / meter.numerator) + 1}` : `${bpm} BPM`} · beat ${beatNumber + 1} of ${meter.numerator}`;
  };
  // Output-only node: never connected to the microphone, meter, or recorder.
  node.connect(audioContext.destination);
  return node;
}
async function routeClickOutput(audioContext) {
  const output = $('audio-output').value;
  if (output) {
    if (!audioContext.setSinkId) throw new Error('Choose your headphones as the system output; this browser cannot select an output device.');
    await audioContext.setSinkId(output);
  }
}
function populateOutputs(devices) {
  const selected = $('audio-output').value;
  $('audio-output').replaceChildren(new Option('System default output', ''));
  devices.filter(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default').forEach(device => {
    $('audio-output').add(new Option(device.label || 'Audio output', device.deviceId));
  });
  if (selected && !devices.some(device => device.deviceId === selected)) $('audio-output').add(new Option('Selected output disconnected — reconnect or choose another', selected));
  $('audio-output').value = selected;
  updateMetronomeControls();
}
async function stopMetronomePreview() {
  previewClick?.port.postMessage('stop'); previewClick?.disconnect(); previewClick = undefined;
  const oldContext = previewContext; previewContext = undefined;
  if (oldContext && oldContext.state !== 'closed') await oldContext.close().catch(() => {});
  resetBeatDisplay(); updateMetronomeControls();
}
async function toggleMetronomePreview() {
  if (mode !== 'idle' || metroStarting) return;
  if (previewContext) { await stopMetronomePreview(); return; }
  metroStarting = true; updateMetronomeControls();
  try {
    const bpm = readTempo(); readMeter();
    $('audio-playback').pause();
    previewContext = new AudioContext({sampleRate: 48000});
    await routeClickOutput(previewContext);
    await previewContext.resume();
    await previewContext.audioWorklet.addModule('/static/metronome-worklet.js');
    previewClick = createClickTrack(previewContext, bpm, previewContext.currentTime + .1);
    status(`Metronome preview at ${bpm} BPM. No audio is being recorded.`);
  } catch (error) {
    await stopMetronomePreview();
    status(error.message || 'Could not play the metronome. Check your headphone output.', true);
  } finally { metroStarting = false; updateMetronomeControls(); }
}
async function cancelCountIn(message = 'Count-in cancelled. Nothing was recorded.') {
  if (mode !== 'countin') return;
  setMode('stopping'); await cleanup(); chunks = []; mixedChunks = [];
  setTimer(0); setMode('idle');
  $('record-hint').textContent = 'Ready when you are.';
  status(message);
}
$('metronome-play').addEventListener('click', toggleMetronomePreview);
$('click-volume').addEventListener('input', () => {
  const message = {type: 'volume', value: Number($('click-volume').value) / 100 * .5};
  previewClick?.port.postMessage(message); recordingClick?.port.postMessage(message); playbackClick?.port.postMessage(message);
});
$('audio-playback').addEventListener('play', () => { if (previewContext) stopMetronomePreview(); });
$('audio-playback').addEventListener('seeking', stopPlaybackMetronome);
$('audio-playback').addEventListener('ratechange', () => { stopPlaybackMetronome(); startPlaybackMetronome(); });
$('audio-playback').addEventListener('seeked', () => { if (!$('audio-playback').paused) startPlaybackMetronome(); });
$('playback-click').addEventListener('change', () => {
  if ($('playback-click').checked) startPlaybackMetronome();
  else stopPlaybackMetronome();
});
updateMetronomeControls();

function readMeter() {
  const numerator = Number($('meter-numerator').value), denominator = Number($('meter-denominator').value);
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 12 || ![2, 4, 8, 16].includes(denominator)) throw new Error('Choose 1–12 beats per measure and a half, quarter, eighth, or sixteenth-note beat.');
  return {numerator, denominator};
}
function refreshMeterDots() {
  const n = Number($('meter-numerator').value);
  const dots = document.querySelector('.beat-dots');
  dots.replaceChildren(...Array.from({length: Math.max(4, Math.min(12, n || 4))}, () => document.createElement('i')));
}
$('meter-numerator').addEventListener('change', refreshMeterDots);

function invalidateToleranceUpdate() {
  toleranceRevision++; clearTimeout(toleranceTimer); toleranceRequest?.abort();
}
function showTolerance() {
  const percent = Number($('timing-tolerance').value);
  $('tolerance-value').textContent = `${percent}%`;
  const tempo = latestScore?.result.tempo || Number($('tempo').value) || 100;
  const denominator = latestScore?.result.time_signature?.denominator || Number($('meter-denominator').value) || 4;
  const quarter = 60 / tempo * denominator / 4;
  $('tolerance-hint').textContent = percent === 0
    ? '0% adds no extra allowance; note lengths still round to the nearest sixteenth.'
    : `Favor undotted notes within ±${percent}%. At ${tempo} BPM, a quarter note accepts ${(quarter * (1-percent/100)).toFixed(3)}–${(quarter * (1+percent/100)).toFixed(3)}s. Barline splits can still require dots or ties.`;
}
async function retimeScore(revision) {
  if (mode !== 'idle' || !latestScore?.result.tempo || revision !== toleranceRevision) return;
  const original = latestScore;
  toleranceRequest = new AbortController();
  try {
    const result = original.result, meter = result.time_signature || {numerator:4,denominator:4};
    const response = await fetch('/api/rhythm', {method:'POST', headers:{'Content-Type':'application/json'}, signal:toleranceRequest.signal,
      body:JSON.stringify({tempo:result.tempo, numerator:meter.numerator, denominator:meter.denominator, tolerance:Number($('timing-tolerance').value), notes:result.notes.map(note=>({start:note.start,duration:note.duration}))})});
    const updated = await response.json();
    if (!response.ok) throw new Error(updated.error || 'Could not update note timing.');
    if (revision !== toleranceRevision || mode !== 'idle' || latestScore?.result !== original.result) return;
    renderResult({...result, timing_tolerance:updated.timing_tolerance, notes:result.notes.map((note,i)=>({...note,...updated.notes[i]}))}, original.demo);
  } catch (error) {
    if (error.name !== 'AbortError' && revision === toleranceRevision) status('The score was not updated: ' + error.message, true);
  }
}
$('timing-tolerance').addEventListener('input', () => {
  showTolerance(); invalidateToleranceUpdate();
  const revision = toleranceRevision;
  toleranceTimer = setTimeout(() => retimeScore(revision), 150);
});
$('tempo').addEventListener('input', showTolerance);
$('meter-denominator').addEventListener('change', showTolerance);
