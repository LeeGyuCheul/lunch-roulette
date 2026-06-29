const MEMBER_STORAGE_KEY = "lunch-roulette-members";
const FOOD_STORAGE_KEY = "lunch-roulette-foods";
const DEFAULT_MEMBERS = [
  "이명원",
  "김혜선",
  "황수찬",
  "전종찬",
  "이규철",
  "김형일",
  "박소연",
  "양현영",
  "이성윤",
  "윤진한",
  "이주희",
].map((name) => ({ name, excluded: false }));

const colors = ["#1f7a4d", "#f4bd43", "#d95d4f", "#4f7fd9", "#7b61d1", "#2a9d8f", "#f08a4b"];

const memberForm = document.querySelector("#memberForm");
const foodForm = document.querySelector("#foodForm");
const nameInput = document.querySelector("#nameInput");
const foodInput = document.querySelector("#foodInput");
const excludedMembersEl = document.querySelector("#excludedMembers");
const excludedFoodsEl = document.querySelector("#excludedFoods");
const memberCountEl = document.querySelector("#memberCount");
const excludedCountEl = document.querySelector("#excludedCount");
const candidateCountEl = document.querySelector("#candidateCount");
const foodCountEl = document.querySelector("#foodCount");
const foodResultEl = document.querySelector("#foodResult");
const vanResultEl = document.querySelector("#vanResult");
const spinButton = document.querySelector("#spinButton");
const modeButtons = document.querySelectorAll(".mode-tab");
const resetButton = document.querySelector("#resetButton");
const wheel = document.querySelector("#wheel");
const wheelDragLayer = document.querySelector("#wheelDragLayer");
const ctx = wheel.getContext("2d");

let members = loadMembers();
let foods = loadFoods();
let currentRotation = 0;
let isSpinning = false;
let wheelMode = "van";
let activeDrag = null;

function loadMembers() {
  try {
    const savedMembers = JSON.parse(localStorage.getItem(MEMBER_STORAGE_KEY));
    return restoreDefaultMembers(normalizeMembers(savedMembers || DEFAULT_MEMBERS));
  } catch {
    return normalizeMembers(DEFAULT_MEMBERS);
  }
}

function loadFoods() {
  try {
    const savedFoods = JSON.parse(localStorage.getItem(FOOD_STORAGE_KEY));
    return normalizeFoods(JSON.parse(JSON.stringify(savedFoods || [])));
  } catch {
    return [];
  }
}

function restoreDefaultMembers(items) {
  const existingNames = new Set(items.map((member) => member.name));
  const missingDefaults = DEFAULT_MEMBERS.filter((member) => !existingNames.has(member.name));
  return [...items, ...normalizeMembers(missingDefaults)];
}

function normalizeMembers(items) {
  const seen = new Set();
  const normalized = [];

  items.forEach((member) => {
    const name = String(typeof member === "string" ? member : member.name || "").trim();

    if (!name || seen.has(name)) {
      return;
    }

    seen.add(name);
    normalized.push({
      name,
      excluded: typeof member === "string" ? false : Boolean(member.excluded),
    });
  });

  return normalized;
}

function normalizeFoods(items) {
  const seen = new Set();
  const normalized = [];

  items.forEach((item) => {
    const name = String(typeof item === "string" ? item : item.name || item.food || "").trim();

    if (!name || seen.has(name)) {
      return;
    }

    seen.add(name);
    normalized.push({ name, excluded: typeof item === "string" ? false : Boolean(item.excluded) });
  });

  return normalized;
}

function saveMembers() {
  localStorage.setItem(MEMBER_STORAGE_KEY, JSON.stringify(members));
}

function saveFoods() {
  localStorage.setItem(FOOD_STORAGE_KEY, JSON.stringify(foods));
}

function splitFoods(value) {
  return value
    .split(",")
    .map((food) => food.trim())
    .filter(Boolean);
}

function getActiveMembers() {
  return members.filter((member) => !member.excluded);
}

function getActiveFoods() {
  return foods.filter((food) => !food.excluded);
}

function getWheelItems() {
  return wheelMode === "food" ? getActiveFoods() : getActiveMembers();
}

function renderAll() {
  renderModeTabs();
  renderExcludedMembers();
  renderExcludedFoods();
  drawWheel();
}

function renderModeTabs() {
  modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === wheelMode);
  });

  spinButton.textContent = wheelMode === "food" ? "음식 룰렛 돌리기" : "벤 담당 룰렛 돌리기";
}

function renderExcludedMembers() {
  const excludedMembers = members.filter((member) => member.excluded);
  memberCountEl.textContent = `${members.length}명`;
  excludedCountEl.textContent = `${excludedMembers.length}명`;
  excludedMembersEl.innerHTML = renderCards(excludedMembers, "member");
}

function renderExcludedFoods() {
  const excludedFoods = foods.filter((food) => food.excluded);
  foodCountEl.textContent = `${excludedFoods.length}개`;
  excludedFoodsEl.innerHTML = renderCards(excludedFoods, "food");
}

function renderCards(items, type) {
  if (items.length === 0) {
    return `<div class="empty">제외된 ${type === "food" ? "음식" : "멤버"}이 없습니다.</div>`;
  }

  return items
    .map((item) => {
      const source = type === "food" ? foods : members;
      const index = source.indexOf(item);

      return `
        <article class="member-card is-excluded" draggable="true" data-type="${type}" data-index="${index}">
          <div class="member-head">
            <div>
              <div class="member-name">${escapeHtml(item.name)}</div>
              <div class="van-badge">오늘 제외</div>
            </div>
            <div class="card-actions">
              <button class="toggle-button" type="button" data-type="${type}" data-index="${index}">복귀</button>
              <button class="remove-button" type="button" data-type="${type}" data-index="${index}" aria-label="${escapeHtml(item.name)} 복귀">×</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function drawWheel() {
  const items = getWheelItems();
  const labels = items.length ? items.map((item) => item.name) : ["후보 없음"];
  const size = wheel.width;
  const radius = size / 2;
  const slice = (Math.PI * 2) / labels.length;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(radius, radius);

  labels.forEach((label, index) => {
    const start = index * slice - Math.PI / 2;
    const end = start + slice;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius - 8, start, end);
    ctx.closePath();
    ctx.fillStyle = items.length ? colors[index % colors.length] : "#dbe2de";
    ctx.fill();

    ctx.save();
    ctx.rotate(start + slice / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = items.length ? "#ffffff" : "#69756f";
    ctx.font = "800 16px Malgun Gothic, Segoe UI, sans-serif";
    ctx.fillText(trimLabel(label), radius - 24, 6);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(0, 0, radius - 8, 0, Math.PI * 2);
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.restore();

  candidateCountEl.textContent = `${wheelMode === "food" ? "음식" : "벤 담당"} 후보 ${items.length}개`;
  renderWheelDragHandles(items);
}

function renderWheelDragHandles(items) {
  if (items.length === 0) {
    wheelDragLayer.innerHTML = "";
    return;
  }

  const source = wheelMode === "food" ? foods : members;
  const slice = 360 / items.length;

  wheelDragLayer.innerHTML = items
    .map((item, position) => {
      const index = source.indexOf(item);
      const angle = -90 + position * slice + slice / 2;
      const radian = (angle * Math.PI) / 180;
      const x = 50 + Math.cos(radian) * 35;
      const y = 50 + Math.sin(radian) * 35;

      return `
        <button
          class="wheel-token"
          draggable="true"
          data-type="${wheelMode === "food" ? "food" : "member"}"
          data-index="${index}"
          type="button"
          style="left: ${x}%; top: ${y}%"
          aria-label="${escapeHtml(item.name)} 제외"
        ></button>
      `;
    })
    .join("");
}

function trimLabel(label) {
  return label.length > 8 ? `${label.slice(0, 7)}...` : label;
}

function spinFood() {
  wheelMode = "food";
  drawWheel();

  const candidates = getActiveFoods();

  if (candidates.length === 0) {
    foodResultEl.textContent = "소울푸드에 음식 후보를 먼저 추가해주세요.";
    return;
  }

  spinCandidates(candidates, (selected) => {
    foodResultEl.textContent = selected.name;
    vanResultEl.textContent = "음식 룰렛에서 뽑혔습니다.";
  });
}

function spinVan() {
  wheelMode = "van";
  drawWheel();

  const candidates = getActiveMembers();

  if (candidates.length === 0) {
    vanResultEl.textContent = "참여 멤버가 없습니다.";
    return;
  }

  spinCandidates(candidates, (selected) => {
    vanResultEl.textContent = `오늘 벤 담당: ${selected.name}님`;
  });
}

function spinCandidates(candidates, onDone) {
  if (isSpinning) {
    return;
  }

  isSpinning = true;
  spinButton.disabled = true;
  modeButtons.forEach((button) => {
    button.disabled = true;
  });

  const selectedIndex = Math.floor(Math.random() * candidates.length);
  const sliceDeg = 360 / candidates.length;
  const targetDeg = 360 - (selectedIndex * sliceDeg + sliceDeg / 2);
  const extraTurns = 5 + Math.floor(Math.random() * 3);
  currentRotation += extraTurns * 360 + targetDeg - (currentRotation % 360);
  wheel.style.transform = `rotate(${currentRotation}deg)`;
  wheelDragLayer.style.transform = `rotate(${currentRotation}deg)`;

  window.setTimeout(() => {
    onDone(candidates[selectedIndex]);
    isSpinning = false;
    spinButton.disabled = false;
    modeButtons.forEach((button) => {
      button.disabled = false;
    });
  }, 3650);
}

function moveItem(type, index, excluded) {
  const source = type === "food" ? foods : members;

  if (!source[index]) {
    return;
  }

  source[index].excluded = excluded;
  type === "food" ? saveFoods() : saveMembers();
  renderAll();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

memberForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();

  if (!name) {
    return;
  }

  members.push({ name, excluded: false });
  saveMembers();
  renderAll();
  memberForm.reset();
  nameInput.focus();
});

foodForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const nextFoods = splitFoods(foodInput.value);

  if (nextFoods.length === 0) {
    return;
  }

  foods = normalizeFoods([...foods, ...nextFoods.map((name) => ({ name, excluded: false }))]);
  saveFoods();
  wheelMode = "food";
  renderAll();
  foodForm.reset();
  foodInput.focus();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-button, .toggle-button");

  if (!button) {
    return;
  }

  moveItem(button.dataset.type, Number(button.dataset.index), false);
});

document.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".member-card, .wheel-token");

  if (!card) {
    return;
  }

  activeDrag = {
    type: card.dataset.type,
    index: Number(card.dataset.index),
    fromWheel: card.classList.contains("wheel-token"),
  };
  event.dataTransfer.setData("text/plain", JSON.stringify(activeDrag));
  event.dataTransfer.effectAllowed = "move";
  card.classList.add("is-dragging");
});

document.addEventListener("dragend", (event) => {
  const draggedEl = event.target.closest(".member-card, .wheel-token");
  draggedEl?.classList.remove("is-dragging");
  document.querySelectorAll(".drop-zone").forEach((zone) => zone.classList.remove("is-over"));

  if (activeDrag?.fromWheel) {
    const droppedInWheel = Boolean(document.elementFromPoint(event.clientX, event.clientY)?.closest(".wheel-wrap"));

    if (!droppedInWheel) {
      moveItem(activeDrag.type, activeDrag.index, true);
    }
  }

  activeDrag = null;
});

document.querySelectorAll(".drop-zone").forEach((zone) => {
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("is-over");
  });

  zone.addEventListener("dragleave", () => {
    zone.classList.remove("is-over");
  });

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-over");

    const drag = activeDrag || JSON.parse(event.dataTransfer.getData("text/plain"));

    if (!drag) {
      return;
    }

    if (zone.classList.contains("wheel-wrap")) {
      moveItem(drag.type, drag.index, false);
      wheelMode = drag.type === "food" ? "food" : "van";
      drawWheel();
      return;
    }

    if (zone.dataset.type === drag.type) {
      moveItem(drag.type, drag.index, zone.dataset.excluded === "true");
    }
  });
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (isSpinning) {
      return;
    }

    wheelMode = button.dataset.mode;
    renderAll();
  });
});

spinButton.addEventListener("click", () => {
  if (wheelMode === "food") {
    spinFood();
    return;
  }

  spinVan();
});

resetButton.addEventListener("click", () => {
  members = normalizeMembers(DEFAULT_MEMBERS);
  foods = [];
  currentRotation = 0;
  wheelMode = "van";
  wheel.style.transform = "rotate(0deg)";
  wheelDragLayer.style.transform = "rotate(0deg)";
  saveMembers();
  saveFoods();
  foodResultEl.textContent = "아직 음식이 정해지지 않았습니다.";
  vanResultEl.textContent = "벤 담당자도 아직 정해지지 않았습니다.";
  renderAll();
});

saveMembers();
saveFoods();
renderAll();
