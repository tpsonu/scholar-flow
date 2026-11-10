/**
 * OmniStudy Voice Studio & Audio Memos
 * Records audio using MediaRecorder + Web Audio API visualizer.
 * Supports playback speed controls (1x, 1.25x, 1.5x, 2x), seeking, and IndexedDB caching.
 */

import { storeBlob, getBlob } from './storage.js';

let mediaRecorder = null;
let audioChunks = [];
let audioContext = null;
let analyser = null;
let visualizerAnimationId = null;
let currentAudioBlob = null;
let currentAudioUrl = null;
let isRecording = false;
let recordStartTime = 0;
let timerInterval = null;

// Stored voice memos list in memory
let voiceMemos = [];
let toastFn = null;

export function initVoiceModule(onNewMemoSaved, showToast = null) {
  toastFn = showToast;
  const recordBtn = document.getElementById('voice-record-toggle-btn');
  const discardBtn = document.getElementById('voice-discard-btn');
  const saveBtn = document.getElementById('voice-save-btn');
  const audioElement = document.getElementById('voice-audio-player');
  const speedBadges = document.querySelectorAll('.voice-speed-badge');
  const memoTitleInput = document.getElementById('voice-memo-title');

  // Load existing memos list
  loadVoiceMemosList();

  recordBtn?.addEventListener('click', () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  discardBtn?.addEventListener('click', () => {
    resetRecordingUI();
  });

  saveBtn?.addEventListener('click', async () => {
    if (!currentAudioBlob) {
      alert('Please record an audio memo first!');
      return;
    }
    const title = memoTitleInput?.value.trim() || `Voice Note ${new Date().toLocaleDateString()}`;
    const memoId = `voice_${Date.now()}`;
    const duration = document.getElementById('voice-duration-display')?.textContent || '00:00';

    await storeBlob(memoId, currentAudioBlob, { title, duration });

    const newMemo = {
      id: memoId,
      title,
      duration,
      created_at: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    voiceMemos.unshift(newMemo);
    localStorage.setItem('omnistudy_voice_memos_meta', JSON.stringify(voiceMemos));
    renderVoiceMemosList();
    resetRecordingUI();

    if (onNewMemoSaved) onNewMemoSaved(newMemo);
  });

  // Speed controls
  speedBadges.forEach(badge => {
    badge.addEventListener('click', () => {
      speedBadges.forEach(b => b.classList.remove('active'));
      badge.classList.add('active');
      const rate = parseFloat(badge.dataset.speed || 1);
      if (audioElement) audioElement.playbackRate = rate;
    });
  });
}

async function startRecording() {
  audioChunks = [];
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('navigator.mediaDevices.getUserMedia is unavailable in this environment.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    handleAudioStream(stream);
  } catch (err) {
    console.warn('Microphone permission denied or unavailable. Using synthesized audio studio simulator.', err);
    if (toastFn) {
      toastFn('⚠️ Mic blocked by IDE preview! Open in regular browser (http://localhost:8080) to record real voice.', 'warning');
    }
    startSimulatedRecording();
  }
}

function handleAudioStream(stream) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    currentAudioBlob = blob;
    setAudioPlayerBlob(blob);
    stream.getTracks().forEach(track => track.stop());
  };

  mediaRecorder.start();
  setRecordingActiveUI(false);
  drawWaveform();
}

/**
 * Fallback simulator when microphone hardware or permissions are restricted
 */
function startSimulatedRecording() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  gain.gain.value = 0.05;
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  osc.connect(gain);
  gain.connect(analyser);
  osc.start();

  setRecordingActiveUI(true);
  drawWaveform();

  // Create a simulated 3-second audio tone blob
  setTimeout(async () => {
    if (isRecording) {
      const sampleBlob = createSynthesizedAudioBlob();
      currentAudioBlob = sampleBlob;
    }
  }, 2000);
}

export function createSynthesizedAudioBlob() {
  // Generate a valid WAV file header and tone in pure JS
  const sampleRate = 8000;
  const durationSec = 3;
  const numSamples = sampleRate * durationSec;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // WAV RIFF header
  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Write simple tone data
  for (let i = 0; i < numSamples; i++) {
    const s = Math.sin(2 * Math.PI * 440 * (i / sampleRate));
    view.setInt16(44 + i * 2, s * 16000, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function setRecordingActiveUI(isSimulated = false) {
  isRecording = true;
  recordStartTime = Date.now();
  const recordBtn = document.getElementById('voice-record-toggle-btn');
  const statusElem = document.getElementById('voice-record-status');
  const controlsPane = document.getElementById('voice-post-record-pane');

  if (recordBtn) {
    recordBtn.classList.add('recording');
    recordBtn.innerHTML = '⏹';
  }
  if (statusElem) {
    if (isSimulated) {
      statusElem.innerHTML = '<span style="color: #f59e0b; font-weight: 600;">⚠️ Test simulation (Mic blocked by IDE preview).</span> Open <a href="http://localhost:8080" target="_blank" style="color: var(--primary); text-decoration: underline;">http://localhost:8080</a> in Chrome/Firefox for your real mic.';
    } else {
      statusElem.textContent = '🎙️ Recording live microphone... Click stop when finished.';
    }
  }
  if (controlsPane) controlsPane.style.display = 'none';

  // Timer
  const timerElem = document.getElementById('voice-record-timer');
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    if (timerElem) timerElem.textContent = `${m}:${s}`;
  }, 500);
}

function stopRecording() {
  isRecording = false;
  clearInterval(timerInterval);
  if (visualizerAnimationId) cancelAnimationFrame(visualizerAnimationId);

  const recordBtn = document.getElementById('voice-record-toggle-btn');
  const statusElem = document.getElementById('voice-record-status');
  const controlsPane = document.getElementById('voice-post-record-pane');

  if (recordBtn) {
    recordBtn.classList.remove('recording');
    recordBtn.innerHTML = '🎙️';
  }
  if (statusElem) statusElem.textContent = 'Recording completed. Review, play back, or save below.';
  if (controlsPane) controlsPane.style.display = 'block';

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    // If using simulator fallback
    if (!currentAudioBlob) {
      currentAudioBlob = createSynthesizedAudioBlob();
    }
    setAudioPlayerBlob(currentAudioBlob);
  }
}

function setAudioPlayerBlob(blob) {
  const audioElement = document.getElementById('voice-audio-player');
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = URL.createObjectURL(blob);
  if (audioElement) {
    audioElement.src = currentAudioUrl;
    audioElement.load();
  }

  // Record duration display
  const timerElem = document.getElementById('voice-record-timer');
  const durationDisplay = document.getElementById('voice-duration-display');
  if (durationDisplay && timerElem) {
    durationDisplay.textContent = timerElem.textContent;
  }
}

function resetRecordingUI() {
  currentAudioBlob = null;
  const controlsPane = document.getElementById('voice-post-record-pane');
  const timerElem = document.getElementById('voice-record-timer');
  const statusElem = document.getElementById('voice-record-status');
  const memoTitle = document.getElementById('voice-memo-title');

  if (controlsPane) controlsPane.style.display = 'none';
  if (timerElem) timerElem.textContent = '00:00';
  if (statusElem) statusElem.textContent = 'Click the microphone to start recording a voice note';
  if (memoTitle) memoTitle.value = '';

  const canvas = document.getElementById('voice-waveform-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function drawWaveform() {
  const canvas = document.getElementById('voice-waveform-canvas');
  if (!canvas || !analyser) return;

  const ctx = canvas.getContext('2d');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    if (!isRecording) return;
    visualizerAnimationId = requestAnimationFrame(draw);

    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#06b6d4';
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  };

  draw();
}

function loadVoiceMemosList() {
  const saved = localStorage.getItem('omnistudy_voice_memos_meta');
  voiceMemos = saved ? JSON.parse(saved) : [
    { id: 'sample_voice_1', title: 'Neuroscience Lecture: Hippocampus & LTP', duration: '02:14', created_at: 'Yesterday' },
    { id: 'sample_voice_2', title: 'Calculus: Fundamental Theorem of Line Integrals', duration: '01:45', created_at: '2 days ago' }
  ];
  renderVoiceMemosList();
}

function renderVoiceMemosList() {
  const container = document.getElementById('voice-memos-list');
  if (!container) return;

  if (voiceMemos.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 12px;">No voice notes recorded yet.</div>';
    return;
  }

  container.innerHTML = voiceMemos.map(memo => `
    <div class="card card-solid" style="padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <button class="btn-icon play-memo-btn" data-id="${memo.id}" title="Play memo">▶</button>
        <div>
          <div style="font-weight: 600; font-size: 0.9rem;">${memo.title}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary);">${memo.created_at} • ${memo.duration}</div>
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn-secondary download-memo-btn" data-id="${memo.id}" style="padding: 4px 8px; font-size: 0.8rem;">Download</button>
        <button class="btn-danger delete-memo-btn" data-id="${memo.id}" style="padding: 4px 8px; font-size: 0.8rem;">✕</button>
      </div>
    </div>
  `).join('');

  // Attach event listeners
  container.querySelectorAll('.play-memo-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      let blob = await getBlob(id);
      if (!blob) blob = createSynthesizedAudioBlob();
      const audioElement = document.getElementById('voice-audio-player');
      if (audioElement && blob) {
        audioElement.src = URL.createObjectURL(blob);
        audioElement.play();
        document.getElementById('voice-post-record-pane').style.display = 'block';
      }
    });
  });

  container.querySelectorAll('.delete-memo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      voiceMemos = voiceMemos.filter(m => m.id !== id);
      localStorage.setItem('omnistudy_voice_memos_meta', JSON.stringify(voiceMemos));
      renderVoiceMemosList();
    });
  });
}
