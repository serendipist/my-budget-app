const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjP671pu6MMLKhmTXHwqCu-wci-Y-RM0Sl5TlQO0HmGsyrH83DBj6dsh62LqHIf-YD/exec";
/* === 전역 상태 === */
let currentDisplayDate = new Date();
let currentCycleMonth = '';
let cardPerformanceMonthDate = new Date();
let expenseCategoriesData = {};
let paymentMethodsData = [];
let incomeSourcesData = [];
// const transactionsCache = {}; // 현재 사용되지 않음
let currentEditingTransaction = null;

/* === API 호출 헬퍼 함수 (다음 단계에서 Apps Script 백엔드 연동 시 사용) === */
async function callAppsScriptApi(actionName, params = {}) {
  const url = new URL(APPS_SCRIPT_API_ENDPOINT);
  url.searchParams.append('action', actionName);
  for (const key in params) {
    url.searchParams.append(key, params[key]);
  }

  console.log(`[API] Calling: ${actionName} with params:`, params, `URL: ${url.toString()}`);
  try {
    const response = await fetch(url.toString(), { method: 'GET' }); // 모든 요청을 GET으로 가정
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

/* === 달력 행 높이 동적 계산 (CSS vh로 주로 제어되므로 역할 축소 또는 제거 고려) === */
function adjustCalendarHeight(){
  // CSS에서 vh 단위로 높이를 제어
}
function afterRender(){ setTimeout(adjustCalendarHeight, 0); }
['resize','orientationchange'].forEach(evt => window.addEventListener(evt, () => {
  setViewportHeightVar();
  adjustCalendarHeight();
}));

/* === 페이지 로드 순서 === */
window.onload = () => {
  console.log("[App.js] window.onload triggered");
  determineInitialCycleMonth();
  setupEventListeners();
  
  // 초기 데이터 로드 (API 연동 전이므로 임시 데이터 사용 또는 빈 화면으로 시작)
  // 실제 API 연동은 다음 단계에서 진행합니다.
  console.warn("[App.js] Using temporary/mock data for initial load. API connection needed.");
  loadInitialDataWithMock(); // API 대신 임시 목업 데이터 사용 함수 호출
  updateCalendarDisplayWithMock(); // API 대신 임시 목업 데이터 사용 함수 호출

  showView('calendarView');
  toggleTypeSpecificFields();
  const transactionModal = document.getElementById('transactionModal');
  if (transactionModal) {
    transactionModal.style.display = 'none';
  }

  // 서비스 워커 등록
  if ('serviceWorker' in navigator) {
    // sw.js 파일이 index.html과 같은 루트에 있다고 가정하고 등록합니다.
    // GitHub Pages 저장소 이름이 'my-budget-app'이고 최상위에 파일들이 있다면,
    // 서비스워커의 scope는 '/my-budget-app/' 이 됩니다.
    // register()의 두 번째 인자로 { scope: '/my-budget-app/' } 와 같이 명시할 수 있습니다.
    // './'는 현재 HTML 파일의 경로를 기준으로 합니다.
    navigator.serviceWorker.register('sw.js', { scope: './' }) 
      .then(registration => {
        console.log('[App.js] Service Worker 등록 성공. Scope:', registration.scope);
      })
      .catch(error => {
        console.error('[App.js] Service Worker 등록 실패:', error);
      });
  }
};

/* === 주기 계산 & 달력 === */
function determineInitialCycleMonth(){
  const today = new Date();
  let year = today.getFullYear();
  let mIdx = today.getDate() < 18 ? today.getMonth() - 1 : today.getMonth();
  if(mIdx < 0){ mIdx = 11; year -= 1; }
  currentDisplayDate = new Date(year, mIdx, 18);
  currentCycleMonth = `${year}-${String(mIdx + 1).padStart(2,'0')}`;
  console.log("[App.js] Initial cycle month determined:", currentCycleMonth);
}

function changeMonth(delta){
  currentDisplayDate.setMonth(currentDisplayDate.getMonth() + delta);
  const y = currentDisplayDate.getFullYear();
  const m = currentDisplayDate.getMonth();
  currentCycleMonth = `${y}-${String(m + 1).padStart(2,'0')}`;
  updateCalendarDisplayWithMock(); // API 연동 전이므로 목업 데이터 사용
}

// --- 임시 목업 데이터 사용 함수 ---
function updateCalendarDisplayWithMock() {
  const loader = document.getElementById('loader');
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error("calendarBody not found"); return; }

  console.log("[App.js] updateCalendarDisplayWithMock for cycle:", currentCycleMonth);
  if(loader) loader.style.display = 'block';
  calendarBody.innerHTML = ''; 
  
  // 여기에 로컬스토리지에서 가져오거나, 테스트용 빈 배열/샘플 데이터 사용
  const cachedData = localStorage.getItem('transactions_' + currentCycleMonth);
  let transactionsToRender = [];
  if (cachedData) {
    console.log('Rendering calendar from localStorage cache.');
    try {
      transactionsToRender = JSON.parse(cachedData);
    } catch(e) {
      console.error("Failed to parse transactions from localStorage", e);
      localStorage.removeItem('transactions_' + currentCycleMonth); // 잘못된 데이터 삭제
    }
  } else {
    console.log('No localStorage cache found for this month. Displaying empty calendar.');
    // 예시: transactionsToRender = [{date: currentCycleMonth + "-20", type: "지출", amount: 12000, content: "테스트 지출"}];
  }

  renderCalendarAndSummary(transactionsToRender);
  if(loader) loader.style.display = 'none';
}

async function updateCalendarDisplay() { // API 연동 시 사용할 함수
  const loader = document.getElementById('loader');
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error("calendarBody not found"); return; }

  if(loader) loader.style.display = 'block';
  calendarBody.innerHTML = '';

  console.log("[App.js] updateCalendarDisplay: Fetching transactions for cycle:", currentCycleMonth);
  try {
    const transactions = await callAppsScriptApi('getTransactions', { cycleMonth: currentCycleMonth });
    localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(transactions || []));
    renderCalendarAndSummary(transactions || []);
  } catch (error) {
    console.error('updateCalendarDisplay API call failed:', error);
    showToast('거래 내역을 불러오는데 실패했습니다.', true);
    renderCalendarAndSummary([]); // 오류 시 빈 달력
  } finally {
    if(loader) loader.style.display = 'none';
  }
}
// --- 임시 목업 데이터 사용 함수 끝 ---


function renderCalendarAndSummary(transactions){
  const year = parseInt(currentCycleMonth.split('-')[0], 10);
  const month = parseInt(currentCycleMonth.split('-')[1], 10);
  const currentMonthYearEl = document.getElementById('currentMonthYear');
  if (currentMonthYearEl) {
    currentMonthYearEl.textContent = `${year}년 ${String(month).padStart(2,'0')}월 주기`;
  } else {
    console.error("currentMonthYear element not found");
  }
  renderCalendar(year, month, transactions);
  updateSummary(transactions);
}

function renderCalendar(year, monthOneBased, transactions){
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error("calendarBody for renderCalendar not found"); return; }
  calendarBody.innerHTML = '';
  const transMap = {};
  (transactions||[]).forEach(t=>{
    if (t && t.date) {
      (transMap[t.date] = transMap[t.date] || []).push(t);
    }
  });

  const cycleStart = new Date(year, monthOneBased - 1, 18);
  const cycleEnd = new Date(year, monthOneBased, 17);
  let curDate = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  const frag = document.createDocumentFragment();
  const startDayOfWeek = cycleStart.getDay(); 

  for(let i=0; i<startDayOfWeek; i++){
    const td = document.createElement('td'); 
    td.className='other-month'; 
    weekRow.appendChild(td);
  }

  while(curDate <= cycleEnd){
    const td = document.createElement('td');
    const dSpan = document.createElement('span');
    dSpan.className='date-number';
    dSpan.textContent = curDate.getDate();
    td.appendChild(dSpan);

    const dStr = `${curDate.getFullYear()}-${String(curDate.getMonth()+1).padStart(2,'0')}-${String(curDate.getDate()).padStart(2,'0')}`;
    td.dataset.date = dStr;
    td.onclick = () => openModal(dStr);

    (transMap[dStr]||[]).forEach(t=>{
      if (t && typeof t.amount !== 'undefined') {
        const div = document.createElement('div');
        div.className = `transaction-item ${t.type==='수입'?'income':'expense'}`;
        div.textContent = `${Number(t.amount).toLocaleString()}원`;
        td.appendChild(div);
      }
    });

    weekRow.appendChild(td);
    if(curDate.getDay() === 6 || curDate.getTime() === cycleEnd.getTime()){
      if(curDate.getDay() !== 6 && curDate.getTime() === cycleEnd.getTime()){ 
        for(let i = curDate.getDay() + 1; i <= 6; i++){
          const emptyTd = document.createElement('td'); 
          emptyTd.className='other-month'; 
          weekRow.appendChild(emptyTd);
        }
      }
      frag.appendChild(weekRow);
      if(curDate.getTime() !== cycleEnd.getTime()){ 
          weekRow = document.createElement('tr');
      }
    }
    curDate.setDate(curDate.getDate() + 1);
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

  const incEl = document.getElementById('totalIncome');
  const expEl = document.getElementById('totalExpense');
  const balEl = document.getElementById('totalBalance');
  const bal = inc - exp;

  if(incEl) incEl.textContent = `₩${inc.toLocaleString()}`;
  if(expEl) expEl.textContent = `₩${exp.toLocaleString()}`;
  if(balEl) {
    balEl.textContent = `₩${bal.toLocaleString()}`;
    balEl.className = 'total-balance'; // Reset class
    if (bal < 0) balEl.classList.add('negative');
  }
}

// --- 임시 목업 데이터 사용 함수 ---
function loadInitialDataWithMock() {
  console.warn("[App.js] loadInitialDataWithMock: Using mock data. API connection needed.");
  expenseCategoriesData = {"식비": ["점심", "저녁", "간식"], "교통비": ["버스", "지하철"]};
  paymentMethodsData = [
    {name: "현대카드", isCard: true, target: 500000},
    {name: "국민현금", isCard: false, target: 0} 
  ];
  incomeSourcesData = ["월급", "용돈"];
  
  populateFormDropdowns();
  populateCardSelector();
  // displayCardData(); // 카드 데이터도 목업 또는 API 연동 필요
  console.log("[App.js] Mock initial data loaded.");
}

async function loadInitialData() {
  console.log("[App.js] loadInitialData: Fetching app setup data via API...");
  try {
    // 'getAppSetupData'는 Code.gs의 doGet에서 e.parameter.action으로 받을 이름입니다.
    const setupData = await callAppsScriptApi('getAppSetupData'); 

    if (setupData) {
      expenseCategoriesData = setupData.expenseCategories || {};
      paymentMethodsData    = setupData.paymentMethods    || [];
      incomeSourcesData     = setupData.incomeSources     || [];
      
      populateFormDropdowns();
      populateCardSelector();
      showToast('앱 설정을 불러왔습니다.', false);
      // displayCardData(); // 카드 데이터는 카드 선택 시 또는 별도 로드
    } else {
      showToast('설정 데이터를 불러오는 데 실패했습니다 (데이터 없음).', true);
    }
  } catch (error) {
    console.error('loadInitialData API call failed:', error);
    // showToast는 callAppsScriptApi 내부에서도 호출될 수 있습니다.
    // 여기서는 추가적인 UI 복구 로직 등을 넣을 수 있습니다.
  }
}

/* === 입력·폼 === */
function setupEventListeners() {
  const transactionForm = document.getElementById('transactionForm');
  if (transactionForm) {
    transactionForm.addEventListener('submit', handleTransactionSubmit);
  }
}

function toggleTypeSpecificFields() {
  const typeRadio = document.querySelector('input[name="type"]:checked');
  if (!typeRadio) {
    // 기본값으로 '지출'을 선택하도록 설정 (예시)
    const defaultExpenseRadio = document.querySelector('input[name="type"][value="지출"]');
    if (defaultExpenseRadio) defaultExpenseRadio.checked = true;
  }
  const type = document.querySelector('input[name="type"]:checked')?.value || '지출'; // 기본값 '지출'

  const expenseFields = document.getElementById('expenseSpecificFields');
  const incomeFields = document.getElementById('incomeSpecificFields');
  if (expenseFields) expenseFields.style.display = type === '지출' ? 'block' : 'none';
  if (incomeFields) incomeFields.style.display  = type === '수입' ? 'block' : 'none';
}

function populateFormDropdowns() {
  const pm = document.getElementById('paymentMethod');
  if (pm) {
    pm.innerHTML = '<option value="">선택하세요</option>';
    (paymentMethodsData||[]).forEach(m=>{ const o=document.createElement('option'); o.value=m.name; o.textContent=m.name; pm.appendChild(o); });
  }

  const mainSel = document.getElementById('mainCategory');
  if (mainSel) {
    mainSel.innerHTML = '<option value="">선택하세요</option>';
    for (const k in expenseCategoriesData) { const o=document.createElement('option'); o.value=k; o.textContent=k; mainSel.appendChild(o); }
    updateSubCategories();
  }
  
  const incSel = document.getElementById('incomeSource');
  if (incSel) {
    incSel.innerHTML='<option value="">선택하세요</option>';
    (incomeSourcesData||[]).forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; incSel.appendChild(o); });
  }
}

function updateSubCategories() {
  const mainCategorySelect = document.getElementById('mainCategory');
  const subCategorySelect = document.getElementById('subCategory');
  if (!mainCategorySelect || !subCategorySelect) return;

  const mainCategoryValue = mainCategorySelect.value;
  subCategorySelect.innerHTML = '<option value="">선택하세요</option>'; 
  
  if (expenseCategoriesData && expenseCategoriesData[mainCategoryValue]) {
    expenseCategoriesData[mainCategoryValue].forEach(subCat => {
      const option = document.createElement('option');
      option.value = subCat;
      option.textContent = subCat;
      subCategorySelect.appendChild(option);
    });
  }
}

/* === 거래 저장 === */
async function handleTransactionSubmit(e) {
  e.preventDefault();
  
  const form = e.target;
  const fd = new FormData(form);
  const transactionData = {};
  fd.forEach((v, k) => transactionData[k] = v); // FormData를 객체로 변환

  // 클라이언트 측 유효성 검사 (간단 예시)
  if (!transactionData.date || !transactionData.amount || !transactionData.content) {
    showToast("날짜, 금액, 내용은 필수입니다.", true);
    return;
  }
  if (transactionData.type === '지출' && (!transactionData.paymentMethod || !transactionData.mainCategory || !transactionData.subCategory)) {
    showToast("지출 시 결제수단과 카테고리는 필수입니다.", true);
    return;
  }
  if (transactionData.type === '수입' && !transactionData.incomeSource) {
    showToast("수입 시 수입원은 필수입니다.", true);
    return;
  }


  // UI 즉시 업데이트 (Optimistic Update)
  const isEditing = currentEditingTransaction && typeof currentEditingTransaction.row !== 'undefined';
  const originalData = JSON.parse(localStorage.getItem('transactions_' + currentCycleMonth) || '[]');
  let optimisticData = JSON.parse(JSON.stringify(originalData)); 

  const tempRowId = `temp-${Date.now()}`;
  let itemForServer = { ...transactionData }; // 서버에 보낼 데이터 복사

  if (isEditing) {
    const index = optimisticData.findIndex(t => t && typeof t.row !== 'undefined' && t.row.toString() === currentEditingTransaction.row.toString());
    if (index > -1) {
      itemForServer.id_to_update = currentEditingTransaction.row; // 수정 시 ID 전달
      optimisticData[index] = { ...optimisticData[index], ...transactionData }; // UI용 데이터 업데이트
      if (optimisticData[index].type === '수입') {
        optimisticData[index].category1 = transactionData.incomeSource || '';
        optimisticData[index].category2 = '';
      } else { 
        optimisticData[index].category1 = transactionData.mainCategory || '';
        optimisticData[index].category2 = transactionData.subCategory || '';
      }
    }
  } else {
    itemForServer.row = tempRowId; // 새 항목은 임시 ID로 UI에 먼저 반영
    const newItemForUI = { ...transactionData, row: tempRowId };
     if (newItemForUI.type === '수입') {
        newItemForUI.category1 = transactionData.incomeSource || '';
        newItemForUI.category2 = '';
      } else { 
        newItemForUI.category1 = transactionData.mainCategory || '';
        newItemForUI.category2 = transactionData.subCategory || '';
      }
    optimisticData.push(newItemForUI);
  }
  
  localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(optimisticData));
  renderCalendarAndSummary(optimisticData);
  showToast(isEditing ? '수정 사항 전송 중...' : '저장 사항 전송 중...');
  closeModal();

  // 서버에 실제 작업 요청 (API 연동 시)
  const action = isEditing ? 'updateTransaction' : 'addTransaction';
  try {
    // POST 방식으로 데이터를 보내려면 callAppsScriptApi 수정 필요
    // 여기서는 GET 방식에 맞게 데이터를 문자열화하여 params로 전달 (매우 긴 데이터에는 부적합)
    // const serverResult = await callAppsScriptApi(action, { transactionDataString: JSON.stringify(itemForServer) });
    
    // 임시: 지금은 google.script.run이 없으므로 콘솔에만 기록
    console.warn(`[App.js] ${action}: Server call with`, itemForServer, `(API connection needed)`);
    // 가짜 성공 응답 (테스트용)
    const serverResult = { success: true, message: "임시 성공", newRowId: isEditing ? itemForServer.id_to_update : Date.now() };


    if (serverResult.success) {
      showToast(serverResult.message || (isEditing ? '수정 완료!' : '저장 완료!'), false);
      // 성공 시, 서버로부터 최신 데이터(또는 새 ID)를 받아 로컬스토리지와 UI를 최종 업데이트 할 수 있음
      // 예: optimisticData에서 temp-ID를 실제 ID로 교체
      if (!isEditing && serverResult.newRowId) {
        const tempItemIndex = optimisticData.findIndex(item => item.row === tempRowId);
        if (tempItemIndex > -1) optimisticData[tempItemIndex].row = serverResult.newRowId;
      }
      // 전체 데이터를 다시 불러와서 갱신 (가장 확실한 방법)
      // await updateCalendarDisplay(); // API 연동 후 주석 해제
      localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(optimisticData)); // 임시 ID가 있다면 실제 ID로 업데이트 된것 저장
      renderCalendarAndSummary(optimisticData); // UI 다시 그리기

    } else {
      throw new Error(serverResult.message || '서버 작업 실패');
    }
  } catch (error) {
    showToast(isEditing ? '수정 실패!' : '저장 실패!' + ` (${error.message})`, true);
    // 오류 발생 시 Optimistic Update 롤백
    localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(originalData));
    renderCalendarAndSummary(originalData);
  }
}

/* === 모달 및 일일 거래 === */
function openModal(dateStr) {
  const transactionForm = document.getElementById('transactionForm');
  if (transactionForm) transactionForm.reset();
  currentEditingTransaction = null; 

  const deleteBtn = document.getElementById('deleteBtn');
  const modalTitle = document.getElementById('modalTitle');
  const transactionDateInput = document.getElementById('transactionDate');

  if (deleteBtn) deleteBtn.style.display = 'none';
  if (modalTitle) modalTitle.textContent = '거래 추가';
  if (transactionDateInput) transactionDateInput.value = dateStr;
  
  toggleTypeSpecificFields(); 
  
  const dailyList = document.getElementById('dailyTransactionList');
  const dailySection = document.getElementById('dailyTransactions');
  const toggleBtn = document.getElementById('toggleDailyTransactions');
  
  if (dailyList) dailyList.innerHTML = '불러오는 중...';
  if (dailySection) dailySection.style.display = 'none'; 
  if (toggleBtn) toggleBtn.textContent = '거래 내역 보기';

  const transactionModal = document.getElementById('transactionModal');
  if (transactionModal) transactionModal.style.display = 'flex'; 
  
  loadDailyTransactionsWithMock(dateStr); // API 연동 전이므로 목업 데이터 사용
}

function closeModal(){ 
  const transactionModal = document.getElementById('transactionModal');
  if (transactionModal) transactionModal.style.display='none'; 
}

function toggleDailyTransactionVisibility() {
  const dailySection = document.getElementById('dailyTransactions');
  const toggleBtn = document.getElementById('toggleDailyTransactions');
  if (!dailySection || !toggleBtn) return;

  const isHidden = dailySection.style.display === 'none';

  if (isHidden) {
    dailySection.style.display = 'block';
    toggleBtn.textContent = '거래 내역 숨기기';
  } else {
    dailySection.style.display = 'none';
    toggleBtn.textContent = '거래 내역 보기';

    const preservedDate = document.getElementById('transactionDate')?.value;
    document.getElementById('transactionForm')?.reset();
    const transactionDateInput = document.getElementById('transactionDate');
    if (transactionDateInput && preservedDate) transactionDateInput.value = preservedDate;

    document.getElementById('modalTitle').textContent = '거래 추가';
    document.getElementById('deleteBtn').style.display = 'none';
    currentEditingTransaction = null;
    toggleTypeSpecificFields();
  }
}

// --- 임시 목업 데이터 사용 함수 ---
function loadDailyTransactionsWithMock(dateStr) {
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;
  list.textContent = '불러오는 중... (목업)';
  console.warn(`[App.js] loadDailyTransactionsWithMock for date: ${dateStr}. API connection needed.`);
  
  // 로컬 스토리지에서 해당 날짜의 거래내역을 가져와서 표시 (Optimistic Update와 연계)
  const allTransactionsForMonth = JSON.parse(localStorage.getItem('transactions_' + currentCycleMonth) || '[]');
  const transactionsForDate = allTransactionsForMonth.filter(t => t.date === dateStr);

  setTimeout(() => displayDailyTransactions(transactionsForDate, dateStr), 100); // 약간의 딜레이로 비동기 흉내
}

async function loadDailyTransactions(dateStr) { // API 연동 시 사용할 함수
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;
  list.textContent = '불러오는 중...';
  
  try {
    const dailyData = await callAppsScriptApi('getTransactionsByDate', { date: dateStr });
    displayDailyTransactions(dailyData || [], dateStr);
  } catch (error) {
    console.error('loadDailyTransactions API call failed:', error);
    if (list) list.textContent = '일일 거래 내역 로딩 실패.';
    showToast('일일 거래 내역 로딩 실패', true);
  }
}
// --- 임시 목업 데이터 사용 함수 끝 ---

function displayDailyTransactions(arr, dateStr) {
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;

  if (arr && arr.error) { // Apps Script에서 {error: "..."} 형태로 반환하는 경우
    list.textContent = '내역 로딩 오류: ' + arr.error;
    return;
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    list.textContent = '해당 날짜의 거래 내역이 없습니다.';
    return;
  }

  list.innerHTML = '';
  arr.forEach(function(t) {
    if (!t || typeof t.type === 'undefined') return;

    const d = document.createElement('div');
    d.classList.add('transaction-item', t.type === '수입' ? 'income' : 'expense');
    
    let txt = `[${t.type}] ${t.content || '(내용 없음)'}: ${Number(t.amount || 0).toLocaleString()}원`;
    if (t.type === '지출' && t.paymentMethod) txt += ` (${t.paymentMethod})`;
    if (t.category1) txt += ` - ${t.category1}`;
    if (t.category2) txt += ` / ${t.category2}`;
    d.textContent = txt;
    d.style.cursor = 'pointer';
    d.title = '클릭하여 이 내용 수정하기';
    
    d.addEventListener('click', function() {
      populateFormForEdit(t); 
    });
    list.appendChild(d);
  });
}

function populateFormForEdit(transaction) {
  if (!transaction || typeof transaction.row === 'undefined') {
    console.error('populateFormForEdit: 유효하지 않은 거래 데이터입니다.', transaction);
    showToast('거래 정보를 불러오지 못했습니다.', true);
    return;
  }

  currentEditingTransaction = transaction; 
  document.getElementById('transactionForm')?.reset();
  document.getElementById('modalTitle').textContent = '거래 수정';

  document.getElementById('transactionDate').value = transaction.date || '';
  document.getElementById('transactionAmount').value = transaction.amount || '';
  document.getElementById('transactionContent').value = transaction.content || '';

  document.querySelectorAll('input[name="type"]').forEach(r => {
    r.checked = (r.value === transaction.type);
  });
  toggleTypeSpecificFields();

  if (transaction.type === '지출') {
    document.getElementById('paymentMethod').value = transaction.paymentMethod || '';
    document.getElementById('mainCategory').value = transaction.category1 || '';
    updateSubCategories(); 
    document.getElementById('subCategory').value = transaction.category2 || '';
  } else { 
    document.getElementById('incomeSource').value = transaction.category1 || '';
  }
  document.getElementById('deleteBtn').style.display = 'block';
}

/* === 탭 & 토스트 === */
function showView(id){
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  const activeTabContent = document.getElementById(id);
  if (activeTabContent) activeTabContent.classList.add('active');
  
  document.querySelectorAll('.tab-button').forEach(b=>b.classList.remove('active'));
  const activeButton = document.querySelector(`.tab-button[onclick="showView('${id}')"]`);
  if (activeButton) activeButton.classList.add('active');

  if(id==='cardView'){
    cardPerformanceMonthDate = new Date(); 
    // populateCardSelector(); // 초기 로드 시 이미 호출됨
    displayCardDataWithMock(); // API 연동 전이므로 목업 데이터 사용
  }
}

function showToast(msg,isErr=false){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.backgroundColor = isErr ? '#dc3545' : '#28a745'; 
  t.style.visibility = 'visible'; 
  t.style.opacity = '1';
  setTimeout(()=>{ 
    t.style.opacity='0'; 
    setTimeout(()=> t.style.visibility = 'hidden', 500); 
  }, 3000);
}

/* === 카드 뷰 === */
function populateCardSelector(){
  const sel = document.getElementById('cardSelector');
  if (!sel) return;
  const currentCard = sel.value; 
  sel.innerHTML='<option value="">카드를 선택하세요</option>';
  (paymentMethodsData||[]).filter(m=>m.isCard).forEach(c=>{
    const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; sel.appendChild(o);
  });
  if (currentCard && sel.querySelector(`option[value="${currentCard}"]`)) {
    sel.value = currentCard; 
  }
}

function changeCardMonth(d){ 
  cardPerformanceMonthDate.setMonth(cardPerformanceMonthDate.getMonth()+d); 
  displayCardDataWithMock(); // API 연동 전이므로 목업 데이터 사용
}

// --- 임시 목업 데이터 사용 함수 ---
function displayCardDataWithMock() {
  const cardSel = document.getElementById('cardSelector');
  const det = document.getElementById('cardDetails');
  const lbl = document.getElementById('cardMonthLabel');
  const loader = document.getElementById('loader');

  if (!cardSel || !det || !lbl) return;
  const cardName = cardSel.value;

  if (!cardName){
    det.innerHTML = '<p>카드를 선택해주세요.</p>';
    lbl.textContent = '';
    return;
  }
  if(loader) loader.style.display = 'block';

  const perfMonth = `${cardPerformanceMonthDate.getFullYear()}-${String(cardPerformanceMonthDate.getMonth()+1).padStart(2,'0')}`;
  lbl.textContent = `${perfMonth} 기준`;

  console.warn(`[App.js] displayCardDataWithMock for card: ${cardName}. API connection needed.`);
  // 예시 목업 데이터
  const cardInfo = paymentMethodsData.find(m => m.name === cardName);
  const mockData = {
    cardName: cardName,
    billingMonth: currentCycleMonth,
    billingAmount: Math.floor(Math.random() * 500000),
    performanceReferenceMonth: perfMonth,
    performanceAmount: Math.floor(Math.random() * (cardInfo?.target || 500000)),
    performanceTarget: cardInfo?.target || 0,
  };
  mockData.rate = mockData.performanceTarget > 0 ? ((mockData.performanceAmount / mockData.performanceTarget) * 100).toFixed(1) + '%' : '0%';

  det.innerHTML = `
    <h4>${mockData.cardName} (목업 데이터)</h4>
    <p><strong>청구 기준월:</strong> ${mockData.billingMonth} (18일~다음달 17일)</p>
    <p><strong>청구 예정 금액:</strong> ${mockData.billingAmount.toLocaleString()}원</p><hr>
    <p><strong>실적 산정월:</strong> ${mockData.performanceReferenceMonth}</p>
    <p><strong>현재 사용액(실적):</strong> ${mockData.performanceAmount.toLocaleString()}원</p>
    <p><strong>실적 목표 금액:</strong> ${mockData.performanceTarget.toLocaleString()}원</p>
    <p><strong>달성률:</strong> ${mockData.rate}</p>
    <p style="font-size:0.8em;color:grey;">(이것은 실제 데이터가 아닌 임시 목업 데이터입니다.)</p>`;
  if(loader) loader.style.display = 'none';
}

async function displayCardData() { // API 연동 시 사용할 함수
  const cardSel = document.getElementById('cardSelector');
  const det = document.getElementById('cardDetails');
  const lbl = document.getElementById('cardMonthLabel');
  const loader = document.getElementById('loader');

  if (!cardSel || !det || !lbl) return;
  const card = cardSel.value;

  if (!card){
    det.innerHTML = '<p>카드를 선택해주세요.</p>';
    lbl.textContent = '';
    return;
  }
  if(loader) loader.style.display = 'block';

  const perfMonth = `${cardPerformanceMonthDate.getFullYear()}-${String(cardPerformanceMonthDate.getMonth()+1).padStart(2,'0')}`;
  lbl.textContent = `${perfMonth} 기준`;

  try {
    const d = await callAppsScriptApi('getCardData', { 
      cardName: card, 
      cycleMonthForBilling: currentCycleMonth, // 현재 달력 주기월을 청구 기준월로 우선 사용
      performanceReferenceMonth: perfMonth      // 카드 실적 조회 기준월
    });

    if (!d || d.error){ // API가 {success:false, error:"..."} 또는 그냥 에러 객체를 반환한 경우
      det.innerHTML = `<p>${d && d.error ? d.error : '카드 데이터 로딩 오류'}</p>`;
      throw new Error(d && d.error ? d.error : '카드 데이터 구조 오류');
    }
    
    const billingMonth = d.billingCycleMonthForCard || currentCycleMonth; // 서버에서 받은 청구월 우선
    const perfRefMonthDisplay = d.performanceReferenceMonthForDisplay || perfMonth; // 서버에서 받은 실적월 우선
    const billingAmt = Number(d.billingAmount) || 0;
    const perfAmt = Number(d.performanceAmount) || 0;
    const targetAmt = Number(d.performanceTarget) || 0;
    const rate = targetAmt > 0 ? ((perfAmt/targetAmt)*100).toFixed(1)+'%' : '0%';

    det.innerHTML = `
      <h4>${d.cardName || card}</h4>
      <p><strong>청구 기준월:</strong> ${billingMonth} (18일~다음달 17일)</p>
      <p><strong>청구 예정 금액:</strong> ${billingAmt.toLocaleString()}원</p><hr>
      <p><strong>실적 산정월:</strong> ${perfRefMonthDisplay}</p>
      <p><strong>현재 사용액(실적):</strong> ${perfAmt.toLocaleString()}원</p>
      <p><strong>실적 목표 금액:</strong> ${targetAmt.toLocaleString()}원</p>
      <p><strong>달성률:</strong> ${rate}</p>
      <p style="font-size:0.8em;color:grey;">(실적은 카드사의 실제 집계와 다를 수 있습니다)</p>`;
  } catch (error) {
    det.innerHTML = '<p>카드 데이터를 불러오는 데 실패했습니다.</p>';
    console.error('displayCardData API call failed:', error);
    showToast('카드 데이터 로드 중 오류 발생', true);
  } finally {
    if(loader) loader.style.display = 'none';
  }
}
// --- 임시 목업 데이터 사용 함수 끝 ---

/* === 거래 삭제 === */
async function handleDelete() {
  if (!currentEditingTransaction || typeof currentEditingTransaction.row === 'undefined') {
    showToast('삭제할 거래를 먼저 선택하거나, 유효한 거래가 아닙니다.', true);
    return;
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

  // 서버에 실제 작업 요청 (API 연동 시)
  try {
    // const serverResult = await callAppsScriptApi('deleteTransaction', { id_to_delete: Number(rowId) }); // POST 방식이 더 적합

    // 임시: 지금은 google.script.run이 없으므로 콘솔에만 기록
    console.warn(`[App.js] handleDelete: Server call for rowId ${rowId} (API connection needed)`);
    const serverResult = { success: true, message: "삭제 임시 성공" }; // 가짜 성공 응답

    if (serverResult.success) {
      showToast(serverResult.message || '삭제 완료!', false);
      // 성공 시 데이터는 이미 UI/localStorage에서 제거됨. 필요 시 서버에서 전체 목록 다시 로드.
      // await updateCalendarDisplay(); // API 연동 후 주석 해제
    } else {
      throw new Error(serverResult.message || '서버에서 삭제 실패');
    }
  } catch (error) {
    showToast(`삭제 실패! (${error.message})`, true);
    // 오류 발생 시 Optimistic Update 롤백
    localStorage.setItem(key, JSON.stringify(originalData));
    renderCalendarAndSummary(originalData);
  }
}
