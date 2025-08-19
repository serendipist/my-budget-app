// app.js - v2 (낙관적 업데이트 제거)

// ▼▼▼ 선생님의 실제 앱스 스크립트 웹앱 배포 URL로 반드시 교체해주세요!!! ▼▼▼
const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjP671pu6MMLKhmTXHwqCu-wci-Y-RM0Sl5TlQO0HmGsyrH83DBj6dsh62LqHIf-YD/exec"; //https://github.com/serendipist/my-budget-app/blob/main/app.js
// ▲▲▲ 선생님의 실제 배포 URL을 다시 한번 확인해주세요. ▲▲▲

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
  
  // 로더 표시
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';

  console.log(`[API] Calling: ${actionName} with params: ${JSON.stringify(params)}`);
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
  } finally {
    // API 호출이 끝나면 로더 숨김
    if (loader) loader.style.display = 'none';
  }
}

/* === 뷰포트 높이 CSS 변수 갱신 (이전과 동일) === */
function setViewportHeightVar(){
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h}px`);
}
['load','resize','orientationchange'].forEach(evt => window.addEventListener(evt, setViewportHeightVar));
setViewportHeightVar();

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
function determineInitialCycleMonth(){
  const today = new Date();
  let year = today.getFullYear();
  let mIdx = today.getDate() < 18 ? today.getMonth() - 1 : today.getMonth();
  if(mIdx < 0){ mIdx = 11; year -= 1; }
  currentDisplayDate = new Date(year, mIdx, 18);
  currentCycleMonth = `${year}-${String(mIdx + 1).padStart(2,'0')}`;
  console.log("[App.js] Initial cycle month determined:", currentCycleMonth);
}

async function changeMonth(delta){
  currentDisplayDate.setMonth(currentDisplayDate.getMonth() + delta);
  const y = currentDisplayDate.getFullYear();
  const m = currentDisplayDate.getMonth();
  currentCycleMonth = `${y}-${String(m + 1).padStart(2,'0')}`;
  await updateCalendarDisplay(); 
}

// updateCalendarDisplay 함수는 서버에서 데이터를 가져오는 역할에 집중합니다.
async function updateCalendarDisplay () {
  const loader = document.getElementById('loader');
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error('calendarBody not found'); return; }
  
  // 로더를 항상 표시
  if (loader) loader.style.display = 'block';
  
  console.log('[App.js] updateCalendarDisplay (fetching from server) →', currentCycleMonth);

  try {
    const transactions = await callAppsScriptApi('getTransactions', { cycleMonth: currentCycleMonth });
    
    // 로컬 스토리지에 최신 데이터 캐싱
    localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(transactions || []));
    
    // 받아온 최신 데이터로 화면 렌더링
    renderCalendarAndSummary(transactions || []);

  } catch (err) {
    console.error('[App.js] getTransactions failed, rendering empty calendar.', err);
    // 실패 시 빈 달력 표시
    renderCalendarAndSummary([]);
    if (typeof showToast === 'function') showToast('데이터를 불러오는 데 실패했습니다.', true);
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

// renderCalendar, updateSummary, loadInitialData 등은 이전과 동일
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
    // getAppSetupData는 callAppsScriptApi 헬퍼를 직접 쓰지 않습니다.
    // 로더 관리를 헬퍼가 아닌 onload 함수에서 직접 하기 때문입니다.
    const url = new URL(APPS_SCRIPT_API_ENDPOINT);
    url.searchParams.append('action', 'getAppSetupData');
    url.searchParams.append('initialCycleMonth', currentCycleMonth);
    const response = await fetch(url.toString());
    const result = await response.json();
    const setupData = result.data;

    if (setupData) { 
      expenseCategoriesData = setupData.expenseCategories || {};
      paymentMethodsData    = setupData.paymentMethods    || [];
      incomeSourcesData     = setupData.incomeSources     || [];
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

// ▒▒▒ 스와이프 제스처 기능 (이전과 동일) ▒▒▒
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

// setupEventListeners, toggleTypeSpecificFields 등 기타 함수는 이전과 동일
function setupEventListeners() {
  document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('mainCategory').addEventListener('change', updateSubCategories);
  setupSwipeListeners(); 
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
  if (!mainCategorySelect || !subCategorySelect) return;
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

// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
// ★★★ 낙관적 업데이트가 제거된 핵심 수정 함수: handleTransactionSubmit ★★★
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
async function handleTransactionSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const transactionData = {};
  fd.forEach((v, k) => transactionData[k] = v);

  if (!validateTransactionData(transactionData)) return;

  const isEditing = currentEditingTransaction && typeof currentEditingTransaction.row !== 'undefined';
  let itemForServer = { ...transactionData }; 

  if (isEditing) {
    itemForServer.id_to_update = currentEditingTransaction.row; 
  }

  // 모달을 먼저 닫아 사용자에게 작업이 진행 중임을 알림
  if (typeof closeModal === 'function') closeModal();
  // 토스트 메시지로 진행상황 알림
  if (typeof showToast === 'function') showToast(isEditing ? '수정 중...' : '저장 중...');

  const action = isEditing ? 'updateTransaction' : 'addTransaction';
  try {
    // API를 호출하고 서버 응답을 기다림
    const serverResult = await callAppsScriptApi(action, { transactionDataString: JSON.stringify(itemForServer) });
    
    // 서버가 성공적으로 처리했을 때만 화면 갱신
    if (serverResult.success) {
      if (typeof showToast === 'function') showToast(serverResult.message || (isEditing ? '수정 완료!' : '저장 완료!'), false);
      
      // 서버의 최신 데이터로 달력을 다시 그림 (가장 중요한 부분)
      await updateCalendarDisplay(); 
    } else { 
      // 서버에서 처리 실패 시 에러 throw
      throw new Error(serverResult.message || serverResult.error || '서버 작업 처리 실패');
    }
  } catch (error) { 
    // API 호출 자체에서 에러 발생 시
    if (typeof showToast === 'function') showToast((isEditing ? '수정 실패: ' : '저장 실패: ') + error.message, true);
    // 화면을 변경하지 않았으므로 롤백할 필요가 없음
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

// 모달 관련 함수들은 이전과 동일
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
    // 이 API는 메인 로더와 별개로 작동하므로 헬퍼 함수를 그대로 사용
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

// 카드 탭 관련 함수들은 이전과 동일
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
  if (!cardSel || !det || !lbl) return;
  const card = cardSel.value;
  if (!card){ det.innerHTML = '<p>카드를 선택해주세요.</p>'; lbl.textContent = ''; return; }
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
  }
}

// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
// ★★★ 낙관적 업데이트가 제거된 핵심 수정 함수: handleDelete ★★★
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
async function handleDelete() {
  if (!currentEditingTransaction || typeof currentEditingTransaction.row === 'undefined') {
    showToast('삭제할 거래를 먼저 선택하거나, 유효한 거래가 아닙니다.', true); return;
  }
  const rowId = currentEditingTransaction.row; 

  // 삭제 확인 절차 추가 (선택사항이지만 권장)
  if (!confirm('정말로 이 거래 내역을 삭제하시겠습니까?')) {
    return;
  }

  // 모달을 먼저 닫음
  closeModal();
  showToast('삭제 중...');

  try {
    // 서버에 삭제 요청을 보내고 응답을 기다림
    const serverResult = await callAppsScriptApi('deleteTransaction', { id_to_delete: Number(rowId) }); 
    
    // 서버가 성공적으로 처리했을 때만 화면 갱신
    if (serverResult.success) {
      showToast(serverResult.message || '삭제 완료!', false);
      
      // 서버의 최신 데이터로 달력을 다시 그림
      await updateCalendarDisplay(); 
    } else {
      throw new Error(serverResult.message || serverResult.error || '서버에서 삭제 실패');
    }
  } catch (error) {
    showToast(`삭제 실패! (${error.message})`, true);
    // 화면을 변경하지 않았으므로 롤백할 필요 없음
  }
}
