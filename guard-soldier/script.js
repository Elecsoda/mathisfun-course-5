const BADGE_THRESHOLD = 3;
const DEFAULT_SETTINGS = {
  participantCount: 9,
  weekCount: 4,
  picksPerWeek: 5,
};

const soldierList = document.querySelector("#soldierList");
const selectionBoard = document.querySelector("#selectionBoard");
const soldierCount = document.querySelector("#soldierCount");
const boardHelp = document.querySelector("#boardHelp");
const undoButton = document.querySelector("#undoButton");
const assignedCount = document.querySelector("#assignedCount");
const winnerCount = document.querySelector("#winnerCount");
const resultContent = document.querySelector("#resultContent");
const highlightTip = document.querySelector("#highlightTip");
const totalSlotCount = document.querySelector("#totalSlotCount");
const introWeekCount = document.querySelector("#introWeekCount");
const introPickCount = document.querySelector("#introPickCount");
const customSettings = document.querySelector("#customSettings");
const participantCountInput = document.querySelector(
  "#participantCountInput",
);
const picksPerWeekInput = document.querySelector("#picksPerWeekInput");
const weekCountInput = document.querySelector("#weekCountInput");

let settings = { ...DEFAULT_SETTINGS };
let assignments = createEmptyAssignments();
let history = [];
let highlightedSoldier = null;
let helpTimer;

function createEmptyAssignments() {
  return Array.from({ length: settings.weekCount }, () =>
    Array(settings.picksPerWeek).fill(null),
  );
}

function soldierLabel(id) {
  return `士兵 ${id}`;
}

function snapshot() {
  return assignments.map((week) => [...week]);
}

function saveHistory() {
  history.push(snapshot());
  undoButton.disabled = false;
}

function showHelp(message, isError = false) {
  window.clearTimeout(helpTimer);
  boardHelp.textContent = message;
  boardHelp.classList.toggle("error", isError);
  helpTimer = window.setTimeout(() => {
    boardHelp.textContent = "请选择一位士兵，或将士兵拖到虚线框中。";
    boardHelp.classList.remove("error");
  }, 2600);
}

function getFillOrder() {
  return document.querySelector('input[name="fillOrder"]:checked').value;
}

function getOrderedPositions() {
  const positions = [];

  if (getFillOrder() === "column") {
    for (let slot = 0; slot < settings.picksPerWeek; slot += 1) {
      for (let week = 0; week < settings.weekCount; week += 1) {
        positions.push({ week, slot });
      }
    }
  } else {
    for (let week = 0; week < settings.weekCount; week += 1) {
      for (let slot = 0; slot < settings.picksPerWeek; slot += 1) {
        positions.push({ week, slot });
      }
    }
  }

  return positions;
}

function findNextEmptyPosition() {
  return getOrderedPositions().find(
    ({ week, slot }) => assignments[week][slot] === null,
  );
}

function addToNextSlot(id) {
  const position = findNextEmptyPosition();
  if (!position) {
    showHelp(
      `${settings.weekCount * settings.picksPerWeek} 个席位已经全部填满。`,
      true,
    );
    return;
  }

  if (assignments[position.week].includes(id)) {
    showHelp(
      `${soldierLabel(id)} 已在第 ${position.week + 1} 周入选，请选择其他士兵。`,
      true,
    );
    return;
  }

  saveHistory();
  assignments[position.week][position.slot] = id;
  highlightedSoldier = null;
  render();
  showHelp(
    `${soldierLabel(id)} 已加入第 ${position.week + 1} 周。`,
  );
}

function assignToSlot(id, week, slot) {
  const previous = assignments[week][slot];

  if (previous === id) {
    return;
  }

  if (assignments[week].includes(id)) {
    showHelp(`同一周不能重复选择${soldierLabel(id)}。`, true);
    return;
  }

  saveHistory();
  assignments[week][slot] = id;
  highlightedSoldier = null;
  render();

  if (previous === null) {
    showHelp(`${soldierLabel(id)} 已加入第 ${week + 1} 周。`);
  } else {
    showHelp(
      `第 ${week + 1} 周的${soldierLabel(previous)}已替换为${soldierLabel(id)}。`,
    );
  }
}

function removeFromSlot(week, slot) {
  const id = assignments[week][slot];
  if (id === null) {
    return;
  }

  saveHistory();
  assignments[week][slot] = null;
  highlightedSoldier = null;
  render();
  showHelp(`已从第 ${week + 1} 周移除${soldierLabel(id)}。`);
}

function buildSoldierList() {
  soldierList.replaceChildren();
  const fragment = document.createDocumentFragment();
  const supportsPreciseDragging = window.matchMedia(
    "(hover: hover) and (pointer: fine)",
  ).matches;

  for (let id = 1; id <= settings.participantCount; id += 1) {
    const button = document.createElement("button");
    button.className = "soldier";
    button.type = "button";
    button.draggable = supportsPreciseDragging;
    button.dataset.soldierId = String(id);
    button.textContent = id;
    button.setAttribute(
      "aria-label",
      supportsPreciseDragging
        ? `${soldierLabel(id)}，点击自动填充，或拖到指定席位`
        : `${soldierLabel(id)}，点击自动填充`,
    );

    button.addEventListener("click", () => addToNextSlot(id));
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/plain", String(id));
      button.classList.add("dragging");
      document.body.classList.add("drag-in-progress");
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("dragging");
      document.body.classList.remove("drag-in-progress");
      document
        .querySelectorAll(".selection-slot.drag-over")
        .forEach((slot) => slot.classList.remove("drag-over"));
    });

    fragment.appendChild(button);
  }

  soldierList.appendChild(fragment);
  soldierCount.textContent = `${settings.participantCount} 人`;
}

function createSlot(week, slot) {
  const element = document.createElement("button");
  const id = assignments[week][slot];
  element.className = "selection-slot";
  element.type = "button";
  element.dataset.week = String(week);
  element.dataset.slot = String(slot);

  if (id !== null) {
    element.classList.add("filled");
    element.setAttribute(
      "aria-label",
      `第 ${week + 1} 周，${soldierLabel(id)}，点击移除`,
    );

    const name = document.createElement("span");
    name.className = "slot-soldier";
    name.textContent = id;

    const removeMark = document.createElement("span");
    removeMark.className = "remove-mark";
    removeMark.textContent = "点击移除";

    element.append(name, removeMark);
    element.addEventListener("click", () => removeFromSlot(week, slot));
  } else {
    element.setAttribute(
      "aria-label",
      `第 ${week + 1} 周第 ${slot + 1} 个空位`,
    );
  }

  if (id === highlightedSoldier) {
    element.classList.add("highlighted");
  }

  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    element.classList.add("drag-over");
  });
  element.addEventListener("dragleave", () => {
    element.classList.remove("drag-over");
  });
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    element.classList.remove("drag-over");
    document.body.classList.remove("drag-in-progress");
    const soldierId = Number.parseInt(
      event.dataTransfer.getData("text/plain"),
      10,
    );
    if (Number.isInteger(soldierId)) {
      assignToSlot(soldierId, week, slot);
    }
  });

  return element;
}

function renderBoard() {
  selectionBoard.replaceChildren();
  const densityName =
    settings.picksPerWeek <= 10
      ? "normal"
      : settings.picksPerWeek <= 15
        ? "dense"
        : "ultra";
  const density =
    settings.picksPerWeek <= 6
      ? {
          labelWidth: 92,
          gap: 12,
          height: 76,
          padding: 7,
          slotFont: 0.76,
          weekFont: 0.86,
          soldierFont: 0.96,
        }
      : settings.picksPerWeek <= 10
        ? {
            labelWidth: 72,
            gap: 7,
            height: 64,
            padding: 5,
            slotFont: 0.66,
            weekFont: 0.75,
            soldierFont: 0.82,
          }
        : settings.picksPerWeek <= 15
          ? {
              labelWidth: 62,
              gap: 4,
              height: 56,
              padding: 3,
              slotFont: 0.56,
              weekFont: 0.66,
              soldierFont: 0.72,
            }
          : {
              labelWidth: 54,
              gap: 3,
              height: 50,
              padding: 2,
              slotFont: 0.5,
              weekFont: 0.6,
              soldierFont: 0.64,
          };

  selectionBoard.dataset.density = densityName;
  selectionBoard.style.setProperty(
    "--pick-count",
    settings.picksPerWeek,
  );
  selectionBoard.style.setProperty(
    "--week-label-width",
    `${density.labelWidth}px`,
  );
  selectionBoard.style.setProperty("--board-gap", `${density.gap}px`);
  selectionBoard.style.setProperty("--slot-height", `${density.height}px`);
  selectionBoard.style.setProperty("--slot-padding", `${density.padding}px`);
  selectionBoard.style.setProperty(
    "--slot-font-size",
    `${density.slotFont}rem`,
  );
  selectionBoard.style.setProperty(
    "--week-font-size",
    `${density.weekFont}rem`,
  );
  selectionBoard.style.setProperty(
    "--soldier-font-size",
    `${density.soldierFont}rem`,
  );
  const fragment = document.createDocumentFragment();

  for (let week = 0; week < settings.weekCount; week += 1) {
    const label = document.createElement("div");
    label.className = "week-label";
    label.textContent = `第 ${week + 1} 周`;
    fragment.appendChild(label);

    for (let slot = 0; slot < settings.picksPerWeek; slot += 1) {
      fragment.appendChild(createSlot(week, slot));
    }
  }

  selectionBoard.appendChild(fragment);
}

function getSoldierStats() {
  const stats = new Map();

  assignments.forEach((week, weekIndex) => {
    week.forEach((id) => {
      if (id === null) {
        return;
      }

      if (!stats.has(id)) {
        stats.set(id, []);
      }
      stats.get(id).push(weekIndex + 1);
    });
  });

  return stats;
}

function renderResults() {
  const stats = getSoldierStats();
  const winners = [...stats.entries()]
    .filter(([, weeks]) => weeks.length >= BADGE_THRESHOLD)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  const filledSlots = assignments.flat().filter((id) => id !== null).length;

  assignedCount.textContent = filledSlots;
  winnerCount.textContent = winners.length;
  totalSlotCount.textContent =
    settings.weekCount * settings.picksPerWeek;
  resultContent.replaceChildren();
  highlightTip.hidden = winners.length === 0;

  if (winners.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-result";
    empty.innerHTML = `
      <div>
        <span class="empty-icon" aria-hidden="true">🤔</span>
        <strong>暂无士兵达到守卫标兵标准</strong>
        <span>需要在 ${BADGE_THRESHOLD} 周或以上入选优秀士兵</span>
      </div>
    `;
    resultContent.appendChild(empty);
    return;
  }

  winners.forEach(([id, weeks]) => {
    const card = document.createElement("button");
    card.className = "winner-card";
    card.type = "button";
    card.classList.toggle("active", highlightedSoldier === id);
    card.setAttribute(
      "aria-label",
      `${soldierLabel(id)}获奖 ${weeks.length} 次，点击高亮榜单位置`,
    );

    const name = document.createElement("span");
    name.className = "winner-name";
    name.textContent = soldierLabel(id);

    const count = document.createElement("span");
    count.className = "winner-count";
    count.textContent = `获奖 ${weeks.length} 次`;

    const tags = document.createElement("span");
    tags.className = "week-tags";
    weeks.forEach((week) => {
      const tag = document.createElement("span");
      tag.textContent = `第 ${week} 周`;
      tags.appendChild(tag);
    });

    card.append(name, count, tags);
    card.addEventListener("click", () => {
      highlightedSoldier = highlightedSoldier === id ? null : id;
      renderBoard();
      renderResults();
    });
    resultContent.appendChild(card);
  });
}

function render() {
  introWeekCount.textContent = settings.weekCount;
  introPickCount.textContent = settings.picksPerWeek;
  renderBoard();
  renderResults();
  undoButton.disabled = history.length === 0;
}

function resetGame() {
  assignments = createEmptyAssignments();
  history = [];
  highlightedSoldier = null;
  window.clearTimeout(helpTimer);
  boardHelp.textContent = "请选择一位士兵，或将士兵拖到虚线框中。";
  boardHelp.classList.remove("error");
  render();
}

function updateModeButtons() {
  document.querySelectorAll(".mode-button").forEach((button) => {
    const isActive =
      Number(button.dataset.count) === settings.participantCount;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, minimum), maximum);
}

function applyCustomSettings() {
  const participantCount = clampInteger(
    participantCountInput.value,
    1,
    60,
    settings.participantCount,
  );
  const weekCount = clampInteger(
    weekCountInput.value,
    1,
    12,
    settings.weekCount,
  );
  const requestedPicks = clampInteger(
    picksPerWeekInput.value,
    1,
    20,
    settings.picksPerWeek,
  );
  const picksPerWeek = Math.min(requestedPicks, participantCount);

  settings = { participantCount, weekCount, picksPerWeek };
  participantCountInput.value = participantCount;
  weekCountInput.value = weekCount;
  picksPerWeekInput.value = picksPerWeek;

  updateModeButtons();
  buildSoldierList();
  resetGame();

  if (requestedPicks > participantCount) {
    showHelp("每周优秀人数不能超过士兵人数，已自动调整。", true);
  } else {
    showHelp("自定义设置已应用。");
  }
}

document.querySelectorAll(".mode-button").forEach((button) => {
  button.addEventListener("click", () => {
    participantCountInput.value = button.dataset.count;
    applyCustomSettings();
  });
});

customSettings.addEventListener("submit", (event) => {
  event.preventDefault();
  applyCustomSettings();
});

customSettings.querySelectorAll("[data-step-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.querySelector(`#${button.dataset.stepTarget}`);
    const delta = Number(button.dataset.delta);
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    const current = Number(input.value);
    input.value = Math.min(Math.max(current + delta, minimum), maximum);
  });
});

document.querySelectorAll('input[name="fillOrder"]').forEach((input) => {
  input.addEventListener("change", () => {
    const direction = input.value === "row" ? "横向填充" : "竖向填充";
    showHelp(`自动填充方向已切换为${direction}。`);
  });
});

document.querySelector("#resetButton").addEventListener("click", resetGame);
window.addEventListener("blur", () => {
  document.body.classList.remove("drag-in-progress");
});
undoButton.addEventListener("click", () => {
  const previous = history.pop();
  if (!previous) {
    return;
  }
  assignments = previous;
  highlightedSoldier = null;
  render();
  showHelp("已撤销上一步操作。");
});

updateModeButtons();
buildSoldierList();
render();
