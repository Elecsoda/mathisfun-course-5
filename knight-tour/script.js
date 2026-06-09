const KNIGHT_MOVES = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];

const BOARD_TYPES = {
  "3x4": {
    rows: 3,
    cols: 4,
    label: "3 × 4",
  },
  "5x5": {
    rows: 5,
    cols: 5,
    label: "5 × 5",
  },
  "8x8": {
    rows: 8,
    cols: 8,
    label: "8 × 8",
  },
  cross: {
    rows: 4,
    cols: 4,
    label: "十字形",
    mask: new Set(["0,0", "0,3", "3,0", "3,3"]),
  },
};

const boardType = document.querySelector("#boardType");
const board = document.querySelector("#board");
const pathLayer = document.querySelector("#pathLayer");
const resetButton = document.querySelector("#resetButton");
const undoButton = document.querySelector("#undoButton");
const showMoves = document.querySelector("#showMoves");
const showDegrees = document.querySelector("#showDegrees");
const showOrder = document.querySelector("#showOrder");
const showPath = document.querySelector("#showPath");
const phaseText = document.querySelector("#phaseText");
const statusMessage = document.querySelector("#statusMessage");
const visitedCount = document.querySelector("#visitedCount");
const totalCount = document.querySelector("#totalCount");
const boardSizeNote = document.querySelector("#boardSizeNote");

let config = BOARD_TYPES[boardType.value];
let path = [];
let cellElements = new Map();

function key(row, col) {
  return `${row},${col}`;
}

function isValidCell(row, col) {
  return (
    row >= 0 &&
    row < config.rows &&
    col >= 0 &&
    col < config.cols &&
    !config.mask?.has(key(row, col))
  );
}

function activeCells() {
  const cells = [];
  for (let row = 0; row < config.rows; row += 1) {
    for (let col = 0; col < config.cols; col += 1) {
      if (isValidCell(row, col)) {
        cells.push({ row, col });
      }
    }
  }
  return cells;
}

function movesFrom(position, includeVisited = false) {
  const visited = new Set(path.map((step) => key(step.row, step.col)));
  return KNIGHT_MOVES.map(([rowDelta, colDelta]) => ({
    row: position.row + rowDelta,
    col: position.col + colDelta,
  })).filter(
    ({ row, col }) =>
      isValidCell(row, col) &&
      (includeVisited || !visited.has(key(row, col))),
  );
}

function isKnightMove(from, to) {
  const rowDistance = Math.abs(from.row - to.row);
  const colDistance = Math.abs(from.col - to.col);
  return (
    (rowDistance === 1 && colDistance === 2) ||
    (rowDistance === 2 && colDistance === 1)
  );
}

function calculateCellSize() {
  const boardSection = document.querySelector(".board-section");
  const boardCard = board.parentElement;
  const sectionWidth =
    boardSection.clientWidth || document.documentElement.clientWidth - 20;
  const cardStyle = window.getComputedStyle(boardCard);
  const horizontalPadding =
    Number.parseFloat(cardStyle.paddingLeft) +
    Number.parseFloat(cardStyle.paddingRight);
  const availableWidth = Math.min(sectionWidth - horizontalPadding, 720);
  return Math.max(28, Math.min(88, availableWidth / config.cols));
}

function setMessage(text, type = "") {
  statusMessage.textContent = text;
  statusMessage.className = `status-message${type ? ` ${type}` : ""}`;
}

function buildBoard() {
  cellElements = new Map();
  board.replaceChildren();
  board.style.setProperty("--rows", config.rows);
  board.style.setProperty("--cols", config.cols);
  board.style.setProperty("--cell-size", `${calculateCellSize()}px`);

  for (let row = 0; row < config.rows; row += 1) {
    for (let col = 0; col < config.cols; col += 1) {
      const cell = document.createElement("button");
      const cellKey = key(row, col);
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("role", "gridcell");

      if (!isValidCell(row, col)) {
        cell.classList.add("masked");
        cell.tabIndex = -1;
      } else {
        cell.addEventListener("click", () => handleCellClick(row, col));
        cellElements.set(cellKey, cell);
      }
      board.appendChild(cell);
    }
  }
}

function renderPath() {
  pathLayer.replaceChildren();
  const boardRect = board.getBoundingClientRect();
  const cardRect = board.parentElement.getBoundingClientRect();
  pathLayer.setAttribute("width", boardRect.width);
  pathLayer.setAttribute("height", boardRect.height);
  pathLayer.style.left = `${boardRect.left - cardRect.left}px`;
  pathLayer.style.top = `${boardRect.top - cardRect.top}px`;
  pathLayer.setAttribute("viewBox", `0 0 ${boardRect.width} ${boardRect.height}`);

  if (!showPath.checked || path.length < 2) {
    return;
  }

  const cellSize = boardRect.width / config.cols;
  const center = ({ row, col }) => ({
    x: col * cellSize + cellSize / 2,
    y: row * cellSize + cellSize / 2,
  });

  path.slice(1).forEach((step, index) => {
    const start = center(path[index]);
    const end = center(step);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    line.setAttribute("x2", end.x);
    line.setAttribute("y2", end.y);
    line.setAttribute("class", "path-line");
    pathLayer.appendChild(line);
  });

  if (
    path.length === activeCells().length &&
    isKnightMove(path[path.length - 1], path[0])
  ) {
    const start = center(path[path.length - 1]);
    const end = center(path[0]);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    line.setAttribute("x2", end.x);
    line.setAttribute("y2", end.y);
    line.setAttribute("class", "path-line closing-line");
    pathLayer.appendChild(line);
  }
}

function render() {
  const total = activeCells().length;
  const current = path[path.length - 1];
  const available = current ? movesFrom(current) : [];
  const availableKeys = new Set(available.map(({ row, col }) => key(row, col)));
  const visitOrder = new Map(
    path.map((step, index) => [key(step.row, step.col), index + 1]),
  );

  cellElements.forEach((cell, cellKey) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const order = visitOrder.get(cellKey);
    const isCurrent = current && row === current.row && col === current.col;
    const isAvailable = availableKeys.has(cellKey);
    cell.replaceChildren();
    cell.className = "cell";

    if (order) {
      cell.classList.add("visited");
      if (showOrder.checked && !isCurrent) {
        const orderLabel = document.createElement("span");
        orderLabel.className = "move-order";
        orderLabel.textContent = String(order);
        cell.appendChild(orderLabel);
      }
      cell.setAttribute("aria-label", `第 ${order} 步经过的格子`);
    } else {
      cell.classList.add("unvisited");
    }

    if (path.length === 0) {
      cell.classList.add("startable");
      cell.setAttribute("aria-label", "可选择为起点");
    } else if (isAvailable) {
      cell.classList.add("available");
      cell.setAttribute("aria-label", "骑士下一步可到达");
      if (showMoves.checked && showDegrees.checked) {
        const degree = document.createElement("span");
        degree.className = "degree";
        degree.textContent = String(movesFrom({ row, col }).length);
        cell.appendChild(degree);
      }
    }

    if (isCurrent) {
      cell.classList.add("current");
      const knight = document.createElement("span");
      knight.className = "knight";
      knight.textContent = "♞";
      knight.setAttribute("aria-hidden", "true");
      cell.appendChild(knight);
    }

    if (!showMoves.checked && isAvailable) {
      cell.classList.remove("available");
    }
  });

  visitedCount.textContent = String(path.length);
  totalCount.textContent = String(total);
  undoButton.disabled = path.length === 0;

  if (path.length === 0) {
    phaseText.textContent = "请选择起始位置";
    setMessage("请点击一个格子选择起始位置");
  } else if (path.length === total) {
    const closed = isKnightMove(path[path.length - 1], path[0]);
    phaseText.textContent = closed ? "完成闭合回路" : "完成骑士巡游";
    setMessage(
      closed
        ? "太棒了！你走遍了所有格子，最后还能一步跳回起点，形成了骑士回路。"
        : "你已经走遍所有格子！",
      "success",
    );
  } else if (available.length === 0) {
    phaseText.textContent = "当前路线无路可走";
    setMessage(
      `游戏结束！骑士无法继续移动了。你访问了 ${path.length} 个格子，还剩 ${total - path.length} 个格子未访问。`,
      "stuck",
    );
  } else {
    phaseText.textContent = `请选择第 ${path.length + 1} 步`;
    setMessage(
      `还有 ${total - path.length} 个格子未访问，当前有 ${available.length} 个落点可选。`,
      "playing",
    );
  }

  window.requestAnimationFrame(renderPath);
}

function handleCellClick(row, col) {
  if (path.length === 0) {
    path.push({ row, col });
    render();
    return;
  }

  const current = path[path.length - 1];
  const legal = movesFrom(current).some(
    (move) => move.row === row && move.col === col,
  );

  if (legal) {
    path.push({ row, col });
    render();
    return;
  }

  const alreadyVisited = path.some(
    (step) => step.row === row && step.col === col,
  );
  setMessage(
    alreadyVisited
      ? "这个格子已经走过了，每个格子只能经过一次。"
      : "骑士不能一步跳到这里，请选择符合“日”字走法的格子。",
    "stuck",
  );
}

function resetGame() {
  config = BOARD_TYPES[boardType.value];
  path = [];
  buildBoard();
  boardSizeNote.textContent = `${config.label} 棋盘，共 ${activeCells().length} 个可走格子`;
  render();
}

boardType.addEventListener("change", resetGame);
resetButton.addEventListener("click", resetGame);
undoButton.addEventListener("click", () => {
  path.pop();
  render();
});
[showMoves, showDegrees, showOrder, showPath].forEach((control) => {
  control.addEventListener("change", render);
});

window.addEventListener("resize", () => {
  board.style.setProperty("--cell-size", `${calculateCellSize()}px`);
  window.requestAnimationFrame(renderPath);
});

window.visualViewport?.addEventListener("resize", () => {
  board.style.setProperty("--cell-size", `${calculateCellSize()}px`);
  window.requestAnimationFrame(renderPath);
});

resetGame();
