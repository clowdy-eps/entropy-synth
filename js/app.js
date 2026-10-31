'use strict'
// State and parameter definitions. Audio nodes never enter persistent state.
const STORAGE_KEY = 'entropy-public:v1'
const defaults = {
  wave: 'sawtooth',
  detune: 0,
  attack: 0.005,
  decay: 0.3,
  sustain: 1,
  release: 0.8,
  bits: 16,
  distortion: 0,
  cutoff: 16000,
  noise: 0,
  reverb: 0.15,
  feedback: 0,
  hum: false,
}
const specs = {
  detune: { label: 'DETUNE', min: -100, max: 100, step: 1, unit: ' ct' },
  attack: {
    label: 'ATTACK',
    min: 0.005,
    max: 2,
    step: 0.005,
    ref: 'R1',
    unit: ' s',
  },
  decay: {
    label: 'DECAY',
    min: 0.01,
    max: 2,
    step: 0.01,
    ref: 'R2',
    unit: ' s',
  },
  sustain: {
    label: 'SUSTAIN',
    min: 0,
    max: 1,
    step: 0.01,
    ref: 'C1',
    percent: true,
  },
  release: {
    label: 'RELEASE',
    min: 0.02,
    max: 4,
    step: 0.01,
    ref: 'C2',
    unit: ' s',
  },
  bits: { label: 'BITS', min: 1, max: 16, step: 1, unit: ' bit' },
  distortion: {
    label: 'DISTORTION',
    min: 0,
    max: 1,
    step: 0.01,
    percent: true,
  },
  cutoff: {
    label: 'CUTOFF',
    min: 80,
    max: 16000,
    step: 1,
    log: true,
    unit: ' Hz',
  },
  noise: { label: 'NOISE', min: 0, max: 1, step: 0.01, percent: true },
  reverb: { label: 'REVERB WET', min: 0, max: 1, step: 0.01, percent: true },
  feedback: {
    label: 'DELAY FEEDBACK',
    min: 0,
    max: 0.85,
    step: 0.01,
    percent: true,
  },
}
const pitches = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
]
const codes = [
  [
    'KeyZ',
    'KeyS',
    'KeyX',
    'KeyD',
    'KeyC',
    'KeyV',
    'KeyG',
    'KeyB',
    'KeyH',
    'KeyN',
    'KeyJ',
    'KeyM',
  ],
  [
    'KeyQ',
    'Digit2',
    'KeyW',
    'Digit3',
    'KeyE',
    'KeyR',
    'Digit5',
    'KeyT',
    'Digit6',
    'KeyY',
    'Digit7',
    'KeyU',
  ],
]
const notes = [3, 4].flatMap((o) => pitches.map((p) => p + o))
const soundNotes = notes
const CHANNEL_LAYOUT = [
  { pan: -0.3, delay: 0.28, decay: 1.6 },
  { pan: 0.3, delay: 0.36, decay: 2.1 },
]
const state = {
  selectedChannel: 0,
  channels: [{ ...defaults }, { ...defaults }],
}
Object.defineProperty(state, 'params', {
  get() {
    return this.channels[this.selectedChannel]
  },
})
function channelForNote(note) {
  return Number(note.match(/-?\d+$/)[0]) >= 4 ? 1 : 0
}
function paramsForNote(note) {
  return state.channels[channelForNote(note)]
}
function selectChannel(index) {
  state.selectedChannel = index
  renderSettings()
  queueSave()
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const $ = (id) => document.getElementById(id)
let storageAvailable = true,
  saveTimer = null,
  powered = false,
  busy = false,
  audio = null,
  savePending = false
const voices = new Map(),
  held = new Map(),
  sources = new Map(),
  keyElements = new Map(),
  controlElements = new Map()
function report(message) {
  $('error').textContent = message
}
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (
      !saved ||
      ![1, 2].includes(saved.version) ||
      saved.instrument !== 'piano-v1'
    )
      return
    for (let index = 0; index < 2; index++) {
      const input = saved.version === 2 ? saved.channels?.[index] : saved.params
      if (!input) continue
      const output = state.channels[index]
      for (const [key, spec] of Object.entries(specs)) {
        const value = input[key]
        if (typeof value === 'number' && Number.isFinite(value))
          output[key] = clamp(value, spec.min, spec.max)
      }
      if (Object.hasOwn(PIANO_TONES, input.wave)) output.wave = input.wave
      if (typeof input.hum === 'boolean') output.hum = input.hum
    }
    state.selectedChannel = saved.selectedChannel === 1 ? 1 : 0
  } catch (e) {
    storageAvailable = false
    report('Память недоступна. Инструмент работает без сохранения.')
  }
}
function persist() {
  clearTimeout(saveTimer)
  saveTimer = null
  savePending = false
  if (!storageAvailable) return
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        instrument: 'piano-v1',
        channels: state.channels,
        selectedChannel: state.selectedChannel,
      }),
    )
  } catch (e) {
    storageAvailable = false
    report(
      'Не удалось сохранить настройки. Текущая сессия продолжает работать.',
    )
  }
}
function queueSave() {
  savePending = true
  if (saveTimer === null) saveTimer = setTimeout(persist, 400)
}
function format(k) {
  const s = specs[k],
    v = state.params[k]
  if (s.percent) return Math.round(v * 100) + '%'
  if (k === 'cutoff')
    return v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : Math.round(v) + ' Hz'
  return (s.step < 1 ? v.toFixed(2) : Math.round(v)) + (s.unit || '')
}
function normalized(k) {
  const s = specs[k],
    v = state.params[k]
  return s.log
    ? Math.log(v / s.min) / Math.log(s.max / s.min)
    : (v - s.min) / (s.max - s.min)
}
function denormalized(k, t) {
  const s = specs[k]
  return s.log
    ? s.min * Math.pow(s.max / s.min, t)
    : s.min + t * (s.max - s.min)
}
function setParam(k, v) {
  const s = specs[k]
  state.params[k] = clamp(Math.round(v / s.step) * s.step, s.min, s.max)
  renderControl(k)
  applyParams()
  queueSave()
}
function renderControl(k) {
  const c = controlElements.get(k)
  if (!c) return
  c.output.textContent = format(k)
  if (c.dial) {
    c.dial.style.setProperty('--angle', -135 + normalized(k) * 270 + 'deg')
    c.dial.setAttribute('aria-valuenow', state.params[k])
    c.dial.setAttribute('aria-valuetext', format(k))
  }
  if (c.input) c.input.value = state.params[k]
}
// DOM controls: rotary parameters and the four physical envelope faders.
function buildControls() {
  const paths = Object.fromEntries(
    Object.keys(PIANO_TONES).map((key) => [
      key,
      'M2 1h32v10H2Z M10 1v10 M18 1v10 M26 1v10 M6 1v5 M14 1v5 M30 1v5',
    ]),
  )
  for (const w of Object.keys(paths)) {
    const b = document.createElement('button')
    b.className = 'chip'
    b.dataset.wave = w
    b.setAttribute('aria-pressed', state.params.wave === w)
    b.innerHTML =
      '<svg viewBox="0 0 36 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="' +
      paths[w] +
      '"/></svg>' +
      PIANO_TONES[w].label
    b.addEventListener('click', () => {
      state.params.wave = w
      renderSettings()
      applyParams()
      queueSave()
    })
    $('waves').append(b)
  }
  document.querySelectorAll('[data-knob]').forEach((host) => {
    const k = host.dataset.knob,
      s = specs[k]
    host.innerHTML =
      '<span class="control-label" id="label-' +
      k +
      '">' +
      s.label +
      '</span><div class="dial" tabindex="0" role="slider" aria-labelledby="label-' +
      k +
      '" aria-orientation="vertical" aria-valuemin="' +
      s.min +
      '" aria-valuemax="' +
      s.max +
      '"><span class="needle"></span></div><output></output>'
    const dial = host.querySelector('.dial'),
      output = host.querySelector('output')
    controlElements.set(k, { dial, output })
    let drag = null
    dial.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      dial.setPointerCapture(e.pointerId)
      dial.focus()
      drag = { id: e.pointerId, y: e.clientY, value: normalized(k) }
      e.preventDefault()
    })
    dial.addEventListener('pointermove', (e) => {
      if (drag?.id === e.pointerId)
        setParam(
          k,
          denormalized(k, clamp(drag.value + (drag.y - e.clientY) / 180, 0, 1)),
        )
    })
    const end = (e) => {
      if (drag?.id === e.pointerId) drag = null
    }
    dial.addEventListener('pointerup', end)
    dial.addEventListener('pointercancel', end)
    dial.addEventListener('lostpointercapture', () => (drag = null))
    dial.addEventListener('keydown', (e) => {
      if (
        [
          'ArrowUp',
          'ArrowRight',
          'ArrowDown',
          'ArrowLeft',
          'Home',
          'End',
        ].includes(e.key)
      ) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Home') setParam(k, s.min)
        else if (e.key === 'End') setParam(k, s.max)
        else {
          const dir = ['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : -1
          setParam(
            k,
            s.log
              ? denormalized(k, clamp(normalized(k) + dir * 0.01, 0, 1))
              : state.params[k] + dir * s.step * (e.shiftKey ? 10 : 1),
          )
        }
      }
    })
  })
  ;['attack', 'decay', 'sustain', 'release'].forEach((k, i) => {
    const s = specs[k],
      host = document.createElement('div')
    host.className = 'fader-control'
    host.innerHTML =
      '<span class="ref">' +
      s.ref +
      '</span><label for="fader-' +
      k +
      '">' +
      s.label +
      '</label><div class="fader-track"><input id="fader-' +
      k +
      '" class="vertical ' +
      (i % 2 ? 'alt' : '') +
      '" type="range" min="' +
      s.min +
      '" max="' +
      s.max +
      '" step="' +
      s.step +
      '"></div><output for="fader-' +
      k +
      '"></output>'
    $('adsr').append(host)
    const input = host.querySelector('input'),
      output = host.querySelector('output')
    controlElements.set(k, { input, output })
    input.addEventListener('input', () => setParam(k, Number(input.value)))
  })
  document
    .querySelectorAll('[data-channel]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        selectChannel(Number(button.dataset.channel)),
      ),
    )
  $('hum').addEventListener('click', () => {
    state.params.hum = !state.params.hum
    renderSettings()
    applyParams()
    queueSave()
  })
  renderSettings()
}
function renderSettings() {
  document
    .querySelectorAll('[data-channel]')
    .forEach((button) =>
      button.setAttribute(
        'aria-pressed',
        Number(button.dataset.channel) === state.selectedChannel,
      ),
    )
  for (const k of Object.keys(specs)) renderControl(k)
  document
    .querySelectorAll('[data-wave]')
    .forEach((b) =>
      b.setAttribute('aria-pressed', b.dataset.wave === state.params.wave),
    )
  $('hum').setAttribute('aria-pressed', state.params.hum)
}
function buildKeyboard() {
  let white = 0
  notes.forEach((n, i) => {
    const black = n.includes('#'),
      code = codes[Math.floor(i / 12)][i % 12],
      binding = code.replace('Key', '').replace('Digit', ''),
      key = document.createElement('button')
    key.className = 'key' + (black ? ' black' : '')
    key.style.width = (black ? 4.2 : 100 / 14) + '%'
    key.style.left =
      (black ? (white * 100) / 14 - 2.1 : (white++ * 100) / 14) + '%'
    key.setAttribute('aria-label', n + ', клавиша ' + binding)
    key.setAttribute('aria-pressed', 'false')
    key.innerHTML =
      '<span class="binding">' +
      binding +
      '</span><span class="note-label">' +
      n +
      '</span>'
    key.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      key.setPointerCapture(e.pointerId)
      noteOn(n, 'pointer:' + e.pointerId)
    })
    const up = (e) => noteOff('pointer:' + e.pointerId)
    key.addEventListener('pointerup', up)
    key.addEventListener('pointercancel', up)
    key.addEventListener('lostpointercapture', up)
    keyElements.set(n, key)
    $('keys').append(key)
  })
}
// Trace origins are measured on the source PCB (1920 x 1280 reference).
// Project them using the same cover geometry as the CSS background on every resize.
function mountCircuitTracks() {
  const board = document.querySelector('.board'),
    instrument = $('instrument'),
    svg = $('circuit-links')
  const pads = {
    detune: [373, 694],
    bits: [727, 526],
    distortion: [697, 543],
    cutoff: [1018, 532],
    noise: [1896, 339],
    reverb: [1035, 554],
    feedback: [1896, 361],
  }
  function draw() {
    const b = board.getBoundingClientRect(),
      r = instrument.getBoundingClientRect()
    const scale = Math.max(r.width / 1920, r.height / 1280),
      ox = r.left + (r.width - 1920 * scale) / 2 - b.left,
      oy = r.top + (r.height - 1280 * scale) / 2 - b.top
    svg.setAttribute('viewBox', '0 0 ' + b.width + ' ' + b.height)
    const ns = 'http://www.w3.org/2000/svg'
    svg.replaceChildren()
    function trace(start, target) {
      const dx = target[0] - start[0],
        dy = target[1] - start[1],
        bend = Math.min(Math.abs(dx), Math.abs(dy))
      const path = document.createElementNS(ns, 'path')
      path.setAttribute(
        'd',
        'M ' +
          start.join(' ') +
          ' L ' +
          (target[0] - Math.sign(dx) * bend) +
          ' ' +
          start[1] +
          ' L ' +
          target.join(' '),
      )
      const pad = document.createElementNS(ns, 'circle')
      pad.setAttribute('cx', target[0])
      pad.setAttribute('cy', target[1])
      pad.setAttribute('r', 7)
      svg.append(path, pad)
    }
    for (const [name, point] of Object.entries(pads)) {
      const dial = board.querySelector('[data-knob=' + name + '] .dial'),
        d = dial.getBoundingClientRect()
      trace(
        [ox + point[0] * scale, oy + point[1] * scale],
        [d.left + d.width / 2 - b.left, d.top + d.height / 2 - b.top],
      )
    }
    // Small branches fan out from the existing central contact bank to the faders.
    board.querySelectorAll('.fader-control').forEach((f, i) => {
      const d = f.querySelector('.fader-track').getBoundingClientRect()
      trace(
        [ox + (941 + i * 18) * scale, oy + (477 + i * 10) * scale],
        [d.left + d.width / 2 - b.left, d.bottom - b.top],
      )
    })
  }
  const observer = new ResizeObserver(draw)
  observer.observe(board)
  observer.observe(instrument)
  draw()
  document.fonts.ready.then(draw)
}
function renderActivity() {
  for (const [n, key] of keyElements) {
    key.classList.toggle('active', held.has(n))
    key.setAttribute('aria-pressed', held.has(n))
  }
  $('voice-count').textContent = String(held.size).padStart(2, '0') + ' VOICES'
}
// Independent recorded-piano voices share samples and expose manual effects.
async function initAudio() {
  if (audio) return
  await loadPianoSamples()
  const master = new Tone.Gain(0),
    limiter = new Tone.Limiter(-3),
    waveform = new Tone.Waveform(1024)
  master.chain(limiter, Tone.Destination)
  limiter.connect(waveform)
  audio = { master, limiter, waveform, channels: [] }
  rebuildEffects()
  await Promise.all(audio.channels.map((bus) => bus.reverb.ready))
  applyParams()
}
function rebuildEffects() {
  if (!audio) return
  for (const voice of voices.values()) voice.contact.disconnect()
  for (const bus of audio.channels)
    for (const node of Object.values(bus)) node.dispose()
  // Two independent signal paths. Only the final master and limiter are shared.
  audio.channels = CHANNEL_LAYOUT.map((layout, index) => {
    const p = state.channels[index]
    const bus = {
      distortion: new Tone.Distortion(p.distortion),
      filter: new Tone.Filter(p.cutoff, 'lowpass', -24),
      delay: new Tone.FeedbackDelay({
        delayTime: layout.delay,
        feedback: p.feedback,
        wet: p.feedback > 0 ? 0.2 : 0,
      }),
      reverb: new Tone.Reverb({
        decay: layout.decay,
        preDelay: 0.015,
        wet: p.reverb,
      }),
      channel: new Tone.Channel({ volume: -3, pan: layout.pan }),
      hum: new Tone.Oscillator(50, 'sine'),
      humGain: new Tone.Gain(0),
      noise: new Tone.Noise('pink'),
      noiseFilter: new Tone.Filter(2500, 'highpass'),
      noiseGain: new Tone.Gain(0),
    }
    bus.distortion.chain(
      bus.filter,
      bus.delay,
      bus.reverb,
      bus.channel,
      audio.master,
    )
    bus.hum.chain(bus.humGain, bus.distortion)
    bus.noise.chain(bus.noiseFilter, bus.noiseGain, bus.distortion)
    bus.hum.start()
    bus.noise.start()
    return bus
  })
  for (const voice of voices.values())
    voice.contact.connect(audio.channels[voice.channelIndex].distortion)
}
// file:// pages have an opaque origin: Tone.BitCrusher's blob worklet cannot load.
// A synchronous WaveShaper implements the same amplitude quantization locally.
function createCrusher() {
  if (location.protocol === 'file:' || !Tone.context.rawContext.audioWorklet) {
    const node = new Tone.WaveShaper((x) => x, 65536)
    return { node, bits: null, local: true }
  }
  return {
    node: new Tone.BitCrusher({ bits: 16, wet: 0 }),
    bits: null,
    local: false,
  }
}
function createVoice(n) {
  if (voices.has(n)) return voices.get(n)
  const channelIndex = channelForNote(n),
    synth = new PianoVoice(paramsForNote(n))
  const crusher = createCrusher(),
    level = new Tone.Gain(Tone.dbToGain(-6)),
    contact = new Tone.Gain(1)
  // Attenuate after quantization, so low bit depths do not erase a quiet voice.
  synth.chain(
    crusher.node,
    level,
    contact,
    audio.channels[channelIndex].distortion,
  )
  const voice = {
    synth,
    crusher: crusher.node,
    crusherMode: crusher,
    level,
    contact,
    note: n,
    channelIndex,
    disposed: false,
  }
  voices.set(n, voice)
  return voice
}
function configureVoice(n, voice, now) {
  const p = paramsForNote(n)
  if (voice.crusherMode.local) {
    const bits = Math.round(p.bits)
    if (voice.crusherMode.bits !== bits) {
      const steps = Math.pow(2, bits - 1)
      voice.crusher.setMap((x) => Math.round(x * steps) / steps, 65536)
      voice.crusherMode.bits = bits
    }
  } else {
    voice.crusher.bits.value = p.bits
    voice.crusher.wet.rampTo(p.bits === 16 ? 0 : 1, 0.03)
  }
  voice.synth.detune.rampTo(p.detune, 0.08)
}
function applyParams() {
  if (!audio) return
  audio.channels.forEach((bus, index) => {
    const p = state.channels[index]
    bus.distortion.distortion = p.distortion
    bus.filter.frequency.rampTo(p.cutoff, 0.04)
    bus.delay.feedback.rampTo(p.feedback, 0.04)
    bus.delay.wet.rampTo(p.feedback > 0 ? 0.2 : 0, 0.04)
    bus.reverb.wet.rampTo(p.reverb, 0.04)
    bus.humGain.gain.rampTo(powered && p.hum ? 0.025 : 0, 0.05)
    bus.noiseGain.gain.rampTo(powered ? p.noise * 0.045 : 0, 0.04)
  })
  for (const voice of voices.values()) {
    const p = paramsForNote(voice.note)
    voice.synth.set({ oscillator: { type: p.wave }, envelope: p })
    configureVoice(voice.note, voice, Tone.now())
  }
}
function disposeVoice(key, v) {
  if (v.disposed) return
  v.disposed = true
  v.synth.dispose()
  v.crusher.dispose()
  v.level.dispose()
  v.contact.dispose()
  if (voices.get(key) === v) voices.delete(key)
}
async function switchPower() {
  if (busy) return
  busy = true
  $('power').disabled = true
  try {
    if (!powered) {
      if (!window.Tone)
        throw new Error(
          'Tone.js не загрузился. Проверьте интернет и обновите страницу.',
        )
      await Tone.start()
      await initAudio()
      powered = true
      audio.master.gain.cancelScheduledValues(Tone.now())
      audio.master.gain.rampTo(0.65, 0.08)
      applyParams()
    } else {
      releaseAll()
      powered = false
      audio.master.gain.cancelScheduledValues(Tone.now())
      audio.master.gain.rampTo(0, 0.035)
      for (const bus of audio.channels) {
        bus.humGain.gain.rampTo(0, 0.03)
        bus.noiseGain.gain.rampTo(0, 0.03)
      }
      await new Promise((resolve) => setTimeout(resolve, 55))
      for (const [key, v] of voices) disposeVoice(key, v)
      rebuildEffects()
    }
    renderPower()
  } catch (e) {
    releaseAll()
    powered = false
    renderPower()
    report(e.message || 'Не удалось включить звук. Попробуйте ещё раз.')
  } finally {
    busy = false
    $('power').disabled = false
  }
}
function renderPower() {
  $('power').setAttribute('aria-checked', powered)
  $('instrument').classList.toggle('powered-off', !powered)
}
function registerAttack(n, source) {
  sources.set(source, n)
  if (!held.has(n)) held.set(n, new Set())
  held.get(n).add(source)
}
function unregisterSource(source) {
  const n = sources.get(source)
  if (!n) return null
  sources.delete(source)
  const owners = held.get(n)
  owners?.delete(source)
  if (!owners?.size) held.delete(n)
  return n
}
function noteOn(n, source, time, velocity = 0.8) {
  if (!powered || busy || sources.has(source) || !soundNotes.includes(n)) return
  registerAttack(n, source)
  const v = createVoice(n),
    now = time ?? Tone.now()
  v.contact.gain.cancelScheduledValues(now)
  v.contact.gain.setValueAtTime(1, now)
  configureVoice(n, v, now)
  v.synth.triggerAttack(n, now, clamp(velocity, 0, 1))
  renderActivity()
}
function noteOff(source, time) {
  if (!sources.has(source)) return
  const n = unregisterSource(source)
  if (!n) return
  const owners = held.get(n),
    v = voices.get(n)
  if (v && !owners?.size) {
    const now = time ?? Tone.now()
    v.synth.triggerRelease(now)
    v.contact.gain.cancelScheduledValues(now)
    v.contact.gain.rampTo(1, 0.01)
  }
  renderActivity()
}
function releaseAll() {
  for (const v of voices.values()) {
    v.synth.triggerRelease()
    v.contact.gain.cancelScheduledValues(Tone.now())
    v.contact.gain.rampTo(1, 0.01)
  }
  held.clear()
  sources.clear()
  renderActivity()
  if (savePending) persist()
}
async function repair() {
  if (busy) return
  busy = true
  $('repair').disabled = true
  try {
    releaseAll()
    if (audio) {
      audio.master.gain.cancelScheduledValues(Tone.now())
      audio.master.gain.rampTo(0, 0.025)
      await new Promise((resolve) => setTimeout(resolve, 45))
      for (const [key, v] of voices) disposeVoice(key, v)
    }
    state.channels = [{ ...defaults }, { ...defaults }]
    state.selectedChannel = 0
    clearTimeout(saveTimer)
    saveTimer = null
    savePending = false
    try {
      localStorage.removeItem(STORAGE_KEY)
      storageAvailable = true
      report('')
    } catch (e) {
      storageAvailable = false
      report('Состояние восстановлено; хранилище браузера недоступно.')
    }
    if (audio) {
      rebuildEffects()
      applyParams()
      audio.master.gain.rampTo(powered ? 0.65 : 0, 0.06)
    }
    renderSettings()
  } finally {
    busy = false
    $('repair').disabled = false
  }
}
// Performance clock and real output visualization, independent of browser key repeat.
const canvas = $('scope'),
  ctx = canvas.getContext('2d')
let scopeWidth = 0,
  scopeHeight = 0
function drawScope() {
  const rect = canvas.getBoundingClientRect(),
    dpr = Math.min(window.devicePixelRatio || 1, 2)
  if (scopeWidth !== rect.width || scopeHeight !== rect.height) {
    scopeWidth = rect.width
    scopeHeight = rect.height
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  const w = scopeWidth,
    h = scopeHeight
  ctx.fillStyle = '#080d08'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#273b22'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  for (let x = 0; x < w; x += 24) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  for (let y = 0; y < h; y += 13) {
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()
  const values = powered && audio ? audio.waveform.getValue() : null
  ctx.strokeStyle = powered ? '#c4f784' : '#536345'
  ctx.lineWidth = 1.3
  ctx.shadowColor = '#adff66'
  ctx.shadowBlur = powered ? 5 : 0
  ctx.beginPath()
  for (let x = 0; x < w; x++) {
    const sample = values ? values[Math.floor((x / w) * values.length)] : 0,
      y = h * 0.5 - clamp(sample, -1, 1) * h * 0.44
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.shadowBlur = 0
  requestAnimationFrame(drawScope)
}
loadState()
persist()
buildControls()
buildKeyboard()
mountCircuitTracks()
renderPower()
$('power').addEventListener('click', switchPower)
$('repair').addEventListener('click', repair)
const codeNotes = new Map(
  notes.map((n, i) => [codes[Math.floor(i / 12)][i % 12], n]),
)
// Note bindings stay active while knobs and faders have focus; their arrow keys remain local.
document.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
  const n = codeNotes.get(e.code)
  if (n) {
    e.preventDefault()
    noteOn(n, 'key:' + e.code)
  }
})
document.addEventListener('keyup', (e) => {
  if (codeNotes.has(e.code)) {
    noteOff('key:' + e.code)
  }
})
window.addEventListener('blur', () => {
  releaseAll()
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    releaseAll()
    persist()
  }
})
window.addEventListener('pagehide', () => {
  releaseAll()
  persist()
})
requestAnimationFrame(drawScope)
if (!window.Tone)
  report(
    'Tone.js не загрузился. Для звука нужен интернет. Проверьте подключение и обновите страницу.',
  )
