// app.js - 카테고리 수정 문제 디버깅 및 API 연동

// ▼▼▼ 선생님의 실제 앱스 스크립트 웹앱 배포 URL로 반드시 교체해주세요!!! ▼▼▼
const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbxiR6w6tIohFbPzTgAAVZtHeJqtyMyzVlMndDib0PB9x9W9k_282UpZ3zr19vkK2l8/exec"; //https://github.com/serendipist/my-budget-app/blob/main/app.js
// ▲▲▲ 선생님의 실제 배포 URL을 다시 한번 확인해주세요. ▲▲▲

/* === 전역 상태 === */
let currentDisplayDate = new Date();
let currentCycleMonth = '';
let cardPerformanceMonthDate = new Date();
let expenseCategoriesData = {}; // loadInitialData를 통해 채워짐
let paymentMethodsData = [];    // loadInitialData를 통해 채워짐
let incomeSourcesData = [];     // loadInitialData를 통해 채워짐
let currentEditingTransaction = null;

/* === API 호출 헬퍼 함수 === */
async function callAppsScriptApi(actionName, params = {}) {
  const url = new URL(APPS_SCRIPT_API_ENDPOINT);
  url.searchParams.append('action', actionName);
  for (const key in params) {
    if (params[key]) { // 값이 있는 파라미터만 추가
      url.searchParams.append(key, params[key]);
    }
  }

  console.log(`[API] Calling: ${actionName} with params: ${JSON.stringify(params)}, URL: ${url.toString()}`);
  try {
    const response = await fetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[API] Call to "${actionName}" failed with status ${response.status}: ${errorText}`);
      throw new Error(`서버 응답 오류 (${response.status})`);
    }
    const result = await response.json();
    if (result.success === false) {
      console.error(`[API] Action "${actionName}" returned an error:`, result.error);
      throw new Error(result.error || `"${actionName}" API 요청 실패`);
    }
    return result.data !== undefined ? result.data : result;
  } catch (error) {
    console.error(`[API] Error calling action "${actionName}":`, error);
    if (typeof showToast === 'function') {
      showToast(`"${actionName}" API 요청 중 오류: ${error.message}`, true);
    }
    throw error; 
  }
}

/* === 뷰포트 높이 CSS 변수 갱신 === */
function setViewportHeightVar(){
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h}px`);
}
['load','resize','orientationchange'].forEach(evt => window.addEventListener(evt, setViewportHeightVar));
setViewportHeightVar();


/* === 페이지 로드 순서 === */
window.onload = async () => {
  console.log("[App.js] window.onload triggered");
  determineInitialCycleMonth();
  setupEventListeners();
  
  const loader = document.getElementById('loader');
  if(loader) loader.style.display = 'block';

  try {
    await loadInitialData();     
    await updateCalendarDisplay(); 
  } catch (error) {
    console.error("[App.js] Error during initial data loading:", error);
    if (typeof showToast === 'function') showToast("초기 데이터 로딩 중 오류가 발생했습니다. 페이지를 새로고침해주세요.", true);
  } finally {
    if(loader) loader.style.display = 'none';
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
  // ▼▼▼ [추가됨] 검색 버튼에 이벤트 리스너 연결 ▼▼▼
  document.getElementById('searchBtn').addEventListener('click', handleSearch);
}

// (기존 함수들: determineInitialCycleMonth, changeMonth, updateCalendarDisplay, renderCalendarAndSummary, renderCalendar, updateSummary, loadInitialData 등... 수정 없이 그대로 유지)
// ... 기존 함수들 생략 ...
/* === 주기 계산 & 달력 (이전과 거의 동일, updateCalendarDisplay 호출 확인) === */
function determineInitialCycleMonth(){ /* 이전과 동일 */
  const today = new Date();
  let year = today.getFullYear();
  let mIdx = today.getDate() < 18 ? today.getMonth() - 1 : today.getMonth();
  if(mIdx < 0){ mIdx = 11; year -= 1; }
  currentDisplayDate = new Date(year, mIdx, 18);
  currentCycleMonth = `${year}-${String(mIdx + 1).padStart(2,'0')}`;
  console.log("[App.js] Initial cycle month determined:", currentCycleMonth);
}

async function changeMonth(delta){ /* 이전과 동일 */
  currentDisplayDate.setMonth(currentDisplayDate.getMonth() + delta);
  const y = currentDisplayDate.getFullYear();
  const m = currentDisplayDate.getMonth();
  currentCycleMonth = `${y}-${String(m + 1).padStart(2,'0')}`;
  await updateCalendarDisplay(); 
}

async function updateCalendarDisplay () {
  const loader       = document.getElementById('loader');
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error('calendarBody not found'); return; }
  if (loader) loader.style.display = 'block';

  console.log('[App.js] updateCalendarDisplay →', currentCycleMonth);

  const cacheKey            = 'transactions_' + currentCycleMonth;
  const cachedDataString    = localStorage.getItem(cacheKey);
  let   renderedFromCache   = false;
  let   transactionsToRender = [];

  if (cachedDataString) {
    try {
      const cachedArr = JSON.parse(cachedDataString);
      if (Array.isArray(cachedArr)) {
        transactionsToRender = cachedArr;
        renderCalendarAndSummary(cachedArr);
        renderedFromCache = true;
        console.log('[App.js] drew calendar from localStorage');
      } else {
        localStorage.removeItem(cacheKey);
      }
    } catch (err) {
      console.warn('cache parse fail → drop', err);
      localStorage.removeItem(cacheKey);
    }
  }

  if (!renderedFromCache) {
    calendarBody.innerHTML = '';
    renderCalendarAndSummary([]);
  }

  try {
    const latest = await callAppsScriptApi('getTransactions',
                                           { cycleMonth: currentCycleMonth });

    const finalTx = (latest && Array.isArray(latest)) ? latest : [];
    
    if (renderedFromCache && finalTx.length === 0) {
      console.warn('[App.js] API empty → keep cached view');
      return;
    }

    localStorage.setItem(cacheKey, JSON.stringify(finalTx));

    if (!renderedFromCache ||
        JSON.stringify(transactionsToRender) !== JSON.stringify(finalTx)) {
      renderCalendarAndSummary(finalTx);

      if (renderedFromCache) {
        showToast?.('달력 정보가 업데이트 되었습니다.', false);
      }
    }
  } catch (err) {
    console.error('[App.js] getTransactions failed', err);
    if (!renderedFromCache) renderCalendarAndSummary([]);
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

function renderCalendarAndSummary(transactions){
  if (!currentCycleMonth) { console.error("renderCalendarAndSummary: currentCycleMonth is not set."); return; }
  const parts = currentCycleMonth.split('-');
  if (parts.length < 2) { console.error("renderCalendarAndSummary: currentCycleMonth format is incorrect.", currentCycleMonth); return; }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  document.getElementById('currentMonthYear').textContent = `${year}년 ${String(month).padStart(2,'0')}월 주기`;
  renderCalendar(year, month, transactions);
  updateSummary(transactions);
}

function renderCalendar(year, monthOneBased, transactions){
  const calendarBody = document.getElementById('calendarBody');
  calendarBody.innerHTML = '';
  const transMap = {};
  (transactions||[]).forEach(t=>{
     if(t && t.date){ (transMap[t.date]=transMap[t.date]||[]).push(t); }
  });
  const cycleStart = new Date(year, monthOneBased-1, 18);
  const cycleEnd   = new Date(year, monthOneBased,   17);
  let cur = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  const frag = document.createDocumentFragment();
  for(let i=0;i<cycleStart.getDay();i++){
    const td=document.createElement('td'); td.className='other-month'; weekRow.appendChild(td);
  }
  while(cur<=cycleEnd){
    const td = document.createElement('td');
    const dStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    td.dataset.date=dStr; td.onclick=()=>openModal(dStr);
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
    if(cur.getDay()===6 || cur.getTime()===cycleEnd.getTime()){
      if(cur.getTime()===cycleEnd.getTime() && cur.getDay()!==6){
        for(let i=cur.getDay()+1;i<=6;i++){
          const empty=document.createElement('td');
          empty.className='other-month';
          weekRow.appendChild(empty);
        }
      }
      frag.appendChild(weekRow);
      if(cur.getTime()!==cycleEnd.getTime()) weekRow=document.createElement('tr');
    }
    cur.setDate(cur.getDate()+1);
  }
  calendarBody.appendChild(frag);
}

function updateSummary(transactions){
  let inc = 0, exp = 0;
  (transactions||[]).forEach(t => { if (t && typeof t.amount !== 'undefined') { const a = Number(t.amount)||0; if (t.type==='수입') inc += a; else exp += a; } });
  const bal = inc - exp;
  document.getElementById('totalIncome').textContent = `₩${inc.toLocaleString()}`;
  document.getElementById('totalExpense').textContent = `₩${exp.toLocaleString()}`;
  const balEl = document.getElementById('totalBalance');
  balEl.textContent = `₩${bal.toLocaleString()}`; balEl.className = 'total-balance'; 
  if (bal < 0) balEl.classList.add('negative');
}

async function loadInitialData() {
  console.log("[App.js] loadInitialData: Fetching app setup data via API...");
  try {
    const setupData = await callAppsScriptApi('getAppSetupData', { initialCycleMonth: currentCycleMonth }); 
    if (setupData) { 
      expenseCategoriesData = setupData.expenseCategories || {};
      paymentMethodsData    = setupData.paymentMethods    || [];
      incomeSourcesData     = setupData.incomeSources     || [];
      if (setupData.initialTransactions && Array.isArray(setupData.initialTransactions)) {
        console.log("[App.js] Initial transactions received from getAppSetupData and caching to localStorage for cycle:", currentCycleMonth);
        localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(setupData.initialTransactions));
      }
      populateFormDropdowns(); 
      populateCardSelector();  
    }
  } catch (error) {
    console.error('loadInitialData API call failed:', error);
  }
}

function setupSwipeListeners() {
    const calendarElement = document.getElementById('calendarView');
    if (!calendarElement) {
        console.warn("[App.js] 스와이프 감지를 위한 달력 요소를 찾을 수 없습니다 ('calendarView').");
        return;
    }
    let touchstartX = 0;
    let touchendX = 0;
    let touchstartY = 0;
    let touchendY = 0;
    const SWIPE_THRESHOLD = 50;
    const SWIPE_MAX_VERTICAL = 75;
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

// ... (기존 함수들 생략) ...

/* === 검색 기능 관련 함수들 === */

/**
 * '검색하기' 버튼 클릭 시 실행되는 메인 핸들러 함수
 */
async function handleSearch() {
  const query = document.getElementById('searchInput').value.trim();
  const startMonth = document.getElementById('startMonth').value; // YYYY-MM 형식
  const endMonth = document.getElementById('endMonth').value;     // YYYY-MM 형식
  const resultsDiv = document.getElementById('searchResults');
  const loader = document.getElementById('loader');

  resultsDiv.innerHTML = ''; // 이전 결과 초기화
  if (loader) loader.style.display = 'block';
  showToast('데이터를 검색 중입니다...');

  try {
    const searchParams = { query, startMonth, endMonth };
    // 백엔드(Apps Script)에 'searchTransactions' 액션을 요청합니다.
    const results = await callAppsScriptApi('searchTransactions', searchParams);
    renderSearchResults(results); // 결과를 화면에 렌더링
  } catch (error) {
    console.error('Search failed:', error);
    resultsDiv.innerHTML = `<p style="text-align: center; color: red;">검색 중 오류가 발생했습니다.</p>`;
    showToast(`검색 오류: ${error.message}`, true);
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

/**
 * 검색 결과를 받아 화면에 목록 형태로 그려주는 함수
 * @param {Array<Object>} transactions - 검색된 거래 내역 객체 배열
 */
function renderSearchResults(transactions) {
  const resultsDiv = document.getElementById('searchResults');
  resultsDiv.innerHTML = ''; // 이전 결과 초기화

  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    resultsDiv.innerHTML = '<p style="text-align: center; color: #888;">검색 결과가 없습니다.</p>';
    return;
  }

  // 검색 결과 요약 정보 추가
  const summary = document.createElement('p');
  summary.style.textAlign = 'center';
  summary.style.marginBottom = '20px';
  summary.innerHTML = `<strong>총 ${transactions.length}건</strong>의 거래 내역을 찾았습니다.`;
  resultsDiv.appendChild(summary);

  const fragment = document.createDocumentFragment();
  transactions.forEach(t => {
    const item = document.createElement('div');
    item.className = `transaction-item search-result-item ${t.type === '수입' ? 'income' : 'expense'}`;
    
    // 거래 내역의 상세 정보를 담을 컨테이너
    const details = document.createElement('div');
    details.className = 'result-details';

    const line1 = document.createElement('div');
    line1.className = 'result-line1';
    
    const dateSpan = document.createElement('span');
    dateSpan.className = 'result-date';
    dateSpan.textContent = t.date || '날짜 없음';
    
    const contentSpan = document.createElement('span');
    contentSpan.className = 'result-content';
    contentSpan.textContent = t.content || '내용 없음';

    line1.appendChild(dateSpan);
    line1.appendChild(contentSpan);

    const line2 = document.createElement('div');
    line2.className = 'result-line2';
    
    const categorySpan = document.createElement('span');
    categorySpan.className = 'result-category';
    let categoryText = '';
    if (t.type === '지출') {
      categoryText = `${t.category1 || ''}${t.category2 ? ` / ${t.category2}` : ''} (${t.paymentMethod || '미지정'})`;
    } else { // 수입
      categoryText = t.category1 || '미지정 수입원';
    }
    categorySpan.textContent = categoryText;
    
    line2.appendChild(categorySpan);

    details.appendChild(line1);
    details.appendChild(line2);

    // 금액 정보
    const amountSpan = document.createElement('span');
    amountSpan.className = 'result-amount';
    amountSpan.textContent = `${Number(t.amount || 0).toLocaleString()}원`;

    item.appendChild(details);
    item.appendChild(amountSpan);
    
    fragment.appendChild(item);
  });

  resultsDiv.appendChild(fragment);
}


/* === 기존 모달 및 거래 처리 관련 함수들 === */
// (handleTransactionSubmit, openModal, closeModal, populateFormForEdit 등... 수정 없이 그대로 유지)
// ... 기존 함수들 생략 ...
async function handleTransactionSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const transactionData = {};
  fd.forEach((v, k) => transactionData[k] = v);

  if (!validateTransactionData(transactionData)) return;

  const isEditing = currentEditingTransaction && typeof currentEditingTransaction.row !== 'undefined';
  const itemForServer = { ...transactionData };
  if (isEditing) {
    itemForServer.id_to_update = currentEditingTransaction.row;
  }

  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';
  showToast(isEditing ? '수정 사항을 전송 중입니다...' : '저장 중입니다...');
  closeModal();

  const action = isEditing ? 'updateTransaction' : 'addTransaction';
  try {
    const serverResult = await callAppsScriptApi(action, { transactionDataString: JSON.stringify(itemForServer) });
    
    if (serverResult.success) {
      showToast(serverResult.message || (isEditing ? '수정 완료!' : '저장 완료!'), false);
      await updateCalendarDisplay();
    } else {
      throw new Error(serverResult.message || serverResult.error || '서버 작업 처리 실패');
    }
  } catch (error) {
    showToast((isEditing ? '수정 실패: ' : '저장 실패: ') + error.message, true);
  } finally {
    if (loader) loader.style.display = 'none';
  }
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

function closeModal(){
  const transactionModal = document.getElementById('transactionModal');
  if (transactionModal) transactionModal.style.display='none'; 
}

function toggleDailyTransactionVisibility() {
  const dailySection = document.getElementById('dailyTransactions');
  const toggleBtn = document.getElementById('toggleDailyTransactions');
  const isHidden = dailySection.style.display === 'none';
  if (isHidden) { dailySection.style.display = 'block'; toggleBtn.textContent = '거래 내역 숨기기';
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

async function loadDailyTransactions(dateStr) {
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;
  list.textContent = '불러오는 중...';
  try {
    const dailyData = await callAppsScriptApi('getTransactionsByDate', { date: dateStr });
    displayDailyTransactions(dailyData || [], dateStr);
  } catch (error) {
    console.error('loadDailyTransactions API call failed for date ' + dateStr + ':', error);
    if (list) list.textContent = '일일 거래 내역 로딩 실패.';
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

function showToast(msg,isErr=false){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.style.backgroundColor = isErr ? '#dc3545' : '#28a745'; 
  t.style.visibility = 'visible'; t.style.opacity = '1';
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=> t.style.visibility = 'hidden', 500); }, 3000);
}

function populateCardSelector(){
  const sel = document.getElementById('cardSelector');
  if (!sel) return;
  const currentCard = sel.value; 
  sel.innerHTML='<option value="">카드를 선택하세요</option>';
  (paymentMethodsData||[]).filter(m=>m.isCard).forEach(c=>{
    const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; sel.appendChild(o);
  });
  if (currentCard && sel.querySelector(`option[value="${currentCard}"]`)) { sel.value = currentCard; }
}

async function changeCardMonth(d){
  cardPerformanceMonthDate.setMonth(cardPerformanceMonthDate.getMonth()+d); 
  await displayCardData(); 
}

async function displayCardData() {
  const cardSel = document.getElementById('cardSelector');
  const det = document.getElementById('cardDetails');
  const lbl = document.getElementById('cardMonthLabel');
  const loader = document.getElementById('loader');
  if (!cardSel || !det || !lbl) return;
  const card = cardSel.value;
  if (!card){ det.innerHTML = '<p>카드를 선택해주세요.</p>'; lbl.textContent = ''; return; }
  if(loader) loader.style.display = 'block';
  const perfMonth = `${cardPerformanceMonthDate.getFullYear()}-${String(cardPerformanceMonthDate.getMonth()+1).padStart(2,'0')}`;
  lbl.textContent = `${perfMonth} 기준`;
  try {
    const d = await callAppsScriptApi('getCardData', { 
      cardName: card, cycleMonthForBilling: currentCycleMonth, performanceReferenceMonth: perfMonth 
    });
    if (!d || d.success === false){
      det.innerHTML = `<p>${d && d.error ? d.error : '카드 데이터 로딩 중 오류가 발생했습니다.'}</p>`;
      throw new Error(d && d.error ? d.error : '카드 데이터 구조 오류 또는 API 실패');
    }
    const billingMonth = d.billingCycleMonthForCard || currentCycleMonth;
    const perfRefMonthDisplay = d.performanceReferenceMonthForDisplay || perfMonth;
    const billingAmt = Number(d.billingAmount) || 0;
    const perfAmt = Number(d.performanceAmount) || 0;
    const targetAmt = Number(d.performanceTarget) || 0;
    const rate = targetAmt > 0 ? ((perfAmt/targetAmt)*100).toFixed(1)+'%' : '0%';
    det.innerHTML = `<h4>${d.cardName || card}</h4> <p><strong>청구 기준월:</strong> ${billingMonth} (18일~다음달 17일)</p> <p><strong>청구 예정 금액:</strong> ${billingAmt.toLocaleString()}원</p><hr> <p><strong>실적 산정월:</strong> ${perfRefMonthDisplay}</p> <p><strong>현재 사용액(실적):</strong> ${perfAmt.toLocaleString()}원</p> <p><strong>실적 목표 금액:</strong> ${targetAmt.toLocaleString()}원</p> <p><strong>달성률:</strong> ${rate}</p> <p style="font-size:0.8em;color:grey;">(실적은 카드사의 실제 집계와 다를 수 있습니다)</p>`;
  } catch (error) {
    det.innerHTML = '<p>카드 데이터를 불러오는 데 실패했습니다.</p>';
    console.error('displayCardData API call failed:', error);
  } finally {
    if(loader) loader.style.display = 'none';
  }
}

async function handleDelete() {
  if (!currentEditingTransaction || typeof currentEditingTransaction.row === 'undefined') {
    showToast('삭제할 거래를 먼저 선택하거나, 유효한 거래가 아닙니다.', true);
    return;
  }
  const rowId = currentEditingTransaction.row;
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';
  showToast('삭제를 서버에 전송 중입니다...');
  closeModal();

  try {
    const serverResult = await callAppsScriptApi('deleteTransaction', { id_to_delete: Number(rowId) });
    if (serverResult.success) {
      showToast(serverResult.message || '삭제 완료!', false);
      await updateCalendarDisplay();
    } else {
      throw new Error(serverResult.message || serverResult.error || '서버에서 삭제 실패');
    }
  } catch (error) {
    showToast(`삭제 실패! (${error.message})`, true);
  } finally {
    if (loader) loader.style.display = 'none';
  }
}
function toggleTypeSpecificFields() { 
  const typeRadio = document.querySelector('input[name="type"]:checked');
  let type = '지출'; 
  if (typeRadio) { type = typeRadio.value;
  } else { const defaultExpenseRadio = document.querySelector('input[name="type"][value="지출"]');
    if (defaultExpenseRadio) defaultExpenseRadio.checked = true;
  }
  document.getElementById('expenseSpecificFields').style.display = type === '지출' ? 'block' : 'none';
  document.getElementById('incomeSpecificFields').style.display  = type === '수입' ? 'block' : 'none';
}
function populateFormDropdowns() { 
  const pm = document.getElementById('paymentMethod');
  pm.innerHTML = '<option value="">선택하세요</option>';
  (paymentMethodsData||[]).forEach(m=>{ const o=document.createElement('option'); o.value=m.name; o.textContent=m.name; pm.appendChild(o); });
  const mainSel = document.getElementById('mainCategory');
  mainSel.innerHTML = '<option value="">선택하세요</option>';
  for (const k in expenseCategoriesData) { const o=document.createElement('option'); o.value=k; o.textContent=k; mainSel.appendChild(o); }
  updateSubCategories(); 
  const incSel = document.getElementById('incomeSource');
  incSel.innerHTML='<option value="">선택하세요</option>';
  (incomeSourcesData||[]).forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; incSel.appendChild(o); });
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

