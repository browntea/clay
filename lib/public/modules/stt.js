// Speech-to-Text module using whisper.cpp WASM
// Real-time dictation with chunk + tail buffer approach
// Runs whisper on main thread (ggml.ai build requires main thread context)

import { iconHtml, refreshIcons } from './icons.js';
import { autoResize } from './input.js';

var ctx;

// Served locally — pthreads worker (main.worker.js) must be same-origin
var WHISPER_JS_URL = null; // set in initSTT from ctx.basePath

var MODEL_URLS = {
  'tiny-q5_1': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin',
  'tiny.en-q5_1': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin',
  'tiny': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  'tiny.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
};

var MODEL_SIZES = {
  'tiny-q5_1': 31,
  'tiny.en-q5_1': 31,
  'tiny': 75,
  'tiny.en': 75,
};

// --- State ---
var recording = false;
var whisperReady = false;
var whisperInstance = null;
var audioContext = null;
var workletNode = null;
var sourceNode = null;
var silentGain = null;
var mediaStream = null;
var selectedLang = null;
var initializing = false;
var micRequesting = false;

// Audio processing
var sampleQueue = [];
var tailBuffer = new Float32Array(0);
var confirmedText = "";
var processing = false;
var processTimer = null;
var printBuffer = [];

var CHUNK_INTERVAL_MS = 2500;
var TAIL_SEC = 1;
var SAMPLE_RATE = 16000;
var MIN_CHUNK_SEC = 0.5;

// DOM refs
var sttBtn = null;
var langPopover = null;
var progressEl = null;

// --- Language options ---
var LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ko', name: 'Korean' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'auto', name: 'Auto-detect' },
];

// --- Persist language choice ---
function saveLang(code) {
  try { localStorage.setItem('stt-lang', code); } catch (e) { /* ignore */ }
}

function loadLang() {
  try { return localStorage.getItem('stt-lang'); } catch (e) { return null; }
}

// --- IndexedDB cache ---
function openDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('whisper-stt-cache', 1);
    req.onupgradeneeded = function() {
      req.result.createObjectStore('files');
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

function getCached(db, key) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction('files', 'readonly');
    var req = tx.objectStore('files').get(key);
    req.onsuccess = function() { resolve(req.result || null); };
    req.onerror = function() { reject(req.error); };
  });
}

function putCached(db, key, value) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction('files', 'readwrite');
    var req = tx.objectStore('files').put(value, key);
    req.onsuccess = function() { resolve(); };
    req.onerror = function() { reject(req.error); };
  });
}

// --- Download with progress ---
function downloadWithProgress(url, label) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onprogress = function(e) {
      if (e.lengthComputable) {
        updateProgress(label, e.loaded, e.total);
      }
    };
    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        reject(new Error('Download failed: HTTP ' + xhr.status));
      }
    };
    xhr.onerror = function() { reject(new Error('Download failed: network error')); };
    xhr.send();
  });
}

// --- Init ---
export function initSTT(_ctx) {
  ctx = _ctx;
  WHISPER_JS_URL = ctx.basePath + 'whisper/main.js';

  sttBtn = document.getElementById('stt-btn');
  if (!sttBtn) return;

  // Restore saved language
  selectedLang = loadLang();

  sttBtn.addEventListener('click', function(e) {
    e.stopPropagation();

    if (initializing || micRequesting) return;

    if (recording) {
      stopRecording();
      return;
    }

    if (whisperReady) {
      acquireMic().then(function() {
        startRecording();
      }).catch(function() { /* error already shown */ });
      return;
    }

    // First use or language not selected
    if (!selectedLang) {
      showLangPopover();
    } else {
      acquireMic().then(function() {
        initWhisper();
      }).catch(function() { /* error already shown */ });
    }
  });

  // Right-click to change language
  sttBtn.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (recording) stopRecording();
    showLangPopover();
  });
}

// --- Language popover ---
function showLangPopover() {
  if (langPopover) {
    hideLangPopover();
    return;
  }

  langPopover = document.createElement('div');
  langPopover.className = 'stt-lang-popover';

  var html = '<div class="stt-lang-title">Voice Input Language</div>';
  for (var i = 0; i < LANGUAGES.length; i++) {
    var l = LANGUAGES[i];
    var activeClass = (selectedLang === l.code) ? ' stt-lang-active' : '';
    html += '<button class="stt-lang-option' + activeClass + '" data-lang="' + l.code + '">' +
      '<span class="stt-lang-name">' + l.name + '</span>' +
      (l.code === 'en' ? '<span class="stt-lang-hint">Best quality</span>' : '') +
      '</button>';
  }
  langPopover.innerHTML = html;

  langPopover.querySelectorAll('.stt-lang-option').forEach(function(btn) {
    btn.addEventListener('click', function() {
      onLangSelected(btn.dataset.lang);
    });
  });

  var wrapper = document.getElementById('input-wrapper');
  wrapper.appendChild(langPopover);

  setTimeout(function() {
    document.addEventListener('click', closeLangOnOutside);
  }, 0);
}

function closeLangOnOutside(e) {
  if (langPopover && !langPopover.contains(e.target) && e.target !== sttBtn && !sttBtn.contains(e.target)) {
    hideLangPopover();
  }
}

function hideLangPopover() {
  if (langPopover) {
    langPopover.remove();
    langPopover = null;
  }
  document.removeEventListener('click', closeLangOnOutside);
}

function onLangSelected(code) {
  selectedLang = code;
  saveLang(code);
  hideLangPopover();

  if (whisperReady) {
    acquireMic().then(function() {
      startRecording();
    }).catch(function() { /* error already shown */ });
    return;
  }

  acquireMic().then(function() {
    initWhisper();
  }).catch(function() { /* error already shown */ });
}

// --- Acquire microphone during user gesture ---
function acquireMic() {
  if (mediaStream) return Promise.resolve();
  if (micRequesting) return Promise.reject(new Error('already requesting'));

  micRequesting = true;
  return navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
    mediaStream = stream;
    micRequesting = false;
  }).catch(function(err) {
    micRequesting = false;
    console.error('[STT] Microphone error:', err);
    if (ctx.addSystemMessage) {
      var hint = '';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        hint = '\n\nTo fix: click the lock icon (or tune icon) in the address bar → Site settings → Microphone → Allow, then reload.';
      } else if (err.name === 'NotFoundError') {
        hint = '\n\nNo microphone detected. Please connect a microphone and try again.';
      } else if (err.name === 'NotReadableError') {
        hint = '\n\nMicrophone is in use by another app. Close it and try again.';
      }
      ctx.addSystemMessage('Microphone access denied.' + hint, true);
    }
    throw err;
  });
}

// --- Load whisper.cpp WASM via script tag (main thread) ---
function loadWhisperScript() {
  return new Promise(function(resolve, reject) {
    // Already loaded
    if (window.Module && window.Module.init) {
      resolve();
      return;
    }

    // Set up Module before script loads (match official demo setup)
    // No locateFile needed — main.js, main.worker.js are same-origin
    window.Module = {
      print: function(text) {
        printBuffer.push(text);
      },
      printErr: function(text) {
        console.log('[whisper]', text);
      },
      setStatus: function() {},
      monitorRunDependencies: function() {}
    };

    updateStatus('Loading Whisper engine...');

    var script = document.createElement('script');
    script.src = WHISPER_JS_URL;

    script.onload = function() {
      // Wait for Emscripten runtime
      var attempts = 0;
      var timer = setInterval(function() {
        attempts++;
        if (window.Module.calledRun || (window.Module.init && typeof window.Module.init === 'function')) {
          clearInterval(timer);
          resolve();
        } else if (attempts > 100) {
          clearInterval(timer);
          reject(new Error('Whisper WASM initialization timed out'));
        }
      }, 100);
    };

    script.onerror = function() {
      reject(new Error('Failed to load Whisper WASM script'));
    };

    document.head.appendChild(script);
  });
}

// --- Load model into WASM filesystem ---
function loadWhisperModel(modelName) {
  return openDB().then(function(db) {
    var cacheKey = 'model-' + modelName;
    return getCached(db, cacheKey).then(function(cached) {
      if (cached) {
        updateStatus('Loading cached model...');
        return cached;
      }

      var url = MODEL_URLS[modelName];
      if (!url) throw new Error('Unknown model: ' + modelName);

      var sizeMb = MODEL_SIZES[modelName] || '?';
      updateStatus('Downloading model (~' + sizeMb + ' MB)...');

      return downloadWithProgress(url, modelName + ' model').then(function(data) {
        return putCached(db, cacheKey, data).then(function() {
          return data;
        });
      });
    });
  }).then(function(modelData) {
    updateStatus('Initializing model...');

    var M = window.Module;
    var buf = new Uint8Array(modelData);

    try { M.FS_unlink('whisper.bin'); } catch (e) { /* ignore */ }
    M.FS_createDataFile('/', 'whisper.bin', buf, true, true);

    whisperInstance = M.init('whisper.bin');
    console.log('[STT] whisper instance:', whisperInstance);
    if (!whisperInstance) throw new Error('Failed to initialize Whisper model');
  });
}

// --- Whisper initialization ---
function initWhisper() {
  if (initializing) return;
  initializing = true;

  sttBtn.classList.add('stt-loading');
  sttBtn.innerHTML = '<span class="stt-spinner"></span>';

  var model = (selectedLang === 'en') ? 'tiny.en-q5_1' : 'tiny-q5_1';

  showProgress();

  loadWhisperScript().then(function() {
    return loadWhisperModel(model);
  }).then(function() {
    whisperReady = true;
    initializing = false;
    sttBtn.classList.remove('stt-loading');
    sttBtn.innerHTML = iconHtml('mic');
    refreshIcons();
    hideProgress();
    startRecording();
  }).catch(function(err) {
    console.error('[STT] Init error:', err);
    initializing = false;
    sttBtn.classList.remove('stt-loading');
    sttBtn.innerHTML = iconHtml('mic');
    refreshIcons();
    hideProgress();
    if (ctx.addSystemMessage) {
      ctx.addSystemMessage('Voice input error: ' + err.message, true);
    }
  });
}

// --- Progress UI ---
function showProgress() {
  if (progressEl) return;
  progressEl = document.createElement('div');
  progressEl.className = 'stt-progress';
  progressEl.innerHTML =
    '<div class="stt-progress-label">Preparing voice input...</div>' +
    '<div class="stt-progress-bar"><div class="stt-progress-fill"></div></div>';

  var wrapper = document.getElementById('input-wrapper');
  wrapper.appendChild(progressEl);
}

function updateProgress(label, loaded, total) {
  if (!progressEl) return;
  var pct = Math.round((loaded / total) * 100);
  var mb = (loaded / 1048576).toFixed(1);
  var totalMb = (total / 1048576).toFixed(1);
  progressEl.querySelector('.stt-progress-label').textContent =
    'Downloading ' + label + '... ' + mb + ' / ' + totalMb + ' MB';
  progressEl.querySelector('.stt-progress-fill').style.width = pct + '%';
}

function updateStatus(text) {
  if (!progressEl) return;
  progressEl.querySelector('.stt-progress-label').textContent = text;
}

function hideProgress() {
  if (progressEl) {
    progressEl.remove();
    progressEl = null;
  }
}

// --- Parse timestamp output ---
function parseTimestamp(str) {
  var m = str.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if (!m) return 0;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 1000;
}

function parseSegments(lines) {
  var segments = [];
  var re = /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/;

  for (var i = 0; i < lines.length; i++) {
    var match = lines[i].match(re);
    if (match) {
      var text = match[3].trim();
      if (text) {
        segments.push({
          start: parseTimestamp(match[1]),
          end: parseTimestamp(match[2]),
          text: text
        });
      }
    }
  }
  return segments;
}

// --- Recording ---
function startRecording() {
  if (recording) return;

  var streamReady = mediaStream
    ? Promise.resolve()
    : navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
        mediaStream = stream;
      });

  streamReady.then(function() {
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

    return audioContext.audioWorklet.addModule(ctx.basePath + 'workers/stt-processor.js');
  }).then(function() {
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'stt-processor');

    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    workletNode.port.onmessage = function(e) {
      if (recording) {
        sampleQueue.push(new Float32Array(e.data.samples));
      }
    };

    sourceNode.connect(workletNode);
    workletNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    sampleQueue = [];
    tailBuffer = new Float32Array(0);
    confirmedText = ctx.inputEl.value;
    processing = false;

    processTimer = setInterval(function() {
      processChunk(false);
    }, CHUNK_INTERVAL_MS);

    recording = true;
    sttBtn.classList.add('stt-active');
    sttBtn.innerHTML = iconHtml('mic-off');
    refreshIcons();
    ctx.inputEl.setAttribute('placeholder', 'Listening...');
  }).catch(function(err) {
    console.error('[STT] Recording error:', err);
    cleanupAudio();
    if (ctx.addSystemMessage) {
      ctx.addSystemMessage('Failed to start voice input: ' + err.message, true);
    }
  });
}

function stopRecording() {
  if (!recording) return;
  recording = false;

  if (processTimer) {
    clearInterval(processTimer);
    processTimer = null;
  }

  // Process remaining audio (final chunk)
  if (sampleQueue.length > 0 && !processing) {
    processChunk(true);
  }

  cleanupAudio();

  sttBtn.classList.remove('stt-active');
  sttBtn.innerHTML = iconHtml('mic');
  refreshIcons();
  ctx.inputEl.setAttribute('placeholder', 'Message Claude Code...');
}

function cleanupAudio() {
  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (silentGain) {
    silentGain.disconnect();
    silentGain = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(function(t) { t.stop(); });
    mediaStream = null;
  }
}

// --- Chunk processing (runs whisper on main thread) ---
function processChunk(final) {
  if (processing) return;

  var totalLength = tailBuffer.length;
  for (var i = 0; i < sampleQueue.length; i++) {
    totalLength += sampleQueue[i].length;
  }

  if (totalLength < SAMPLE_RATE * MIN_CHUNK_SEC) {
    if (final) {
      sampleQueue = [];
      tailBuffer = new Float32Array(0);
    }
    return;
  }

  var merged = new Float32Array(totalLength);
  var offset = 0;

  if (tailBuffer.length > 0) {
    merged.set(tailBuffer, 0);
    offset += tailBuffer.length;
  }

  for (var i = 0; i < sampleQueue.length; i++) {
    merged.set(sampleQueue[i], offset);
    offset += sampleQueue[i].length;
  }
  sampleQueue = [];

  var tailSamples = final ? 0 : Math.min(TAIL_SEC * SAMPLE_RATE, Math.floor(merged.length * 0.3));
  if (tailSamples > 0) {
    tailBuffer = merged.slice(merged.length - tailSamples);
  } else {
    tailBuffer = new Float32Array(0);
  }

  processing = true;

  var lang = selectedLang;
  if (lang === 'auto') lang = '';

  // Run whisper inference on main thread
  var M = window.Module;
  printBuffer = [];

  try {
    var nthreads = Math.min(navigator.hardwareConcurrency || 4, 8);
    M.full_default(whisperInstance, merged, lang || 'en', nthreads, false);
  } catch (err) {
    console.error('[STT] Transcription failed:', err);
    processing = false;
    if (recording) stopRecording();
    if (ctx.addSystemMessage) {
      ctx.addSystemMessage('Voice input error: ' + err.message, true);
    }
    return;
  }

  var segments = parseSegments(printBuffer);
  var totalDuration = merged.length / 16000;
  var tailDuration = final ? 0 : (tailSamples / SAMPLE_RATE);

  processing = false;
  onTranscriptionResult(segments, totalDuration, tailDuration);
}

// --- Handle transcription result ---
function onTranscriptionResult(segments, totalDuration, tailDuration) {
  if (!segments || segments.length === 0) return;

  var cutoff = totalDuration - tailDuration;

  var confirmedNew = '';
  var tentative = '';

  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    if (tailDuration === 0 || seg.end <= cutoff) {
      confirmedNew += seg.text;
    } else {
      tentative += seg.text;
    }
  }

  if (confirmedNew && confirmedText && confirmedText.length > 0) {
    var lastChar = confirmedText[confirmedText.length - 1];
    if (lastChar !== ' ' && lastChar !== '\n') {
      confirmedNew = ' ' + confirmedNew;
    }
  }

  confirmedText += confirmedNew;

  var fullText = confirmedText;
  if (tentative) {
    if (fullText && fullText.length > 0) {
      var lc = fullText[fullText.length - 1];
      if (lc !== ' ' && lc !== '\n') {
        fullText += ' ';
      }
    }
    fullText += tentative;
  }

  ctx.inputEl.value = fullText;
  autoResize();
}

// --- Exports ---
export function isSTTRecording() {
  return recording;
}

export function isSTTInitializing() {
  return initializing;
}
