// app.js - 최종 수정본 (문법 오류 수정)
const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbzfBYh9cmtHXtEUE8wseB5KHy8Ltbi58moew1ky6Bya-FY94cyvlQrilVIeN3Ex8QDO/exec";

/* === 전역 상태 === */
let currentDisplayDate = new Date();
let currentCycleMonth = '';
let cardPerformanceMonthDate = new Date();
let expenseCategoriesData = {};
let paymentMethodsData = [];
let incomeSourcesData = [];
let currentEditingTransaction = null;

/* === API 호출 헬퍼 함수 === */
async function callAppsScriptApi(actionName, params = {}) {
  const url = new URL(APPS_SCRIPT_API_ENDPOINT);
  url.searchParams.append('action', actionName);
  for (const key in params) {
    url.searchParams.append(key, params[key]);
  }
  console.log(`[API] Calling: ${actionName} with params: ${JSON.stringify(params)}`);
  try {
    const response = await fetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`서버 응답 오류 (${response.status}): ${errorText}`);
    }
    const result = await response.json();
    if (result.success === false) {
      throw new Error(result.error || `"${actionName}" API 요청 실패`);
    }
    return result.data !== undefined ? result.data : result;
  } catch (error) {
    console.error(`[API] Error calling action "${actionName}":`, error);
    showToast?.(`API 요청 중 오류: ${error.message}`, true);
    throw error;
  }
}

/* === 뷰포트 높이 CSS 변수 갱신 === */
function setViewportHeightVar(){
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h}px`);
}
['load','resize','orientationchange'].forEach(evt => window.addEventListener(evt, setViewportHeightVar));

function adjustCalendarHeight(){ /* 현재 사용 안 함 */ }
function afterRender(){ setTimeout(adjustCalendarHeight, 0); }
['resize','orientationchange'].forEach(evt => {
  setViewportHeightVar();
  adjustCalendarHeight();
});

/* === 페이지 로드 순서 (수정됨) === */
window.onload = async () => {
  console.log("[App.js] window.onload triggered");
  setViewportHeightVar();
  
  // 1. 가장 먼저 필요한 초기 변수 설정
  determineInitialCycleMonth();
  
  // 2. 이벤트 리스너 설정
  setupEventListeners();
  
  // 3. UI 요소 채우기 (서버 데이터 필요)
  //await populateSearchYearDropdownFromServer();

  const loader = document.getElementById('loader');
  if(loader) loader.style.display = 'block';
  try {
    // 4. 나머지 데이터 로딩 및 화면 그리기
    await loadInitialData();
    await updateCalendarDisplay();
  } catch (error) {
    console.error("[App.js] Error during initial data loading:", error);
    showToast?.("초기 데이터 로딩 중 오류가 발생했습니다.", true);
  } finally {
    if(loader) loader.style.display = 'none';
  }
  showView('calendarView');
  toggleTypeSpecificFields();
  const transactionModal = document.getElementById('transactionModal');
    if (transactionModal) transactionModal.style.display = 'none';
  registerServiceWorker();
};

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' })
      .then(reg => console.log('[SW] 등록 성공:', reg.scope))
      .catch(err => console.error('[SW] 등록 실패:', err));
  }
}

/* === 주기 계산 & 달력 === */
function determineInitialCycleMonth(){
  const today = new Date();
  let year = today.getFullYear();
  let mIdx = today.getDate() < 18 ? today.getMonth() - 1 : today.getMonth();
  if(mIdx < 0){ mIdx = 11; year -= 1; }
  currentDisplayDate = new Date(year, mIdx, 18);
  currentCycleMonth = `${year}-${String(mIdx + 1).padStart(2,'0')}`;
}

async function changeMonth(delta){
  currentDisplayDate.setMonth(currentDisplayDate.getMonth() + delta);
  const y = currentDisplayDate.getFullYear();
  const m = currentDisplayDate.getMonth();
  currentCycleMonth = `${y}-${String(m + 1).padStart(2,'0')}`;
  await updateCalendarDisplay();
}

async function updateCalendarDisplay () {
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';
  const cacheKey = 'transactions_' + currentCycleMonth;
  const cachedDataString = localStorage.getItem(cacheKey);
  let renderedFromCache = false;
  let transactionsToRender = [];
  if (cachedDataString) {
    try {
      const cachedArr = JSON.parse(cachedDataString);
      if (Array.isArray(cachedArr)) {
        transactionsToRender = cachedArr;
        renderCalendarAndSummary(cachedArr);
        renderedFromCache = true;
      } else { localStorage.removeItem(cacheKey); }
    } catch (err) { localStorage.removeItem(cacheKey); }
  }
  if (!renderedFromCache) { renderCalendarAndSummary([]); }
  try {
    const latest = await callAppsScriptApi('getTransactions', { cycleMonth: currentCycleMonth });
    const finalTx = (latest && Array.isArray(latest)) ? latest : [];
    localStorage.setItem(cacheKey, JSON.stringify(finalTx));
    if (!renderedFromCache || JSON.stringify(transactionsToRender) !== JSON.stringify(finalTx)) {
      renderCalendarAndSummary(finalTx);
      if (renderedFromCache) showToast?.('달력 정보가 업데이트 되었습니다.', false);
    }
  } catch (err) {
    console.error('[App.js] getTransactions failed', err);
    if (!renderedFromCache) renderCalendarAndSummary([]);
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

function renderCalendarAndSummary(transactions){
  const [year, month] = currentCycleMonth.split('-').map(Number);
  document.getElementById('currentMonthYear').textContent = `${year}년 ${String(month).padStart(2,'0')}월 주기`;
  renderCalendar(year, month, transactions);
  updateSummary(transactions);
}

/**
 * [REVISED] 달력 UI를 생성하는 함수.
 * 기존 로직은 복잡하여 오류 발생 가능성이 있었습니다.
 * 주(week) 단위로 순회하며 날짜 셀을 생성하는 보다 안정적인 로직으로 변경했습니다.
 */
function renderCalendar(year, monthOneBased, transactions) {
    const calendarBody = document.getElementById('calendarBody');
    calendarBody.innerHTML = ''; // 기존 달력 내용 초기화

    // 거래 내역을 날짜별로 쉽게 찾을 수 있도록 맵으로 변환
    const transMap = {};
    (transactions || []).forEach(t => {
        if (t && t.date) {
            (transMap[t.date] = transMap[t.date] || []).push(t);
        }
    });

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 현재 주기의 시작일과 종료일 계산
    const cycleStart = new Date(year, monthOneBased - 1, 18);
    const cycleEnd = new Date(year, monthOneBased, 17);

    // 달력의 첫 번째 날짜를 찾기 (주기의 시작일이 포함된 주의 일요일)
    let currentDate = new Date(cycleStart);
    currentDate.setDate(currentDate.getDate() - currentDate.getDay());

    const frag = document.createDocumentFragment();

    let safetyCounter = 0; // 무한 루프 방지
    while (safetyCounter < 6) { // 달력은 최대 6주
        const weekRow = document.createElement('tr');
        for (let i = 0; i < 7; i++) { // 일요일부터 토요일까지 7일
            const td = document.createElement('td');
            const dStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;

            // 날짜가 현재 주기에 포함되는 경우에만 내용을 채움
            if (currentDate >= cycleStart && currentDate <= cycleEnd) {
                if (dStr === todayStr) {
                    td.classList.add('today');
                }
                td.dataset.date = dStr;
                td.onclick = () => openModal(dStr);

                const num = document.createElement('span');
                num.className = 'date-number';
                num.textContent = currentDate.getDate();
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
                    more.onclick = e => { e.stopPropagation(); openModal(dStr); };
                    wrap.appendChild(more);
                }
                td.appendChild(wrap);
            } else {
                td.className = 'other-month'; // 주기 외 날짜는 다른 스타일 적용
            }
            weekRow.appendChild(td);
            currentDate.setDate(currentDate.getDate() + 1);
        }
        frag.appendChild(weekRow);

        // 루프 종료 조건: 다음 주가 시작될 때, 현재 날짜가 이미 주기 종료일보다 뒤에 있으면 종료
        if (currentDate > cycleEnd) {
            break;
        }
        safetyCounter++;
    }
    calendarBody.appendChild(frag);
    if (typeof afterRender === 'function') afterRender();
}


function updateSummary(transactions){
  let inc = 0, exp = 0;
  (transactions||[]).forEach(t => { 
    if (t && typeof t.amount !== 'undefined') {
      const a = Number(t.amount)||0; 
      if (t.type==='수입') inc += a;
      else exp += a; 
    } 
  });
  const bal = inc - exp;
  document.getElementById('totalIncome').textContent = `₩${inc.toLocaleString()}`;
  document.getElementById('totalExpense').textContent = `₩${exp.toLocaleString()}`;
  const balEl = document.getElementById('totalBalance');
  balEl.textContent = `₩${bal.toLocaleString()}`; balEl.className = 'total-balance';
  if (bal < 0) balEl.classList.add('negative');
}

async function loadInitialData() {
  try {
    const setupData = await callAppsScriptApi('getAppSetupData', { initialCycleMonth: currentCycleMonth });
    expenseCategoriesData = setupData.expenseCategories || {};
    paymentMethodsData    = setupData.paymentMethods    || [];
    incomeSourcesData     = setupData.incomeSources     || [];
    if (setupData.initialTransactions) {
      localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(setupData.initialTransactions));
    }
    populateFormDropdowns();
    populateCardSelector();
  } catch (error) {
    console.error('loadInitialData API call failed:', error);
  }
}

function setupEventListeners() {
  document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('mainCategory').addEventListener('change', updateSubCategories);
  setupSwipeListeners();
  setupSearchEventListeners(); // 검색 이벤트 리스너 추가
}

function setupSwipeListeners() {
    const calendarElement = document.getElementById('calendarView');
    if (!calendarElement) return;
    let touchstartX = 0, touchendX = 0, touchstartY = 0, touchendY = 0;
    const SWIPE_THRESHOLD = 50, SWIPE_MAX_VERTICAL = 75;
    // [FIXED] e.changedTouches는 TouchList 객체이므로 [0] 인덱스로 접근해야 합니다.
    calendarElement.addEventListener('touchstart', e => { 
        touchstartX = e.changedTouches[0].screenX; 
        touchstartY = e.changedTouches[0].screenY; 
    }, { passive: true });
    calendarElement.addEventListener('touchend', async e => {
        touchendX = e.changedTouches[0].screenX;
        touchendY = e.changedTouches[0].screenY;
        const deltaX = touchendX - touchstartX, deltaY = touchendY - touchstartY;
        if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_MAX_VERTICAL) {
            await changeMonth(deltaX > 0 ? -1 : 1);
        }
    });
}

// 검색 이벤트 리스너 설정 함수 추가
function setupSearchEventListeners() {
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const searchResultsContainer = document.getElementById('searchResults');

    if (searchButton && searchInput) {
        searchButton.addEventListener('click', handleSearchClick);
        
        // Enter 키로도 검색 가능하도록
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSearchClick();
            }
        });
        
        // 검색창 외부 클릭 시 결과 숨기기
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-section')) {
                hideSearchResults();
            }
        });
    }
}

function toggleTypeSpecificFields() {
    const type = document.querySelector('input[name="type"]:checked')?.value || '지출';
    document.getElementById('expenseSpecificFields').style.display = type === '지출' ? 'block' : 'none';
    document.getElementById('incomeSpecificFields').style.display = type === '수입' ? 'block' : 'none';
}

function populateFormDropdowns() {
    const pm = document.getElementById('paymentMethod');
    pm.innerHTML = '<option value="">선택</option>';
    (paymentMethodsData||[]).forEach(m=>{ const o=document.createElement('option'); o.value=m.name; o.textContent=m.name; pm.appendChild(o); });
    const mainSel = document.getElementById('mainCategory');
    mainSel.innerHTML = '<option value="">선택</option>';
    for (const k in expenseCategoriesData) { const o=document.createElement('option'); o.value=k; o.textContent=k; mainSel.appendChild(o); }
    updateSubCategories();
    const incSel = document.getElementById('incomeSource');
    incSel.innerHTML='<option value="">선택</option>';
    (incomeSourcesData||[]).forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; incSel.appendChild(o); });
}

function updateSubCategories() {
    const mainSel = document.getElementById('mainCategory'), subSel = document.getElementById('subCategory'), mainVal = mainSel.value;
    subSel.innerHTML = '<option value="">선택</option>';
    if (expenseCategoriesData?.[mainVal]?.length) {
        expenseCategoriesData[mainVal].forEach(sub => { const o=document.createElement('option'); o.value=sub; o.textContent=sub; subSel.appendChild(o); });
    }
}

/**
 * [REVISED] 거래 내역 제출(추가/수정)을 처리하는 함수
 * 낙관적 UI 업데이트 시 수입/지출에 따라 category1, category2 필드를
 * 올바르게 매핑하도록 수정했습니다.
 */
async function handleTransactionSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {};
    fd.forEach((v, k) => (data[k] = v));

    if (!validateTransactionData(data)) return;

    const isEditing = !!currentEditingTransaction?.row;
    const key = 'transactions_' + currentCycleMonth;
    const originalData = JSON.parse(localStorage.getItem(key) || '[]');
    let optimisticData = JSON.parse(JSON.stringify(originalData));

    // 서버로 보낼 데이터 (id_to_update 포함 가능)
    const itemForServer = { ...data };
    
    // 화면에 즉시 보여줄 데이터 (category1, 2 필드 정리)
    const itemForUI = {
        ...data,
        category1: data.type === '수입' ? data.incomeSource : data.mainCategory,
        category2: data.type === '수입' ? '' : data.subCategory,
    };

    if (isEditing) {
        const index = optimisticData.findIndex(t => t?.row?.toString() === currentEditingTransaction.row.toString());
        if (index > -1) {
            itemForServer.id_to_update = currentEditingTransaction.row;
            // 기존 데이터에 UI용 데이터를 덮어씀
            optimisticData[index] = { ...optimisticData[index], ...itemForUI };
        }
    } else {
        // UI용 데이터에 임시 row ID 추가
        optimisticData.push({ ...itemForUI, row: `temp-${Date.now()}` });
    }

    localStorage.setItem(key, JSON.stringify(optimisticData));
    renderCalendarAndSummary(optimisticData);
    showToast(isEditing ? '수정 중...' : '저장 중...');
    closeModal();

    try {
        const result = await callAppsScriptApi(isEditing ? 'updateTransaction' : 'addTransaction', { transactionDataString: JSON.stringify(itemForServer) });
        if (result.success) {
            showToast(result.message || '완료!', false);
            // 서버 응답 성공 후, 최신 데이터로 달력 전체를 다시 그림
            await updateCalendarDisplay(); 
        } else {
            throw new Error(result.message || '서버 처리 실패');
        }
    } catch (error) {
        showToast(`실패: ${error.message}`, true);
        // 실패 시, 원래 데이터로 롤백
        localStorage.setItem(key, JSON.stringify(originalData));
        renderCalendarAndSummary(originalData);
    }
}


function validateTransactionData(data) {
    if (!data.date || !data.amount || !data.content) { showToast("날짜, 금액, 내용은 필수입니다.", true); return false; }
    if (data.type === '지출' && (!data.paymentMethod || !data.mainCategory)) { showToast("지출 시 결제수단과 주 카테고리는 필수입니다.", true); return false; }
    if (data.type === '수입' && !data.incomeSource) { showToast("수입 시 수입원은 필수입니다.", true); return false; }
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

function closeModal(){
    document.getElementById('transactionModal').style.display='none';
}

function toggleDailyTransactionVisibility() {
    const dailySection = document.getElementById('dailyTransactions');
    const toggleBtn = document.getElementById('toggleDailyTransactions');
    const isHidden = dailySection.style.display === 'none';
    dailySection.style.display = isHidden ? 'block' : 'none';
    toggleBtn.textContent = isHidden ? '거래 내역 숨기기' : '거래 내역 보기';
    if (!isHidden) {
        const date = document.getElementById('transactionDate').value;
        document.getElementById('transactionForm').reset();
        document.getElementById('transactionDate').value = date;
        document.getElementById('modalTitle').textContent = '거래 추가';
        document.getElementById('deleteBtn').style.display = 'none';
        currentEditingTransaction = null;
        toggleTypeSpecificFields();
    }
}

async function loadDailyTransactions(dateStr) {
    const list = document.getElementById('dailyTransactionList');
    list.textContent = '불러오는 중...';
    try {
        const dailyData = await callAppsScriptApi('getTransactionsByDate', { date: dateStr });
        displayDailyTransactions(dailyData || []);
    } catch (error) {
        list.textContent = '일일 내역 로딩 실패.';
    }
}

function displayDailyTransactions(arr) {
    const list = document.getElementById('dailyTransactionList');
    if (!Array.isArray(arr) || arr.length === 0) {
        list.textContent = '해당 날짜의 거래 내역이 없습니다.';
        return;
    }
    list.innerHTML = '';
    arr.forEach(t => {
        const d = document.createElement('div');
        d.className = `transaction-item ${t.type === '수입' ? 'income' : 'expense'}`;
        let txt = `[${t.type}] ${t.content}: ${Number(t.amount).toLocaleString()}원`;
        if (t.type === '지출') {
            txt += ` (${t.paymentMethod || ''} - ${t.category1 || ''}${t.category2 ? '/' + t.category2 : ''})`;
        } else {
            txt += ` (${t.category1 || ''})`;
        }
        d.style.cursor = 'pointer';
        d.textContent = txt;
        d.onclick = () => populateFormForEdit(t);
        list.appendChild(d);
    });
}

function populateFormForEdit(transaction) {
    if (!transaction?.row) { showToast('유효하지 않은 거래 데이터입니다.', true); return; }
    currentEditingTransaction = transaction;
    document.getElementById('transactionForm').reset();
    document.getElementById('modalTitle').textContent = '거래 수정';
    document.getElementById('transactionDate').value = transaction.date;
    document.getElementById('transactionAmount').value = transaction.amount;
    document.getElementById('transactionContent').value = transaction.content;
    document.querySelectorAll('input[name="type"]').forEach(r => r.checked = r.value === transaction.type);
    toggleTypeSpecificFields();
    if (transaction.type === '지출') {
        document.getElementById('paymentMethod').value = transaction.paymentMethod;
        document.getElementById('mainCategory').value = transaction.category1;
        updateSubCategories();
        document.getElementById('subCategory').value = transaction.category2;
    } else {
        document.getElementById('incomeSource').value = transaction.category1;
    }
    document.getElementById('deleteBtn').style.display = 'block';
}

function showView(id){
    document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.tab-button').forEach(b=>b.classList.remove('active'));
    document.querySelector(`.tab-button[onclick="showView('${id}')"]`).classList.add('active');
    if(id==='cardView'){
        cardPerformanceMonthDate = new Date();
        displayCardData();
    }
}

function showToast(msg, isErr = false) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `show ${isErr ? 'error' : 'success'}`;
    setTimeout(() => {
        t.className = t.className.replace("show", "");
    }, 3000);
}

function populateCardSelector(){
    const sel = document.getElementById('cardSelector');
    const currentCard = sel.value;
    sel.innerHTML='<option value="">카드 선택</option>';
    (paymentMethodsData||[]).filter(m=>m.isCard).forEach(c=>{ const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; sel.appendChild(o); });
    if (currentCard) sel.value = currentCard;
}

async function changeCardMonth(d){
    cardPerformanceMonthDate.setMonth(cardPerformanceMonthDate.getMonth()+d);
    await displayCardData();
}

async function displayCardData() {
    const cardSel = document.getElementById('cardSelector'), det = document.getElementById('cardDetails'), lbl = document.getElementById('cardMonthLabel'), loader = document.getElementById('loader');
    const card = cardSel.value;
    if (!card){ det.innerHTML = '<p>카드를 선택해주세요.</p>'; lbl.textContent = ''; return; }
    if(loader) loader.style.display = 'block';
    const perfMonth = `${cardPerformanceMonthDate.getFullYear()}-${String(cardPerformanceMonthDate.getMonth()+1).padStart(2,'0')}`;
    lbl.textContent = `${perfMonth} 기준`;
    try {
        const d = await callAppsScriptApi('getCardData', { cardName: card, cycleMonthForBilling: perfMonth, performanceReferenceMonth: perfMonth });
        const rate = d.performanceTarget > 0 ? ((d.performanceAmount/d.performanceTarget)*100).toFixed(1)+'%' : '0%';
        det.innerHTML = `<h4>${d.cardName}</h4><p><strong>청구 예정:</strong> ${Number(d.billingAmount).toLocaleString()}원</p><p><strong>현재 실적:</strong> ${Number(d.performanceAmount).toLocaleString()}원 / ${Number(d.performanceTarget).toLocaleString()}원 (${rate})</p>`;
    } catch (error) {
        det.innerHTML = '<p>데이터 로딩 실패.</p>';
    } finally {
        if(loader) loader.style.display = 'none';
    }
}

async function handleDelete() {
    if (!currentEditingTransaction?.row) { showToast('삭제할 거래가 없습니다.', true); return; }
    const { row } = currentEditingTransaction;
    const key = 'transactions_' + currentCycleMonth;
    const originalData = JSON.parse(localStorage.getItem(key) || '[]');
    const filteredData = originalData.filter(t => t?.row?.toString() !== row.toString());
    localStorage.setItem(key, JSON.stringify(filteredData));
    renderCalendarAndSummary(filteredData);
    closeModal();
    if (String(row).startsWith('temp-')) { showToast('임시 입력을 삭제했습니다.'); return; }
    showToast('삭제 중...');
    try {
        const result = await callAppsScriptApi('deleteTransaction', { id_to_delete: Number(row) });
        if (result.success) {
            showToast(result.message || '삭제 완료!', false);
            await updateCalendarDisplay();
        } else {
            throw new Error(result.message || '서버 삭제 실패');
        }
    } catch (error) {
        showToast(`삭제 실패: ${error.message}`, true);
        localStorage.setItem(key, JSON.stringify(originalData));
        renderCalendarAndSummary(originalData);
    }
}

// ======================
// ▼▼▼ 검색 기능 관련 코드 ▼▼▼
// ======================

/**
 * 서버에서 연도 목록을 가져와 드롭다운 메뉴를 채우는 함수
*/
async function populateSearchYearDropdownFromServer() {
    const searchYearSelect = document.getElementById('searchYear');
    if (!searchYearSelect) return;
    
    searchYearSelect.innerHTML = '<option value="all">전체</option>';

    try {
        const years = await callAppsScriptApi('getExistingYears');
        if (years && Array.isArray(years)) {
            years.forEach(year => {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = `${year}년`;
                searchYearSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error("연도 목록을 불러오는 데 실패했습니다:", error);
        showToast("검색 연도 목록 로딩 실패", true);
    }
}

async function handleSearchClick() {
    const searchInput = document.getElementById('searchInput');
    // const searchYearSelect = document.getElementById('searchYear'); // 삭제
    const searchResultsContainer = document.getElementById('searchResults');
    
    const searchTerm = searchInput.value.trim();
    // const selectedYear = searchYearSelect.value; // 삭제

    if (searchTerm === '') {
        showToast('검색어를 입력하세요.', true);
        return;
    }

    searchResultsContainer.classList.remove('hidden');
    searchResultsContainer.innerHTML = '<div class="search-results-header">검색 중...</div>';

    try {
        // API 호출 시 'year' 파라미터를 완전히 제거합니다.
        const results = await callAppsScriptApi('searchTransactions', { 
            term: searchTerm 
        });

        if (results && results.length > 0) {
            displaySearchResults(results);
        } else {
            searchResultsContainer.innerHTML = '<div class="search-results-header">검색 결과가 없습니다.</div>';
        }
    } catch (error) {
        searchResultsContainer.innerHTML = `<div class="search-results-header">검색 중 오류: ${error.message}</div>`;
    }
}

function displaySearchResults(results) {
    const searchResultsContainer = document.getElementById('searchResults');
    
    searchResultsContainer.innerHTML = `
        <div class="search-results-header">
            검색 결과 ${results.length}건
        </div>
        <div class="search-results-content">
            <div id="searchResultsList"></div>
        </div>
    `;
    
    const resultsList = document.getElementById('searchResultsList');
    
    results.forEach(item => {
        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        
        const amountClass = item.type === '수입' ? 'income' : 'expense';
        
        resultItem.innerHTML = `
            <div class="search-result-date">${item.date}</div>
            <div class="search-result-content">${item.content}</div>
            <div class="search-result-amount ${amountClass}">${Number(item.amount).toLocaleString()}원</div>
            <div class="search-result-meta">
                <span>${item.type}</span>
                ${item.paymentMethod ? `<span>${item.paymentMethod}</span>` : ''}
                ${item.category1 ? `<span>${item.category1}</span>` : ''}
            </div>
        `;
        
        resultItem.addEventListener('click', () => {
            openTransactionModalForEdit(item);
            // [ADDED] 검색 결과 클릭 후 검색창 숨기기 및 입력 초기화
            hideSearchResults();
            clearSearchInput();
        });
        
        resultsList.appendChild(resultItem);
    });
}

function hideSearchResults() {
    const searchResultsContainer = document.getElementById('searchResults');
    if (searchResultsContainer) {
        searchResultsContainer.classList.add('hidden');
    }
}

function clearSearchInput() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
    }
}

// [ADDED] 검색 결과 클릭 시 수정 모달을 열기 위한 함수
function openTransactionModalForEdit(transactionData) {
    // populateFormForEdit 함수는 이미 존재하므로 이를 호출합니다.
    populateFormForEdit(transactionData);
    // 모달을 열 때 일일 거래내역은 숨깁니다.
    document.getElementById('dailyTransactions').style.display = 'none'; 
    document.getElementById('toggleDailyTransactions').textContent = '거래 내역 보기';
    // 모달을 표시합니다.
    document.getElementById('transactionModal').style.display = 'flex';
}




