'use strict'
// The control identifiers retain compatibility with the existing panel layout.
const PIANO_TONES = {
  sawtooth: { label: 'GRAND', cutoff: 12000, velocity: 1 },
  square: { label: 'BRIGHT', cutoff: 20000, velocity: 0.8 },
  triangle: { label: 'SOFT', cutoff: 5000, velocity: 1.3 },
  sine: { label: 'DARK', cutoff: 2200, velocity: 1.1 },
}
function pianoNoteNumber(note) {
  return Math.round(
    69 + 12 * Math.log2(Tone.Frequency(note).toFrequency() / 440),
  )
}
const pianoBank = new Map()
let pianoLoading = null
function loadPianoSamples() {
  if (pianoLoading) return pianoLoading
  pianoLoading = (async () => {
    if (!globalThis.PIANO_SAMPLES)
      throw new Error('Не найдены локальные семплы фортепиано.')
    await Promise.all(
      Object.entries(PIANO_SAMPLES).map(async ([name, encoded]) => {
        const binary = atob(encoded),
          bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const buffer = await Tone.getContext().rawContext.decodeAudioData(
          bytes.buffer,
        )
        const note = name.replace('Ds', 'D#').replace('Fs', 'F#')
        pianoBank.set(pianoNoteNumber(note), buffer)
      }),
    )
  })().catch(() => {
    pianoLoading = null
    throw new Error(
      'Не удалось загрузить семплы фортепиано. Проверьте папку assets/audio/piano.',
    )
  })
  return pianoLoading
}
// Each voice uses shared decoded recordings and an independent envelope and pitch.
// Native playbackRate automation supplies smooth detune without an oscillator.
class PianoVoice {
  constructor(params) {
    this.filter = new Tone.Filter(20000, 'lowpass', -12)
    this.envelope = new Tone.AmplitudeEnvelope()
    this.output = new Tone.Gain(1)
    this.filter.chain(this.envelope, this.output)
    this.sources = new Map()
    this.pitch = 0
    this.disposed = false
    this.detune = {
      rampTo: (value, duration) => {
        this.pitch = value
        const now = Tone.now()
        for (const [source, base] of this.sources) {
          const rate = source.playbackRate
          rate.cancelAndHoldAtTime(now)
          rate.linearRampToValueAtTime(
            base * Math.pow(2, value / 1200),
            now + duration,
          )
        }
      },
    }
    this.set({ oscillator: { type: params.wave }, envelope: params })
  }
  chain(...nodes) {
    this.output.chain(...nodes)
    return this
  }
  set(options) {
    if (options.oscillator)
      this.tone = PIANO_TONES[options.oscillator.type] || PIANO_TONES.sawtooth
    if (options.envelope) {
      const p = options.envelope
      this.envelope.set({
        attack: p.attack,
        decay: p.decay,
        sustain: p.sustain,
        release: p.release,
      })
    }
    this.filter.frequency.rampTo(this.tone.cutoff, 0.04)
    return this
  }
  triggerAttack(note, time = Tone.now(), velocity = 0.8) {
    if (this.disposed) return this
    const pitchNumber = pianoNoteNumber(note)
    const nearest = [...pianoBank.keys()].reduce((best, key) =>
      Math.abs(key - pitchNumber) < Math.abs(best - pitchNumber) ? key : best,
    )
    // A manual retrigger starts a fresh recording instead of reopening the old tail.
    for (const source of this.sources.keys()) {
      try {
        source.stop(time)
      } catch {}
    }
    const source = Tone.getContext().rawContext.createBufferSource()
    const base = Math.pow(2, (pitchNumber - nearest) / 12)
    source.buffer = pianoBank.get(nearest)
    source.playbackRate.value = base * Math.pow(2, this.pitch / 1200)
    Tone.connect(source, this.filter)
    this.sources.set(source, base)
    source.onended = () => {
      source.disconnect()
      this.sources.delete(source)
    }
    source.start(time)
    this.envelope.triggerAttack(time, Math.pow(velocity, this.tone.velocity))
    return this
  }
  triggerRelease(time = Tone.now()) {
    if (this.disposed) return this
    this.envelope.triggerRelease(time)
    for (const source of this.sources.keys()) {
      try {
        source.stop(time + this.envelope.release + 0.05)
      } catch {}
    }
    return this
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const source of this.sources.keys()) {
      source.onended = null
      try {
        source.stop()
      } catch {}
      source.disconnect()
    }
    this.sources.clear()
    this.filter.dispose()
    this.envelope.dispose()
    this.output.dispose()
  }
}
