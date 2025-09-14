// app.js - 카테고리 수정 문제 디버깅 및 API 연동

// ▼▼▼ 선생님의 실제 앱스 스크립트 웹앱 배포 URL로 반드시 교체해주세요!!! ▼▼▼
const API_ENDPOINT = "https://budget-api-166126275494.asia-northeast3.run.app";
const API_KEY = "LovelyNaonDaon"; 
// ▲▲▲ 선생님의 실제 배포 URL을 다시 한번 확인해주세요. ▲▲▲
/* === 전역 상태 및 API 설정 === */
// config.js에서 API_ENDPOINT와 API_KEY를 불러옵니다.

let currentDisplayDate = new Date();
let currentCycleMonth = '';
let cardPerformanceMonthDate = new Date();
let cardBillingCycleDate = new Date()
let expenseCategoriesData = {};
let paymentMethodsData = [];
let incomeSourcesData = [];
let currentEditingTransaction = null;

/* === API 호출 헬퍼 함수 === */
async function callApi(path, method = 'GET', body = null) {
    const url = new URL(path, API_ENDPOINT);
    
    // GET 요청의 경우, body 객체를 쿼리 파라미터로 변환합니다.
    if (method === 'GET' && body) {
        Object.keys(body).forEach(key => url.searchParams.append(key, body[key]));
    }

    const options = {
        method,
        headers: {
            'X-API-KEY': API_KEY,
            'Content-Type': 'application/json'
        }
    };

    // GET이 아닌 요청에만 body를 포함시킵니다.
    if (method !== 'GET' && body) {
        options.body = JSON.stringify(body);
    }

    console.log(`[API] Calling: ${method} ${url.toString()}`);
    try {
        const response = await fetch(url.toString(), options);
        const result = await response.json();

        if (!response.ok) {
             throw new Error(result.error || `서버 응답 오류 (${response.status})`);
        }
        
        if (result.success === false) {
             throw new Error(result.error || `"${path}" API 요청 실패`);
        }
        return result.data !== undefined ? result.data : result;
    } catch (error) {
        console.error(`[API] Error calling action "${path}":`, error);
        if (typeof showToast === 'function') {
            showToast(`API 요청 중 오류: ${error.message}`, true);
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
    document.getElementById('searchBtn').addEventListener('click', handleSearch);
    document.getElementById('deleteBtn').addEventListener('click', handleDelete);
    document.querySelectorAll('input[name="type"]').forEach(radio => {
        radio.addEventListener('change', toggleTypeSpecificFields);
    });
    document.getElementById('cardSelector').addEventListener('change', displayCardData);
    document.getElementById('toggleDailyTransactions').addEventListener('click', toggleDailyTransactionVisibility);
    document.querySelector('.close-button').addEventListener('click', closeModal);
}


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
    console.log('[App.js] updateCalendarDisplay →', currentCycleMonth);
    try {
        const transactions = await callApi('/transactions', 'GET', { cycleMonth: currentCycleMonth });
        renderCalendarAndSummary(transactions);
        console.log('[App.js] Calendar updated from API');
    } catch (err) {
        console.error('[App.js] getTransactions failed', err);
        renderCalendarAndSummary([]); // Render empty on failure
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
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const transMap = {};
    (transactions||[]).forEach(t=>{ if(t && t.Date){ (transMap[t.Date]=transMap[t.Date]||[]).push(t); } });
    const cycleStart = new Date(year, monthOneBased-1, 18);
    const cycleEnd = new Date(year, monthOneBased, 17);
    let cur = new Date(cycleStart);
    let weekRow = document.createElement('tr');
    const frag = document.createDocumentFragment();
    for(let i=0;i<cycleStart.getDay();i++){ const td=document.createElement('td'); td.className='other-month'; weekRow.appendChild(td); }
    while(cur<=cycleEnd){
        const td = document.createElement('td');
        const dStr = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
        if (dStr === todayStr) td.classList.add('today');
        td.dataset.date=dStr; td.onclick=()=>openModal(dStr);
        const num = document.createElement('span'); num.className='date-number'; num.textContent=cur.getDate(); td.appendChild(num);
        const wrap=document.createElement('div'); wrap.className='txn-wrap';
        const list = transMap[dStr]||[];
        list.slice(0,4).forEach(t=>{
            const div=document.createElement('div');
            div.className=`txn-item ${t.Type==='수입'?'income':'expense'}`;
            div.textContent=`${Number(t.Amount).toLocaleString()}원`;
            wrap.appendChild(div);
        });
        if(list.length>4){
            const more=document.createElement('div'); more.className='more-link'; more.textContent=`+${list.length-4}`;
            more.onclick=e=>{ e.stopPropagation(); openModal(dStr);}
            wrap.appendChild(more);
        }
        td.appendChild(wrap);
        weekRow.appendChild(td);
        if(cur.getDay()===6 || cur.getTime()===cycleEnd.getTime()){
            if(cur.getTime()===cycleEnd.getTime() && cur.getDay()!==6){
                for(let i=cur.getDay()+1;i<=6;i++){ const empty=document.createElement('td'); empty.className='other-month'; weekRow.appendChild(empty); }
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
    (transactions||[]).forEach(t => { if (t && typeof t.Amount !== 'undefined') { const a = Number(t.Amount)||0; if (t.Type==='수입') inc += a; else exp += a; } });
    const bal = inc - exp;
    document.getElementById('totalIncome').textContent = `₩${inc.toLocaleString()}`;
    document.getElementById('totalExpense').textContent = `₩${exp.toLocaleString()}`;
    const balEl = document.getElementById('totalBalance');
    balEl.textContent = `₩${bal.toLocaleString()}`; balEl.className = 'total-balance';
    if (bal < 0) balEl.classList.add('negative');
}

async function loadInitialData() {
    console.log("[App.js] loadInitialData: Fetching app setup data via new API...");
    try {
        const setupData = await callApi('/setup-data');
        if (setupData) {
            expenseCategoriesData = setupData.expenseCategories || {};
            paymentMethodsData = setupData.paymentMethods || [];
            incomeSourcesData = setupData.incomeSources || [];
            populateFormDropdowns();
            populateCardSelector();
        }
    } catch (error) {
        console.error('loadInitialData API call failed:', error);
    }
}


/* === 모달 및 거래 처리 관련 함수들 === */

async function handleTransactionSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const transactionData = {};
    fd.forEach((v, k) => transactionData[k] = v);

    if (!validateTransactionData(transactionData)) return;

    const isEditing = currentEditingTransaction && typeof currentEditingTransaction.row !== 'undefined';
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'block';
    showToast(isEditing ? '수정 사항을 전송 중입니다...' : '저장 중입니다...');
    closeModal();

    try {
        let result;
        if (isEditing) {
            result = await callApi(`/transactions/${currentEditingTransaction.row}`, 'PUT', transactionData);
        } else {
            result = await callApi('/transactions', 'POST', transactionData);
        }
        
        if (result.success) {
            showToast(result.message || (isEditing ? '수정 완료!' : '저장 완료!'), false);
            await updateCalendarDisplay(); // Refresh calendar
        }
    } catch (error) {
        console.error(`Transaction submission failed:`, error);
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
        // Reset form when hiding
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
        const dailyData = await callApi('/daily-transactions', 'GET', { date: dateStr });
        displayDailyTransactions(dailyData);
    } catch (error) {
        console.error('loadDailyTransactions API call failed for date ' + dateStr + ':', error);
        if (list) list.textContent = '일일 거래 내역 로딩 실패.';
    }
}

function displayDailyTransactions(arr) {
    const list = document.getElementById('dailyTransactionList');
    if (!list) return;
    if (!Array.isArray(arr) || arr.length === 0) { list.textContent = '해당 날짜의 거래 내역이 없습니다.'; return; }
    list.innerHTML = '';
    arr.forEach(function(t) {
        if (!t || typeof t.Type === 'undefined') return;
        const d = document.createElement('div');
        d.classList.add('transaction-item', t.Type === '수입' ? 'income' : 'expense');
        let txt = `[${t.Type}] ${t.Content || '(내용 없음)'}: ${Number(t.Amount || 0).toLocaleString()}원`;
        if (t.Type === '지출' && t.PaymentMethod) txt += ` (${t.PaymentMethod})`;
        if (t.Category1) txt += ` - ${t.Category1}`;
        if (t.Category2) txt += ` / ${t.Category2}`;
        d.textContent = txt; d.style.cursor = 'pointer'; d.title = '클릭하여 이 내용 수정하기';
        d.addEventListener('click', function() { populateFormForEdit(t); });
        list.appendChild(d);
    });
}

function populateFormForEdit(transaction) {
    if (!transaction || typeof transaction.row === 'undefined') {
        console.error('[populateFormForEdit] Invalid transaction data.', transaction);
        showToast('거래 정보를 불러오지 못했습니다. (ID 누락)', true);
        return;
    }
    currentEditingTransaction = transaction;
    const form = document.getElementById('transactionForm');
    form.reset();
    document.getElementById('modalTitle').textContent = '거래 수정';
    document.getElementById('transactionDate').value = transaction.Date || '';
    document.getElementById('transactionAmount').value = transaction.Amount || '';
    document.getElementById('transactionContent').value = transaction.Content || '';
    document.querySelectorAll('input[name="type"]').forEach(r => { r.checked = (r.value === transaction.Type); });
    toggleTypeSpecificFields();
    if (transaction.Type === '지출') {
        document.getElementById('paymentMethod').value = transaction.PaymentMethod || '';
        const mainCategorySelect = document.getElementById('mainCategory');
        mainCategorySelect.value = transaction.Category1 || '';
        updateSubCategories();
        document.getElementById('subCategory').value = transaction.Category2 || '';
    } else if (transaction.Type === '수입') {
        document.getElementById('incomeSource').value = transaction.Category1 || '';
    }
    document.getElementById('deleteBtn').style.display = 'block';
    document.getElementById('dailyTransactions').style.display = 'none';
    document.getElementById('toggleDailyTransactions').textContent = '거래 내역 보기';
    document.getElementById('transactionModal').style.display = 'flex';
}

async function handleDelete() {
    if (!currentEditingTransaction || typeof currentEditingTransaction.row === 'undefined') {
        showToast('삭제할 거래를 먼저 선택해주세요.', true);
        return;
    }
    const rowId = currentEditingTransaction.row;
    
    // confirm은 브라우저 기본 UI이므로 PWA 환경에 적합하지 않을 수 있습니다. 
    // 실제 앱에서는 커스텀 모달로 구현하는 것이 좋습니다.
    if (!confirm(`[${currentEditingTransaction.Date}] ${currentEditingTransaction.Content} (${Number(currentEditingTransaction.Amount).toLocaleString()}원) 내역을 정말 삭제하시겠습니까?`)) {
        return;
    }

    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'block';
    showToast('삭제를 서버에 전송 중...');
    closeModal();
    
    try {
        const result = await callApi(`/transactions/${rowId}`, 'DELETE');
        if (result.success) {
            showToast(result.message || '삭제 완료!', false);
            await updateCalendarDisplay(); // Refresh calendar
        }
    } catch (error) {
        console.error('Delete failed:', error);
        showToast(`삭제 실패! (${error.message})`, true);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}


/* === 기타 UI 함수들 === */
function toggleTypeSpecificFields() {
    const typeRadio = document.querySelector('input[name="type"]:checked');
    let type = typeRadio ? typeRadio.value : '지출';
    document.getElementById('expenseSpecificFields').style.display = type === '지출' ? 'block' : 'none';
    document.getElementById('incomeSpecificFields').style.display = type === '수입' ? 'block' : 'none';
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

function showView(id){
    document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.tab-button').forEach(b=>b.classList.remove('active'));
    document.querySelector(`.tab-button[onclick="showView('${id}')"]`).classList.add('active');
    
    if(id==='cardView'){
        cardPerformanceMonthDate = new Date();
        cardBillingCycleDate = new Date(currentDisplayDate);
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


/* === 카드 탭 관련 함수들 === */

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
    cardBillingCycleDate.setMonth(cardBillingCycleDate.getMonth()+d);
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
    const billingMonth = `${cardBillingCycleDate.getFullYear()}-${String(cardBillingCycleDate.getMonth()+1).padStart(2,'0')}`;
    lbl.textContent = `${billingMonth} 주기 기준`;

    try {
        const d = await callApi('/card-data', 'GET', { 
            cardName: card, 
            billingMonth: billingMonth, 
            performanceMonth: perfMonth 
        });

        const billingAmt = Number(d.billingAmount) || 0;
        const perfAmt = Number(d.performanceAmount) || 0;
        const targetAmt = Number(d.performanceTarget) || 0;
        const rate = targetAmt > 0 ? ((perfAmt/targetAmt)*100).toFixed(1)+'%' : '0%';
        det.innerHTML = `<h4>${d.cardName || card}</h4> <p><strong>청구 기준월:</strong> ${d.billingCycleMonthForCard || billingMonth} (18일~다음달 17일)</p> <p><strong>청구 예정 금액:</strong> ${billingAmt.toLocaleString()}원</p><hr> <p><strong>실적 산정월:</strong> ${d.performanceReferenceMonthForDisplay || perfMonth}</p> <p><strong>현재 사용액(실적):</strong> ${perfAmt.toLocaleString()}원</p> <p><strong>실적 목표 금액:</strong> ${targetAmt.toLocaleString()}원</p> <p><strong>달성률:</strong> ${rate}</p> <p style="font-size:0.8em;color:grey;">(실적은 카드사의 실제 집계와 다를 수 있습니다)</p>`;
    } catch (error) {
        det.innerHTML = '<p>카드 데이터를 불러오는 데 실패했습니다.</p>';
        console.error('displayCardData API call failed:', error);
    } finally {
        if(loader) loader.style.display = 'none';
    }
}


/* === 검색 탭 관련 함수들 === */

async function handleSearch() {
    const query = document.getElementById('searchInput').value.trim();
    const startMonth = document.getElementById('startMonth').value;
    const endMonth = document.getElementById('endMonth').value;
    const resultsDiv = document.getElementById('searchResults');
    const loader = document.getElementById('loader');

    resultsDiv.innerHTML = '';
    if (loader) loader.style.display = 'block';
    showToast('데이터를 검색 중입니다...');

    try {
        const results = await callApi('/search', 'GET', { 
            query: query, 
            startMonth: startMonth, 
            endMonth: endMonth 
        });
        renderSearchResults(results);
    } catch (error) {
        console.error('Search failed:', error);
        resultsDiv.innerHTML = `<p style="text-align: center; color: red;">검색 중 오류가 발생했습니다.</p>`;
        showToast(`검색 오류: ${error.message}`, true);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

function renderSearchResults(transactions) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '';

    if (!transactions || transactions.length === 0) {
        resultsDiv.innerHTML = '<p style="text-align: center; color: #888;">검색 결과가 없습니다.</p>';
        showToast('일치하는 검색 결과가 없습니다.', true);
        return;
    }

    const summary = document.createElement('p');
    summary.style.textAlign = 'center';
    summary.style.marginBottom = '20px';
    summary.innerHTML = `<strong>총 ${transactions.length}건</strong>의 거래 내역을 찾았습니다.`;
    resultsDiv.appendChild(summary);

    const fragment = document.createDocumentFragment();
    transactions.forEach(t => {
        if (!t || typeof t.Type === 'undefined') return;
        const item = document.createElement('div');
        item.className = `transaction-item ${t.Type === '수입' ? 'income' : 'expense'}`;
        
        let txt = `[${t.Date}] [${t.Type}] ${t.Content || '(내용 없음)'}: ${Number(t.Amount || 0).toLocaleString()}원`;
        if (t.Type === '지출') {
            if (t.PaymentMethod) txt += ` (${t.PaymentMethod})`;
            if (t.Category1) txt += ` - ${t.Category1}`;
            if (t.Category2) txt += ` / ${t.Category2}`;
        } else {
            if (t.Category1) txt += ` - ${t.Category1}`;
        }
        
        item.textContent = txt;
        item.style.cursor = 'pointer';
        item.title = '클릭하여 이 내용 수정하기';
        item.addEventListener('click', function() {
            populateFormForEdit(t);
        });
        fragment.appendChild(item);
    });
    resultsDiv.appendChild(fragment);
}

