// app.js - 카테고리 수정 문제 디버깅 및 API 연동

// ▼▼▼ 선생님의 실제 앱스 스크립트 웹앱 배포 URL로 반드시 교체해주세요!!! ▼▼▼
const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjP671pu6MMLKhmTXHwqCu-wci-Y-RM0Sl5TlQO0HmGsyrH83DBj6dsh62LqHIf-YD/exec"; //https://github.com/serendipist/my-budget-app/blob/main/app.js
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

async function updateCalendarDisplay () {
  const loader       = document.getElementById('loader');
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error('calendarBody not found'); return; }
  if (loader) loader.style.display = 'block';

  console.log('[App.js] updateCalendarDisplay →', currentCycleMonth);

  /* 1️⃣  캐시 우선 렌더링 ------------------------------------------------- */
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

  if (!renderedFromCache) {                        // 캐시 미존재 시 빈 달력
    calendarBody.innerHTML = '';
    renderCalendarAndSummary([]);
  }

  /* 2️⃣  네트워크 — stale-while-revalidate -------------------------------- */
  try {
    const latest = await callAppsScriptApi('getTransactions',
                                           { cycleMonth: currentCycleMonth });

    const finalTx = (latest && Array.isArray(latest)) ? latest : [];

    /* ✨ PATCH: API가 빈 배열을 돌려줬지만 이미 캐시를 그렸다면 무시 */
    if (renderedFromCache && finalTx.length === 0) {
      console.warn('[App.js] API empty → keep cached view');
      return;                         // ⚠️ 아래 로직/캐시 덮어쓰기 모두 건너뜀
    }

    /* 3️⃣  캐시 갱신 + 필요 시 재렌더 ------------------------------------ */
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

function renderCalendar(year, monthOneBased, transactions){
  const calendarBody = document.getElementById('calendarBody');
  calendarBody.innerHTML = '';

  /* 날짜별 거래 배열 맵 */
  const transMap = {};
  (transactions||[]).forEach(t=>{
    if(t && t.date){ (transMap[t.date]=transMap[t.date]||[]).push(t); }
  });

  // 오늘 날짜 확인 (이 부분은 선생님 코드에 이미 잘 들어가 있습니다)
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  const cycleStart = new Date(year, monthOneBased-1, 18);
  const cycleEnd   = new Date(year, monthOneBased,   17);
  let cur = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  const frag = document.createDocumentFragment();

  /* 첫 주 공백 */
  for(let i=0;i<cycleStart.getDay();i++){
    const td=document.createElement('td'); td.className='other-month'; weekRow.appendChild(td);
  }

  /* 날짜 루프 */
  while(cur<=cycleEnd){
    const td = document.createElement('td');
    const dStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    
    // ▼▼▼ 이 부분을 추가하면 됩니다 ▼▼▼
    // 현재 그리고 있는 날짜(dStr)가 오늘 날짜(todayStr)와 같으면,
    // <td> 요소에 'today' 클래스를 추가합니다.
    if (dStr === todayStr) {
      td.classList.add('today');
    }
    // ▲▲▲ 여기까지 추가 ▲▲▲

    td.dataset.date=dStr; 
    td.onclick=()=>openModal(dStr);

    /* 날짜 숫자 */
    const num = document.createElement('span');
    num.className='date-number';
    num.textContent=cur.getDate();
    td.appendChild(num);

    /* ─ 새: 거래 미리보기 ─ */
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
      more.onclick=e=>{ e.stopPropagation(); openModal(dStr);}   // td 클릭 전파 막기
      wrap.appendChild(more);
    }
    td.appendChild(wrap);
    /* ──────────────── */

    weekRow.appendChild(td);

    if(cur.getDay()===6 || cur.getTime()===cycleEnd.getTime()){
      /* 마지막 주 빈칸 */
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
  if(typeof afterRender==='function') afterRender();
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

// ▒▒▒ 스와이프 제스처로 달력 월 변경 기능 ▒▒▒
function setupSwipeListeners() {
    const calendarElement = document.getElementById('calendarView'); // 스와이프를 감지할 주요 달력 영역 요소
    if (!calendarElement) {
        console.warn("[App.js] 스와이프 감지를 위한 달력 요소를 찾을 수 없습니다 ('calendarView').");
        return;
    }

    let touchstartX = 0;
    let touchendX = 0;
    let touchstartY = 0; // 수직 스크롤과 구분하기 위함
    let touchendY = 0;

    const SWIPE_THRESHOLD = 50;      // 스와이프로 인정할 최소 수평 이동 거리 (px)
    const SWIPE_MAX_VERTICAL = 75; // 수평 스와이프로 간주할 최대 수직 이동 거리 (px)
                                   // 이 값보다 수직 이동이 크면 일반 스크롤로 간주하여 월 변경 안 함

    calendarElement.addEventListener('touchstart', function(event) {
        touchstartX = event.changedTouches[0].screenX;
        touchstartY = event.changedTouches[0].screenY;
    }, { passive: true }); // passive:true는 스크롤 성능 최적화를 위함 (preventDefault를 호출하지 않을 것이므로)

    calendarElement.addEventListener('touchend', async function(event) { // changeMonth가 async이므로, 이 핸들러도 async
        touchendX = event.changedTouches[0].screenX;
        touchendY = event.changedTouches[0].screenY;
        await handleSwipeGesture(); // 실제 스와이프 처리 함수 호출
    }, false); // touchend는 일반적으로 passive:true와 큰 관계 없음

    async function handleSwipeGesture() {
        const deltaX = touchendX - touchstartX;
        const deltaY = touchendY - touchstartY;

        // 수평 이동 거리가 threshold보다 크고, 수직 이동은 maxVertical보다 작을 때만 스와이프로 처리
        if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_MAX_VERTICAL) {
            if (deltaX > 0) {
                // 오른쪽으로 스와이프 (손가락이 왼쪽에서 오른쪽으로 이동) -> 이전 달
                console.log("[App.js] Swiped Right -> Previous Month");
                await changeMonth(-1); // 기존 changeMonth 함수 사용
            } else {
                // 왼쪽으로 스와이프 (손가락이 오른쪽에서 왼쪽으로 이동) -> 다음 달
                console.log("[App.js] Swiped Left -> Next Month");
                await changeMonth(1);  // 기존 changeMonth 함수 사용
            }
        }
    }
}
// ▒▒▒ 스와이프 제스처 기능 끝 ▒▒▒

function setupEventListeners() {
  document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('mainCategory').addEventListener('change', updateSubCategories);
  setupSwipeListeners(); 
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
    // ▼▼▼ 수정된 부분 ▼▼▼
    // cycleMonthForBilling의 값을 currentCycleMonth에서 perfMonth로 변경합니다.
    const d = await callAppsScriptApi('getCardData', {
      cardName: card,
      **cycleMonthForBilling: perfMonth,** // 이 부분을 수정했습니다.
      performanceReferenceMonth: perfMonth
    });
    // ▲▲▲ 여기까지 수정 ▲▲▲

    if (!d || d.success === false){
      det.innerHTML = `<p>${d && d.error ? d.error : '카드 데이터 로딩 중 오류가 발생했습니다.'}</p>`;
      throw new Error(d && d.error ? d.error : '카드 데이터 구조 오류 또는 API 실패');
    }
    const billingMonth = d.billingCycleMonthForCard || perfMonth; // 폴백 값도 perfMonth로 변경
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
