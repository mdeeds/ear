

/**
 * Implements an IIR (Infinite Impulse Response) band-boost filter.
 * The filter is a biquad peaking EQ type.
 */
class IIRBandBoostFilter {
  /**
   * Creates an instance of an IIR band-boost filter.
   * @param {number} midiNoteNumber - The MIDI note number for the center frequency of the boost.
   * @param {number} samplingFrequency - The sampling frequency of the audio signal (e.g., 44100 Hz).
   * @param {number} [peakGainDB=6.0] - The gain at the center frequency in decibels (dB).
   */
  constructor(midiNoteNumber, samplingFrequency, peakGainDB = 6.0) {
    this.Fs = samplingFrequency;
    this.f0 = 440.0 * Math.pow(2, (midiNoteNumber - 69.0) / 12.0);
    this.peakGainDB = peakGainDB;


    if (this.f0 <= 0 || this.f0 >= this.Fs / 2) {
      console.warn(`IIRBandBoostFilter: Center frequency ${this.f0} Hz is out of valid range (0, ${this.Fs / 2} Hz). Filter will act as pass-through.`);
      // Set coefficients for an all-pass filter (gain of 1)
      this.b0 = 1.0;
      this.b1 = 0.0;
      this.b2 = 0.0;
      this.a1 = 0.0;
      this.a2 = 0.0;
    } else {
      const w0 = 2 * Math.PI * this.f0 / this.Fs;
      const cos_w0 = Math.cos(w0);
      const sin_w0 = Math.sin(w0);

      // Calculate Q based on a "radius" of 25 cents.
      // 25 cents means the bandwidth is from f0 * 2^(-25/1200) to f0 * 2^(+25/1200).
      // Total bandwidth is 50 cents.
      // Q = f0 / BW, where BW = f0 * (2^(25/1200) - 2^(-25/1200))
      const ratio_radius = Math.pow(2, 25.0 / 1200.0); // 2^(1/24)
      const Q = 1.0 / (ratio_radius - 1.0 / ratio_radius);

      const alpha = sin_w0 / (2.0 * Q);
      const A = Math.pow(10, this.peakGainDB / 20.0);

      // RBJ Audio EQ Cookbook: Peaking EQ coefficients
      // H(z) = (b0 + b1*z^-1 + b2*z^-2) / (a0 + a1*z^-1 + a2*z^-2)
      // We will normalize by a0.

      // Temporary coefficients before normalization by a0_rbj
      const b0_rbj_num = 1 + alpha * A;
      const b1_rbj_num = -2 * cos_w0;
      const b2_rbj_num = 1 - alpha * A;
      const a0_rbj_den = 1 + alpha / A; // This is the a0 we normalize by
      const a1_rbj_num = -2 * cos_w0;
      const a2_rbj_num = 1 - alpha / A;

      if (a0_rbj_den === 0) { // Should not happen with A >= 1 and alpha >= 0
        console.warn("IIRBandBoostFilter: Denominator a0_rbj is zero. Filter will act as pass-through.");
        this.b0 = 1.0; this.b1 = 0.0; this.b2 = 0.0; this.a1 = 0.0; this.a2 = 0.0;
      } else {
        // Normalized coefficients for the difference equation:
        // y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
        this.b0 = b0_rbj_num / a0_rbj_den;
        this.b1 = b1_rbj_num / a0_rbj_den;
        this.b2 = b2_rbj_num / a0_rbj_den;
        this.a1 = a1_rbj_num / a0_rbj_den; // This is the 'a1' coefficient from the polynomial 1 + a1*z^-1 + ...
        this.a2 = a2_rbj_num / a0_rbj_den; // This is the 'a2' coefficient from the polynomial 1 + ... + a2*z^-2
      }
    }

    // State variables for Direct Form I
    this.x1 = 0.0; // x[n-1]
    this.x2 = 0.0; // x[n-2]
    this.y1 = 0.0; // y[n-1]
    this.y2 = 0.0; // y[n-2]
  }

  /**
   * Processes a single audio sample through the filter.
   * @param {number} inputSample - The input audio sample.
   * @returns {number} The filtered audio sample.
   */
  process(inputSample) {
    const x0 = inputSample; // Current input x[n]

    // Difference equation: y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
    const outputSample = this.b0 * x0 +
      this.b1 * this.x1 +
      this.b2 * this.x2 -
      this.a1 * this.y1 -
      this.a2 * this.y2;

    // Update state variables for the next sample
    this.x2 = this.x1;
    this.x1 = x0;
    this.y2 = this.y1;
    this.y1 = outputSample;

    return outputSample;
  }
}

/**
 * Implements a pair of IIR band-boost filters with one delayed by a quarter wavelength.
 */
class DelayedIIRBandBoostFilterPair {
  /**
   * Creates an instance of a delayed IIR band-boost filter pair.
   * @param {number} midiNoteNumber - The MIDI note number for the center frequency of the boost.
   * @param {number} samplingFrequency - The sampling frequency of the audio signal (e.g., 44100 Hz).
   * @param {number} [peakGainDB=6.0] - The gain at the center frequency in decibels (dB).
   */
  constructor(midiNoteNumber, samplingFrequency, peakGainDB = 6.0) {
    this.Fs = samplingFrequency;
    this.f0 = 440.0 * Math.pow(2, (midiNoteNumber - 69.0) / 12.0);
    this.peakGainDB = peakGainDB;

    // Create two IIR band-boost filters
    this.filter1 = new IIRBandBoostFilter(midiNoteNumber, samplingFrequency, peakGainDB);
    this.filter2 = new IIRBandBoostFilter(midiNoteNumber, samplingFrequency, peakGainDB);

    this.filter1Out = 0.0;
    this.filter2Out = 0.0;

    // Calculate the quarter wavelength delay in samples
    const wavelengthInSamples = this.Fs / this.f0;
    const delayInSamples = Math.round(wavelengthInSamples / 4);

    // Initialize delay buffers for the input signal
    this.delayBuffer = new Float32Array(delayInSamples).fill(0);
    this.delayIndex = 0;

    this.powerMean = 0.0;
  }

  /**
   * Processes a single audio sample through the filter pair with a quarter wavelength delay.
   * @param {number} inputSample - The input audio sample.
   * @returns {[number, number]} An array containing the filtered audio samples from filter1 and filter2.
   */
  process(inputSample) {
    // Delay the input signal for filter2
    this.filter1Out = this.filter1.process(inputSample);
    this.filter2Out = this.filter2.process(this.delayBuffer[this.delayIndex]);
    this.delayBuffer[this.delayIndex] = inputSample;
    ++this.delayIndex;
    this.delayIndex = this.delayIndex % this.delayBuffer.length;

    const nowPower = this.filter1Out ** 2 + this.filter2Out ** 2;
    const alpha = 0.95; // Smoothing factor
    this.powerMean = alpha * this.powerMean + (1.0 - alpha) * nowPower;

    return [this.filter1Out, this.filter2Out];
  }

  getInstantPower() {
    return this.powerMean;
  }
}

class EarProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (e) => {
      // Handle requests from the main thread to get data from the worker
      if (e.data.message === 'get-data') {
        const requestId = e.data.requestId; // Get the requestId
        // The main thread must pass in a buffer
        if (!e.data.buffer) { return; }
        const data = new Float32Array(e.data.buffer);
        for (let i = 0; i < 88; ++i) {
          data[i] = this.filters[i].getInstantPower();
        }
        this.port.postMessage({
          message: 'data',
          buffer: data.buffer,
          requestId: requestId, // Send it back
        }, [data.buffer]); // Transfer ownership of the buffer
      }
    };

    // Create 88 IIR band-boost filters, one for each note on the piano
    this.filters = Array.from({ length: 88 }, (_, i) => {
      // MIDI note numbers for the piano range from 21 (A0) to 108 (C8)
      const midiNoteNumber = i + 21;
      return new DelayedIIRBandBoostFilterPair(midiNoteNumber, sampleRate);
    });


  }

  process(inputs, outputs, params) {
    const input = inputs[0];

    if (!input || input.length === 0) {
      // No input available, return early.
      return true;
    }
    // We'll process only the first channel of the input and copy the result to all output channels.
    const inputChannel = input[0];

    if (!inputChannel || inputChannel.length === 0) {
      // No samples in the first input channel, return early.
      return true;
    }

    const numSamples = inputChannel.length;

    for (let sampleIndex = 0; sampleIndex < numSamples; ++sampleIndex) {
      const inputSample = inputChannel[sampleIndex];
      // Process the input sample through all 88 filters
      for (let i = 0; i < 88; ++i) {
        this.filters[i].process(inputSample)
      }
    }

    return true;
  }
}

registerProcessor('ear-processor', EarProcessor);
