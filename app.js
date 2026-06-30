import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDM3cetpAhdTsaybl6k0pgTRq9mCmd4wfE",
  authDomain: "lunch-roulette-a3094.firebaseapp.com",
  projectId: "lunch-roulette-a3094",
  storageBucket: "lunch-roulette-a3094.firebasestorage.app",
  messagingSenderId: "904405175309",
  appId: "1:904405175309:web:8f68ade5c11a0845265944",
  measurementId: "G-KRRGTQ6FMW",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const stateRef = doc(db, "lunchRoulette", "sharedState");
const LEGACY_FOOD_STORAGE_KEY = "lunch-roulette-foods";
const LEGACY_MEMBER_STORAGE_KEY = "lunch-roulette-members";
const CLIENT_ID_STORAGE_KEY = "lunch-roulette-client-id";
const CONTROL_LOCK_MS = 45_000;
const SPIN_DURATION_MS = 3_650;
const MAX_FOODS_PER_WINNER = 3;

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

const DEFAULT_RESULTS = {
  foodText: "아직 음식이 정해지지 않았습니다.",
  vanText: "벤 담당자도 아직 정해지지 않았습니다.",
};

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
const lockStatusEl = document.querySelector("#lockStatus");
const spinButton = document.querySelector("#spinButton");
const modeButtons = document.querySelectorAll(".mode-tab");
const resetButton = document.querySelector("#resetButton");
const wheel = document.querySelector("#wheel");
const wheelDragLayer = document.querySelector("#wheelDragLayer");
const ctx = wheel.getContext("2d");

let members = normalizeMembers(DEFAULT_MEMBERS);
let foods = [];
let results = { ...DEFAULT_RESULTS };
let currentRotation = 0;
let isSpinning = false;
let wheelMode = "van";
let activeDrag = null;
let hasRemoteState = false;
let controlLock = null;
let activeSpin = null;
let lastAppliedSpinId = "";
const clientId = getClientId();

function getClientId() {
  const savedId = sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);

  if (savedId) {
    return savedId;
  }

  const nextId = crypto.randomUUID();
  sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, nextId);
  return nextId;
}

function normalizeMembers(items) {
  const seen = new Set();
  const normalized = [];

  (Array.isArray(items) ? items : []).forEach((member) => {
    const name = String(typeof member === "string" ? member : member?.name || "").trim();

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

function restoreDefaultMembers(items) {
  const existingNames = new Set(items.map((member) => member.name));
  const missingDefaults = DEFAULT_MEMBERS.filter((member) => !existingNames.has(member.name));
  return [...items, ...normalizeMembers(missingDefaults)];
}

function normalizeFoods(items) {
  const seen = new Set();
  const normalized = [];

  (Array.isArray(items) ? items : []).forEach((item) => {
    const name = String(typeof item === "string" ? item : item?.name || item?.food || "").trim();

    if (!name || seen.has(name)) {
      return;
    }

    seen.add(name);
    normalized.push({
      name,
      excluded: typeof item === "string" ? false : Boolean(item.excluded),
      cooldownDate: typeof item === "string" ? "" : normalizeDateValue(item.cooldownDate),
    });
  });

  return normalized;
}

function normalizeDateValue(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function getKstDate(offsetDays = 0) {
  const kstNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  kstNow.setDate(kstNow.getDate() + offsetDays);

  const year = kstNow.getFullYear();
  const month = String(kstNow.getMonth() + 1).padStart(2, "0");
  const day = String(kstNow.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isFoodCoolingDown(food) {
  return food?.cooldownDate === getKstDate();
}

function loadLegacyFoods() {
  try {
    const savedFoods = JSON.parse(localStorage.getItem(LEGACY_FOOD_STORAGE_KEY)) || [];
    const savedMembers = JSON.parse(localStorage.getItem(LEGACY_MEMBER_STORAGE_KEY)) || [];
    const memberFoods = Array.isArray(savedMembers)
      ? savedMembers.flatMap((member) => (Array.isArray(member?.foods) ? member.foods : []))
      : [];

    return normalizeFoods([...savedFoods, ...memberFoods]);
  } catch {
    return [];
  }
}

function normalizeResults(value) {
  return {
    foodText: String(value?.foodText || DEFAULT_RESULTS.foodText),
    vanText: String(value?.vanText || DEFAULT_RESULTS.vanText),
  };
}

function normalizeLock(value) {
  return {
    clientId: String(value?.clientId || ""),
    expiresAt: Number(value?.expiresAt || 0),
  };
}

function normalizeSpin(value) {
  if (!value?.id) {
    return null;
  }

  return {
    id: String(value?.id || ""),
    mode: value?.mode === "food" ? "food" : value?.mode === "van" ? "van" : "",
    selectedName: String(value?.selectedName || ""),
    finalRotation: Number(value?.finalRotation || 0),
    startedAt: Number(value?.startedAt || 0),
    duration: Number(value?.duration || SPIN_DURATION_MS),
    clientId: String(value?.clientId || ""),
  };
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
  return foods.filter((food) => !food.excluded && !isFoodCoolingDown(food));
}

function getWheelItems() {
  return wheelMode === "food" ? getActiveFoods() : getActiveMembers();
}

function renderAll() {
  renderModeTabs();
  renderLockStatus();
  renderExcludedMembers();
  renderExcludedFoods();
  renderResults();
  drawWheel();
}

function isLockedByOther() {
  return controlLock?.clientId && controlLock.clientId !== clientId && controlLock.expiresAt > Date.now();
}

function ownsLock() {
  return controlLock?.clientId === clientId && controlLock.expiresAt > Date.now();
}

function renderLockStatus() {
  const lockedByOther = isLockedByOther();
  const watchingSpin = isSpinning && !ownsLock();
  const disabled = lockedByOther || isSpinning;

  lockStatusEl.textContent = lockedByOther
    ? watchingSpin
      ? "다른 자리에서 룰렛을 돌리는 중입니다."
      : "다른 사용자가 조작 중입니다. 잠시 후 다시 시도하세요."
    : ownsLock()
      ? "현재 이 브라우저가 조작권을 가지고 있습니다."
      : "조작 가능";
  lockStatusEl.classList.toggle("is-locked", lockedByOther);

  nameInput.disabled = disabled;
  foodInput.disabled = disabled;
  memberForm.querySelector("button").disabled = disabled;
  foodForm.querySelector("button").disabled = disabled;
  resetButton.disabled = disabled;
  spinButton.disabled = disabled;
  modeButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function renderModeTabs() {
  modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === wheelMode);
  });

  spinButton.textContent = "GO";
}

function renderExcludedMembers() {
  const excludedMembers = members.filter((member) => member.excluded);
  memberCountEl.textContent = `${members.length}명`;
  excludedCountEl.textContent = `${excludedMembers.length}명`;
  excludedMembersEl.innerHTML = renderCards(excludedMembers, "member");
}

function renderExcludedFoods() {
  const excludedFoods = foods.filter((food) => food.excluded || isFoodCoolingDown(food));
  foodCountEl.textContent = `${excludedFoods.length}개`;
  excludedFoodsEl.innerHTML = renderCards(excludedFoods, "food");
}

function renderResults() {
  foodResultEl.textContent = results.foodText;
  vanResultEl.textContent = results.vanText;
}

function setWheelTransition(enabled, duration = SPIN_DURATION_MS) {
  const transition = enabled ? `transform ${duration}ms cubic-bezier(0.12, 0.75, 0.14, 1)` : "none";
  wheel.style.transition = transition;
  wheelDragLayer.style.transition = transition;
}

function renderCards(items, type) {
  if (items.length === 0) {
    return `<div class="empty">제외된 ${type === "food" ? "음식" : "멤버"}이 없습니다.</div>`;
  }

  return items
    .map((item) => {
      const source = type === "food" ? foods : members;
      const index = source.indexOf(item);
      const isAutoExcludedFood = type === "food" && isFoodCoolingDown(item) && !item.excluded;
      const disabled = isLockedByOther() || isAutoExcludedFood;
      const badgeText = isAutoExcludedFood ? "오늘 자동 제외" : "오늘 제외";
      const restoreLabel = isAutoExcludedFood ? "자동" : "복귀";

      return `
        <article class="member-card is-excluded" draggable="${!disabled}" data-type="${type}" data-index="${index}">
          <div class="member-head">
            <div>
              <div class="member-name">${escapeHtml(item.name)}</div>
              <div class="van-badge">${badgeText}</div>
            </div>
            <div class="card-actions">
              <button class="toggle-button" type="button" data-type="${type}" data-index="${index}" ${disabled ? "disabled" : ""}>${restoreLabel}</button>
              <button class="remove-button" type="button" data-type="${type}" data-index="${index}" aria-label="${escapeHtml(item.name)} 복귀" ${disabled ? "disabled" : ""}>×</button>
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
          draggable="${!isLockedByOther()}"
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

async function spinFood() {
  if (!(await acquireControl())) {
    return;
  }

  wheelMode = "food";
  renderAll();

  const candidates = getActiveFoods();

  if (candidates.length === 0) {
    results.foodText = "소울푸드에 음식 후보를 먼저 추가해주세요.";
    renderResults();
    await releaseControl();
    return;
  }

  await spinCandidates(candidates, async (selected) => {
    results.foodText = selected.name;
    results.vanText = "음식 룰렛에서 뽑혔습니다.";
    selected.cooldownDate = getKstDate(1);
    await persistState({ spin: null });
  });
}

async function spinVan() {
  if (!(await acquireControl())) {
    return;
  }

  wheelMode = "van";
  renderAll();

  const candidates = getActiveMembers();

  if (candidates.length === 0) {
    results.vanText = "참여 멤버가 없습니다.";
    renderResults();
    await releaseControl();
    return;
  }

  await spinCandidates(candidates, async (selected) => {
    results.vanText = `오늘 벤 담당: ${selected.name}님`;
    await persistState({ spin: null });
  });
}

async function spinCandidates(candidates, onDone) {
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
  activeSpin = {
    id: crypto.randomUUID(),
    mode: wheelMode,
    selectedName: candidates[selectedIndex].name,
    finalRotation: currentRotation,
    startedAt: Date.now(),
    duration: SPIN_DURATION_MS,
    clientId,
  };
  lastAppliedSpinId = activeSpin.id;
  await setDoc(stateRef, { spin: activeSpin, lock: controlLock, updatedAt: serverTimestamp() }, { merge: true });
  setWheelTransition(true, SPIN_DURATION_MS);
  wheel.style.transform = `rotate(${currentRotation}deg)`;
  wheelDragLayer.style.transform = `rotate(${currentRotation}deg)`;

  window.setTimeout(async () => {
    await onDone(candidates[selectedIndex]);
    isSpinning = false;
    activeSpin = null;
    await releaseControl();
    renderResults();
    spinButton.disabled = false;
    modeButtons.forEach((button) => {
      button.disabled = false;
    });
  }, SPIN_DURATION_MS);
}

async function moveItem(type, index, excluded) {
  if (!(await acquireControl())) {
    return;
  }

  const source = type === "food" ? foods : members;

  if (!source[index]) {
    return;
  }

  if (type === "food" && !excluded && isFoodCoolingDown(source[index])) {
    window.alert("어제 선택된 음식이라 오늘은 자동 제외됩니다. 내일부터 다시 후보에 들어갑니다.");
    await releaseControl();
    return;
  }

  source[index].excluded = excluded;
  renderAll();
  await persistState();
  await releaseControl();
}

function buildStatePayload(extra = {}) {
  return {
    members,
    foods,
    results,
    lock: ownsLock() ? controlLock : null,
    spin: activeSpin,
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

async function acquireControl() {
  if (ownsLock()) {
    controlLock = { clientId, expiresAt: Date.now() + CONTROL_LOCK_MS };
    return true;
  }

  try {
    const nextLock = { clientId, expiresAt: Date.now() + CONTROL_LOCK_MS };

    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(stateRef);
      const remoteLock = normalizeLock(snapshot.data()?.lock);

      if (remoteLock.clientId && remoteLock.clientId !== clientId && remoteLock.expiresAt > Date.now()) {
        throw new Error("LOCKED_BY_OTHER");
      }

      transaction.set(stateRef, { lock: nextLock, updatedAt: serverTimestamp() }, { merge: true });
    });

    controlLock = nextLock;
    renderAll();
    return true;
  } catch (error) {
    if (error.message === "LOCKED_BY_OTHER") {
      window.alert("다른 사용자가 조작 중입니다. 잠시 후 다시 시도해주세요.");
      return false;
    }

    console.error("조작권 획득 실패", error);
    window.alert("조작권을 가져오지 못했습니다. 네트워크나 Firestore 설정을 확인해주세요.");
    return false;
  }
}

async function persistState(extra = {}) {
  try {
    await setDoc(stateRef, buildStatePayload(extra), { merge: true });
  } catch (error) {
    console.error("Firestore 저장 실패", error);
    window.alert("공용 저장소에 저장하지 못했습니다. Firestore 규칙과 네트워크를 확인해주세요.");
  }
}

async function releaseControl() {
  if (!ownsLock()) {
    return;
  }

  controlLock = null;
  renderAll();

  try {
    await setDoc(stateRef, { lock: null, spin: activeSpin, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    console.error("조작권 해제 실패", error);
  }
}

function applyRemoteSpin(spin) {
  if (!spin?.id || spin.id === lastAppliedSpinId || spin.clientId === clientId) {
    return;
  }

  const elapsed = Date.now() - spin.startedAt;

  if (elapsed >= spin.duration + 1_000) {
    return;
  }

  activeSpin = spin;
  lastAppliedSpinId = spin.id;
  wheelMode = spin.mode;
  currentRotation = spin.finalRotation;
  isSpinning = true;
  renderAll();

  if (elapsed > 0) {
    setWheelTransition(false);
    wheel.style.transform = `rotate(${spin.finalRotation - 360}deg)`;
    wheelDragLayer.style.transform = `rotate(${spin.finalRotation - 360}deg)`;
    wheel.offsetHeight;
  }

  setWheelTransition(true, Math.max(0, spin.duration - elapsed));
  wheel.style.transform = `rotate(${spin.finalRotation}deg)`;
  wheelDragLayer.style.transform = `rotate(${spin.finalRotation}deg)`;

  window.setTimeout(() => {
    if (lastAppliedSpinId !== spin.id) {
      return;
    }

    isSpinning = false;
    activeSpin = null;
    renderAll();
  }, Math.max(0, spin.duration - elapsed));
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

memberForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();

  if (!name) {
    window.alert("멤버 이름을 입력해주세요.");
    return;
  }

  if (members.some((member) => member.name === name)) {
    window.alert("이미 등록된 멤버입니다.");
    nameInput.focus();
    return;
  }

  if (!(await acquireControl())) {
    return;
  }

  members = normalizeMembers([...members, { name, excluded: false }]);
  renderAll();
  await persistState();
  await releaseControl();
  memberForm.reset();
  nameInput.focus();
});

foodForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const nextFoods = splitFoods(foodInput.value);

  if (nextFoods.length === 0) {
    window.alert("음식 후보를 입력해주세요.");
    return;
  }

  if (nextFoods.length > MAX_FOODS_PER_WINNER) {
    window.alert(`벤픽 당첨자는 음식 후보를 최대 ${MAX_FOODS_PER_WINNER}개까지만 등록할 수 있습니다.`);
    foodInput.focus();
    return;
  }

  const existingFoodNames = new Set(foods.map((food) => food.name));
  const uniqueFoods = nextFoods.filter((food, index) => nextFoods.indexOf(food) === index && !existingFoodNames.has(food));

  if (uniqueFoods.length === 0) {
    window.alert("이미 등록된 음식 후보입니다.");
    foodInput.focus();
    return;
  }

  if (uniqueFoods.length !== nextFoods.length) {
    window.alert("중복 음식은 제외하고 추가합니다.");
  }

  if (!(await acquireControl())) {
    return;
  }

  foods = normalizeFoods([...foods, ...uniqueFoods.map((name) => ({ name, excluded: false }))]);
  wheelMode = "food";
  renderAll();
  await persistState();
  await releaseControl();
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
  if (isLockedByOther()) {
    event.preventDefault();
    return;
  }

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
      wheelMode = drag.type === "food" ? "food" : "van";
      moveItem(drag.type, drag.index, false);
      return;
    }

    if (zone.dataset.type === drag.type) {
      moveItem(drag.type, drag.index, zone.dataset.excluded === "true");
    }
  });
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (isSpinning || isLockedByOther()) {
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

resetButton.addEventListener("click", async () => {
  if (!(await acquireControl())) {
    return;
  }

  members = normalizeMembers(DEFAULT_MEMBERS);
  foods = [];
  results = { ...DEFAULT_RESULTS };
  currentRotation = 0;
  activeSpin = null;
  wheelMode = "van";
  wheel.style.transform = "rotate(0deg)";
  wheelDragLayer.style.transform = "rotate(0deg)";
  renderAll();
  await persistState();
  await releaseControl();
});

onSnapshot(
  stateRef,
  async (snapshot) => {
    const legacyFoods = loadLegacyFoods();

    if (!snapshot.exists()) {
      members = normalizeMembers(DEFAULT_MEMBERS);
      foods = legacyFoods;
      results = { ...DEFAULT_RESULTS };
      renderAll();
      await persistState();
      hasRemoteState = true;
      return;
    }

    const data = snapshot.data();
    members = restoreDefaultMembers(normalizeMembers(data.members || DEFAULT_MEMBERS));
    const remoteFoods = normalizeFoods(data.foods || []);
    foods = normalizeFoods([...remoteFoods, ...legacyFoods]);
    results = normalizeResults(data.results || DEFAULT_RESULTS);
    controlLock = normalizeLock(data.lock);
    activeSpin = normalizeSpin(data.spin);
    hasRemoteState = true;
    renderAll();
    applyRemoteSpin(activeSpin);

    if (foods.length !== remoteFoods.length) {
      await persistState();
    }
  },
  (error) => {
    console.error("Firestore 구독 실패", error);
    results.vanText = "Firestore 연결에 실패했습니다. 규칙과 네트워크를 확인해주세요.";
    renderAll();
  },
);

renderAll();
window.setInterval(renderLockStatus, 1000);
