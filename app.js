// app.js - 카테고리 수정 문제 디버깅 및 API 연동

// ▼▼▼ 선생님의 실제 앱스 스크립트 웹앱 배포 URL로 반드시 교체해주세요!!! ▼▼▼
const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjP671pu6MMLKhmTXHwqCu-wci-Y-RM0Sl5TlQO0HmGsyrH83DBj6dsh62LqHIf-YD/exec"; 
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
    url.searchParams.append(key, params[key]);
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

/* === 뷰포트 높이 CSS 변수 갱신 (이전과 동일) === */
function setViewportHeightVar(){
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h}px`);
}
['load','resize','orientationchange'].forEach(evt => window.addEventListener(evt, setViewportHeightVar));
setViewportHeightVar();

function adjustCalendarHeight(){ /* 현재 사용 안 함 */ }
function afterRender(){ setTimeout(adjustCalendarHeight, 0); } 
['resize','orientationchange'].forEach(evt => {
  setViewportHeightVar();
  adjustCalendarHeight();
});

/* === 페이지 로드 순서 (이전과 동일) === */
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

async function updateCalendarDisplay() { /* 이전 답변의 "캐시 먼저, 네트워크는 나중에" 전략 적용된 버전 사용 */
  const loader = document.getElementById('loader');
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error("calendarBody not found"); if(loader) loader.style.display = 'none'; return; }
  if(loader) loader.style.display = 'block';
  console.log("[App.js] updateCalendarDisplay: Fetching transactions for cycle:", currentCycleMonth);
  let transactionsToRender = [];
  const cachedDataString = localStorage.getItem('transactions_' + currentCycleMonth);
  let renderedFromCache = false;
  if (cachedDataString) {
    console.log('[App.js] Rendering calendar from localStorage cache (first pass for updateCalendarDisplay).');
    try {
      const cachedTransactions = JSON.parse(cachedDataString);
      if (Array.isArray(cachedTransactions)) {
        transactionsToRender = cachedTransactions;
        renderCalendarAndSummary(transactionsToRender); 
        renderedFromCache = true;
      } else { localStorage.removeItem('transactions_' + currentCycleMonth); }
    } catch (e) { 
      console.error("Failed to parse transactions from localStorage", e);
      localStorage.removeItem('transactions_' + currentCycleMonth);
    }
  }
  if (!renderedFromCache) {
      calendarBody.innerHTML = ''; 
      renderCalendarAndSummary([]);
  }
  try {
    const latestTransactions = await callAppsScriptApi('getTransactions', { cycleMonth: currentCycleMonth });
    const finalTransactions = (latestTransactions && Array.isArray(latestTransactions)) ? latestTransactions : [];
    localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(finalTransactions));
    console.log('[App.js] Updated localStorage with fresh data from API for transactions.');
    if (!renderedFromCache || JSON.stringify(transactionsToRender) !== JSON.stringify(finalTransactions)) {
      renderCalendarAndSummary(finalTransactions);
    }
    if (renderedFromCache && JSON.stringify(transactionsToRender) !== JSON.stringify(finalTransactions)) {
      if (typeof showToast === 'function') showToast('달력 정보가 업데이트 되었습니다.', false);
    }
  } catch (error) {
    console.error('updateCalendarDisplay API call failed:', error);
    if (!renderedFromCache) { renderCalendarAndSummary([]); }
  } finally {
    if(loader) loader.style.display = 'none';
  }
}

function renderCalendarAndSummary(transactions){ /* 이전과 동일 */
  if (!currentCycleMonth) { console.error("renderCalendarAndSummary: currentCycleMonth is not set."); return; }
  const parts = currentCycleMonth.split('-');
  if (parts.length < 2) { console.error("renderCalendarAndSummary: currentCycleMonth format is incorrect.", currentCycleMonth); return; }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  document.getElementById('currentMonthYear').textContent = `${year}년 ${String(month).padStart(2,'0')}월 주기`;
  renderCalendar(year, month, transactions);
  updateSummary(transactions);
}

function renderCalendar(year, monthOneBased, transactions){ /* 이전과 동일 */
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error("calendarBody for renderCalendar not found"); return; }
  calendarBody.innerHTML = '';
  const transMap = {};
  (transactions||[]).forEach(t=>{ if (t && t.date) { (transMap[t.date] = transMap[t.date] || []).push(t); } });
  const cycleStart = new Date(year, monthOneBased - 1, 18);
  const cycleEnd = new Date(year, monthOneBased, 17);
  let curDate = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  const frag = document.createDocumentFragment();
  const startDayOfWeek = cycleStart.getDay(); 
  for(let i=0; i<startDayOfWeek; i++){ const td = document.createElement('td'); td.className='other-month'; weekRow.appendChild(td); }
  while(curDate <= cycleEnd){
    const td = document.createElement('td');
    const dSpan = document.createElement('span'); dSpan.className='date-number'; dSpan.textContent = curDate.getDate(); td.appendChild(dSpan);
    const dStr = `${curDate.getFullYear()}-${String(curDate.getMonth()+1).padStart(2,'0')}-${String(curDate.getDate()).padStart(2,'0')}`;
    td.dataset.date = dStr; td.onclick = () => openModal(dStr);
    (transMap[dStr]||[]).forEach(t=>{
      if (t && typeof t.amount !== 'undefined') {
        const div = document.createElement('div'); div.className = `transaction-item ${t.type==='수입'?'income':'expense'}`;
        div.textContent = `${Number(t.amount).toLocaleString()}원`; td.appendChild(div);
      }
    });
    weekRow.appendChild(td);
    if(curDate.getDay() === 6 || curDate.getTime() === cycleEnd.getTime()){
      if(curDate.getDay() !== 6 && curDate.getTime() === cycleEnd.getTime()){ 
        for(let i = curDate.getDay() + 1; i <= 6; i++){ const emptyTd = document.createElement('td'); emptyTd.className='other-month'; weekRow.appendChild(emptyTd); }
      }
      frag.appendChild(weekRow);
      if(curDate.getTime() !== cycleEnd.getTime()){ weekRow = document.createElement('tr'); }
    }
    curDate.setDate(curDate.getDate() + 1);
  }
  calendarBody.appendChild(frag);
  if (typeof afterRender === 'function') afterRender();
}

function updateSummary(transactions){ /* 이전과 동일 */
  let inc = 0, exp = 0;
  (transactions||[]).forEach(t => { if (t && typeof t.amount !== 'undefined') { const a = Number(t.amount)||0; if (t.type==='수입') inc += a; else exp += a; } });
  const bal = inc - exp;
  document.getElementById('totalIncome').textContent = `₩${inc.toLocaleString()}`;
  document.getElementById('totalExpense').textContent = `₩${exp.toLocaleString()}`;
  const balEl = document.getElementById('totalBalance');
  balEl.textContent = `₩${bal.toLocaleString()}`; balEl.className = 'total-balance'; 
  if (bal < 0) balEl.classList.add('negative');
}

async function loadInitialData() { /* 이전과 동일 */
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
      if (typeof showToast === 'function') showToast('앱 설정을 불러왔습니다.', false);
    } else {
      if (typeof showToast === 'function') showToast('앱 설정 데이터를 가져오지 못했습니다.', true);
    }
  } catch (error) {
    console.error('loadInitialData API call failed:', error);
  }
}

function setupEventListeners() { /* 이전과 동일 (mainCategory change 리스너 포함) */
  document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('mainCategory').addEventListener('change', updateSubCategories); 
}

function toggleTypeSpecificFields() { /* 이전과 동일 */
  const typeRadio = document.querySelector('input[name="type"]:checked');
  let type = '지출'; 
  if (typeRadio) { type = typeRadio.value;
  } else { const defaultExpenseRadio = document.querySelector('input[name="type"][value="지출"]');
    if (defaultExpenseRadio) defaultExpenseRadio.checked = true;
  }
  document.getElementById('expenseSpecificFields').style.display = type === '지출' ? 'block' : 'none';
  document.getElementById('incomeSpecificFields').style.display  = type === '수입' ? 'block' : 'none';
}

function populateFormDropdowns() { /* 이전과 동일 */
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

function updateSubCategories() { /* 이전과 동일 (콘솔 로그 포함된 버전) */
  const mainCategorySelect = document.getElementById('mainCategory');
  const subCategorySelect = document.getElementById('subCategory');
  if (!mainCategorySelect || !subCategorySelect) {
    console.warn('[updateSubCategories] 주 또는 하위 카테고리 Select 요소를 찾을 수 없습니다.');
    return;
  }
  const mainCategoryValue = mainCategorySelect.value;
  console.log(`[updateSubCategories] 주 카테고리 값 '${mainCategoryValue}' 기준으로 하위 목록 업데이트 시작.`);
  subCategorySelect.innerHTML = '<option value="">선택하세요</option>'; 
  if (expenseCategoriesData && expenseCategoriesData[mainCategoryValue] && Array.isArray(expenseCategoriesData[mainCategoryValue])) {
    expenseCategoriesData[mainCategoryValue].forEach(subCat => {
      const option = document.createElement('option');
      option.value = subCat; option.textContent = subCat;
      subCategorySelect.appendChild(option);
    });
    console.log(`[updateSubCategories] '${mainCategoryValue}'에 대한 하위 카테고리 (${expenseCategoriesData[mainCategoryValue].length}개) 목록 생성 완료.`);
  } else {
    console.log(`[updateSubCategories] 주 카테고리 '${mainCategoryValue}'에 대한 하위 카테고리 데이터가 없습니다.`);
  }
}

async function handleTransactionSubmit(e) { /* 이전과 동일 (API 호출 및 Optimistic Update) */
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const transactionData = {};
  fd.forEach((v, k) => transactionData[k] = v);

  if (!validateTransactionData(transactionData)) return; // 유효성 검사 함수 호출

  const isEditing = currentEditingTransaction && typeof currentEditingTransaction.row !== 'undefined';
  const originalData = JSON.parse(localStorage.getItem('transactions_' + currentCycleMonth) || '[]');
  let optimisticData = JSON.parse(JSON.stringify(originalData)); 
  const tempRowId = `temp-${Date.now()}`;
  let itemForServer = { ...transactionData }; 

  if (isEditing) {
    const index = optimisticData.findIndex(t => t && typeof t.row !== 'undefined' && t.row.toString() === currentEditingTransaction.row.toString());
    if (index > -1) {
      itemForServer.id_to_update = currentEditingTransaction.row; 
      optimisticData[index] = { ...optimisticData[index], ...transactionData }; 
      if (optimisticData[index].type === '수입') { 
        optimisticData[index].category1 = transactionData.incomeSource || ''; 
        optimisticData[index].category2 = '';
      } else { 
        optimisticData[index].category1 = transactionData.mainCategory || ''; 
        optimisticData[index].category2 = transactionData.subCategory || '';
      }
    }
  } else {
    const newItemForUI = { ...transactionData, row: tempRowId };
     if (newItemForUI.type === '수입') {
        newItemForUI.category1 = transactionData.incomeSource || ''; newItemForUI.category2 = '';
      } else { 
        newItemForUI.category1 = transactionData.mainCategory || ''; newItemForUI.category2 = transactionData.subCategory || '';
      }
    optimisticData.push(newItemForUI);
  }
  
  localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(optimisticData));
  renderCalendarAndSummary(optimisticData);
  if (typeof showToast === 'function') showToast(isEditing ? '수정 사항 전송 중...' : '저장 사항 전송 중...');
  if (typeof closeModal === 'function') closeModal();

  const action = isEditing ? 'updateTransaction' : 'addTransaction';
  try {
    const serverResult = await callAppsScriptApi(action, { transactionDataString: JSON.stringify(itemForServer) });
    if (serverResult.success) {
      if (typeof showToast === 'function') showToast(serverResult.message || (isEditing ? '수정 완료!' : '저장 완료!'), false);
      await updateCalendarDisplay(); 
    } else { 
      throw new Error(serverResult.message || serverResult.error || '서버 작업 처리 실패');
    }
  } catch (error) { 
    if (typeof showToast === 'function') showToast((isEditing ? '수정 실패: ' : '저장 실패: ') + error.message, true);
    localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(originalData)); 
    renderCalendarAndSummary(originalData);
  }
}

// validateTransactionData 헬퍼 함수 (handleTransactionSubmit 내부 로직 분리)
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


async function openModal(dateStr) { /* 이전과 동일 */
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

function closeModal(){ /* 이전과 동일 */
  const transactionModal = document.getElementById('transactionModal');
  if (transactionModal) transactionModal.style.display='none'; 
}

function toggleDailyTransactionVisibility() { /* 이전과 동일 */
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

async function loadDailyTransactions(dateStr) { /* 이전과 동일 (API 호출) */
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

function displayDailyTransactions(arr, dateStr) { /* 이전과 동일 */
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

// ▼▼▼ 카테고리 수정 문제 해결을 위한 populateFormForEdit 최종 제안 ▼▼▼
function populateFormForEdit(transaction) {
  if (!transaction || typeof transaction.row === 'undefined') {
    console.error('[populateFormForEdit] 유효하지 않은 거래 데이터입니다.', transaction);
    if (typeof showToast === 'function') showToast('거래 정보를 불러오지 못했습니다. (ID 누락)', true); 
    return;
  }
  console.log('[populateFormForEdit] 수정할 거래 원본 데이터:', JSON.parse(JSON.stringify(transaction)));
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
  toggleTypeSpecificFields(); // ★ 유형에 따라 관련 필드 표시/숨김 (이 함수가 먼저 호출되어야 함)

  if (transaction.type === '지출') {
    console.log('[populateFormForEdit] 지출 유형 필드 채우기 시작');
    
    const paymentMethodSelect = document.getElementById('paymentMethod');
    if (paymentMethodSelect) paymentMethodSelect.value = transaction.paymentMethod || '';
    
    const mainCategorySelect = document.getElementById('mainCategory');
    if (mainCategorySelect) {
      // 주 카테고리 값을 먼저 설정합니다.
      mainCategorySelect.value = transaction.category1 || ''; 
      console.log(`[populateFormForEdit] 주 카테고리(${mainCategorySelect.id})에 설정 시도: '${transaction.category1}', 실제 설정된 값: '${mainCategorySelect.value}'`);
      
      // 주 카테고리 값 설정 후, 해당 값 기준으로 하위 카테고리 목록을 '강제로' 업데이트합니다.
      // 이렇게 하면 mainCategorySelect의 'change' 이벤트가 프로그래매틱하게 발생하지 않아도
      // updateSubCategories가 현재 mainCategorySelect.value를 기준으로 실행됩니다.
      updateSubCategories(); 
      
      // 하위 카테고리 값을 설정합니다. updateSubCategories가 동기적으로 옵션을 변경한 후입니다.
      const subCategorySelect = document.getElementById('subCategory');
      if (subCategorySelect) {
        subCategorySelect.value = transaction.category2 || '';
        console.log(`[populateFormForEdit] 하위 카테고리(${subCategorySelect.id})에 설정 시도: '${transaction.category2}', 실제 설정된 값: '${subCategorySelect.value}'`);
        
        if (transaction.category2 && subCategorySelect.value !== transaction.category2) {
            console.warn(`[populateFormForEdit] 하위 카테고리 '${transaction.category2}' 설정 실패. 사용 가능한 옵션:`, Array.from(subCategorySelect.options).map(opt => opt.value));
        }
      }
    }
  } else if (transaction.type === '수입') {
    console.log('[populateFormForEdit] 수입 유형 필드 채우기 시작');
    const incomeSourceSelect = document.getElementById('incomeSource');
    if (incomeSourceSelect) incomeSourceSelect.value = transaction.category1 || ''; 
  }

  const deleteBtn = document.getElementById('deleteBtn');
  if (deleteBtn) deleteBtn.style.display = 'block';
}
// ▲▲▲ 여기까지 populateFormForEdit 최종 제안 ▲▲▲


function showView(id){ /* 이전과 동일 */
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.tab-button').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.tab-button[onclick="showView('${id}')"]`).classList.add('active');
  if(id==='cardView'){
    cardPerformanceMonthDate = new Date(); 
    displayCardData();
  }
}

function showToast(msg,isErr=false){ /* 이전과 동일 */
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.style.backgroundColor = isErr ? '#dc3545' : '#28a745'; 
  t.style.visibility = 'visible'; t.style.opacity = '1';
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=> t.style.visibility = 'hidden', 500); }, 3000);
}

function populateCardSelector(){ /* 이전과 동일 */
  const sel = document.getElementById('cardSelector');
  if (!sel) return;
  const currentCard = sel.value; 
  sel.innerHTML='<option value="">카드를 선택하세요</option>';
  (paymentMethodsData||[]).filter(m=>m.isCard).forEach(c=>{
    const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; sel.appendChild(o);
  });
  if (currentCard && sel.querySelector(`option[value="${currentCard}"]`)) { sel.value = currentCard; }
}

async function changeCardMonth(d){ /* 이전과 동일 */
  cardPerformanceMonthDate.setMonth(cardPerformanceMonthDate.getMonth()+d); 
  await displayCardData(); 
}

async function displayCardData() { /* 이전과 동일 (API 호출) */
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

async function handleDelete() { /* 이전과 동일 (API 호출) */
  if (!currentEditingTransaction || typeof currentEditingTransaction.row === 'undefined') {
    showToast('삭제할 거래를 먼저 선택하거나, 유효한 거래가 아닙니다.', true); return;
  }
  const rowId = currentEditingTransaction.row; 
  const isTemp = typeof rowId === 'string' && rowId.startsWith('temp-');
  const key = 'transactions_' + currentCycleMonth;
  const originalData = JSON.parse(localStorage.getItem(key) || '[]');
  
  const filteredData = originalData.filter(t => t && typeof t.row !== 'undefined' && t.row.toString() !== rowId.toString());
  localStorage.setItem(key, JSON.stringify(filteredData));
  renderCalendarAndSummary(filteredData);
  closeModal();
  showToast(isTemp ? '임시 입력을 삭제했습니다.' : '삭제를 서버에 전송 중...');

  if (isTemp) return; 

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
    localStorage.setItem(key, JSON.stringify(originalData)); 
    renderCalendarAndSummary(originalData);
  }
}
