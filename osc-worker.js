class RotatingAudioBuffer {
  constructor(length) {
    this.length = length;
    this.buffer = new Float32Array(length);
    this.writeIndex = 0;
  }

  write(data) {
    for (let i = 0; i < data.length; i++) {
      this.buffer[this.writeIndex] = data[i];
      this.writeIndex = (this.writeIndex + 1) % this.length;
    }
  }

  read(targetBuffer) {
    const targetLength = targetBuffer.length;
    let readIndex = (this.writeIndex - targetLength + this.length) % this.length;

    for (let i = 0; i < targetLength; i++) {
      targetBuffer[i] = this.buffer[readIndex];
      readIndex = (readIndex + 1) % this.length;
    }
  }
}


class OscWorker extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rotatingBuffer = new RotatingAudioBuffer(sampleRate);
    this.port.onmessage = this.handleMessage.bind(this);
  }

  handleMessage(event) {
    if (event.data.type === 'dump') {
      const buffer = event.data.buffer;
      const writeArray = new Float32Array(buffer);
      if (buffer && buffer.length > 0) {
        this.rotatingBuffer.read(writeArray);
        this.port.postMessage({
          type: 'dumped',
          buffer: writeArray.buffer
        },
          [writeArray.buffer]);
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (input.length > 0 && input[0].length > 0) {
      const monoInput = input[0][0];
      this.rotatingBuffer.write(monoInput);
    }

    return true;
  }
}

registerProcessor('osc-worker', OscWorker);
