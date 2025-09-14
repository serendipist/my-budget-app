// app.js - API_ENDPOINT 및 API_KEY 연동 버전

// ▼▼▼ 사용하실 API 엔드포인트와 키로 반드시 교체해주세요! ▼▼▼
const API_ENDPOINT = "https://budget-api-166126275494.asia-northeast3.run.app";
const API_KEY = "LovelyNaonDaon";
// ▲▲▲ 사용하실 API 엔드포인트와 키를 다시 한번 확인해주세요. ▲▲▲

/* === 전역 상태 === */
// config.js 파일에서 API_ENDPOINT와 API_KEY를 불러옵니다.
let currentDisplayDate = new Date();
let currentCycleMonth = '';
let cardPerformanceMonthDate = new Date();
let cardBillingCycleDate = new Date();
let expenseCategoriesData = {};
let paymentMethodsData = [];
let incomeSourcesData = [];
let currentEditingTransaction = null;

/* === 새로운 API 호출 헬퍼 함수 === */
/**
 * 새로운 Cloud Run API 서버와 통신하는 중앙 함수
 * @param {string} path - 요청할 경로 (예: '/transactions')
 * @param {string} method - HTTP 메소드 (예: 'GET', 'POST', 'DELETE')
 * @param {object} params - 쿼리 파라미터 또는 요청 본문
 * @returns {Promise<any>}
 */
async function callApi(path, method = 'GET', params = {}) {
  const url = new URL(API_ENDPOINT + path);
  const options = {
    method,
    headers: {
      'X-API-KEY': API_KEY, // config.js의 API 키 사용
      'Content-Type': 'application/json'
    }
  };

  if (method === 'GET') {
    // GET 요청의 경우 파라미터를 URL에 추가
    for (const key in params) {
      if (params[key]) {
        url.searchParams.append(key, params[key]);
      }
    }
  } else {
    // POST, PUT 등의 경우 파라미터를 body에 포함
    options.body = JSON.stringify(params);
  }

  console.log(`[API] Calling: ${method} ${url.toString()}`);
  try {
    const response = await fetch(url.toString(), options);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[API] Call to "${path}" failed with status ${response.status}: ${errorText}`);
      throw new Error(`서버 응답 오류 (${response.status})`);
    }
    const result = await response.json();
    if (result.success === false) {
      console.error(`[API] Action "${path}" returned an error:`, result.error);
      throw new Error(result.error || `"${path}" API 요청 실패`);
    }
    return result.data !== undefined ? result.data : result;
  } catch (error) {
    console.error(`[API] Error calling action "${path}":`, error);
    if (typeof showToast === 'function') {
      showToast(`API 요청 중 오류: ${error.message}`, true);
    }
    throw error;
  }
}


/* === 뷰포트 높이 CSS 변수 갱신 === */
function setViewportHeightVar() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h}px`);
}
['load', 'resize', 'orientationchange'].forEach(evt => window.addEventListener(evt, setViewportHeightVar));
setViewportHeightVar();


/* === 페이지 로드 순서 === */
window.onload = async () => {
  console.log("[App.js] window.onload triggered");
  determineInitialCycleMonth();
  setupEventListeners();

  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';

  try {
    await loadInitialData();
    await updateCalendarDisplay();
  } catch (error) {
    console.error("[App.js] Error during initial data loading:", error);
    if (typeof showToast === 'function') showToast("초기 데이터 로딩 중 오류가 발생했습니다. 페이지를 새로고침해주세요.", true);
  } finally {
    if (loader) loader.style.display = 'none';
  }

  showView('calendarView');
  toggleTypeSpecificFields();
  const transactionModal = document.getElementById('transactionModal');
  if (transactionModal) transactionModal.style.display = 'none';

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' })
      .then(registration => { console.log('[App.js] Service Worker 등록 성공. Scope:', registration.scope); })
      .catch(error => { console.error('[App.js] Service Worker 등록 실패:', error); });
  }
};

/* === 이벤트 리스너 설정 === */
function setupEventListeners() {
  document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('mainCategory').addEventListener('change', updateSubCategories);
  setupSwipeListeners();
  document.getElementById('searchBtn').addEventListener('click', handleSearch);
  // 기존 이벤트 리스너들...
}


/* === 주기 계산 & 달력 === */
function determineInitialCycleMonth() {
  const today = new Date();
  let year = today.getFullYear();
  let mIdx = today.getDate() < 18 ? today.getMonth() - 1 : today.getMonth();
  if (mIdx < 0) { mIdx = 11; year -= 1; }
  currentDisplayDate = new Date(year, mIdx, 18);
  currentCycleMonth = `${year}-${String(mIdx + 1).padStart(2, '0')}`;
  console.log("[App.js] Initial cycle month determined:", currentCycleMonth);
}

async function changeMonth(delta) {
  currentDisplayDate.setMonth(currentDisplayDate.getMonth() + delta);
  const y = currentDisplayDate.getFullYear();
  const m = currentDisplayDate.getMonth();
  currentCycleMonth = `${y}-${String(m + 1).padStart(2, '0')}`;
  await updateCalendarDisplay();
}

// [수정됨] getTransactions 함수 대신 updateCalendarDisplay에서 직접 API 호출
async function updateCalendarDisplay() {
  const loader = document.getElementById('loader');
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error('calendarBody not found'); return; }
  if (loader) loader.style.display = 'block';

  console.log('[App.js] updateCalendarDisplay →', currentCycleMonth);
  
  const cacheKey = 'transactions_' + currentCycleMonth;
  const cachedDataString = localStorage.getItem(cacheKey);
  let renderedFromCache = false;
  
  if (cachedDataString) {
      try {
          const cachedArr = JSON.parse(cachedDataString);
          renderCalendarAndSummary(cachedArr);
          renderedFromCache = true;
          console.log('[App.js] drew calendar from localStorage');
      } catch(e) {
          localStorage.removeItem(cacheKey);
      }
  } else {
    renderCalendarAndSummary([]); // 캐시 없으면 빈 화면 먼저 그리기
  }

  try {
    // 새로운 callApi 함수를 사용하여 데이터 요청
    const latestTransactions = await callApi('/transactions', 'GET', { cycleMonth: currentCycleMonth });
    
    localStorage.setItem(cacheKey, JSON.stringify(latestTransactions));
    
    // 캐시된 데이터와 비교하여 변경되었을 경우에만 다시 렌더링
    if (!renderedFromCache || JSON.stringify(JSON.parse(cachedDataString || '[]')) !== JSON.stringify(latestTransactions)) {
        renderCalendarAndSummary(latestTransactions);
        if (renderedFromCache) {
            showToast?.('달력 정보가 업데이트 되었습니다.', false);
        }
    }
  } catch (err) {
    console.error('[App.js] getTransactions failed', err);
    if (!renderedFromCache) renderCalendarAndSummary([]); // API 실패 시 빈 화면 표시
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

function renderCalendarAndSummary(transactions) {
  if (!currentCycleMonth) { console.error("renderCalendarAndSummary: currentCycleMonth is not set."); return; }
  const parts = currentCycleMonth.split('-');
  if (parts.length < 2) { console.error("renderCalendarAndSummary: currentCycleMonth format is incorrect.", currentCycleMonth); return; }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  document.getElementById('currentMonthYear').textContent = `${year}년 ${String(month).padStart(2, '0')}월 주기`;
  renderCalendar(year, month, transactions);
  updateSummary(transactions);
}

function renderCalendar(year, monthOneBased, transactions) {
  const calendarBody = document.getElementById('calendarBody');
  calendarBody.innerHTML = '';
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const transMap = {};
  (transactions || []).forEach(t => {
    if (t && t.date) { (transMap[t.date] = transMap[t.date] || []).push(t); }
  });
  const cycleStart = new Date(year, monthOneBased - 1, 18);
  const cycleEnd = new Date(year, monthOneBased, 17);
  let cur = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < cycleStart.getDay(); i++) {
    const td = document.createElement('td'); td.className = 'other-month'; weekRow.appendChild(td);
  }
  while (cur <= cycleEnd) {
    const td = document.createElement('td');
    const dStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    if (dStr === todayStr) {
      td.classList.add('today');
    }
    td.dataset.date = dStr; td.onclick = () => openModal(dStr);
    const num = document.createElement('span');
    num.className = 'date-number';
    num.textContent = cur.getDate();
    td.appendChild(num);
    const wrap = document.createElement('div');
    wrap.className = 'txn-wrap';
    const list = transMap[dStr] || [];
    list.slice(0, 4).forEach(t => {
      const div = document.createElement('div');
      div.className = `txn-item ${t.type === '수입' ? 'income' : 'expense'}`;
      div.textContent = `${Number(t.amount).toLocaleString()}원`;
      wrap.appendChild(div);
    });
    if (list.length > 4) {
      const more = document.createElement('div');
      more.className = 'more-link';
      more.textContent = `+${list.length - 4}`;
      more.onclick = e => { e.stopPropagation(); openModal(dStr); }
      wrap.appendChild(more);
    }
    td.appendChild(wrap);
    weekRow.appendChild(td);
    if (cur.getDay() === 6 || cur.getTime() === cycleEnd.getTime()) {
      if (cur.getTime() === cycleEnd.getTime() && cur.getDay() !== 6) {
        for (let i = cur.getDay() + 1; i <= 6; i++) {
          const empty = document.createElement('td');
          empty.className = 'other-month';
          weekRow.appendChild(empty);
        }
      }
      frag.appendChild(weekRow);
      if (cur.getTime() !== cycleEnd.getTime()) weekRow = document.createElement('tr');
    }
    cur.setDate(cur.getDate() + 1);
  }
  calendarBody.appendChild(frag);
}

function updateSummary(transactions) {
  let inc = 0, exp = 0;
  (transactions || []).forEach(t => { if (t && typeof t.amount !== 'undefined') { const a = Number(t.amount) || 0; if (t.type === '수입') inc += a; else exp += a; } });
  const bal = inc - exp;
  document.getElementById('totalIncome').textContent = `₩${inc.toLocaleString()}`;
  document.getElementById('totalExpense').textContent = `₩${exp.toLocaleString()}`;
  const balEl = document.getElementById('totalBalance');
  balEl.textContent = `₩${bal.toLocaleString()}`; balEl.className = 'total-balance';
  if (bal < 0) balEl.classList.add('negative');
}

// [수정됨] 초기 데이터를 새로운 API로 호출
async function loadInitialData() {
  console.log("[App.js] loadInitialData: Fetching app setup data via new API...");
  try {
    const setupData = await callApi('/setup-data', 'GET'); // 새 엔드포인트 호출
    if (setupData) {
      expenseCategoriesData = setupData.expenseCategories || {};
      paymentMethodsData = setupData.paymentMethods || [];
      incomeSourcesData = setupData.incomeSources || [];
      populateFormDropdowns();
      populateCardSelector();
    }
  } catch (error) {
    console.error('loadInitialData API call failed:', error);
  }
}

// [수정됨] 검색 핸들러
async function handleSearch() {
    const query = document.getElementById('searchInput').value.trim();
    const startMonth = document.getElementById('startMonth').value;
    const endMonth = document.getElementById('endMonth').value;
    const resultsDiv = document.getElementById('searchResults');
    const loader = document.getElementById('loader');

    resultsDiv.innerHTML = '';
    if (loader) loader.style.display = 'block';
    showToast('데이터를 검색 중입니다...');

    try {
        const searchParams = { query, startMonth, endMonth };
        // 새로운 callApi 함수 사용
        const results = await callApi('/search', 'GET', searchParams);
        renderSearchResults(results);
    } catch (error) {
        console.error('Search failed:', error);
        resultsDiv.innerHTML = `<p style="text-align: center; color: red;">검색 중 오류가 발생했습니다.</p>`;
        showToast(`검색 오류: ${error.message}`, true);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

// [수정됨] 거래 제출 핸들러 (추가/수정)
async function handleTransactionSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const transactionData = {};
  fd.forEach((v, k) => transactionData[k] = v);

  if (!validateTransactionData(transactionData)) return;

  const isEditing = currentEditingTransaction && typeof currentEditingTransaction.row !== 'undefined';
  
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';
  showToast(isEditing ? '수정 사항을 전송 중입니다...' : '저장 중입니다...');
  closeModal();
  
  try {
    let serverResult;
    if (isEditing) {
      // 수정 API 호출 (PUT)
      const id = currentEditingTransaction.row;
      serverResult = await callApi(`/transactions/${id}`, 'PUT', transactionData);
    } else {
      // 추가 API 호출 (POST)
      serverResult = await callApi('/transactions', 'POST', transactionData);
    }
    
    if (serverResult.success) {
      showToast(serverResult.message || (isEditing ? '수정 완료!' : '저장 완료!'), false);
      await updateCalendarDisplay(); // 달력 새로고침
    } else {
      throw new Error(serverResult.message || serverResult.error || '서버 작업 처리 실패');
    }
  } catch (error) {
    showToast((isEditing ? '수정 실패: ' : '저장 실패: ') + error.message, true);
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

// [수정됨] 일일 거래 내역 로드
async function loadDailyTransactions(dateStr) {
    const list = document.getElementById('dailyTransactionList');
    if (!list) return;
    list.textContent = '불러오는 중...';
    try {
        const dailyData = await callApi('/daily-transactions', 'GET', { date: dateStr });
        displayDailyTransactions(dailyData || [], dateStr);
    } catch (error) {
        console.error('loadDailyTransactions API call failed for date ' + dateStr + ':', error);
        if (list) list.textContent = '일일 거래 내역 로딩 실패.';
    }
}

// [수정됨] 카드 데이터 표시
async function displayCardData() {
  const cardSel = document.getElementById('cardSelector');
  const det = document.getElementById('cardDetails');
  const lbl = document.getElementById('cardMonthLabel');
  const loader = document.getElementById('loader');
  if (!cardSel || !det || !lbl) return;
  const card = cardSel.value;
  if (!card) { det.innerHTML = '<p>카드를 선택해주세요.</p>'; lbl.textContent = ''; return; }
  if (loader) loader.style.display = 'block';

  const billingMonthForAPI = `${cardBillingCycleDate.getFullYear()}-${String(cardBillingCycleDate.getMonth() + 1).padStart(2, '0')}`;
  lbl.textContent = `${billingMonthForAPI} 주기 기준`;

  try {
    const cardData = await callApi('/card-data', 'GET', {
      cardName: card,
      cycleMonth: billingMonthForAPI,
    });

    if (!cardData || cardData.success === false) {
      throw new Error(cardData?.error || '카드 데이터 구조 오류');
    }

    const { billingAmount, performanceAmount, performanceTarget } = cardData;
    const rate = performanceTarget > 0 ? ((performanceAmount / performanceTarget) * 100).toFixed(1) + '%' : '0%';
    
    det.innerHTML = `<h4>${card}</h4>
                     <p><strong>청구 예정 금액:</strong> ${billingAmount.toLocaleString()}원</p><hr>
                     <p><strong>현재 사용액(실적):</strong> ${performanceAmount.toLocaleString()}원</p>
                     <p><strong>실적 목표 금액:</strong> ${performanceTarget.toLocaleString()}원</p>
                     <p><strong>달성률:</strong> ${rate}</p>`;
  } catch (error) {
    det.innerHTML = '<p>카드 데이터를 불러오는 데 실패했습니다.</p>';
    console.error('displayCardData API call failed:', error);
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

// [수정됨] 삭제 핸들러
async function handleDelete() {
    if (!currentEditingTransaction || typeof currentEditingTransaction.row === 'undefined') {
        showToast('삭제할 거래를 먼저 선택하거나, 유효한 거래가 아닙니다.', true);
        return;
    }
    const rowId = currentEditingTransaction.row;
    
    // 화면 먼저 업데이트
    // ... 기존 Optimistic Update 로직 ...
    closeModal();
    showToast('삭제를 서버에 전송 중...');

    try {
        const serverResult = await callApi(`/transactions/${rowId}`, 'DELETE');
        if (serverResult.success) {
            showToast(serverResult.message || '삭제 완료!', false);
            // 최종 데이터 동기화를 위해 달력 업데이트
            await updateCalendarDisplay();
        } else {
            throw new Error(serverResult.message || serverResult.error || '서버에서 삭제 실패');
        }
    } catch (error) {
        showToast(`삭제 실패! (${error.message})`, true);
        // TODO: 실패 시 롤백 로직
    }
}


// --- 아래는 수정이 필요 없는 기존 함수들입니다 ---

function setupSwipeListeners() {
    const calendarElement = document.getElementById('calendarView');
    if (!calendarElement) {
        console.warn("[App.js] 스와이프 감지를 위한 달력 요소를 찾을 수 없습니다 ('calendarView').");
        return;
    }
    let touchstartX = 0, touchendX = 0, touchstartY = 0, touchendY = 0;
    const SWIPE_THRESHOLD = 50, SWIPE_MAX_VERTICAL = 75;

    calendarElement.addEventListener('touchstart', function(event) {
        touchstartX = event.changedTouches[0].screenX;
        touchstartY = event.changedTouches[0].screenY;
    }, { passive: true });

    calendarElement.addEventListener('touchend', async function(event) {
        touchendX = event.changedTouches[0].screenX;
        touchendY = event.changedTouches[0].screenY;
        await handleSwipeGesture();
    }, false);

    async function handleSwipeGesture() {
        const deltaX = touchendX - touchstartX;
        const deltaY = touchendY - touchstartY;
        if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_MAX_VERTICAL) {
            if (deltaX > 0) {
                console.log("[App.js] Swiped Right -> Previous Month");
                await changeMonth(-1);
            } else {
                console.log("[App.js] Swiped Left -> Next Month");
                await changeMonth(1);
            }
        }
    }
}

function renderSearchResults(transactions) {
  const resultsDiv = document.getElementById('searchResults');
  resultsDiv.innerHTML = '';

  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    resultsDiv.innerHTML = '<p style="text-align: center; color: #888;">검색 결과가 없습니다.</p>';
    showToast('일치하는 검색 결과가 없습니다.', true);
    return;
  }

  const summary = document.createElement('p');
  summary.style.textAlign = 'center';
  summary.style.marginBottom = '20px';
  summary.innerHTML = `<strong>총 ${transactions.length}건</strong>의 거래 내역을 찾았습니다.`;
  resultsDiv.appendChild(summary);

  const fragment = document.createDocumentFragment();
  transactions.forEach(t => {
    if (!t || typeof t.type === 'undefined') return;
    const item = document.createElement('div');
    item.className = `transaction-item ${t.type === '수입' ? 'income' : 'expense'}`;
    let txt = `[${t.date}] [${t.type}] ${t.content || '(내용 없음)'}: ${Number(t.amount || 0).toLocaleString()}원`;
    if (t.type === '지출') {
      if (t.paymentMethod) txt += ` (${t.paymentMethod})`;
      if (t.category1) txt += ` - ${t.category1}`;
      if (t.category2) txt += ` / ${t.category2}`;
    } else {
      if (t.category1) txt += ` - ${t.category1}`;
    }
    item.textContent = txt;
    item.style.cursor = 'pointer';
    item.title = '클릭하여 이 내용 수정하기';
    item.addEventListener('click', function() {
      populateFormForEdit(t);
    });
    fragment.appendChild(item);
  });
  resultsDiv.appendChild(fragment);
}

function validateTransactionData(data) {
  if (!data.date || !data.amount || !data.content) {
    if (typeof showToast === 'function') showToast("날짜, 금액, 내용은 필수입니다.", true);
    return false;
  }
  if (data.type === '지출' && (!data.paymentMethod || !data.mainCategory || !data.subCategory)) {
    if (typeof showToast === 'function') showToast("지출 시 결제수단과 카테고리는 필수입니다.", true);
    return false;
  }
  if (data.type === '수입' && !data.incomeSource) {
    if (typeof showToast === 'function') showToast("수입 시 수입원은 필수입니다.", true);
    return false;
  }
  return true;
}

async function openModal(dateStr) {
  document.getElementById('transactionForm').reset();
  currentEditingTransaction = null;
  document.getElementById('deleteBtn').style.display = 'none';
  document.getElementById('modalTitle').textContent = '거래 추가';
  document.getElementById('transactionDate').value = dateStr;
  toggleTypeSpecificFields();
  document.getElementById('dailyTransactionList').innerHTML = '불러오는 중...';
  document.getElementById('dailyTransactions').style.display = 'none';
  document.getElementById('toggleDailyTransactions').textContent = '거래 내역 보기';
  document.getElementById('transactionModal').style.display = 'flex';
  await loadDailyTransactions(dateStr);
}

function closeModal() {
  const transactionModal = document.getElementById('transactionModal');
  if (transactionModal) transactionModal.style.display = 'none';
}

function toggleDailyTransactionVisibility() {
  const dailySection = document.getElementById('dailyTransactions');
  const toggleBtn = document.getElementById('toggleDailyTransactions');
  const isHidden = dailySection.style.display === 'none';
  if (isHidden) {
    dailySection.style.display = 'block'; toggleBtn.textContent = '거래 내역 숨기기';
  } else {
    dailySection.style.display = 'none'; toggleBtn.textContent = '거래 내역 보기';
    const preservedDate = document.getElementById('transactionDate').value;
    document.getElementById('transactionForm').reset();
    document.getElementById('transactionDate').value = preservedDate;
    document.getElementById('modalTitle').textContent = '거래 추가';
    document.getElementById('deleteBtn').style.display = 'none';
    currentEditingTransaction = null; toggleTypeSpecificFields();
  }
}

function displayDailyTransactions(arr, dateStr) {
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;
  if (arr && arr.error) { list.textContent = '내역 로딩 오류: ' + arr.error; return; }
  if (!Array.isArray(arr) || arr.length === 0) { list.textContent = '해당 날짜의 거래 내역이 없습니다.'; return; }
  list.innerHTML = '';
  arr.forEach(function(t) {
    if (!t || typeof t.type === 'undefined') return;
    const d = document.createElement('div');
    d.classList.add('transaction-item', t.type === '수입' ? 'income' : 'expense');
    let txt = `[${t.type}] ${t.content || '(내용 없음)'}: ${Number(t.amount || 0).toLocaleString()}원`;
    if (t.type === '지출' && t.paymentMethod) txt += ` (${t.paymentMethod})`;
    if (t.category1) txt += ` - ${t.category1}`;
    if (t.category2) txt += ` / ${t.category2}`;
    d.textContent = txt; d.style.cursor = 'pointer'; d.title = '클릭하여 이 내용 수정하기';
    d.addEventListener('click', function() { populateFormForEdit(t); });
    list.appendChild(d);
  });
}

function populateFormForEdit(transaction) {
  if (!transaction || typeof transaction.row === 'undefined') {
    console.error('[populateFormForEdit] 유효하지 않은 거래 데이터입니다.', transaction);
    if (typeof showToast === 'function') showToast('거래 정보를 불러오지 못했습니다. (ID 누락)', true);
    return;
  }
  currentEditingTransaction = transaction;
  const form = document.getElementById('transactionForm');
  if (form) form.reset();
  document.getElementById('modalTitle').textContent = '거래 수정';
  document.getElementById('transactionDate').value = transaction.date || '';
  document.getElementById('transactionAmount').value = transaction.amount || '';
  document.getElementById('transactionContent').value = transaction.content || '';
  document.querySelectorAll('input[name="type"]').forEach(r => {
    r.checked = (r.value === transaction.type);
  });
  toggleTypeSpecificFields();
  if (transaction.type === '지출') {
    const paymentMethodSelect = document.getElementById('paymentMethod');
    if (paymentMethodSelect) paymentMethodSelect.value = transaction.paymentMethod || '';
    const mainCategorySelect = document.getElementById('mainCategory');
    if (mainCategorySelect) {
      mainCategorySelect.value = transaction.category1 || '';
      updateSubCategories();
      const subCategorySelect = document.getElementById('subCategory');
      if (subCategorySelect) {
        subCategorySelect.value = transaction.category2 || '';
      }
    }
  } else if (transaction.type === '수입') {
    const incomeSourceSelect = document.getElementById('incomeSource');
    if (incomeSourceSelect) incomeSourceSelect.value = transaction.category1 || '';
  }
  const deleteBtn = document.getElementById('deleteBtn');
  if (deleteBtn) deleteBtn.style.display = 'block';

  document.getElementById('dailyTransactions').style.display = 'none';
  document.getElementById('toggleDailyTransactions').textContent = '거래 내역 보기';
  document.getElementById('transactionModal').style.display = 'flex';
}

function showView(id) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-button[onclick="showView('${id}')"]`).classList.add('active');

  if (id === 'cardView') {
    cardPerformanceMonthDate = new Date();
    cardBillingCycleDate = new Date(currentDisplayDate);
    displayCardData();
  }
}

function showToast(msg, isErr = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.style.backgroundColor = isErr ? '#dc3545' : '#28a745';
  t.style.visibility = 'visible'; t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.style.visibility = 'hidden', 500); }, 3000);
}

function populateCardSelector() {
  const sel = document.getElementById('cardSelector');
  if (!sel) return;
  const currentCard = sel.value;
  sel.innerHTML = '<option value="">카드를 선택하세요</option>';
  (paymentMethodsData || []).filter(m => m.isCard).forEach(c => {
    const o = document.createElement('option'); o.value = c.name; o.textContent = c.name; sel.appendChild(o);
  });
  if (currentCard && sel.querySelector(`option[value="${currentCard}"]`)) { sel.value = currentCard; }
}

async function changeCardMonth(d) {
  cardPerformanceMonthDate.setMonth(cardPerformanceMonthDate.getMonth() + d);
  cardBillingCycleDate.setMonth(cardBillingCycleDate.getMonth() + d);
  await displayCardData();
}

function toggleTypeSpecificFields() {
  const typeRadio = document.querySelector('input[name="type"]:checked');
  let type = '지출';
  if (typeRadio) {
    type = typeRadio.value;
  } else {
    const defaultExpenseRadio = document.querySelector('input[name="type"][value="지출"]');
    if (defaultExpenseRadio) defaultExpenseRadio.checked = true;
  }
  document.getElementById('expenseSpecificFields').style.display = type === '지출' ? 'block' : 'none';
  document.getElementById('incomeSpecificFields').style.display = type === '수입' ? 'block' : 'none';
}

function populateFormDropdowns() {
  const pm = document.getElementById('paymentMethod');
  pm.innerHTML = '<option value="">선택하세요</option>';
  (paymentMethodsData || []).forEach(m => { const o = document.createElement('option'); o.value = m.name; o.textContent = m.name; pm.appendChild(o); });
  const mainSel = document.getElementById('mainCategory');
  mainSel.innerHTML = '<option value="">선택하세요</option>';
  for (const k in expenseCategoriesData) { const o = document.createElement('option'); o.value = k; o.textContent = k; mainSel.appendChild(o); }
  updateSubCategories();
  const incSel = document.getElementById('incomeSource');
  incSel.innerHTML = '<option value="">선택하세요</option>';
  (incomeSourcesData || []).forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; incSel.appendChild(o); });
}

function updateSubCategories() {
  const mainCategorySelect = document.getElementById('mainCategory');
  const subCategorySelect = document.getElementById('subCategory');
  if (!mainCategorySelect || !subCategorySelect) {
    console.warn('[updateSubCategories] 주 또는 하위 카테고리 Select 요소를 찾을 수 없습니다.');
    return;
  }
  const mainCategoryValue = mainCategorySelect.value;
  subCategorySelect.innerHTML = '<option value="">선택하세요</option>';
  if (expenseCategoriesData && expenseCategoriesData[mainCategoryValue] && Array.isArray(expenseCategoriesData[mainCategoryValue])) {
    expenseCategoriesData[mainCategoryValue].forEach(subCat => {
      const option = document.createElement('option');
      option.value = subCat; option.textContent = subCat;
      subCategorySelect.appendChild(option);
    });
  }
}
