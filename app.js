// app.js

// ▼▼▼ 선생님의 실제 앱스 스크립트 웹앱 배포 URL로 반드시 교체해주세요!!! ▼▼▼
const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjP671pu6MMLKhmTXHwqCu-wci-Y-RM0Sl5TlQO0HmGsyrH83DBj6dsh62LqHIf-YD/exec"; 
// ▲▲▲ 예시 URL입니다. 선생님의 배포 URL로 바꿔주세요. ▲▲▲

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

  console.log(`[API] Calling: ${actionName} with params:`, params, `URL: ${url.toString()}`);
  try {
    const response = await fetch(url.toString(), { method: 'GET' }); // 모든 요청 GET으로 가정
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
    return result.data !== undefined ? result.data : result; // result.data가 있으면 그것을, 아니면 result 전체를 반환
  } catch (error) {
    console.error(`[API] Error calling action "${actionName}":`, error);
    if (typeof showToast === 'function') {
      showToast(`"${actionName}" API 요청 중 오류: ${error.message}`, true);
    }
    throw error; // 에러를 다시 던져서 호출한 곳에서 잡을 수 있도록 함
  }
}

/* === 뷰포트 높이 CSS 변수 갱신 === */
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

/* === 페이지 로드 순서 === */
window.onload = async () => {
  console.log("[App.js] window.onload triggered");
  determineInitialCycleMonth();
  setupEventListeners();
  
  // 초기 데이터 로드 (API 호출)
  await loadInitialData(); // 카테고리 등 설정 데이터
  await updateCalendarDisplay(); // 첫 달 달력 데이터

  showView('calendarView');
  toggleTypeSpecificFields();
  document.getElementById('transactionModal').style.display = 'none';

  // 서비스 워커 등록
  if ('serviceWorker' in navigator) {
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

async function changeMonth(delta){ // 비동기로 변경
  currentDisplayDate.setMonth(currentDisplayDate.getMonth() + delta);
  const y = currentDisplayDate.getFullYear();
  const m = currentDisplayDate.getMonth();
  currentCycleMonth = `${y}-${String(m + 1).padStart(2,'0')}`;
  await updateCalendarDisplay(); // 실제 API 호출 함수로 변경
}

async function updateCalendarDisplay() {
  const loader = document.getElementById('loader');
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error("calendarBody not found"); return; }

  if(loader) loader.style.display = 'block';
  calendarBody.innerHTML = '';

  console.log("[App.js] updateCalendarDisplay: Fetching transactions for cycle:", currentCycleMonth);
  try {
    const transactions = await callAppsScriptApi('getTransactions', { cycleMonth: currentCycleMonth });
    localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(transactions || [])); // API 결과 캐싱
    renderCalendarAndSummary(transactions || []);
  } catch (error) {
    console.error('updateCalendarDisplay API call failed:', error);
    // showToast는 callAppsScriptApi에서 이미 호출됨
    renderCalendarAndSummary([]); // 오류 시 빈 달력
  } finally {
    if(loader) loader.style.display = 'none';
  }
}

function renderCalendarAndSummary(transactions){
  const year = parseInt(currentCycleMonth.split('-')[0], 10);
  const month = parseInt(currentCycleMonth.split('-')[1], 10);
  document.getElementById('currentMonthYear').textContent = `${year}년 ${String(month).padStart(2,'0')}월 주기`;
  renderCalendar(year, month, transactions);
  updateSummary(transactions);
}

function renderCalendar(year, monthOneBased, transactions){
  const calendarBody = document.getElementById('calendarBody');
  calendarBody.innerHTML = '';
  const transMap = {};
  (transactions||[]).forEach(t=>{
    if (t && t.date) { (transMap[t.date] = transMap[t.date] || []).push(t); }
  });

  const cycleStart = new Date(year, monthOneBased - 1, 18);
  const cycleEnd = new Date(year, monthOneBased, 17);
  let curDate = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  const frag = document.createDocumentFragment();
  const startDayOfWeek = cycleStart.getDay(); 

  for(let i=0; i<startDayOfWeek; i++){
    const td = document.createElement('td'); td.className='other-month'; weekRow.appendChild(td);
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
          const emptyTd = document.createElement('td'); emptyTd.className='other-month'; weekRow.appendChild(emptyTd);
        }
      }
      frag.appendChild(weekRow);
      if(curDate.getTime() !== cycleEnd.getTime()){ weekRow = document.createElement('tr'); }
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
      if (t.type==='수입') inc += a; else exp += a;
    }
  });
  const bal = inc - exp;
  document.getElementById('totalIncome').textContent = `₩${inc.toLocaleString()}`;
  document.getElementById('totalExpense').textContent = `₩${exp.toLocaleString()}`;
  const balEl = document.getElementById('totalBalance');
  balEl.textContent = `₩${bal.toLocaleString()}`;
  balEl.className = 'total-balance'; 
  if (bal < 0) balEl.classList.add('negative');
}

async function loadInitialData() {
  console.log("[App.js] loadInitialData: Fetching app setup data via API...");
  try {
    // Code.gs의 doGet에서 getAppSetupData는 initialCycleMonth 파라미터를 받을 수 있도록 수정됨
    const setupData = await callAppsScriptApi('getAppSetupData', { initialCycleMonth: currentCycleMonth }); 
    if (setupData) {
      expenseCategoriesData = setupData.expenseCategories || {};
      paymentMethodsData    = setupData.paymentMethods    || [];
      incomeSourcesData     = setupData.incomeSources     || [];
      
      // 만약 getAppSetupData가 초기 거래내역(initialTransactions)도 반환한다면 여기서 처리
      if (setupData.initialTransactions && Array.isArray(setupData.initialTransactions)) {
        console.log("[App.js] Initial transactions received from getAppSetupData");
        localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(setupData.initialTransactions));
        // updateCalendarDisplay를 여기서 또 호출할 필요는 없음. window.onload에서 이미 호출됨.
        // 만약 이 데이터로 즉시 달력을 그려야 한다면 renderCalendarAndSummary(setupData.initialTransactions) 호출.
      }

      populateFormDropdowns();
      populateCardSelector();
      showToast('앱 설정을 불러왔습니다.', false);
    }
  } catch (error) {
    console.error('loadInitialData API call failed:', error);
    // showToast는 callAppsScriptApi 내부에서 이미 호출됨
  }
}

function setupEventListeners() {
  document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmit);
}

function toggleTypeSpecificFields() {
  const typeRadio = document.querySelector('input[name="type"]:checked');
  let type = '지출'; // 기본값
  if (typeRadio) {
    type = typeRadio.value;
  } else {
    // 페이지 로드 시 체크된 라디오 버튼이 없을 수 있으므로, 기본으로 '지출'을 선택하고 UI 업데이트
    const defaultExpenseRadio = document.querySelector('input[name="type"][value="지출"]');
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
  if (expenseCategoriesData && expenseCategoriesData[mainCategoryValue]) {
    expenseCategoriesData[mainCategoryValue].forEach(subCat => {
      const option = document.createElement('option'); option.value = subCat; option.textContent = subCat; subCategorySelect.appendChild(option);
    });
  }
}

async function handleTransactionSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const transactionData = {};
  fd.forEach((v, k) => transactionData[k] = v);

  if (!transactionData.date || !transactionData.amount || !transactionData.content) {
    showToast("날짜, 금액, 내용은 필수입니다.", true); return;
  }
  if (transactionData.type === '지출' && (!transactionData.paymentMethod || !transactionData.mainCategory || !transactionData.subCategory)) {
    showToast("지출 시 결제수단과 카테고리는 필수입니다.", true); return;
  }
  if (transactionData.type === '수입' && !transactionData.incomeSource) {
    showToast("수입 시 수입원은 필수입니다.", true); return;
  }

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
        optimisticData[index].category1 = transactionData.incomeSource || ''; optimisticData[index].category2 = '';
      } else { 
        optimisticData[index].category1 = transactionData.mainCategory || ''; optimisticData[index].category2 = transactionData.subCategory || '';
      }
    }
  } else {
    const newItemForUI = { ...transactionData, row: tempRowId }; // UI에는 임시 ID 사용
     if (newItemForUI.type === '수입') {
        newItemForUI.category1 = transactionData.incomeSource || ''; newItemForUI.category2 = '';
      } else { 
        newItemForUI.category1 = transactionData.mainCategory || ''; newItemForUI.category2 = transactionData.subCategory || '';
      }
    optimisticData.push(newItemForUI);
    // itemForServer에는 row ID를 보내지 않거나, 서버에서 생성하도록 합니다. (addTransaction의 경우)
    // 여기서는 Code.gs의 addTransaction이 ID를 다루지 않는다고 가정하고, 클라이언트 임시 ID는 보내지 않습니다.
  }
  
  localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(optimisticData));
  renderCalendarAndSummary(optimisticData);
  showToast(isEditing ? '수정 사항 전송 중...' : '저장 사항 전송 중...');
  closeModal();

  const action = isEditing ? 'updateTransaction' : 'addTransaction';
  try {
    // GET 방식이므로 복잡한 객체는 문자열로 변환하여 전달
    const serverResult = await callAppsScriptApi(action, { transactionDataString: JSON.stringify(itemForServer) });

    if (serverResult.success) {
      showToast(serverResult.message || (isEditing ? '수정 완료!' : '저장 완료!'), false);
      // 성공 시 서버로부터 받은 실제 데이터로 로컬 스토리지와 UI를 최종 업데이트 할 수 있습니다.
      // 예: 새 거래 추가 시 서버에서 실제 ID를 반환하면 optimisticData의 temp-ID를 교체
      // 지금은 전체 목록을 다시 불러오는 것으로 대체합니다. (더 확실한 동기화)
      await updateCalendarDisplay(); // 서버와 완벽 동기화를 위해 데이터 다시 로드

    } else { // API 호출은 성공했으나, API 내부 로직에서 success:false 반환
      throw new Error(serverResult.message || serverResult.error || '서버 작업 처리 실패');
    }
  } catch (error) { // fetch 자체의 실패 또는 API가 success:false 반환 후 여기서 throw한 에러
    showToast((isEditing ? '수정 실패: ' : '저장 실패: ') + error.message, true);
    // 오류 발생 시 Optimistic Update 롤백
    localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(originalData));
    renderCalendarAndSummary(originalData);
  }
}

async function openModal(dateStr) { // 비동기일 필요는 없지만, loadDailyTransactions이 비동기이므로 통일
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
  await loadDailyTransactions(dateStr); // 실제 API 호출 함수로 변경
}

function closeModal(){ 
  document.getElementById('transactionModal').style.display='none'; 
}

function toggleDailyTransactionVisibility() {
  const dailySection = document.getElementById('dailyTransactions');
  const toggleBtn = document.getElementById('toggleDailyTransactions');
  const isHidden = dailySection.style.display === 'none';
  if (isHidden) {
    dailySection.style.display = 'block';
    toggleBtn.textContent = '거래 내역 숨기기';
  } else {
    dailySection.style.display = 'none';
    toggleBtn.textContent = '거래 내역 보기';
    const preservedDate = document.getElementById('transactionDate').value;
    document.getElementById('transactionForm').reset();
    document.getElementById('transactionDate').value = preservedDate;
    document.getElementById('modalTitle').textContent = '거래 추가';
    document.getElementById('deleteBtn').style.display = 'none';
    currentEditingTransaction = null;
    toggleTypeSpecificFields();
  }
}

async function loadDailyTransactions(dateStr) {
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;
  list.textContent = '불러오는 중...';
  
  try {
    const dailyData = await callAppsScriptApi('getTransactionsByDate', { date: dateStr });
    displayDailyTransactions(dailyData || [], dateStr); // dailyData가 없을 경우 빈 배열로 처리
  } catch (error) {
    console.error('loadDailyTransactions API call failed for date ' + dateStr + ':', error);
    if (list) list.textContent = '일일 거래 내역 로딩 실패.';
    // showToast는 callAppsScriptApi에서 이미 호출됨
  }
}

function displayDailyTransactions(arr, dateStr) {
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;

  if (arr && arr.error) {
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
    d.addEventListener('click', function() { populateFormForEdit(t); });
    list.appendChild(d);
  });
}

function populateFormForEdit(transaction) {
  if (!transaction || typeof transaction.row === 'undefined') {
    console.error('populateFormForEdit: 유효하지 않은 거래 데이터입니다.', transaction);
    showToast('거래 정보를 불러오지 못했습니다.', true); return;
  }
  currentEditingTransaction = transaction; 
  document.getElementById('transactionForm').reset();
  document.getElementById('modalTitle').textContent = '거래 수정';
  document.getElementById('transactionDate').value = transaction.date || '';
  document.getElementById('transactionAmount').value = transaction.amount || '';
  document.getElementById('transactionContent').value = transaction.content || '';
  document.querySelectorAll('input[name="type"]').forEach(r => { r.checked = (r.value === transaction.type); });
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

function showView(id){
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.tab-button').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.tab-button[onclick="showView('${id}')"]`).classList.add('active');
  if(id==='cardView'){
    cardPerformanceMonthDate = new Date(); 
    // populateCardSelector(); // loadInitialData에서 이미 호출됨
    displayCardData(); // API 연동 함수 호출
  }
}

function showToast(msg,isErr=false){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.backgroundColor = isErr ? '#dc3545' : '#28a745'; 
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

async function changeCardMonth(d){ // 비동기로 변경
  cardPerformanceMonthDate.setMonth(cardPerformanceMonthDate.getMonth()+d); 
  await displayCardData(); // API 연동 함수 호출
}

async function displayCardData() {
  const cardSel = document.getElementById('cardSelector');
  const det = document.getElementById('cardDetails');
  const lbl = document.getElementById('cardMonthLabel');
  const loader = document.getElementById('loader');
  if (!cardSel || !det || !lbl) return;
  const card = cardSel.value;

  if (!card){
    det.innerHTML = '<p>카드를 선택해주세요.</p>'; lbl.textContent = ''; return;
  }
  if(loader) loader.style.display = 'block';

  const perfMonth = `${cardPerformanceMonthDate.getFullYear()}-${String(cardPerformanceMonthDate.getMonth()+1).padStart(2,'0')}`;
  lbl.textContent = `${perfMonth} 기준`;

  try {
    const d = await callAppsScriptApi('getCardData', { 
      cardName: card, 
      cycleMonthForBilling: currentCycleMonth, 
      performanceReferenceMonth: perfMonth 
    });
    if (!d || d.success === false){ // API가 {success:false, error:"..."} 반환 시 d.error 사용
      det.innerHTML = `<p>${d && d.error ? d.error : '카드 데이터 로딩 중 오류가 발생했습니다.'}</p>`;
      throw new Error(d && d.error ? d.error : '카드 데이터 구조 오류 또는 API 실패');
    }
    
    const billingMonth = d.billingCycleMonthForCard || currentCycleMonth;
    const perfRefMonthDisplay = d.performanceReferenceMonthForDisplay || perfMonth;
    const billingAmt = Number(d.billingAmount) || 0;
    const perfAmt = Number(d.performanceAmount) || 0;
    const targetAmt = Number(d.performanceTarget) || 0;
    const rate = targetAmt > 0 ? ((perfAmt/targetAmt)*100).toFixed(1)+'%' : '0%';

    det.innerHTML = `<h4>${d.cardName || card}</h4>
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
    // showToast는 callAppsScriptApi 내부에서 이미 호출됨
  } finally {
    if(loader) loader.style.display = 'none';
  }
}

async function handleDelete() {
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
    // Code.gs의 deleteTransaction은 숫자 ID를 받음
    const serverResult = await callAppsScriptApi('deleteTransaction', { id_to_delete: Number(rowId) }); 
    if (serverResult.success) {
      showToast(serverResult.message || '삭제 완료!', false);
      await updateCalendarDisplay(); // 삭제 후 목록 새로고침
    } else {
      throw new Error(serverResult.message || serverResult.error || '서버에서 삭제 실패');
    }
  } catch (error) {
    showToast(`삭제 실패! (${error.message})`, true);
    localStorage.setItem(key, JSON.stringify(originalData)); // 롤백
    renderCalendarAndSummary(originalData);
  }
}
