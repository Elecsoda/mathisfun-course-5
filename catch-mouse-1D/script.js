const MAX_STEPS = 40;

const board = document.querySelector("#board");
const boardStage = document.querySelector(".board-stage");
const controlsLayer = document.querySelector("#controlsLayer");
const settingsForm = document.querySelector("#settingsForm");
const undoButton = document.querySelector("#undoButton");
const cellCountInput = document.querySelector("#cellCountInput");
const tomStepA = document.querySelector("#tomStepA");
const tomStepB = document.querySelector("#tomStepB");
const jerryStepA = document.querySelector("#jerryStepA");
const jerryStepB = document.querySelector("#jerryStepB");
const showTargetsInput = document.querySelector("#showTargetsInput");
const turnDisplay = document.querySelector("#turnDisplay");
const jumpDisplay = document.querySelector("#jumpDisplay");
const stepDisplay = document.querySelector("#stepDisplay");
const positionDisplay = document.querySelector("#positionDisplay");
const progressFill = document.querySelector("#progressFill");
const actionNotice = document.querySelector("#actionNotice");
const hintText = document.querySelector("#hintText");
const historyList = document.querySelector("#historyList");
const messagePanel = document.querySelector("#messagePanel");
const messageIcon = document.querySelector("#messageIcon");
const messageTitle = document.querySelector("#messageTitle");
const messageCopy = document.querySelector("#messageCopy");
const introJerryStart = document.querySelector("#introJerryStart");
const introTomPattern = document.querySelector("#introTomPattern");
const introJerryPattern = document.querySelector("#introJerryPattern");
const tomRule = document.querySelector("#tomRule");
const jerryRule = document.querySelector("#jerryRule");

let state;
let noticeTimer;
let settings = {
  cellCount: 30,
  tomPattern: [3, 1],
  jerryPattern: [1],
  showTargets: false,
};

function createAnimal(name, emoji) {
  const animal = document.createElement("div");
  animal.className = `animal ${name.toLowerCase()}`;
  animal.setAttribute("role", "img");
  animal.setAttribute("aria-label", name);
  animal.textContent = emoji;
  return animal;
}

function createControls(animal) {
  const controls = document.createElement("div");
  controls.className = `move-controls ${animal.toLowerCase()}-controls`;
  controls.dataset.animal = animal;

  const directions = [
    { value: -1, icon: "←", label: "向左跳" },
    { value: 1, icon: "→", label: "向右跳" },
  ];

  directions.forEach(({ value, icon, label }) => {
    const button = document.createElement("button");
    button.className = "arrow-button";
    button.type = "button";
    button.dataset.direction = String(value);
    button.setAttribute("aria-label", `${animal} ${label}`);
    button.textContent = icon;
    button.addEventListener("click", () => move(animal, value));
    controls.appendChild(button);
  });

  controlsLayer.appendChild(controls);
  return controls;
}

function buildBoard() {
  board.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (let index = 1; index <= settings.cellCount; index += 1) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.position = String(index);

    const number = document.createElement("span");
    number.className = "cell-number";
    number.textContent = index;
    cell.appendChild(number);
    fragment.appendChild(cell);
  }

  board.appendChild(fragment);
  boardStage.style.setProperty("--cell-count", settings.cellCount);

  if (!controlsLayer.children.length) {
    createControls("Tom");
    createControls("Jerry");
  }
}

function getPattern(animal) {
  return animal === "Tom" ? settings.tomPattern : settings.jerryPattern;
}

function getJump(animal) {
  const pattern = getPattern(animal);
  const moveCount = state.moveCounts[animal];
  return pattern[moveCount % pattern.length];
}

function positionControls(controls, position) {
  const boardWidth = board.clientWidth;
  const cellWidth = boardWidth / settings.cellCount;
  const halfControlWidth = controls.offsetWidth / 2;
  const desiredLeft = (position - 0.5) * cellWidth;
  const safeLeft = Math.min(
    Math.max(desiredLeft, halfControlWidth),
    boardWidth - halfControlWidth,
  );

  controls.style.left = `${safeLeft}px`;
}

function renderAnimals() {
  document.querySelectorAll(".animal").forEach((animal) => animal.remove());
  document.querySelectorAll(".cell.shared").forEach((cell) => {
    cell.classList.remove("shared");
  });

  const tomCell = board.querySelector(`[data-position="${state.tom}"]`);
  const jerryCell = board.querySelector(`[data-position="${state.jerry}"]`);
  tomCell.appendChild(createAnimal("Tom", "🐱"));
  jerryCell.appendChild(createAnimal("Jerry", "🐭"));

  if (state.tom === state.jerry) {
    tomCell.classList.add("shared");
  }
}

function renderReachableCells() {
  document.querySelectorAll(".cell.reachable").forEach((cell) => {
    cell.classList.remove("reachable");
  });

  if (!settings.showTargets || state.gameOver) {
    return;
  }

  const animal = state.turn;
  const position = animal === "Tom" ? state.tom : state.jerry;
  const jump = getJump(animal);

  [-1, 1].forEach((direction) => {
    const target = position + direction * jump;
    const jerryWouldEnterTom =
      animal === "Jerry" && target === state.tom;
    if (
      target >= 1 &&
      target <= settings.cellCount &&
      !jerryWouldEnterTom
    ) {
      board
        .querySelector(`[data-position="${target}"]`)
        .classList.add("reachable");
    }
  });
}

function updateControls() {
  const firstControls = document.querySelector(".move-controls");
  const cellWidth = board.clientWidth / settings.cellCount;
  const overlapDistance = Math.ceil(firstControls.offsetWidth / cellWidth);
  const controlsOverlap =
    Math.abs(state.tom - state.jerry) <= overlapDistance;

  document.querySelectorAll(".move-controls").forEach((controls) => {
    const animal = controls.dataset.animal;
    const position = animal === "Tom" ? state.tom : state.jerry;
    const jump = getJump(animal);
    const isActive = state.turn === animal && !state.gameOver;

    positionControls(controls, position);
    controls.classList.toggle("inactive", !isActive);
    controls.classList.toggle(
      "staggered",
      controlsOverlap && animal === "Jerry",
    );

    controls.querySelectorAll(".arrow-button").forEach((button) => {
      const direction = Number(button.dataset.direction);
      const target = position + direction * jump;
      button.disabled =
        !isActive || target < 1 || target > settings.cellCount;
    });
  });
}

function renderStatus() {
  turnDisplay.textContent = state.gameOver ? "游戏结束" : state.turn;
  jumpDisplay.textContent = state.gameOver
    ? "—"
    : `${getJump(state.turn)} 格`;
  stepDisplay.textContent = state.steps;
  positionDisplay.textContent = `Tom ${state.tom} · Jerry ${state.jerry}`;
  progressFill.style.width = `${(state.steps / MAX_STEPS) * 100}%`;
  undoButton.disabled = state.history.length === 0;

  if (!state.gameOver) {
    const jump = getJump(state.turn);
    const position = state.turn === "Tom" ? state.tom : state.jerry;
    const canMoveLeft = position - jump >= 1;
    const canMoveRight = position + jump <= settings.cellCount;
    hintText.textContent =
      canMoveLeft || canMoveRight
        ? `轮到 ${state.turn}：请选择向左或向右跳 ${jump} 格`
        : `${state.turn} 当前无法移动，请调整步长或方格数`;
  }
}

function formatPattern(pattern) {
  if (pattern.length === 1 || pattern[0] === pattern[1]) {
    return `${pattern[0]}、${pattern[0]}、${pattern[0]}、${pattern[0]}……`;
  }
  return `${pattern[0]}、${pattern[1]}、${pattern[0]}、${pattern[1]}……`;
}

function formatRule(pattern) {
  if (pattern.length === 1 || pattern[0] === pattern[1]) {
    return `每次跳 ${pattern[0]} 格`;
  }
  return `按 ${pattern[0]}、${pattern[1]} 循环`;
}

function renderRules() {
  introJerryStart.textContent = Math.min(10, settings.cellCount);
  introTomPattern.textContent = formatPattern(settings.tomPattern);
  introJerryPattern.textContent = formatPattern(settings.jerryPattern);
  tomRule.textContent = formatRule(settings.tomPattern);
  jerryRule.textContent = formatRule(settings.jerryPattern);
  board.setAttribute(
    "aria-label",
    `${settings.cellCount} 格追逐棋盘`,
  );
}

function renderHistory() {
  historyList.replaceChildren();
  state.history.forEach((item, index) => {
    const entry = document.createElement("li");
    const arrow = item.from < item.to ? "→" : "←";
    entry.textContent = `${index + 1}. ${item.animal} ${item.from}${arrow}${item.to}`;
    historyList.appendChild(entry);
  });
  historyList.scrollLeft = historyList.scrollWidth;
}

function showResult(type) {
  state.gameOver = true;
  messagePanel.hidden = false;

  if (type === "caught") {
    messageIcon.textContent = "🎉";
    messageTitle.textContent = "Tom 抓到 Jerry 了！";
    messageCopy.textContent = `第 ${state.steps} 步，两者在第 ${state.tom} 格相遇。`;
  } else {
    messageIcon.textContent = "💨";
    messageTitle.textContent = "Jerry 成功逃脱！";
    messageCopy.textContent = "已经走满 40 步，Tom 仍然没有抓到 Jerry。";
  }
}

function showActionNotice(message) {
  window.clearTimeout(noticeTimer);
  actionNotice.textContent = message;
  actionNotice.hidden = false;
  noticeTimer = window.setTimeout(() => {
    actionNotice.hidden = true;
  }, 2600);
}

function clearActionNotice() {
  window.clearTimeout(noticeTimer);
  actionNotice.hidden = true;
}

function move(animal, direction) {
  if (state.gameOver || state.turn !== animal) {
    return;
  }

  const jump = getJump(animal);
  const key = animal.toLowerCase();
  const from = state[key];
  const target = from + direction * jump;

  if (target < 1 || target > settings.cellCount) {
    return;
  }

  if (animal === "Jerry" && target === state.tom) {
    showActionNotice("Jerry 不能主动跳到 Tom 所在的格子，请选择另一个方向。");
    return;
  }

  clearActionNotice();
  state[key] = target;
  state.steps += 1;
  state.history.push({ animal, from, to: target });

  state.moveCounts[animal] += 1;

  if (state.tom === state.jerry) {
    showResult("caught");
  } else if (state.steps >= MAX_STEPS) {
    showResult("escaped");
  } else {
    state.turn = animal === "Tom" ? "Jerry" : "Tom";
  }

  render();
}

function undoMove() {
  const lastMove = state.history.pop();
  if (!lastMove) {
    return;
  }

  const key = lastMove.animal.toLowerCase();
  state[key] = lastMove.from;
  state.moveCounts[lastMove.animal] -= 1;
  state.steps -= 1;
  state.turn = lastMove.animal;
  state.gameOver = false;
  messagePanel.hidden = true;
  clearActionNotice();
  render();
}

function resetGame() {
  state = {
    tom: 1,
    jerry: Math.min(10, settings.cellCount),
    turn: "Tom",
    moveCounts: {
      Tom: 0,
      Jerry: 0,
    },
    steps: 0,
    gameOver: false,
    history: [],
  };

  messagePanel.hidden = true;
  clearActionNotice();
  buildBoard();
  renderRules();
  render();
}

function render() {
  renderAnimals();
  renderReachableCells();
  updateControls();
  renderStatus();
  renderHistory();
}

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, minimum), maximum);
}

function readPattern(firstInput, secondInput, fallback) {
  const first = clampNumber(firstInput.value, 1, 40, fallback[0]);
  const secondText = secondInput.value.trim();
  const second = secondText
    ? clampNumber(secondText, 1, 40, first)
    : first;

  firstInput.value = first;
  secondInput.value = secondText ? second : "";
  return first === second ? [first] : [first, second];
}

function applySettings() {
  settings = {
    cellCount: clampNumber(cellCountInput.value, 5, 40, 30),
    tomPattern: readPattern(tomStepA, tomStepB, [3, 1]),
    jerryPattern: readPattern(jerryStepA, jerryStepB, [1]),
    showTargets: showTargetsInput.checked,
  };

  cellCountInput.value = settings.cellCount;
  resetGame();
}

function changeStepperValue(button) {
  const input = document.querySelector(`#${button.dataset.stepTarget}`);
  const delta = Number(button.dataset.delta);
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const optional = input.dataset.optional === "true";
  const currentText = input.value.trim();

  if (!currentText) {
    if (delta > 0) {
      input.value = minimum;
      applySettings();
    }
    return;
  }

  const current = Number(input.value);
  if (optional && delta < 0 && current <= minimum) {
    input.value = "";
  } else {
    input.value = Math.min(Math.max(current + delta, minimum), maximum);
  }
  applySettings();
}

document.querySelector("#resetButton").addEventListener("click", resetGame);
undoButton.addEventListener("click", undoMove);
document.querySelector("#playAgainButton").addEventListener("click", resetGame);
settingsForm.addEventListener("submit", (event) => event.preventDefault());
settingsForm.querySelectorAll("[data-step-target]").forEach((button) => {
  button.addEventListener("click", () => changeStepperValue(button));
});
showTargetsInput.addEventListener("change", () => {
  settings.showTargets = showTargetsInput.checked;
  renderReachableCells();
});

resetGame();

window.addEventListener("resize", updateControls);
