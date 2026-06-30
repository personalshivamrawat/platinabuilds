// --- Application State & Constants ---
let currentMode = 'work'; // 'work', 'short', 'long'
let timerState = 'idle'; // 'idle', 'running', 'paused'
let timeRemaining = 0; // in seconds
let totalDuration = 0; // in seconds (for current session)
let timerIntervalId = null;
let targetTimestamp = null; // target Date.now() timestamp when timer completes

// Audio Context (initialized on first user interaction)
let audioCtx = null;

// Settings Default Structure
const DEFAULT_SETTINGS = {
  workTime: 25,
  shortTime: 5,
  longTime: 15,
  autoBreak: false,
  autoWork: false,
  playTicking: false,
  soundVolume: 50
};
let settings = { ...DEFAULT_SETTINGS };

// Tasks & Stats Data
let tasks = [];
let activeTaskId = null;
let stats = {
  totalPomodoros: 0,
  totalMinutes: 0,
  streakDays: 0,
  lastCompletedDate: null // 'YYYY-MM-DD'
};

// UI Cache
const elements = {
  timerTime: document.getElementById('timer-time'),
  timerStatus: document.getElementById('timer-status-text'),
  timerProgress: document.getElementById('timer-progress'),
  timerCard: document.getElementById('timer-card'),
  activeIndicator: document.getElementById('active-indicator'),
  btnPlayPause: document.getElementById('btn-play-pause'),
  playIcon: document.getElementById('play-icon'),
  pauseIcon: document.getElementById('pause-icon'),
  btnReset: document.getElementById('btn-reset'),
  btnSkip: document.getElementById('btn-skip'),
  currentTaskName: document.getElementById('current-task-name'),
  
  // Tabs
  tabWork: document.getElementById('tab-work'),
  tabShort: document.getElementById('tab-short'),
  tabLong: document.getElementById('tab-long'),
  tabButtons: document.querySelectorAll('.tab-btn'),
  
  // Settings Trigger & Modal
  settingsTrigger: document.getElementById('settings-trigger'),
  settingsModal: document.getElementById('settings-modal'),
  settingsClose: document.getElementById('settings-close'),
  inputWork: document.getElementById('input-work'),
  inputShort: document.getElementById('input-short'),
  inputLong: document.getElementById('input-long'),
  toggleAutoBreak: document.getElementById('toggle-auto-break'),
  toggleAutoWork: document.getElementById('toggle-auto-work'),
  toggleTicking: document.getElementById('toggle-ticking'),
  sliderVolume: document.getElementById('slider-volume'),
  volumeDisplay: document.getElementById('volume-display'),
  btnSettingsReset: document.getElementById('btn-settings-reset'),
  btnSettingsSave: document.getElementById('btn-settings-save'),
  
  // Tasks
  taskForm: document.getElementById('add-task-form'),
  taskInput: document.getElementById('task-input'),
  taskList: document.getElementById('task-list'),
  taskStatsText: document.getElementById('task-stats'),
  
  // Stats Footer
  statsPomodoros: document.getElementById('stats-total-pomodoros'),
  statsMinutes: document.getElementById('stats-total-minutes'),
  statsStreak: document.getElementById('stats-daily-streak')
};

// Mode Design Tokens (accent colors and glowing values)
const MODE_STYLES = {
  work: {
    color: '#ff5c5c',
    glow: 'rgba(255, 92, 92, 0.15)',
    status: 'Time to focus'
  },
  short: {
    color: '#0bd3a0',
    glow: 'rgba(11, 211, 160, 0.15)',
    status: 'Short break'
  },
  long: {
    color: '#925cff',
    glow: 'rgba(146, 92, 255, 0.15)',
    status: 'Long break'
  }
};

let progressCircumference = 0;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupEventListeners();
  updateCircumference();
  setMode(currentMode, false);
  renderTasks();
  updateStatsUI();
});

// Calculate SVG progress ring circumference dynamically
function updateCircumference() {
  const radius = elements.timerProgress.r.baseVal.value;
  progressCircumference = 2 * Math.PI * radius;
  elements.timerProgress.style.strokeDasharray = `${progressCircumference} ${progressCircumference}`;
  updateProgressRing();
}

// Window resize updates the progress ring circumference
window.addEventListener('resize', () => {
  // Let DOM resize first
  setTimeout(updateCircumference, 50);
});

// --- Audio Engine (Web Audio API Synthesizer) ---
function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.error('Web Audio API not supported', e);
  }
}

// Play pleasant chimes / synthesized tones
function playTone(frequency, type, startTime, duration, volume) {
  if (!audioCtx) return;
  
  // Make sure AudioContext is running (needed due to browser autoplay policies)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);
  
  // Smooth envelope to prevent audio popping
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.03);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playCompletionChime() {
  initAudio();
  if (!audioCtx || settings.soundVolume === 0) return;
  
  const vol = settings.soundVolume / 100;
  const now = audioCtx.currentTime;
  
  // Mode-based sound signature
  if (currentMode === 'work') {
    // Elegant descending-ascending motif
    playTone(523.25, 'sine', now, 0.4, vol * 0.5); // C5
    playTone(659.25, 'sine', now + 0.15, 0.4, vol * 0.5); // E5
    playTone(783.99, 'sine', now + 0.3, 0.6, vol * 0.6); // G5
  } else {
    // Gentle ascending break chime
    playTone(587.33, 'triangle', now, 0.35, vol * 0.4); // D5
    playTone(698.46, 'triangle', now + 0.12, 0.35, vol * 0.4); // F5
    playTone(880.00, 'sine', now + 0.24, 0.5, vol * 0.5); // A5
  }
}

function playTickSound() {
  initAudio();
  if (!audioCtx || !settings.playTicking || settings.soundVolume === 0) return;
  
  const vol = (settings.soundVolume / 100) * 0.05; // extremely soft tick
  const now = audioCtx.currentTime;
  
  // Super short frequency burst (transient analog click simulator)
  playTone(1800, 'triangle', now, 0.015, vol);
}

// --- Data Persistence ---
function loadData() {
  // Load settings
  const storedSettings = localStorage.getItem('focusflow_settings');
  if (storedSettings) {
    try {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) };
    } catch (e) {
      settings = { ...DEFAULT_SETTINGS };
    }
  }
  
  // Load tasks
  const storedTasks = localStorage.getItem('focusflow_tasks');
  if (storedTasks) {
    try {
      tasks = JSON.parse(storedTasks);
    } catch (e) {
      tasks = [];
    }
  }
  
  // Load active task ID
  activeTaskId = localStorage.getItem('focusflow_active_task_id');
  
  // Load stats
  const storedStats = localStorage.getItem('focusflow_stats');
  if (storedStats) {
    try {
      stats = { ...stats, ...JSON.parse(storedStats) };
    } catch (e) {
      // keep default stats
    }
  }
}

function saveData() {
  localStorage.setItem('focusflow_settings', JSON.stringify(settings));
  localStorage.setItem('focusflow_tasks', JSON.stringify(tasks));
  if (activeTaskId) {
    localStorage.setItem('focusflow_active_task_id', activeTaskId);
  } else {
    localStorage.removeItem('focusflow_active_task_id');
  }
  localStorage.setItem('focusflow_stats', JSON.stringify(stats));
}

// --- Core Timer Logic ---
function setMode(mode, stopTimer = true) {
  if (stopTimer) {
    pauseTimer();
  }
  
  currentMode = mode;
  
  // Update design tokens
  const tokens = MODE_STYLES[mode];
  document.documentElement.style.setProperty('--accent-color', tokens.color);
  document.documentElement.style.setProperty('--accent-glow', tokens.glow);
  
  elements.timerStatus.textContent = tokens.status;
  
  // Toggle tab buttons
  elements.tabButtons.forEach(btn => {
    if (btn.dataset.mode === mode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Slide capsule indicator
  const activeTab = document.getElementById(`tab-${mode}`);
  if (activeTab) {
    elements.activeIndicator.style.left = `${activeTab.offsetLeft}px`;
    elements.activeIndicator.style.width = `${activeTab.offsetWidth}px`;
  }
  
  // Determine duration
  let mins = settings.workTime;
  if (mode === 'short') mins = settings.shortTime;
  if (mode === 'long') mins = settings.longTime;
  
  totalDuration = mins * 60;
  timeRemaining = totalDuration;
  
  updateTimerUI();
  updateProgressRing();
}

function startTimer() {
  initAudio();
  if (timerState === 'running') return;
  
  timerState = 'running';
  targetTimestamp = Date.now() + timeRemaining * 1000;
  
  // Toggle playback UI icons
  elements.playIcon.classList.add('hidden');
  elements.pauseIcon.classList.remove('hidden');
  
  timerIntervalId = setInterval(tick, 200); // Poll frequently to avoid timestamp delays
  tick(); // execute immediately
}

function pauseTimer() {
  if (timerState !== 'running') return;
  
  timerState = 'paused';
  clearInterval(timerIntervalId);
  timerIntervalId = null;
  
  // Calculate remaining seconds exactly
  timeRemaining = Math.max(0, Math.ceil((targetTimestamp - Date.now()) / 1000));
  
  elements.playIcon.classList.remove('hidden');
  elements.pauseIcon.classList.add('hidden');
}

function resetTimer() {
  pauseTimer();
  timerState = 'idle';
  
  let mins = settings.workTime;
  if (currentMode === 'short') mins = settings.shortTime;
  if (currentMode === 'long') mins = settings.longTime;
  
  totalDuration = mins * 60;
  timeRemaining = totalDuration;
  
  updateTimerUI();
  updateProgressRing();
}

function skipSession() {
  // Cycle session modes
  let nextMode = 'work';
  if (currentMode === 'work') {
    // Focus complete: cycle to Short or Long Break (traditional pomodoro is long break every 4 sessions)
    nextMode = (stats.totalPomodoros > 0 && stats.totalPomodoros % 4 === 0) ? 'long' : 'short';
  } else {
    // Break complete: back to Focus
    nextMode = 'work';
  }
  
  setMode(nextMode, true);
  
  // Determine auto-start behavior
  if (nextMode === 'work' && settings.autoWork) {
    startTimer();
  } else if (nextMode !== 'work' && settings.autoBreak) {
    startTimer();
  }
}

function tick() {
  const currentTimestamp = Date.now();
  const diff = targetTimestamp - currentTimestamp;
  
  if (diff <= 0) {
    timeRemaining = 0;
    updateTimerUI();
    updateProgressRing();
    handleSessionCompletion();
    return;
  }
  
  const previousSecond = timeRemaining;
  timeRemaining = Math.ceil(diff / 1000);
  
  // Perform actions on second boundary
  if (previousSecond !== timeRemaining) {
    updateTimerUI();
    updateProgressRing();
    playTickSound();
  }
}

function handleSessionCompletion() {
  pauseTimer();
  playCompletionChime();
  
  if (currentMode === 'work') {
    // Focus session completed successfully
    stats.totalPomodoros += 1;
    stats.totalMinutes += settings.workTime;
    
    // Auto increment active task completed count
    if (activeTaskId) {
      const taskIndex = tasks.findIndex(t => t.id === activeTaskId);
      if (taskIndex !== -1 && !tasks[taskIndex].completed) {
        tasks[taskIndex].completedPomodoros += 1;
        renderTasks();
      }
    }
    
    // Update daily streak
    updateStreak();
    saveData();
    updateStatsUI();
  }
  
  // Wait brief period to let sound play, then skip mode
  setTimeout(() => {
    skipSession();
  }, 1000);
}

function updateStreak() {
  const todayStr = getLocalDateString();
  const yesterdayStr = getLocalDateString(-1);
  
  if (stats.lastCompletedDate === yesterdayStr) {
    stats.streakDays += 1;
  } else if (stats.lastCompletedDate !== todayStr) {
    stats.streakDays = 1; // start new streak
  }
  
  stats.lastCompletedDate = todayStr;
}

function getLocalDateString(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// --- UI Updates ---
function updateTimerUI() {
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  elements.timerTime.textContent = timeStr;
  
  // Browser title updates
  const emoji = currentMode === 'work' ? '🎯' : '☕';
  const modeLabel = currentMode === 'work' ? 'Focus' : 'Break';
  document.title = `${timeStr} | ${emoji} ${modeLabel}`;
}

function updateProgressRing() {
  if (totalDuration <= 0) return;
  const percent = timeRemaining / totalDuration;
  const offset = progressCircumference * (1 - percent);
  elements.timerProgress.style.strokeDashoffset = offset;
}

function updateStatsUI() {
  elements.statsPomodoros.textContent = stats.totalPomodoros;
  elements.statsMinutes.textContent = stats.totalMinutes;
  elements.statsStreak.textContent = stats.streakDays;
}

// --- Task Manager Logic ---
function addTask(title) {
  const newTask = {
    id: Date.now().toString(),
    title: title.trim(),
    completed: false,
    completedPomodoros: 0
  };
  
  tasks.push(newTask);
  
  // Set as active focus task if none selected
  if (!activeTaskId) {
    selectActiveTask(newTask.id);
  }
  
  saveData();
  renderTasks();
}

function selectActiveTask(id) {
  activeTaskId = id;
  const task = tasks.find(t => t.id === id);
  
  if (task) {
    elements.currentTaskName.textContent = task.title;
    elements.currentTaskName.classList.remove('completed-text');
  } else {
    activeTaskId = null;
    elements.currentTaskName.textContent = 'No active task selected';
  }
  
  saveData();
  renderTasks();
}

function toggleTaskComplete(id, event) {
  event.stopPropagation(); // Avoid selecting task when checking off
  
  const taskIndex = tasks.findIndex(t => t.id === id);
  if (taskIndex === -1) return;
  
  tasks[taskIndex].completed = !tasks[taskIndex].completed;
  
  // If active task was completed, update display
  if (id === activeTaskId) {
    if (tasks[taskIndex].completed) {
      elements.currentTaskName.classList.add('completed-text');
      // Look for next uncompleted task
      const nextUncompleted = tasks.find(t => !t.completed);
      if (nextUncompleted) {
        selectActiveTask(nextUncompleted.id);
      } else {
        selectActiveTask(null);
      }
    } else {
      selectActiveTask(id);
    }
  }
  
  saveData();
  renderTasks();
}

function deleteTask(id, event) {
  event.stopPropagation(); // Prevent selection trigger
  
  tasks = tasks.filter(t => t.id !== id);
  
  if (id === activeTaskId) {
    activeTaskId = null;
    const nextUncompleted = tasks.find(t => !t.completed);
    selectActiveTask(nextUncompleted ? nextUncompleted.id : null);
  }
  
  saveData();
  renderTasks();
}

function renderTasks() {
  elements.taskList.innerHTML = '';
  
  const completedCount = tasks.filter(t => t.completed).length;
  elements.taskStatsText.textContent = `${completedCount} of ${tasks.length} completed`;
  
  tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = `task-item ${task.completed ? 'completed' : ''} ${task.id === activeTaskId ? 'active' : ''}`;
    li.dataset.id = task.id;
    li.addEventListener('click', () => {
      if (!task.completed) {
        selectActiveTask(task.id);
      }
    });
    
    li.innerHTML = `
      <div class="task-left">
        <button class="checkbox-btn" aria-label="Toggle Complete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
        <span class="task-title" title="${task.title}">${task.title}</span>
      </div>
      <div class="task-right">
        <div class="pomodoro-counter" title="Completed Pomodoros on this task">
          <span>🍅</span>
          <span>${task.completedPomodoros}</span>
        </div>
        <button class="delete-task-btn" aria-label="Delete Task">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
    
    // Bind task-specific interactions
    li.querySelector('.checkbox-btn').addEventListener('click', (e) => toggleTaskComplete(task.id, e));
    li.querySelector('.delete-task-btn').addEventListener('click', (e) => deleteTask(task.id, e));
    
    // Manual click on tomato counter triggers a manual increment
    li.querySelector('.pomodoro-counter').addEventListener('click', (e) => {
      e.stopPropagation();
      task.completedPomodoros += 1;
      saveData();
      renderTasks();
    });
    
    elements.taskList.appendChild(li);
  });
}

// --- Settings Modal Actions ---
function openSettings() {
  initAudio();
  elements.inputWork.value = settings.workTime;
  elements.inputShort.value = settings.shortTime;
  elements.inputLong.value = settings.longTime;
  elements.toggleAutoBreak.checked = settings.autoBreak;
  elements.toggleAutoWork.checked = settings.autoWork;
  elements.toggleTicking.checked = settings.playTicking;
  elements.sliderVolume.value = settings.soundVolume;
  elements.volumeDisplay.textContent = `${settings.soundVolume}%`;
  
  elements.settingsModal.classList.add('open');
}

function closeSettings() {
  elements.settingsModal.classList.remove('open');
}

function saveSettings() {
  // Validate and read input times
  const workMins = parseInt(elements.inputWork.value) || DEFAULT_SETTINGS.workTime;
  const shortMins = parseInt(elements.inputShort.value) || DEFAULT_SETTINGS.shortTime;
  const longMins = parseInt(elements.inputLong.value) || DEFAULT_SETTINGS.longTime;
  
  settings.workTime = Math.min(180, Math.max(1, workMins));
  settings.shortTime = Math.min(60, Math.max(1, shortMins));
  settings.longTime = Math.min(120, Math.max(1, longMins));
  
  settings.autoBreak = elements.toggleAutoBreak.checked;
  settings.autoWork = elements.toggleAutoWork.checked;
  settings.playTicking = elements.toggleTicking.checked;
  settings.soundVolume = parseInt(elements.sliderVolume.value);
  
  saveData();
  closeSettings();
  
  // Re-apply settings to current mode duration
  resetTimer();
}

function resetSettingsToDefault() {
  elements.inputWork.value = DEFAULT_SETTINGS.workTime;
  elements.inputShort.value = DEFAULT_SETTINGS.shortTime;
  elements.inputLong.value = DEFAULT_SETTINGS.longTime;
  elements.toggleAutoBreak.checked = DEFAULT_SETTINGS.autoBreak;
  elements.toggleAutoWork.checked = DEFAULT_SETTINGS.autoWork;
  elements.toggleTicking.checked = DEFAULT_SETTINGS.playTicking;
  elements.sliderVolume.value = DEFAULT_SETTINGS.soundVolume;
  elements.volumeDisplay.textContent = `${DEFAULT_SETTINGS.soundVolume}%`;
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Play/Pause Playback Toggle
  elements.btnPlayPause.addEventListener('click', () => {
    if (timerState === 'running') {
      pauseTimer();
    } else {
      startTimer();
    }
  });
  
  // Reset Timer Button
  elements.btnReset.addEventListener('click', resetTimer);
  
  // Skip Mode Button
  elements.btnSkip.addEventListener('click', skipSession);
  
  // Tabs Modes Clicks
  elements.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode !== currentMode) {
        setMode(mode, true);
      }
    });
  });
  
  // Settings Trigger
  elements.settingsTrigger.addEventListener('click', openSettings);
  elements.settingsClose.addEventListener('click', closeSettings);
  
  // Clicking outside modal content closes the modal
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      closeSettings();
    }
  });
  
  // Modal Buttons
  elements.btnSettingsSave.addEventListener('click', saveSettings);
  elements.btnSettingsReset.addEventListener('click', resetSettingsToDefault);
  
  // Volume slider dynamic display label update
  elements.sliderVolume.addEventListener('input', (e) => {
    elements.volumeDisplay.textContent = `${e.target.value}%`;
  });
  
  // Task form submission
  elements.taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = elements.taskInput.value;
    if (title.trim()) {
      addTask(title);
      elements.taskInput.value = '';
    }
  });
}
