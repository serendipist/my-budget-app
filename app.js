// app.js - 최종 수정본 (문법 오류 수정)
const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjP671pu6MMLKhmTXHwqCu-wci-Y-RM0Sl5TlQO0HmGsyrH83DBj6dsh62LqHIf-YD/exec";

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
  await populateSearchYearDropdownFromServer();

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
  document.getElementById('transactionModal')?.style.display = 'none';
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

function renderCalendar(year, monthOneBased, transactions) {
  const calendarBody = document.getElementById('calendarBody');
  calendarBody.innerHTML = '';
  const transMap = {};
  (transactions||[]).forEach(t=>{ if(t && t.date){ (transMap[t.date]=transMap[t.date]||[]).push(t); } });
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const cycleStart = new Date(year, monthOneBased-1, 18);
  const cycleEnd   = new Date(year, monthOneBased,   17);
  let cur = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  const frag = document.createDocumentFragment();
  for(let i=0;i<cycleStart.getDay();i++){ const td=document.createElement('td'); td.className='other-month'; weekRow.appendChild(td); }
  while(cur<=cycleEnd){
    const td = document.createElement('td');
    const dStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    if (dStr === todayStr) { td.classList.add('today'); }
    td.dataset.date=dStr;
    td.onclick=()=>openModal(dStr);
    const num = document.createElement('span');
    num.className='date-number';
    num.textContent=cur.getDate();
    td.appendChild(num);
    const wrap=document.createElement('div');
    wrap.className='txn-wrap';
    const list = transMap[dStr]||[];
    list.slice(0,4).forEach(t=>{
      const div=document.createElement('div');
      div.className=`txn-item ${t.type==='수입'?'income':'expense'}`;
      div.textContent=`${Number(t.amount).toLocaleString()}원`;
      wrap.appendChild(div);
    });
    if(list.length>4){
      const more=document.createElement('div');
      more.className='more-link';
      more.textContent=`+${list.length-4}`;
      more.onclick=e=>{ e.stopPropagation(); openModal(dStr);}
      wrap.appendChild(more);
    }
    td.appendChild(wrap);
    weekRow.appendChild(td);
    if(cur.getDay()===6 || cur.getTime()===cycleEnd.getTime()){ // 수정: = → ===
      if(cur.getTime()===cycleEnd.getTime() && cur.getDay()!==6){ // 수정: = → ===, !6 → !==6
        for(let i=cur.getDay()+1;i<=6;i++){ const empty=document.createElement('td'); empty.className='other-month'; weekRow.appendChild(empty); }
      }
      frag.appendChild(weekRow);
      if(cur.getTime()!==cycleEnd.getTime()) weekRow=document.createElement('tr');
    }
    cur.setDate(cur.getDate()+1);
  }
  calendarBody.appendChild(frag);
  if(typeof afterRender==='function') afterRender();
}

function updateSummary(transactions){
  let inc = 0, exp = 0;
  (transactions||[]).forEach(t => { 
    if (t && typeof t.amount !== 'undefined') { // 수정: ! → !==
      const a = Number(t.amount)||0; 
      if (t.type==='수입') inc += a; // 수정: = → ===
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
    paymentMethodsData    = setupData.paymentMethods    || [];
    incomeSourcesData     = setupData.incomeSources     || [];
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
    calendarElement.addEventListener('touchstart', e => { touchstartX = e.changedTouches[0].screenX; touchstartY = e.changedTouches.screenY; }, { passive: true });
    calendarElement.addEventListener('touchend', async e => {
        touchendX = e.changedTouches[0].screenX;
        touchendY = e.changedTouches.screenY;
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

async function handleTransactionSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target), data = {};
    fd.forEach((v, k) => data[k] = v);
    if (!validateTransactionData(data)) return;
    const isEditing = !!currentEditingTransaction?.row;
    const key = 'transactions_' + currentCycleMonth;
    const originalData = JSON.parse(localStorage.getItem(key) || '[]');
    let optimisticData = JSON.parse(JSON.stringify(originalData));
    const itemForServer = { ...data };
    if (isEditing) {
        const index = optimisticData.findIndex(t => t?.row?.toString() === currentEditingTransaction.row.toString());
        if (index > -1) {
            itemForServer.id_to_update = currentEditingTransaction.row;
            optimisticData[index] = { 
                ...optimisticData[index], 
                ...data, 
                category1: data.type === '수입' ? data.incomeSource : data.mainCategory, // 수정: = → ===
                category2: data.type === '수입' ? '' : data.subCategory // 수정: = → ===
            };
        }
    } else {
        optimisticData.push({ 
            ...data, 
            row: `temp-${Date.now()}`, 
            category1: data.type === '수입' ? data.incomeSource : data.mainCategory, // 수정: = → ===
            category2: data.type === '수입' ? '' : data.subCategory // 수정: = → ===
        });
    }
    localStorage.setItem(key, JSON.stringify(optimisticData));
    renderCalendarAndSummary(optimisticData);
    showToast(isEditing ? '수정 중...' : '저장 중...');
    closeModal();
    try {
        const result = await callAppsScriptApi(isEditing ? 'updateTransaction' : 'addTransaction', { transactionDataString: JSON.stringify(itemForServer) });
        if (result.success) {
            showToast(result.message || '완료!', false);
            await updateCalendarDisplay();
        } else {
            throw new Error(result.message || '서버 처리 실패');
        }
    } catch (error) {
        showToast(`실패: ${error.message}`, true);
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
    const searchYearSelect = document.getElementById('searchYear');
    const searchResultsContainer = document.getElementById('searchResults');
    
    const searchTerm = searchInput.value.trim();
    const selectedYear = searchYearSelect.value;

    if (searchTerm === '') {
        showToast('검색어를 입력하세요.', true);
        return;
    }

    // 검색 결과 컨테이너 표시 및 로딩 메시지
    searchResultsContainer.classList.remove('hidden');
    searchResultsContainer.innerHTML = '<div class="search-results-header">검색 중...</div>';

    try {
        const results = await callAppsScriptApi('searchTransactions', { 
            term: searchTerm, 
            year: selectedYear 
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

function openTransactionModalForEdit(transactionData) {
    populateFormForEdit(transactionData);
    document.getElementById('dailyTransactions').style.display = 'none'; 
    document.getElementById('toggleDailyTransactions').textContent = '거래 내역 보기';
    document.getElementById('transactionModal').style.display = 'flex';
}
