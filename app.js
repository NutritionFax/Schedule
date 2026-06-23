const STORAGE_KEY = "daily-activities-state-v1";
const DEFAULT_RESET_TIME = "00:00";

const $ = (selector, root = document) => root.querySelector(selector);
const todayKey = () => getDayKey(new Date(), state.settings.resetTime);
const makeId = () => {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
};

const state = loadState();
ensureToday();
let rolloverTimer = null;
let countdownTimer = null;
const draftSubtasks = [];

const elements = {
  todayLabel: $("#todayLabel"),
  activityForm: $("#activityForm"),
  activityTitle: $("#activityTitle"),
  activityLink: $("#activityLink"),
  initialSubtaskInput: $("#initialSubtaskInput"),
  addInitialSubtask: $("#addInitialSubtask"),
  initialSubtaskList: $("#initialSubtaskList"),
  activityRepeats: $("#activityRepeats"),
  activityList: $("#activityList"),
  template: $("#activityTemplate"),
  progressTitle: $("#progressTitle"),
  progressRing: $("#progressRing"),
  progressBar: $("#progressBar"),
  homeCurrentStreak: $("#homeCurrentStreak"),
  homeBestStreak: $("#homeBestStreak"),
  resetCountdown: $("#resetCountdown"),
  streakNote: $("#streakNote"),
  dailyNote: $("#dailyNote"),
  dashboardPanel: $(".dashboard-panel"),
  resetTime: $("#resetTime"),
  resetNote: $("#resetNote"),
  analyticsActivity: $("#analyticsActivity"),
  analyticsRange: $("#analyticsRange"),
  totalCompletions: $("#totalCompletions"),
  bestStreak: $("#bestStreak"),
  currentStreak: $("#currentStreak"),
  chart: $("#completionChart")
};

document.addEventListener("click", handleGlobalClick);
elements.activityForm.addEventListener("submit", addActivity);
elements.addInitialSubtask.addEventListener("click", addDraftSubtask);
elements.initialSubtaskInput.addEventListener("keydown", handleDraftSubtaskKeydown);
elements.resetTime.addEventListener("change", updateResetTime);
elements.analyticsActivity.addEventListener("change", renderAnalytics);
elements.analyticsRange.addEventListener("change", renderAnalytics);
document.addEventListener("visibilitychange", refreshForCurrentDay);
window.addEventListener("focus", refreshForCurrentDay);

render();
scheduleNextRollover();
startResetCountdown();

function loadState() {
  const fallback = {
    lastOpenedDate: getDayKey(new Date(), DEFAULT_RESET_TIME),
    activities: [],
    activityLabels: {},
    settings: {
      resetTime: DEFAULT_RESET_TIME
    },
    history: {}
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    const settings = { ...fallback.settings, ...(saved.settings || {}) };
    return {
      ...fallback,
      ...saved,
      activityLabels: { ...fallback.activityLabels, ...(saved.activityLabels || {}) },
      settings,
      lastOpenedDate: saved.lastOpenedDate || getDayKey(new Date(), settings.resetTime)
    };
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureToday() {
  const today = todayKey();
  if (state.lastOpenedDate === today) return;

  state.lastOpenedDate = today;
  state.activities = state.activities
    .filter((activity) => activity.repeats)
    .map((activity) => ({
      ...activity,
      completedDates: activity.completedDates || [],
      tasks: activity.tasks.map((task) => ({ ...task, done: false }))
    }));

  saveState();
}

function addActivity(event) {
  event.preventDefault();

  const title = elements.activityTitle.value.trim();
  if (!title) return;
  const id = makeId();

  const tasks = getDraftSubtaskTitles()
    .map((title) => ({ id: makeId(), title, done: false }));

  state.activities.unshift({
    id,
    title,
    link: elements.activityLink.value.trim(),
    repeats: elements.activityRepeats.checked,
    createdDate: todayKey(),
    completedDates: [],
    tasks
  });
  state.activityLabels[id] = title;

  elements.activityForm.reset();
  elements.activityRepeats.checked = true;
  clearDraftSubtasks();
  saveState();
  render();
}

function addDraftSubtask() {
  const titles = elements.initialSubtaskInput.value
    .split(/\n+/)
    .map((title) => title.trim())
    .filter(Boolean);

  if (!titles.length) return;

  draftSubtasks.push(...titles);
  elements.initialSubtaskInput.value = "";
  renderDraftSubtasks();
}

function handleDraftSubtaskKeydown(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addDraftSubtask();
}

function getDraftSubtaskTitles() {
  const pending = elements.initialSubtaskInput.value.trim();
  return pending ? [...draftSubtasks, pending] : [...draftSubtasks];
}

function clearDraftSubtasks() {
  draftSubtasks.length = 0;
  elements.initialSubtaskInput.value = "";
  renderDraftSubtasks();
}

function updateResetTime(event) {
  state.settings.resetTime = event.target.value || DEFAULT_RESET_TIME;
  state.lastOpenedDate = todayKey();
  saveState();
  render();
  scheduleNextRollover();
}

function refreshForCurrentDay() {
  ensureToday();
  render();
  scheduleNextRollover();
  startResetCountdown();
}

function handleGlobalClick(event) {
  const tabButton = event.target.closest(".tab-button");
  if (tabButton) {
    setActiveTab(tabButton.dataset.tab);
    return;
  }

  const draftDelete = event.target.closest(".draft-subtask-list button");
  if (draftDelete) {
    draftSubtasks.splice(Number(draftDelete.closest("li").dataset.index), 1);
    triggerButtonFeedback(draftDelete);
    renderDraftSubtasks();
    return;
  }

  const activityCard = event.target.closest(".activity-card");
  if (!activityCard) return;

  const activity = state.activities.find((item) => item.id === activityCard.dataset.id);
  if (!activity) return;

  if (event.target.matches(".complete-activity")) {
    setActivityComplete(activity, event.target.checked);
  }

  if (event.target.closest(".add-task")) {
    $(".task-form", activityCard).classList.toggle("open");
    $(".task-form input", activityCard).focus();
  }

  if (event.target.closest(".delete-activity")) {
    deleteActivity(activity.id);
  }

  if (event.target.matches(".task-list input")) {
    const task = activity.tasks.find((item) => item.id === event.target.closest("li").dataset.id);
    task.done = event.target.checked;
    saveState();
    render();
  }

  if (event.target.matches(".task-list button")) {
    const taskId = event.target.closest("li").dataset.id;
    activity.tasks = activity.tasks.filter((task) => task.id !== taskId);
    saveState();
    render();
  }
}

document.addEventListener("submit", (event) => {
  const taskForm = event.target.closest(".task-form");
  if (!taskForm) return;

  event.preventDefault();
  const card = event.target.closest(".activity-card");
  const activity = state.activities.find((item) => item.id === card.dataset.id);
  const input = $("input", taskForm);
  const title = input.value.trim();

  if (!activity || !title) return;

  activity.tasks.push({ id: makeId(), title, done: false });
  input.value = "";
  saveState();
  render();
});

function setActiveTab(tab) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  $("#todayView").classList.toggle("active", tab === "today");
  $("#analyticsView").classList.toggle("active", tab === "analytics");

  if (tab === "analytics") renderAnalytics();
}

function setActivityComplete(activity, completed) {
  const date = todayKey();
  const wasDoneForDay = isDoneForDay();
  activity.completedDates = activity.completedDates || [];

  if (completed && !activity.completedDates.includes(date)) {
    state.activityLabels[activity.id] = activity.title;
    activity.completedDates.push(date);
    incrementHistory(activity.id, date);
    if (!isLastOpenActivity(activity.id)) playFeedbackTone("click");
  }

  if (!completed) {
    activity.completedDates = activity.completedDates.filter((item) => item !== date);
    decrementHistory(activity.id, date);
    playFeedbackTone("click");
  }

  saveState();
  render();

  if (!wasDoneForDay && isDoneForDay()) {
    celebrateDailyCompletion();
  }
}

function incrementHistory(activityId, date) {
  state.history[activityId] = state.history[activityId] || {};
  state.history[activityId][date] = (state.history[activityId][date] || 0) + 1;
}

function decrementHistory(activityId, date) {
  if (!state.history[activityId]?.[date]) return;
  state.history[activityId][date] -= 1;
  if (state.history[activityId][date] <= 0) delete state.history[activityId][date];
}

function deleteActivity(activityId) {
  state.activities = state.activities.filter((activity) => activity.id !== activityId);
  saveState();
  render();
}

function render() {
  elements.todayLabel.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(dateFromKey(todayKey()));

  renderActivities();
  renderDraftSubtasks();
  renderProgress();
  renderResetSettings();
  renderAnalyticsOptions();
  renderAnalytics();
}

function renderDraftSubtasks() {
  elements.initialSubtaskList.replaceChildren();

  draftSubtasks.forEach((title, index) => {
    const item = document.createElement("li");
    item.dataset.index = index;
    item.innerHTML = `
      <span></span>
      <button type="button" aria-label="Remove draft subtask">x</button>
    `;
    $("span", item).textContent = title;
    elements.initialSubtaskList.append(item);
  });
}

function renderResetSettings() {
  elements.resetTime.value = state.settings.resetTime;
  elements.resetNote.textContent = `Next reset: ${formatResetDate(getNextResetAt())}`;
}

function renderActivities() {
  elements.activityList.replaceChildren();

  if (!state.activities.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No activities yet. Add one above and it will show up here for today.";
    elements.activityList.append(empty);
    return;
  }

  state.activities.forEach((activity) => {
    const fragment = elements.template.content.cloneNode(true);
    const card = $(".activity-card", fragment);
    const isComplete = isCompletedToday(activity);

    card.dataset.id = activity.id;
    card.classList.toggle("completed", isComplete);
    $(".complete-activity", card).checked = isComplete;
    $(".activity-check span", card).textContent = isComplete ? "Done today" : "Mark complete";
    $("h3", card).textContent = activity.title;
    $(".repeat-label", card).textContent = activity.repeats ? "Repeats every day" : "Only for today";

    const link = $(".activity-link", card);
    if (activity.link) {
      link.href = normalizeUrl(activity.link);
      link.textContent = activity.link;
    } else {
      link.remove();
    }

    const taskList = $(".task-list", card);
    activity.tasks.forEach((task) => {
      const item = document.createElement("li");
      item.dataset.id = task.id;
      item.classList.toggle("done", task.done);
      item.innerHTML = `
        <input type="checkbox" aria-label="Toggle subtask">
        <span></span>
        <button type="button" aria-label="Delete subtask">x</button>
      `;
      $("input", item).checked = task.done;
      $("span", item).textContent = task.title;
      taskList.append(item);
    });

    elements.activityList.append(card);
  });
}

function renderProgress() {
  const total = state.activities.length;
  const complete = state.activities.filter(isCompletedToday).length;
  const percent = total ? Math.round((complete / total) * 100) : 0;
  const activeStreak = getActiveStreak("all");
  const bestStreak = getBestStreak(getRecentDates(365), "all");
  const dayIsDone = total > 0 && complete === total;

  elements.progressTitle.textContent = `${complete} of ${total} complete`;
  elements.progressRing.dataset.label = `${percent}%`;
  elements.progressRing.style.background = `conic-gradient(var(--accent) ${percent * 3.6}deg, var(--soft) 0deg)`;
  elements.progressBar.style.width = `${percent}%`;
  elements.homeCurrentStreak.textContent = formatDayCount(activeStreak.days);
  elements.homeBestStreak.textContent = formatDayCount(bestStreak);
  renderResetCountdown();
  elements.streakNote.textContent = getStreakNote(activeStreak);
  elements.dashboardPanel.classList.toggle("all-done", dayIsDone);
  elements.dailyNote.classList.toggle("done-message", dayIsDone);
  elements.dailyNote.textContent = total
    ? complete === total
      ? "Done for today. Everything is checked off."
      : `${total - complete} ${total - complete === 1 ? "activity" : "activities"} still open today.`
    : "Add an activity to start shaping the day.";
}

function renderAnalyticsOptions() {
  const selected = elements.analyticsActivity.value;
  elements.analyticsActivity.replaceChildren();

  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All activities";
  elements.analyticsActivity.append(all);

  const activeLabels = Object.fromEntries(state.activities.map((activity) => [activity.id, activity.title]));
  const labels = { ...state.activityLabels, ...activeLabels };
  const ids = [...new Set([...Object.keys(labels), ...Object.keys(state.history)])];

  ids.forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = labels[id] || "Archived activity";
    elements.analyticsActivity.append(option);
  });

  if ([...elements.analyticsActivity.options].some((option) => option.value === selected)) {
    elements.analyticsActivity.value = selected;
  }
}

function renderAnalytics() {
  const days = Number(elements.analyticsRange.value || 7);
  const dates = getRecentDates(days);
  const selected = elements.analyticsActivity.value || "all";
  const data = dates.map((date) => countForDate(date, selected));

  drawChart(dates, data);
  renderStats(dates, data, selected);
}

function renderStats(dates, data, selected) {
  const total = data.reduce((sum, value) => sum + value, 0);
  elements.totalCompletions.textContent = total;
  elements.bestStreak.textContent = `${getBestStreak(dates, selected)} days`;
  elements.currentStreak.textContent = `${getCurrentStreak(selected)} days`;
}

function drawChart(dates, data) {
  const canvas = elements.chart;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const padding = { top: 24, right: 18, bottom: 44, left: 42 };
  const chartWidth = rect.width - padding.left - padding.right;
  const chartHeight = rect.height - padding.top - padding.bottom;
  const max = Math.max(1, ...data);
  const slotWidth = chartWidth / data.length;
  const barWidth = Math.max(2, slotWidth * 0.72);

  ctx.strokeStyle = "#dce3dc";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#68736c";
  ctx.font = "12px Inter, system-ui, sans-serif";

  for (let i = 0; i <= max; i += Math.max(1, Math.ceil(max / 4))) {
    const y = padding.top + chartHeight - (i / max) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(rect.width - padding.right, y);
    ctx.stroke();
    ctx.fillText(String(i), 12, y + 4);
  }

  data.forEach((value, index) => {
    const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
    const height = (value / max) * chartHeight;
    const y = padding.top + chartHeight - height;

    ctx.fillStyle = value ? "#256d5a" : "#dce3dc";
    roundRect(ctx, x, y, barWidth, Math.max(4, height), 5);
    ctx.fill();

    if (dates.length <= 14 || index % Math.ceil(dates.length / 12) === 0) {
      ctx.save();
      ctx.translate(x + barWidth / 2, rect.height - 18);
      ctx.rotate(-0.55);
      ctx.fillStyle = "#68736c";
      ctx.textAlign = "right";
      ctx.fillText(formatShortDate(dates[index]), 0, 0);
      ctx.restore();
    }
  });

  if (!data.some(Boolean)) {
    ctx.fillStyle = "#68736c";
    ctx.textAlign = "center";
    ctx.font = "15px Inter, system-ui, sans-serif";
    ctx.fillText("No completions yet for this range.", rect.width / 2, rect.height / 2);
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
}

function countForDate(date, selected) {
  if (selected !== "all") return state.history[selected]?.[date] || 0;

  return Object.values(state.history).reduce((sum, activityHistory) => {
    return sum + (activityHistory[date] || 0);
  }, 0);
}

function getBestStreak(dates, selected) {
  let best = 0;
  let current = 0;

  dates.forEach((date) => {
    if (countForDate(date, selected) > 0) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  });

  return best;
}

function getCurrentStreak(selected) {
  let streak = 0;
  const currentDay = dateFromKey(todayKey());

  for (let offset = 0; offset < 365; offset += 1) {
    const date = new Date(currentDay);
    date.setDate(currentDay.getDate() - offset);
    if (countForDate(toDateKey(date), selected) === 0) break;
    streak += 1;
  }

  return streak;
}

function getActiveStreak(selected) {
  const currentDay = dateFromKey(todayKey());
  const hasToday = countForDate(toDateKey(currentDay), selected) > 0;
  let streak = 0;

  for (let offset = hasToday ? 0 : 1; offset < 365; offset += 1) {
    const date = new Date(currentDay);
    date.setDate(currentDay.getDate() - offset);
    if (countForDate(toDateKey(date), selected) === 0) break;
    streak += 1;
  }

  return { days: streak, hasToday };
}

function getRecentDates(days) {
  const currentDay = dateFromKey(todayKey());
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(currentDay);
    date.setDate(currentDay.getDate() - (days - index - 1));
    return toDateKey(date);
  });
}

function formatShortDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parsed);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(dateKey) {
  return new Date(`${dateKey}T00:00:00`);
}

function getDayKey(date, resetTime) {
  const [hours, minutes] = parseResetTime(resetTime);
  const resetPoint = new Date(date);
  resetPoint.setHours(hours, minutes, 0, 0);

  const day = new Date(date);
  if (date < resetPoint) day.setDate(day.getDate() - 1);
  return toDateKey(day);
}

function parseResetTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || DEFAULT_RESET_TIME);
  if (!match) return [0, 0];
  return [Number(match[1]), Number(match[2])];
}

function getNextResetAt(now = new Date()) {
  const [hours, minutes] = parseResetTime(state.settings.resetTime);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function scheduleNextRollover() {
  window.clearTimeout(rolloverTimer);
  const delay = getNextResetAt().getTime() - Date.now() + 1000;
  rolloverTimer = window.setTimeout(() => {
    refreshForCurrentDay();
  }, Math.max(1000, delay));
}

function startResetCountdown() {
  window.clearInterval(countdownTimer);
  renderResetCountdown();
  countdownTimer = window.setInterval(renderResetCountdown, 1000);
}

function renderResetCountdown() {
  if (!elements.resetCountdown) return;
  elements.resetCountdown.textContent = formatTimeLeft(getNextResetAt().getTime() - Date.now());
}

function formatResetDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatDayCount(days) {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function formatTimeLeft(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function getStreakNote(streak) {
  if (streak.hasToday) return "Active today";
  if (streak.days > 0) return "Complete one today";
  return "Complete one to start";
}

function isCompletedToday(activity) {
  return (activity.completedDates || []).includes(todayKey());
}

function isDoneForDay() {
  return state.activities.length > 0 && state.activities.every(isCompletedToday);
}

function isLastOpenActivity(activityId) {
  return state.activities
    .filter((activity) => activity.id !== activityId)
    .every(isCompletedToday);
}

function normalizeUrl(url) {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

window.addEventListener("resize", () => {
  if ($("#analyticsView").classList.contains("active")) renderAnalytics();
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

document.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("button");
  if (button) triggerButtonFeedback(button);
});

function triggerButtonFeedback(button) {
  button.classList.remove("clicked");
  window.requestAnimationFrame(() => button.classList.add("clicked"));
  window.setTimeout(() => button.classList.remove("clicked"), 260);
}

function celebrateDailyCompletion() {
  playFeedbackTone("complete");
  elements.dashboardPanel.classList.add("celebrating");
  window.setTimeout(() => elements.dashboardPanel.classList.remove("celebrating"), 1000);

  const burst = document.createElement("div");
  burst.className = "confetti-burst";

  for (let index = 0; index < 34; index += 1) {
    const piece = document.createElement("span");
    piece.style.setProperty("--x", `${Math.random() * 100}vw`);
    piece.style.setProperty("--delay", `${Math.random() * 0.18}s`);
    piece.style.setProperty("--spin", `${Math.random() * 520 - 260}deg`);
    piece.style.setProperty("--color", getConfettiColor(index));
    burst.append(piece);
  }

  document.body.append(burst);
  window.setTimeout(() => burst.remove(), 1700);
}

function getConfettiColor(index) {
  return ["#236851", "#315f96", "#d39d3f", "#b84c3f", "#6f7f72"][index % 5];
}

function playFeedbackTone(type) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const context = new AudioContext();
  const first = type === "complete" ? 660 : 440;
  const second = type === "complete" ? 880 : 520;
  playTone(context, first, 0, 0.055);
  playTone(context, second, 0.06, 0.08);
  window.setTimeout(() => context.close(), 240);
}

function playTone(context, frequency, delay, duration) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  const end = start + duration;

  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.04, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}
