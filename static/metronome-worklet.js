// Clicks are synthesized on the audio clock, independent of UI/timer throttling.
class Metronome extends AudioWorkletProcessor {
  constructor({processorOptions: options}) {
    super();
    this.startFrame = Math.round(options.startTime * sampleRate);
    this.beatFrames = sampleRate * 60 / options.bpm;
    this.limit = options.beatLimit || Infinity;
    this.volume = options.volume;
    this.beatsPerMeasure = options.beatsPerMeasure || 4;
    this.countInBeats = options.countInBeats || 0;
    this.lastBeat = -1;
    this.active = true;
    this.port.onmessage = ({data}) => {
      if (data === 'stop') this.active = false;
      if (data?.type === 'volume') this.volume = data.value;
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!this.active) return false;
    for (let i = 0; i < output.length; i++) {
      const elapsed = currentFrame + i - this.startFrame;
      if (elapsed < 0) continue;
      const beat = Math.floor(elapsed / this.beatFrames);
      if (beat >= this.limit) continue;
      if (beat !== this.lastBeat) {
        this.lastBeat = beat;
        this.port.postMessage({type: 'beat', beat});
      }
      const t = (elapsed - beat * this.beatFrames) / sampleRate;
      if (t < .035) {
        const envelope = Math.min(1, t / .001) * Math.exp(-t * 130) * Math.max(0, 1 - t / .035);
        output[i] = Math.sin(2 * Math.PI * ((beat < this.countInBeats ? beat === 0 : (beat - this.countInBeats) % this.beatsPerMeasure === 0) ? 1400 : 950) * t) * envelope * this.volume;
      }
    }
    return true;
  }
}
registerProcessor('metronome', Metronome);
