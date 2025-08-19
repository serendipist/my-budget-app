// app.js - v3 (하이브리드 방식: 조회는 빠르게, 수정은 안정적으로)

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

/* === 주기 계산 (이전과 동일) === */
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

// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
// ★★★ 달력 조회 속도를 위해 원래의 캐시 우선 방식으로 복원된 updateCalendarDisplay ★★★
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
async function updateCalendarDisplay () {
  const loader       = document.getElementById('loader');
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error('calendarBody not found'); return; }
  if (loader) loader.style.display = 'block';

  console.log('[App.js] updateCalendarDisplay →', currentCycleMonth);

  /* 1️⃣  캐시 우선 렌더링 (빠른 화면 표시) */
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

  if (!renderedFromCache) { // 캐시가 없으면 빈 달력이라도 먼저 그림
    calendarBody.innerHTML = '';
    renderCalendarAndSummary([]);
  }

  /* 2️⃣  백그라운드에서 서버와 최신 데이터 동기화 */
  try {
    const latest = await callAppsScriptApi('getTransactions', { cycleMonth: currentCycleMonth });
    const finalTx = (latest && Array.isArray(latest)) ? latest : [];

    // 최신 데이터로 로컬 스토리지 캐시 갱신
    localStorage.setItem(cacheKey, JSON.stringify(finalTx));

    // 화면에 그렸던 내용과 서버 내용이 다르면, 화면을 다시 그림
    if (!renderedFromCache || JSON.stringify(transactionsToRender) !== JSON.stringify(finalTx)) {
      renderCalendarAndSummary(finalTx);

      if (renderedFromCache) {
        showToast?.('달력 정보가 업데이트 되었습니다.', false);
      }
    }
  } catch (err) {
    console.error('[App.js] getTransactions failed', err);
    if (!renderedFromCache) renderCalendarAndSummary([]); // 캐시도 없었고 서버도 실패하면 빈화면 유지
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

// renderCalendarAndSummary 이하 함수들은 이전과 동일
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
function setupSwipeListeners() {
    const calendarElement = document.getElementById('calendarView');
    if (!calendarElement) {
        console.warn("[App.js] 스와이프 감지를 위한 달력 요소를 찾을 수 없습니다 ('calendarView').");
        return;
    }
    let touchstartX = 0, touchendX = 0, touchstartY = 0, touchendY = 0;
    const SWIPE_THRESHOLD = 50, SWIPE_MAX_VERTICAL = 75;
    calendarElement.addEventListener('touchstart', e => { touchstartX = e.changedTouches[0].screenX; touchstartY = e.changedTouches[0].screenY; }, { passive: true });
    calendarElement.addEventListener('touchend', async e => { touchendX = e.changedTouches[0].screenX; touchendY = e.changedTouches[0].screenY; await handleSwipeGesture(); }, false);
    async function handleSwipeGesture() {
        const deltaX = touchendX - touchstartX;
        const deltaY = touchendY - touchstartY;
        if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_MAX_VERTICAL) {
            if (deltaX > 0) { await changeMonth(-1); } else { await changeMonth(1); }
        }
    }
}
function setupEventListeners() {
  document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('mainCategory').addEventListener('change', updateSubCategories);
  setupSwipeListeners(); 
}
function toggleTypeSpecificFields() {
  const typeRadio = document.querySelector('input[name="type"]:checked');
  let type = typeRadio ? typeRadio.value : '지출';
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
  if (expenseCategoriesData && expenseCategoriesData[mainCategoryValue]) {
    expenseCategoriesData[mainCategoryValue].forEach(subCat => {
      const option = document.createElement('option');
      option.value = subCat; option.textContent = subCat;
      subCategorySelect.appendChild(option);
    });
  }
}

// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
// ★★★ 데이터 수정 시 안정성을 위해 서버 응답을 기다리는 handleTransactionSubmit ★★★
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
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
  
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';
  closeModal();
  showToast(isEditing ? '수정 사항 전송 중...' : '저장 사항 전송 중...');

  const action = isEditing ? 'updateTransaction' : 'addTransaction';
  try {
    const serverResult = await callAppsScriptApi(action, { transactionDataString: JSON.stringify(itemForServer) });
    
    if (serverResult.success) {
      showToast(serverResult.message || (isEditing ? '수정 완료!' : '저장 완료!'), false);
      // 성공 시, 캐시 우선 방식인 updateCalendarDisplay를 호출하여 화면을 자연스럽게 갱신
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
    showToast("날짜, 금액, 내용은 필수입니다.", true); 
    return false;
  }
  if (data.type === '지출' && (!data.paymentMethod || !data.mainCategory || !data.subCategory)) {
    showToast("지출 시 결제수단과 카테고리는 필수입니다.", true); 
    return false;
  }
  if (data.type === '수입' && !data.incomeSource) {
    showToast("수입 시 수입원은 필수입니다.", true); 
    return false;
  }
  return true;
}

// 모달 관련 함수 (이전과 동일)
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
    if (list) list.textContent = '일일 거래 내역 로딩 실패.';
  }
}
function displayDailyTransactions(arr, dateStr) {
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;
  if (!Array.isArray(arr) || arr.length === 0) { list.textContent = '해당 날짜의 거래 내역이 없습니다.'; return; }
  list.innerHTML = '';
  arr.forEach(function(t) {
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
  if (!transaction || typeof transaction.row === 'undefined') { return; }
  currentEditingTransaction = transaction; 
  document.getElementById('transactionForm').reset(); 
  document.getElementById('modalTitle').textContent = '거래 수정';
  document.getElementById('transactionDate').value = transaction.date || '';
  document.getElementById('transactionAmount').value = transaction.amount || '';
  document.getElementById('transactionContent').value = transaction.content || '';
  document.querySelectorAll('input[name="type"]').forEach(r => r.checked = (r.value === transaction.type));
  toggleTypeSpecificFields();
  if (transaction.type === '지출') {
    document.getElementById('paymentMethod').value = transaction.paymentMethod || '';
    const mainCategorySelect = document.getElementById('mainCategory');
    mainCategorySelect.value = transaction.category1 || ''; 
    updateSubCategories(); 
    document.getElementById('subCategory').value = transaction.category2 || '';
  } else if (transaction.type === '수입') {
    document.getElementById('incomeSource').value = transaction.category1 || ''; 
  }
  document.getElementById('deleteBtn').style.display = 'block';
}

// 카드 탭 관련 함수 (이전과 동일)
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
  
  const loader = document.getElementById('loader');
  if(loader) loader.style.display = 'block';
  
  const perfMonth = `${cardPerformanceMonthDate.getFullYear()}-${String(cardPerformanceMonthDate.getMonth()+1).padStart(2,'0')}`;
  lbl.textContent = `${perfMonth} 기준`;

  try {
    const d = await callAppsScriptApi('getCardData', { cardName: card, cycleMonthForBilling: currentCycleMonth, performanceReferenceMonth: perfMonth });
    if (!d || d.success === false){ throw new Error(d?.error || '카드 데이터 구조 오류'); }
    const { billingCycleMonthForCard, performanceReferenceMonthForDisplay, billingAmount, performanceAmount, performanceTarget, cardName } = d;
    const rate = Number(performanceTarget) > 0 ? ((Number(performanceAmount)/Number(performanceTarget))*100).toFixed(1)+'%' : '0%';
    det.innerHTML = `<h4>${cardName || card}</h4> <p><strong>청구 기준월:</strong> ${billingCycleMonthForCard}</p> <p><strong>청구 예정 금액:</strong> ${Number(billingAmount).toLocaleString()}원</p><hr> <p><strong>실적 산정월:</strong> ${performanceReferenceMonthForDisplay}</p> <p><strong>현재 사용액(실적):</strong> ${Number(performanceAmount).toLocaleString()}원</p> <p><strong>실적 목표 금액:</strong> ${Number(performanceTarget).toLocaleString()}원</p> <p><strong>달성률:</strong> ${rate}</p> <p style="font-size:0.8em;color:grey;">(실적은 카드사의 실제 집계와 다를 수 있습니다)</p>`;
  } catch (error) {
    det.innerHTML = '<p>카드 데이터를 불러오는 데 실패했습니다.</p>';
  } finally {
    if(loader) loader.style.display = 'none';
  }
}

// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
// ★★★ 데이터 수정 시 안정성을 위해 서버 응답을 기다리는 handleDelete ★★★
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
async function handleDelete() {
  if (!currentEditingTransaction || typeof currentEditingTransaction.row === 'undefined') {
    showToast('삭제할 거래를 먼저 선택해주세요.', true); return;
  }
  if (!confirm('정말로 이 거래 내역을 삭제하시겠습니까?')) return;
  
  const rowId = currentEditingTransaction.row; 
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';
  closeModal();
  showToast('삭제 중...');

  try {
    const serverResult = await callAppsScriptApi('deleteTransaction', { id_to_delete: Number(rowId) }); 
    if (serverResult.success) {
      showToast(serverResult.message || '삭제 완료!', false);
      // 성공 시, 캐시 우선 방식인 updateCalendarDisplay를 호출하여 화면을 자연스럽게 갱신
      await updateCalendarDisplay(); 
    } else {
      throw new Error(serverResult.message || serverResult.error || '서버에서 삭제 실패');
    }
  } catch (error) {
    showToast(`삭제 실패! (${error.message})`, true);
  } finally {
    if(loader) loader.style.display = 'none';
  }
}
