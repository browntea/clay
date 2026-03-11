// AudioWorklet processor for STT recording
// Collects PCM samples and sends to main thread

class STTProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 4096;
    this._buffer = new Float32Array(this._bufferSize);
    this._writeIndex = 0;
  }

  process(inputs) {
    var input = inputs[0];
    if (!input || input.length === 0) return true;

    var channel = input[0];
    if (!channel) return true;

    for (var i = 0; i < channel.length; i++) {
      this._buffer[this._writeIndex++] = channel[i];

      if (this._writeIndex >= this._bufferSize) {
        // Send full buffer to main thread
        this.port.postMessage({ samples: this._buffer.slice() });
        this._writeIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('stt-processor', STTProcessor);
