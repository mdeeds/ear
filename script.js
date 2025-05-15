
class EarDataRequester {
  /**
   * Creates an instance of EarDataRequester.
   * @param {AudioWorkletNode} earAudioWorkletNode - The AudioWorkletNode instance for your 'ear-processor'.
   */
  constructor(earAudioWorkletNode) {
    if (!earAudioWorkletNode || !earAudioWorkletNode.port) {
      throw new Error("A valid AudioWorkletNode with a port must be provided.");
    }
    this.port = earAudioWorkletNode.port;
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;

    // Listen for messages from the worker
    this.port.onmessage = this._handleWorkerMessage.bind(this);
  }

  _handleWorkerMessage(event) {
    const { message, buffer, requestId } = event.data;

    if (message === 'data' && requestId !== undefined) {
      if (this.pendingRequests.has(requestId)) {
        const { resolve } = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);
        resolve(new Float32Array(buffer)); // Resolve with the Float32Array view of the filled buffer
      } else {
        console.warn(`EarDataRequester: Received data for unknown requestId: ${requestId}`);
      }
    }
    // You can add more 'else if' blocks here to handle other types of messages from the worker
  }

  /**
   * Requests the instant power data from the EarProcessor.
   * @returns {Promise<Float32Array>} A promise that resolves with a Float32Array (length 88)
   *                                  containing the instant power values from the filters.
   */
  async getEarPowerData() {
    return new Promise((resolve, reject) => {
      const requestId = this.requestIdCounter++;
      this.pendingRequests.set(requestId, { resolve, reject });

      // Create an ArrayBuffer to be filled by the worker.
      // 88 filters, each producing a Float32 value.
      const bufferToFill = new ArrayBuffer(88 * Float32Array.BYTES_PER_ELEMENT);

      try {
        this.port.postMessage({
          message: 'get-data',
          buffer: bufferToFill,
          requestId: requestId,
        }, [bufferToFill]); // Transfer ownership of the buffer to the worker
      } catch (error) {
        this.pendingRequests.delete(requestId);
        reject(error);
        return;
      }
    });
  }

  /**
   * Cleans up resources, like removing the message listener.
   * Call this when the requester is no longer needed to prevent memory leaks.
   */
  destroy() {
    if (this.port) {
      this.port.onmessage = null; // Remove the message listener
    }
    this.pendingRequests.forEach(({ reject }) => reject(new Error("EarDataRequester instance was destroyed.")));
    this.pendingRequests.clear();
    console.log("EarDataRequester destroyed.");
  }
}

// Helper function to convert HSL to RGB
// h (hue) is 0-360, s (saturation) is 0-100, l (lightness) is 0-100
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [
    Math.round(255 * f(0)),
    Math.round(255 * f(8)),
    Math.round(255 * f(4)),
  ];
}

async function setupAndGetData(audioContext) {
  try {
    await audioContext.audioWorklet.addModule('ear-worker.js');
    const earNode = new AudioWorkletNode(audioContext, 'ear-processor');
    // Connect earNode to your audio graph as needed, e.g., sourceNode.connect(earNode);

    const earDataRequester = new EarDataRequester(earNode);

    // To get data:
    const powerData = await earDataRequester.getEarPowerData();
    console.log("Received power data:", powerData);
    // powerData is a Float32Array with 88 values

    // When done with the requester (e.g., when tearing down the audio context or node):
    // earDataRequester.destroy();

  } catch (error) {
    console.error("Error in setupAndGetData:", error);
  }
}

function renderPowerData(powerData) {
  const canvas = document.getElementById('ear-canvas');
  if (!canvas) {
    console.error("Canvas element with ID 'ear-canvas' not found.");
    return;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    console.error("Could not get 2D context for canvas.");
    return;
  }

  const width = canvas.width;
  const height = canvas.height;

  // Shift the existing content down by one pixel
  const existingImageData = ctx.getImageData(0, 0, width, height - 1);
  ctx.putImageData(existingImageData, 0, 1);

  // Create ImageData for the new top row
  const topRowImageData = ctx.createImageData(width, 1);
  const pixels = topRowImageData.data; // This is a Uint8ClampedArray [R,G,B,A, R,G,B,A, ...]

  // Define min/max power for normalization. Consider making these configurable.
  const minPower = -20;
  const maxPower = 0;
  const barSegmentWidth = width / 88;

  for (let i = 0; i < 88; i++) {
    // Calculate the value (brightness) based on the power data (0 to 100%)
    const db = 20 * Math.log10(powerData[i] * 20)
    const normalizedPower = Math.min(1.0, Math.max(0.0, (db - minPower) / (maxPower - minPower)));
    const lightnessPercent = normalizedPower * 100; // For L in HSL (0-100)
    const hueDegrees = normalizedPower * 360;   // For H in HSL (0-360)

    const [r, g, b] = hslToRgb(hueDegrees, 100, lightnessPercent); // Saturation is 100%

    const startX = Math.floor(i * barSegmentWidth);
    const endX = Math.floor((i + 1) * barSegmentWidth);

    for (let px = startX; px < endX && px < width; px++) {
      const dataIndex = px * 4; // Each pixel has 4 components (R,G,B,A)
      pixels[dataIndex] = r;
      pixels[dataIndex + 1] = g;
      pixels[dataIndex + 2] = b;
      pixels[dataIndex + 3] = 255; // Alpha (fully opaque)
    }
  }
  // Draw the new top row by putting the prepared pixel data
  ctx.putImageData(topRowImageData, 0, 0);
}

// Example usage (assuming you have the powerData):
// renderPowerData(powerData);

// To integrate with the setupAndGetData function:
// async function setupAndGetDataAndRender(audioContext) {
//   try {
//     await audioContext.audioWorklet.addModule('ear-worker.js');
//     const earNode = new AudioWorkletNode(audioContext, 'ear-processor');
//     // Connect earNode to your audio graph as needed, e.g., sourceNode.connect(earNode);

//     const ear

// Assuming you have an AudioContext instance:
// const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
// setupAndGetData(audioCtx);

let earDataRequester;

async function renderLoop() {
  const powerData = await earDataRequester.getEarPowerData();
  renderPowerData(powerData);

  requestAnimationFrame(renderLoop);
}

function makeTestTone(audioCtx) {
  const oscillator = audioCtx.createOscillator();
  oscillator.frequency.value = 220;
  oscillator.type = 'sawtooth';
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 0.1;
  oscillator.connect(gainNode);
  oscillator.start();
  return gainNode;
}

class OscRender {
  /**
   * Creates an instance of OscDataRequester.
   * @param {AudioWorkletNode} oscAudioWorkletNode - The AudioWorkletNode instance for your 'osc-processor'.
   */
  constructor(inputNode) {
    if (!inputNode) {
      throw new Error("A valid AudioWorkletNode with a port must be provided.");
    }
    this.inputNode = inputNode;
    this.audioContext = inputNode.context;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'oscCanvas';
    this.canvas.width = 200;
    this.canvas.height = 100;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this._setup();

  }

  async _setup() {
    await this.audioContext.audioWorklet.addModule('osc-worker.js');
    this.oscAudioWorkletNode = new AudioWorkletNode(this.audioContext, 'osc-worker');
    this.inputNode.connect(this.oscAudioWorkletNode);

    this.port = this.oscAudioWorkletNode.port;
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;

    // Listen for messages from the worker
    this.port.onmessage = this._handleWorkerMessage.bind(this);

    this._renderLoop();
  }

  async _renderLoop() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const data = await this._getOscData();

    if (data) {
      const canvasWidth = this.canvas.width;
      const canvasHeight = this.canvas.height;
      const dataLength = data.length;

      this.ctx.beginPath();
      this.ctx.moveTo(0, canvasHeight / 2); // Start at the middle of the canvas

      const numSamples = Math.round(canvasWidth);
      for (let i = 0; i < numSamples; i++) {
        const x = (i / dataLength) * canvasWidth;
        const y = canvasHeight / 2 - (data[i] * canvasHeight / 2); // Scale and invert the data
        this.ctx.lineTo(x, y);
      }

      this.ctx.strokeStyle = 'blue';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }


    window.requestAnimationFrame(this._renderLoop.bind(this));
  }

  _handleWorkerMessage(event) {
    const { message, buffer, requestId } = event.data;

    if (message === 'data' && requestId !== undefined) {
      if (this.pendingRequests.has(requestId)) {
        const { resolve } = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);
        // Resolve with the Float32Array view of the filled buffer
        resolve(new Float32Array(buffer));
      } else {
        console.warn(`OscDataRequester: Received data for unknown requestId: ${requestId}`);
      }
    }
  }

  /**
   * Requests the osc data from the OscProcessor.
   * @returns {Promise<Float32Array>} A promise that resolves with a Float32Array (length 128)
   *                                  containing the osc values.
   */
  async _getOscData() {
    return new Promise((resolve, reject) => {
      const requestId = this.requestIdCounter++;
      this.pendingRequests.set(requestId, { resolve, reject });

      // Create an ArrayBuffer to be filled by the worker.
      const bufferToFill = new ArrayBuffer(128 * Float32Array.BYTES_PER_ELEMENT);

      try {
        this.port.postMessage({
          message: 'dump',
          buffer: bufferToFill,
          requestId
        }, [bufferToFill]);
        this.pendingRequests.set(requestId, { resolve, reject });
      } catch {

      }
    });
  }

}


async function initalize() {
  const gainControl = document.createElement('input');
  gainControl.type = 'range';
  gainControl.min = -20;
  gainControl.max = 10;
  gainControl.value = 0;
  gainControl.id = 'gainControl';
  document.body.appendChild(gainControl);

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.audioWorklet.addModule('ear-worker.js');
    const earNode = new AudioWorkletNode(audioCtx, 'ear-processor');
    // Connect earNode to your audio graph as needed, e.g., sourceNode.connect(earNode);

    const gain = audioCtx.createGain();
    gain.gain.value = 0.1;
    gainControl.oninput = () => {
      gain.gain.value = Math.pow(10, gainControl.value / 20);
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const sourceNode = audioCtx.createMediaStreamSource(stream);

    console.log(stream.id);



    sourceNode.connect(gain).connect(earNode);
    // makeTestTone(audioCtx).connect(earNode);

    earDataRequester = new EarDataRequester(earNode);
    new OscRender(gain);

    renderLoop();
  } catch (error) {
    console.error("Error during initialization:", error);
  }
}


document.body.onload = () => {
  const startButton = document.createElement('button');
  startButton.id = 'startButon';
  startButton.innerHTML = 'Start';
  startButton.onclick = () => {
    initalize();
    startButton.remove();
  };
  document.body.appendChild(startButton);
};
