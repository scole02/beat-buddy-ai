class PCMRecorder extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.startFrame = Math.round((processorOptions.startTime || 0) * sampleRate);
    this.maxSamples = Math.round((processorOptions.maxDuration || 60) * sampleRate);
    this.captured = 0;
    this.started = false;
    this.active = true;
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.port.onmessage = ({data}) => { if (data === 'stop') this.finish(); };
  }
  finish() {
    if (this.active && this.offset) this.port.postMessage(this.buffer.slice(0, this.offset));
    this.offset = 0;
    this.active = false;
    this.port.postMessage('stopped');
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (this.active && channel) {
      for (let i = 0; i < channel.length; i++) {
        if (currentFrame + i < this.startFrame) continue;
        if (!this.started) {
          this.started = true;
          this.port.postMessage({type: 'started'});
        }
        this.buffer[this.offset++] = channel[i];
        this.captured++;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer);
          this.offset = 0;
        }
        if (this.captured === this.maxSamples) {
          this.finish();
          this.port.postMessage({type: 'limit'});
          break;
        }
      }
    }
    return this.active;
  }
}
registerProcessor('pcm-recorder', PCMRecorder);
