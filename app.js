// app.js - v5 (최종 수정본)

const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbwpfhT4H1B_tzK-Db5D6VODxsRTtZLwBboDsBhqRQQRo7mUyx4D186OULpr97bd-5Jh/exec";

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
  console.log(`[API] Calling: ${actionName}`);
  try {
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`서버 응답 오류 (${response.status})`);
    const result = await response.json();
    if (result.success === false) throw new Error(result.error || `"${actionName}" API 요청 실패`);
    return result;
  } catch (error) {
    console.error(`[API] Error calling action "${actionName}":`, error);
    showToast(`API 요청 중 오류: ${error.message}`, true);
    throw error; 
  }
}

/* === 뷰포트 높이 설정 === */
function setViewportHeightVar(){
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h}px`);
}
['load','resize','orientationchange'].forEach(evt => window.addEventListener(evt, setViewportHeightVar));
setViewportHeightVar();

/* === 페이지 로드 === */
window.onload = async () => {
  determineInitialCycleMonth();
  setupEventListeners();
  const loader = document.getElementById('loader');
  if(loader) loader.style.display = 'block';
  try {
    await loadInitialData();     
    await updateCalendarDisplay(); 
  } catch (error) {
    console.error("초기 데이터 로딩 실패:", error);
    showToast("초기 데이터 로딩 중 오류 발생. 새로고침해주세요.", true);
  } finally {
    if(loader) loader.style.display = 'none';
  }
  showView('calendarView');
};

/* === 이벤트 리스너 설정 === */
function setupEventListeners() {
  document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('mainCategory').addEventListener('change', updateSubCategories);
  setupSwipeListeners();
  
  document.getElementById('searchButton').addEventListener('click', handleSearch);
  document.getElementById('searchInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
          event.preventDefault();
          handleSearch();
      }
  });
}

/* === 달력 및 데이터 관련 함수 === */
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
      transactionsToRender = JSON.parse(cachedDataString);
      renderCalendarAndSummary(transactionsToRender);
      renderedFromCache = true;
    } catch (err) { localStorage.removeItem(cacheKey); }
  }
  if (!renderedFromCache) renderCalendarAndSummary([]);

  try {
    const result = await callAppsScriptApi('getTransactions', { cycleMonth: currentCycleMonth });
    const finalTx = result.data || [];
    localStorage.setItem(cacheKey, JSON.stringify(finalTx));
    if (!renderedFromCache || JSON.stringify(transactionsToRender) !== JSON.stringify(finalTx)) {
      renderCalendarAndSummary(finalTx);
      if (renderedFromCache) showToast('달력 정보가 업데이트 되었습니다.', false);
    }
  } catch (err) {
    console.error('getTransactions 실패', err);
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

function renderCalendar(year, monthOneBased, transactions){
  const calendarBody = document.getElementById('calendarBody');
  calendarBody.innerHTML = '';
  const transMap = {};
  (transactions||[]).forEach(t => (transMap[t.date] = transMap[t.date] || []).push(t));
  const cycleStart = new Date(year, monthOneBased - 1, 18);
  const cycleEnd = new Date(year, monthOneBased, 17);
  let cur = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  const frag = document.createDocumentFragment();
  for(let i=0; i < cycleStart.getDay(); i++) weekRow.appendChild(document.createElement('td'));
  while(cur <= cycleEnd){
    const td = document.createElement('td');
    const dStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    td.dataset.date = dStr;
    td.onclick = () => openModal(dStr);
    td.innerHTML = `<span class="date-number">${cur.getDate()}</span><div class="txn-wrap"></div>`;
    const wrap = td.querySelector('.txn-wrap');
    const list = transMap[dStr] || [];
    list.slice(0, 4).forEach(t => {
      wrap.innerHTML += `<div class="txn-item ${t.type==='수입'?'income':'expense'}">${Number(t.amount).toLocaleString()}원</div>`;
    });
    if(list.length > 4) {
      const more = document.createElement('div');
      more.className = 'more-link';
      more.textContent = `+${list.length-4}`;
      more.onclick = e => { e.stopPropagation(); openModal(dStr); };
      wrap.appendChild(more);
    }
    weekRow.appendChild(td);
    if(cur.getDay() === 6 || cur.getTime() === cycleEnd.getTime()){
      if(cur.getTime() === cycleEnd.getTime() && cur.getDay() !== 6){
        for(let i = cur.getDay() + 1; i <= 6; i++) weekRow.appendChild(document.createElement('td'));
      }
      frag.appendChild(weekRow);
      if(cur.getTime() !== cycleEnd.getTime()) weekRow = document.createElement('tr');
    }
    cur.setDate(cur.getDate() + 1);
  }
  calendarBody.appendChild(frag);
}

function updateSummary(transactions){
  let inc = 0, exp = 0;
  (transactions||[]).forEach(t => { const a = Number(t.amount)||0; if (t.type==='수입') inc += a; else exp += a; });
  document.getElementById('totalIncome').textContent = `₩${inc.toLocaleString()}`;
  document.getElementById('totalExpense').textContent = `₩${exp.toLocaleString()}`;
  const balEl = document.getElementById('totalBalance');
  balEl.textContent = `₩${(inc - exp).toLocaleString()}`;
  balEl.className = (inc - exp) < 0 ? 'total-balance negative' : 'total-balance';
}

async function loadInitialData() {
  const result = await callAppsScriptApi('getAppSetupData');
  if (result.success) {
    expenseCategoriesData = result.expenseCategories || {};
    paymentMethodsData = result.paymentMethods || [];
    incomeSourcesData = result.incomeSources || [];
    populateFormDropdowns(); 
    populateCardSelector();
  } else {
    showToast('앱 설정 로딩 실패.', true);
  }
}

/* === 검색 기능 관련 함수들 === */
async function handleSearch() {
  const searchInput = document.getElementById('searchInput');
  const keyword = searchInput.value.trim();
  if (!keyword) {
    showToast('검색어를 입력해주세요.', true);
    return;
  }
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  const resultsContainer = document.getElementById('searchResultView');
  resultsContainer.innerHTML = '';
  resultsContainer.style.display = 'block';
  try {
    const result = await callAppsScriptApi('searchTransactions', { keyword });
    displaySearchResults(result.data, keyword);
  } catch (error) {
    resultsContainer.innerHTML = `<p>검색 중 오류가 발생했습니다: ${error.message}</p>`;
  } finally {
    if (loader) loader.style.display = 'none';
    searchInput.blur();
  }
}

function displaySearchResults(transactions, keyword) {
  const container = document.getElementById('searchResultView');
  container.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'search-result-header';
  header.innerHTML = `<h3>'${keyword}' 검색 결과 (${transactions.length}건)</h3>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-search-btn';
  closeBtn.textContent = '닫기';
  closeBtn.onclick = () => {
      document.getElementById('searchInput').value = '';
      showView('calendarView');
  };
  header.appendChild(closeBtn);
  container.appendChild(header);
  if (transactions.length === 0) {
    container.innerHTML += '<p>검색 결과가 없습니다.</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  transactions.forEach(t => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    const amountClass = t.type === '수입' ? 'income' : 'expense';
    item.innerHTML = `
      <div class="result-item-details">
        <span class="result-item-date">${t.date}</span>
        <span class="result-item-content">${t.content}</span>
      </div>
      <span class="result-item-amount ${amountClass}">${t.type === '수입' ? '+' : '-'}${Number(t.amount).toLocaleString()}원</span>
    `;
    item.addEventListener('click', () => {
      openModal(t.date);
      setTimeout(() => populateFormForEdit(t), 100); 
    });
    fragment.appendChild(item);
  });
  container.appendChild(fragment);
}

/* === UI 및 폼 관련 함수 === */
function showView(id){
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.remove('active');
    c.style.display = 'none';
  });
  document.getElementById('searchResultView').innerHTML = '';
  const activeTabContent = document.getElementById(id);
  activeTabContent.classList.add('active');
  activeTabContent.style.display = 'block';
  document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-button[onclick="showView('${id}')"]`).classList.add('active');
  if(id === 'cardView') displayCardData();
}

async function handleTransactionSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const transactionData = Object.fromEntries(new FormData(form).entries());
  if (!validateTransactionData(transactionData)) return;
  const isEditing = currentEditingTransaction && typeof currentEditingTransaction.row !== 'undefined';
  if (isEditing) transactionData.id_to_update = currentEditingTransaction.row;
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';
  closeModal();
  showToast(isEditing ? '수정 중...' : '저장 중...');
  const action = isEditing ? 'updateTransaction' : 'addTransaction';
  try {
    const result = await callAppsScriptApi(action, { transactionDataString: JSON.stringify(transactionData) });
    if (result.success) {
      showToast(result.message || (isEditing ? '수정 완료!' : '저장 완료!'), false);
      await updateCalendarDisplay(); 
    } else { throw new Error(result.error); }
  } catch (error) { 
    showToast((isEditing ? '수정 실패: ' : '저장 실패: ') + error.message, true);
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

async function handleDelete() {
  if (!currentEditingTransaction || !confirm('정말로 삭제하시겠습니까?')) return;
  const rowId = currentEditingTransaction.row; 
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'block';
  closeModal();
  showToast('삭제 중...');
  try {
    const result = await callAppsScriptApi('deleteTransaction', { id_to_delete: Number(rowId) }); 
    if (result.success) {
      showToast(result.message || '삭제 완료!', false);
      await updateCalendarDisplay(); 
    } else { throw new Error(result.error); }
  } catch (error) {
    showToast(`삭제 실패! (${error.message})`, true);
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

function validateTransactionData(data) {
  if (!data.date || !data.amount || !data.content) {
    showToast("날짜, 금액, 내용은 필수입니다.", true); return false;
  }
  if (data.type === '지출' && (!data.paymentMethod || !data.mainCategory || !data.subCategory)) {
    showToast("지출 시 결제수단과 카테고리는 필수입니다.", true); return false;
  }
  if (data.type === '수입' && !data.incomeSource) {
    showToast("수입 시 수입원은 필수입니다.", true); return false;
  }
  return true;
}

function setupSwipeListeners() {
    const calendarElement = document.getElementById('calendarView');
    if (!calendarElement) return;
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
    const result = await callAppsScriptApi('getTransactionsByDate', { date: dateStr });
    displayDailyTransactions(result.data || []);
  } catch (error) {
    if (list) list.textContent = '일일 거래 내역 로딩 실패.';
  }
}

function displayDailyTransactions(arr) {
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;
  if (!Array.isArray(arr) || arr.length === 0) { 
    list.textContent = '해당 날짜의 거래 내역이 없습니다.'; 
    return; 
  }
  list.innerHTML = '';
  arr.forEach(function(t) {
    const d = document.createElement('div');
    d.classList.add('transaction-item', t.type === '수입' ? 'income' : 'expense');
    let txt = `[${t.type}] ${t.content || ''}: ${Number(t.amount || 0).toLocaleString()}원`;
    if (t.type === '지출' && t.paymentMethod) txt += ` (${t.paymentMethod})`;
    if (t.category1) txt += ` - ${t.category1}`;
    if (t.category2) txt += ` / ${t.category2}`;
    d.textContent = txt; 
    d.style.cursor = 'pointer';
    d.addEventListener('click', () => populateFormForEdit(t));
    list.appendChild(d);
  });
}

function populateFormForEdit(transaction) {
  if (!transaction || typeof transaction.row === 'undefined') return;
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

function showToast(msg,isErr=false){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; 
  t.style.backgroundColor = isErr ? '#dc3545' : '#28a745'; 
  t.style.visibility = 'visible'; 
  t.style.opacity = '1';
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=> t.style.visibility = 'hidden', 500); }, 3000);
}

function populateCardSelector(){
  const sel = document.getElementById('cardSelector');
  if (!sel) return;
  sel.innerHTML='<option value="">카드를 선택하세요</option>';
  (paymentMethodsData||[]).filter(m=>m.isCard).forEach(c=>{
    const o=document.createElement('option'); 
    o.value=c.name; 
    o.textContent=c.name; 
    sel.appendChild(o);
  });
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
  if (!card){ 
    det.innerHTML = '<p>카드를 선택해주세요.</p>'; 
    lbl.textContent = ''; 
    return; 
  }
  
  const loader = document.getElementById('loader');
  if(loader) loader.style.display = 'block';
  
  const perfMonth = `${cardPerformanceMonthDate.getFullYear()}-${String(cardPerformanceMonthDate.getMonth()+1).padStart(2,'0')}`;
  lbl.textContent = `${perfMonth} 기준`;

  try {
    const result = await callAppsScriptApi('getCardData', { cardName: card, cycleMonthForBilling: currentCycleMonth, performanceReferenceMonth: perfMonth });
    const d = result.data;
    if (!result.success || !d) throw new Error(result.error || '카드 데이터 구조 오류');
    const { billingCycleMonthForCard, performanceReferenceMonthForDisplay, billingAmount, performanceAmount, performanceTarget, cardName } = d;
    const rate = Number(performanceTarget) > 0 ? ((Number(performanceAmount)/Number(performanceTarget))*100).toFixed(1)+'%' : '0%';
    det.innerHTML = `<h4>${cardName || card}</h4> <p><strong>청구 기준월:</strong> ${billingCycleMonthForCard}</p> <p><strong>청구 예정 금액:</strong> ${Number(billingAmount).toLocaleString()}원</p><hr> <p><strong>실적 산정월:</strong> ${performanceReferenceMonthForDisplay}</p> <p><strong>현재 사용액(실적):</strong> ${Number(performanceAmount).toLocaleString()}원</p> <p><strong>실적 목표 금액:</strong> ${Number(performanceTarget).toLocaleString()}원</p> <p><strong>달성률:</strong> ${rate}</p> <p style="font-size:0.8em;color:grey;">(실적은 카드사의 실제 집계와 다를 수 있습니다)</p>`;
  } catch (error) {
    det.innerHTML = '<p>카드 데이터를 불러오는 데 실패했습니다.</p>';
  } finally {
    if(loader) loader.style.display = 'none';
  }
}

