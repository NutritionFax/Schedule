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
  categoryTitle: $("#categoryTitle"),
  addCategory: $("#addCategory"),
  activityCategory: $("#activityCategory"),
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
document.addEventListener("submit", handleGlobalSubmit);
document.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("button");
  if (button) triggerButtonFeedback(button);
});
elements.activityForm.addEventListener("submit", addActivity);
elements.addCategory.addEventListener("click", addCategory);
elements.categoryTitle.addEventListener("keydown", handleCategoryKeydown);
elements.addInitialSubtask.addEventListener("click", addDraftSubtask);
elements.initialSubtaskInput.addEventListener("keydown", handleDraftSubtaskKeydown);
elements.resetTime.addEventListener("change", updateResetTime);
elements.analyticsActivity.addEventListener("change", renderAnalytics);
elements.analyticsRange.addEventListener("change", renderAnalytics);
document.addEventListener("visibilitychange", refreshForCurrentDay);
window.addEventListener("focus", refreshForCurrentDay);
window.addEventListener("resize", () => {
  if ($("#analyticsView").classList.contains("active")) renderAnalytics();
});

render();
scheduleNextRollover();
startResetCountdown();

function loadState() {
  const fallback = {
    lastOpenedDate: getDayKey(new Date(), DEFAULT_RESET_TIME),
    categories: [],
    activities: [],
    activityLabels: {},
    dailyProgress: {},
    settings: {
      resetTime: DEFAULT_RESET_TIME
    },
    history: {}
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    const settings = { ...fallback.settings, ...(saved.settings || {}) };
    const categories = normalizeCategories(saved.categories);
    const defaultCategory = categories[0];
    const activities = normalizeActivities(saved.activities, categories, defaultCategory.id);

    return {
      ...fallback,
      ...saved,
      categories,
      activities,
      activityLabels: { ...fallback.activityLabels, ...(saved.activityLabels || {}) },
      dailyProgress: saved.dailyProgress || {},
      settings,
      history: saved.history || {},
      lastOpenedDate: saved.lastOpenedDate || getDayKey(new Date(), settings.resetTime)
    };
  } catch {
    const defaultCategory = createCategory("General");
    return { ...fallback, categories: [defaultCategory] };
  }
}

function normalizeCategories(categories) {
  if (Array.isArray(categories) && categories.length) {
    const normalized = categories
      .filter((category) => category && category.title)
      .map((category) => ({
        id: category.id || makeId(),
        title: category.title.trim(),
        createdDate: category.createdDate || todayKeySafe()
      }));

    return normalized.length ? normalized : [createCategory("General")];
  }

  return [createCategory("General")];
}

function normalizeActivities(activities, categories, defaultCategoryId) {
  const categoryIds = new Set(categories.map((category) => category.id));

  return (Array.isArray(activities) ? activities : []).map((activity) => ({
    id: activity.id || makeId(),
    categoryId: categoryIds.has(activity.categoryId) ? activity.categoryId : defaultCategoryId,
    title: activity.title || "Untitled activity",
    link: activity.link || "",
    repeats: activity.repeats !== false,
    createdDate: activity.createdDate || todayKeySafe(),
    completedDates: Array.isArray(activity.completedDates) ? activity.completedDates : [],
    tasks: normalizeTasks(activity.tasks)
  }));
}

function normalizeTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : []).map((task) => ({
    id: task.id || makeId(),
    title: task.title || "Untitled subtask",
    done: Boolean(task.done)
  }));
}

function createCategory(title) {
  return {
    id: makeId(),
    title,
    createdDate: todayKeySafe()
  };
}

function todayKeySafe() {
  return getDayKey(new Date(), DEFAULT_RESET_TIME);
}

function saveState(options = {}) {
  const { recordProgress = true } = options;
  if (recordProgress) recordDailyProgress();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function recordDailyProgress() {
  state.dailyProgress = state.dailyProgress || {};
  state.dailyProgress[todayKey()] = getDailyProgressSnapshot();
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

function addCategory() {
  const title = elements.categoryTitle.value.trim();
  if (!title) return;

  const category = createCategory(title);
  state.categories.push(category);
  elements.categoryTitle.value = "";
  saveState();
  render();
  elements.activityCategory.value = category.id;
}

function handleCategoryKeydown(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addCategory();
}

function addActivity(event) {
  event.preventDefault();

  const title = elements.activityTitle.value.trim();
  if (!title) return;

  const selectedCategory = elements.activityCategory.value || state.categories[0]?.id;
  const id = makeId();
  const tasks = getDraftSubtaskTitles().map((title) => ({ id: makeId(), title, done: false }));

  state.activities.unshift({
    id,
    categoryId: selectedCategory,
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
  elements.activityCategory.value = selectedCategory;
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
  startResetCountdown();
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
    const wasDoneForDay = isDoneForDay();
    const wasComplete = isActivityComplete(activity);
    task.done = event.target.checked;
    syncActivityCompletion(activity, wasComplete);
    saveState();
    render();
    playFeedbackTone(isDoneForDay() ? "complete" : "click");
    if (!wasDoneForDay && isDoneForDay()) celebrateDailyCompletion(false);
  }

  if (event.target.matches(".task-list button")) {
    const wasComplete = isActivityComplete(activity);
    const taskId = event.target.closest("li").dataset.id;
    activity.tasks = activity.tasks.filter((task) => task.id !== taskId);
    syncActivityCompletion(activity, wasComplete);
    saveState();
    render();
  }
}

function handleGlobalSubmit(event) {
  const taskForm = event.target.closest(".task-form");
  if (!taskForm) return;

  event.preventDefault();
  const card = event.target.closest(".activity-card");
  const activity = state.activities.find((item) => item.id === card.dataset.id);
  const input = $("input", taskForm);
  const title = input.value.trim();

  if (!activity || !title) return;

  const wasComplete = isActivityComplete(activity);
  activity.tasks.push({ id: makeId(), title, done: false });
  syncActivityCompletion(activity, wasComplete);
  input.value = "";
  saveState();
  render();
}

function setActiveTab(tab) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  $("#todayView").classList.toggle("active", tab === "today");
  $("#analyticsView").classList.toggle("active", tab === "analytics");

  if (tab === "analytics") renderAnalytics();
}

function setActivityComplete(activity, completed) {
  const wasDoneForDay = isDoneForDay();
  const wasComplete = isActivityComplete(activity);

  if (activity.tasks.length) {
    activity.tasks = activity.tasks.map((task) => ({ ...task, done: completed }));
  } else {
    setDateCompletion(activity, completed);
  }

  syncActivityCompletion(activity, wasComplete);
  saveState();
  render();

  if (!wasDoneForDay && isDoneForDay()) {
    celebrateDailyCompletion();
  } else {
    playFeedbackTone("click");
  }
}

function setDateCompletion(activity, completed) {
  const date = todayKey();
  activity.completedDates = activity.completedDates || [];

  if (completed && !activity.completedDates.includes(date)) {
    activity.completedDates.push(date);
  }

  if (!completed) {
    activity.completedDates = activity.completedDates.filter((item) => item !== date);
  }
}

function syncActivityCompletion(activity, wasComplete) {
  const date = todayKey();
  const nowComplete = isActivityComplete(activity);

  if (nowComplete && !activity.completedDates.includes(date)) {
    activity.completedDates.push(date);
  }

  if (!nowComplete) {
    activity.completedDates = activity.completedDates.filter((item) => item !== date);
  }

  if (nowComplete && !wasComplete) incrementHistory(activity.id, date);
  if (!nowComplete && wasComplete) decrementHistory(activity.id, date);
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

  renderCategoryOptions();
  renderActivities();
  renderDraftSubtasks();
  renderProgress();
  renderResetSettings();
  renderAnalyticsOptions();
  renderAnalytics();
}

function renderCategoryOptions() {
  const selected = elements.activityCategory.value;
  elements.activityCategory.replaceChildren();

  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.title;
    elements.activityCategory.append(option);
  });

  if ([...elements.activityCategory.options].some((option) => option.value === selected)) {
    elements.activityCategory.value = selected;
  }
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

  state.categories.forEach((category) => {
    const activities = state.activities.filter((activity) => activity.categoryId === category.id);
    const section = document.createElement("section");
    section.className = "category-section";
    section.dataset.id = category.id;

    const percent = getCategoryProgressPercent(category.id);
    section.innerHTML = `
      <div class="category-header">
        <div>
          <p class="eyebrow">Category</p>
          <h2></h2>
          <p class="category-summary"></p>
        </div>
        <div class="category-progress-wrap">
          <span class="category-progress-label"></span>
          <div class="category-meter" aria-hidden="true"><div></div></div>
        </div>
      </div>
      <div class="category-activities"></div>
    `;

    $("h2", section).textContent = category.title;
    $(".category-summary", section).textContent = `${activities.length} ${activities.length === 1 ? "activity" : "activities"}`;
    $(".category-progress-label", section).textContent = `${percent}% complete`;
    $(".category-meter div", section).style.width = `${percent}%`;

    const list = $(".category-activities", section);
    if (!activities.length) {
      const empty = document.createElement("div");
      empty.className = "category-empty";
      empty.textContent = "No activities in this category yet.";
      list.append(empty);
    } else {
      activities.forEach((activity) => list.append(createActivityCard(activity)));
    }

    elements.activityList.append(section);
  });
}

function createActivityCard(activity) {
  const fragment = elements.template.content.cloneNode(true);
  const card = $(".activity-card", fragment);
  const progress = getActivityProgress(activity);
  const percent = Math.round(progress * 100);
  const isComplete = progress === 1;

  card.dataset.id = activity.id;
  card.classList.toggle("completed", isComplete);
  card.classList.toggle("partial", progress > 0 && progress < 1);

  const checkbox = $(".complete-activity", card);
  checkbox.checked = isComplete;
  checkbox.indeterminate = progress > 0 && progress < 1;
  $(".activity-check span", card).textContent = isComplete ? "Done today" : `${percent}% complete`;
  $("h3", card).textContent = activity.title;
  $(".repeat-label", card).textContent = activity.repeats ? "Repeats every day" : "Only for today";
  $(".activity-progress div", card).style.width = `${percent}%`;

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

  return card;
}

function renderProgress() {
  const snapshot = getDailyProgressSnapshot();
  const activeStreak = getActiveStreak("all");
  const bestStreak = getBestStreak(getRecentDates(365), "all");
  const dayIsDone = snapshot.total > 0 && snapshot.percent === 100;

  elements.progressTitle.textContent = `${snapshot.percent}% complete`;
  elements.progressRing.dataset.label = `${snapshot.percent}%`;
  elements.progressRing.style.background = `conic-gradient(var(--accent) ${snapshot.percent * 3.6}deg, var(--soft) 0deg)`;
  elements.progressBar.style.width = `${snapshot.percent}%`;
  elements.homeCurrentStreak.textContent = formatDayCount(activeStreak.days);
  elements.homeBestStreak.textContent = formatDayCount(bestStreak);
  renderResetCountdown();
  elements.streakNote.textContent = getStreakNote(activeStreak);
  elements.dashboardPanel.classList.toggle("all-done", dayIsDone);
  elements.dailyNote.classList.toggle("done-message", dayIsDone);
  elements.dailyNote.textContent = snapshot.total
    ? dayIsDone
      ? "Done for today. Everything is checked off."
      : `${snapshot.remaining} ${snapshot.remaining === 1 ? "activity" : "activities"} still open today.`
    : "Add an activity to start shaping the day.";
}

function renderAnalyticsOptions() {
  const selected = elements.analyticsActivity.value;
  elements.analyticsActivity.replaceChildren();

  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All categories";
  elements.analyticsActivity.append(all);

  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = `category:${category.id}`;
    option.textContent = category.title;
    elements.analyticsActivity.append(option);
  });

  state.activities.forEach((activity) => {
    const option = document.createElement("option");
    const category = getCategory(activity.categoryId);
    option.value = `activity:${activity.id}`;
    option.textContent = `${category?.title || "Category"} / ${activity.title}`;
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
  const data = dates.map((date) => progressForDate(date, selected));

  drawChart(dates, data);
  renderStats(dates, data, selected);
}

function renderStats(dates, data, selected) {
  const average = data.length ? Math.round(data.reduce((sum, value) => sum + value, 0) / data.length) : 0;
  elements.totalCompletions.textContent = `${average}%`;
  elements.bestStreak.textContent = formatDayCount(getBestStreak(dates, selected));
  elements.currentStreak.textContent = formatDayCount(getCurrentStreak(selected));
}

function drawChart(dates, data) {
  const canvas = elements.chart;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  if (!rect.width || !rect.height) return;

  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const padding = { top: 24, right: 18, bottom: 44, left: 42 };
  const chartWidth = rect.width - padding.left - padding.right;
  const chartHeight = rect.height - padding.top - padding.bottom;
  const slotWidth = chartWidth / data.length;
  const barWidth = Math.max(2, slotWidth * 0.72);

  ctx.strokeStyle = "#dce3dc";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#68736c";
  ctx.font = "12px Inter, system-ui, sans-serif";

  [0, 25, 50, 75, 100].forEach((value) => {
    const y = padding.top + chartHeight - (value / 100) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(rect.width - padding.right, y);
    ctx.stroke();
    ctx.fillText(`${value}%`, 8, y + 4);
  });

  data.forEach((value, index) => {
    const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
    const height = (value / 100) * chartHeight;
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
    ctx.fillText("No progress yet for this range.", rect.width / 2, rect.height / 2);
  }
}

function getDailyProgressSnapshot() {
  const activities = state.activities;
  const categoryProgress = Object.fromEntries(
    state.categories.map((category) => [category.id, getCategoryProgressPercent(category.id)])
  );
  const activityProgress = Object.fromEntries(
    activities.map((activity) => [activity.id, Math.round(getActivityProgress(activity) * 100)])
  );
  const percent = getOverallProgressPercent();
  const completed = activities.filter(isActivityComplete).length;

  return {
    percent,
    completed,
    total: activities.length,
    remaining: activities.length - completed,
    categories: categoryProgress,
    activities: activityProgress
  };
}

function getOverallProgressPercent() {
  if (!state.activities.length) return 0;
  const total = state.activities.reduce((sum, activity) => sum + getActivityProgress(activity), 0);
  return Math.round((total / state.activities.length) * 100);
}

function getCategoryProgressPercent(categoryId) {
  const activities = state.activities.filter((activity) => activity.categoryId === categoryId);
  if (!activities.length) return 0;
  const total = activities.reduce((sum, activity) => sum + getActivityProgress(activity), 0);
  return Math.round((total / activities.length) * 100);
}

function getActivityProgress(activity) {
  if (activity.tasks.length) {
    return activity.tasks.filter((task) => task.done).length / activity.tasks.length;
  }

  return isCompletedByDate(activity, todayKey()) ? 1 : 0;
}

function isActivityComplete(activity) {
  return getActivityProgress(activity) === 1;
}

function isCompletedByDate(activity, date) {
  return (activity.completedDates || []).includes(date);
}

function isDoneForDay() {
  return state.activities.length > 0 && getOverallProgressPercent() === 100;
}

function progressForDate(date, selected) {
  const snapshot = state.dailyProgress?.[date];
  if (selected === "all") return snapshot?.percent ?? legacyOverallProgress(date);

  const [type, id] = selected.split(":");
  if (type === "category") return snapshot?.categories?.[id] ?? legacyCategoryProgress(id, date);
  if (type === "activity") return snapshot?.activities?.[id] ?? legacyActivityProgress(id, date);
  return 0;
}

function legacyActivityProgress(activityId, date) {
  return state.history[activityId]?.[date] > 0 ? 100 : 0;
}

function legacyCategoryProgress(categoryId, date) {
  const activities = state.activities.filter((activity) => activity.categoryId === categoryId);
  if (!activities.length) return 0;
  const total = activities.reduce((sum, activity) => sum + legacyActivityProgress(activity.id, date), 0);
  return Math.round(total / activities.length);
}

function legacyOverallProgress(date) {
  if (!state.activities.length) return 0;
  const total = state.activities.reduce((sum, activity) => sum + legacyActivityProgress(activity.id, date), 0);
  return Math.round(total / state.activities.length);
}

function getBestStreak(dates, selected) {
  let best = 0;
  let current = 0;

  dates.forEach((date) => {
    if (progressForDate(date, selected) >= 100) {
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
    if (progressForDate(toDateKey(date), selected) < 100) break;
    streak += 1;
  }

  return streak;
}

function getActiveStreak(selected) {
  const currentDay = dateFromKey(todayKey());
  const hasToday = progressForDate(toDateKey(currentDay), selected) >= 100;
  let streak = 0;

  for (let offset = hasToday ? 0 : 1; offset < 365; offset += 1) {
    const date = new Date(currentDay);
    date.setDate(currentDay.getDate() - offset);
    if (progressForDate(toDateKey(date), selected) < 100) break;
    streak += 1;
  }

  return { days: streak, hasToday };
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

function getCategory(categoryId) {
  return state.categories.find((category) => category.id === categoryId);
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
  if (streak.hasToday) return "Complete today";
  if (streak.days > 0) return "Finish today";
  return "Reach 100% to start";
}

function normalizeUrl(url) {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function triggerButtonFeedback(button) {
  button.classList.remove("clicked");
  window.requestAnimationFrame(() => button.classList.add("clicked"));
  window.setTimeout(() => button.classList.remove("clicked"), 260);
}

function celebrateDailyCompletion(playTone = true) {
  if (playTone) playFeedbackTone("complete");
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

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
