/* === 전역 상태 === */
let currentDisplayDate = new Date();
let currentCycleMonth = '';
let cardPerformanceMonthDate = new Date();
let expenseCategoriesData = {};
let paymentMethodsData = [];
let incomeSourcesData = [];
const transactionsCache = {}; // 이 변수는 현재 코드에서 사용되지 않는 것 같지만, 일단 유지합니다.
let currentEditingTransaction = null;

/* === 뷰포트 높이 CSS 변수 갱신 === */
function setViewportHeightVar(){
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h}px`);
}
['load','resize','orientationchange'].forEach(evt => window.addEventListener(evt, setViewportHeightVar));
setViewportHeightVar(); // 초기 실행

/* === 달력 행 높이 동적 계산 (CSS vh로 주로 제어되므로 역할 축소 또는 제거 고려) === */
function adjustCalendarHeight(){
  // CSS에서 vh 단위로 높이를 제어하므로 이 함수의 필요성이 크게 줄었습니다.
}
// afterRender 함수는 현재 호출되지 않으므로 주석 처리하거나 필요시 사용합니다.
// function afterRender(){ setTimeout(adjustCalendarHeight, 0); } 
['resize','orientationchange'].forEach(evt => window.addEventListener(evt, () => {
  setViewportHeightVar();
  adjustCalendarHeight();
}));

/* === 페이지 로드 순서 === */
window.onload = () => {
  determineInitialCycleMonth();
  setupEventListeners();
  updateCalendarDisplay(); // 최초 달력 데이터 로드
  loadInitialData();      // 카테고리 등 초기 설정 데이터 로드
  showView('calendarView'); // 기본 뷰 설정
  toggleTypeSpecificFields(); // 수입/지출 필드 초기 상태 설정
  const transactionModal = document.getElementById('transactionModal');
  if (transactionModal) {
    transactionModal.style.display = 'none'; // 모달 초기 숨김 확실히
  }

  // 서비스 워커 등록 (GitHub Pages용으로 수정됨)
  if ('serviceWorker' in navigator) {
    // sw.js 파일이 index.html과 같은 루트에 있다고 가정하고 등록합니다.
    // GitHub Pages 저장소 이름이 'my-repo'라면, 실제 경로는 'https://username.github.io/my-repo/sw.js'가 됩니다.
    // scope는 서비스 워커가 제어할 범위를 나타냅니다. './'는 현재 디렉토리 및 하위를 의미합니다.
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
}

function changeMonth(delta){
  currentDisplayDate.setMonth(currentDisplayDate.getMonth() + delta);
  const y = currentDisplayDate.getFullYear();
  const m = currentDisplayDate.getMonth();
  currentCycleMonth = `${y}-${String(m + 1).padStart(2,'0')}`;
  updateCalendarDisplay();
}

function updateCalendarDisplay() {
  const loader = document.getElementById('loader');
  const calendarBody = document.getElementById('calendarBody');

  if (!calendarBody) {
    console.error("calendarBody 요소를 찾을 수 없습니다.");
    return;
  }
  if(loader) loader.style.display = 'block';
  calendarBody.innerHTML = ''; // 이전 내용 초기화

  // !! 중요 !!
  // google.script.run은 GitHub Pages와 같은 외부 호스팅 환경에서는 직접 작동하지 않습니다.
  // 이 부분은 나중에 Apps Script를 API로 사용하고 fetch로 호출하는 방식으로 변경해야 합니다.
  // 지금은 일단 주석 처리하거나, 작동하지 않을 것을 예상하고 두어야 합니다.
  // 테스트를 위해 임시로 빈 데이터를 반환하도록 할 수 있습니다.
  console.warn("updateCalendarDisplay: google.script.run.getTransactions 호출은 외부 호스팅에서 수정 필요합니다. 임시로 빈 데이터를 사용합니다.");
  renderCalendarAndSummary([]); // 임시로 빈 데이터로 달력 그림
  if(loader) loader.style.display = 'none'; // 로더 숨김
  
  /* // 기존 google.script.run 호출 부분 (나중에 수정 필요)
  const cachedData = localStorage.getItem('transactions_' + currentCycleMonth);
  if (cachedData) {
    console.log('Rendering calendar from localStorage cache for cycle:', currentCycleMonth);
    const transactions = JSON.parse(cachedData);
    renderCalendarAndSummary(transactions);
    if(loader) loader.style.display = 'none';

    google.script.run
      .withSuccessHandler(freshData => {
        console.log('Background cache has been updated for cycle:', currentCycleMonth);
        localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(freshData.result || []));
      })
      .withFailureHandler(err => {
         console.error('Background getTransactions 실패 for cycle:', currentCycleMonth, err);
      })
      .getTransactions(currentCycleMonth);
  } else {
    if(loader) loader.style.display = 'block';
    calendarBody.innerHTML = ''; 

    google.script.run
      .withSuccessHandler(response => {
        const transactions = Array.isArray(response.result) ? response.result : [];
        localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(transactions));
        renderCalendarAndSummary(transactions);
        if(loader) loader.style.display = 'none';
      })
      .withFailureHandler(err => {
        console.error('getTransactions 실패 for cycle:', currentCycleMonth, err);
        showToast('거래 내역을 불러오는 데 실패했습니다.', true);
        if(loader) loader.style.display = 'none';
        renderCalendarAndSummary([]);
      })
      .getTransactions(currentCycleMonth);
  }
  */
}

function renderCalendarAndSummary(transactions){
  const year = parseInt(currentCycleMonth.split('-')[0], 10);
  const month = parseInt(currentCycleMonth.split('-')[1], 10);
  const currentMonthYearEl = document.getElementById('currentMonthYear');
  if (currentMonthYearEl) {
    currentMonthYearEl.textContent = `${year}년 ${String(month).padStart(2,'0')}월 주기`;
  }
  renderCalendar(year, month, transactions);
  updateSummary(transactions);
}

function renderCalendar(year, monthOneBased, transactions){
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) return;
  calendarBody.innerHTML = '';
  const transMap = {};
  (transactions||[]).forEach(t=>{
    if (t && t.date) { // t와 t.date가 유효한지 확인
      (transMap[t.date] = transMap[t.date] || []).push(t);
    }
  });

  const cycleStart = new Date(year, monthOneBased - 1, 18);
  const cycleEnd = new Date(year, monthOneBased, 17);
  let curDate = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  const frag = document.createDocumentFragment();
  
  // 시작일의 요일(0=일요일)에 따라 첫 주 빈 칸 채우기
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
      if (t && typeof t.amount !== 'undefined') { // t와 t.amount가 유효한지 확인
        const div = document.createElement('div');
        div.className = `transaction-item ${t.type==='수입'?'income':'expense'}`;
        div.textContent = `${Number(t.amount).toLocaleString()}원`;
        td.appendChild(div);
      }
    });

    weekRow.appendChild(td);
    // 한 주의 마지막 날이거나(토요일) 주기의 마지막 날이면 행을 추가하고 새 행 시작
    if(curDate.getDay() === 6 || curDate.getTime() === cycleEnd.getTime()){
      // 주기의 마지막 날인데 토요일이 아니면, 남은 요일 빈 칸 채우기
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
  // 마지막 주가 7일 미만으로 채워졌다면 빈 칸 추가 (이 로직은 이미 위에서 처리됨)
  // if (weekRow.children.length > 0 && weekRow.children.length < 7) {
  //   for (let i = weekRow.children.length; i < 7; i++) {
  //     const td = document.createElement('td'); td.className = 'other-month'; weekRow.appendChild(td);
  //   }
  //   frag.appendChild(weekRow);
  // } else if (weekRow.children.length === 7 && frag.lastChild !== weekRow && curDate > cycleEnd) { 
  //   // 이 조건은 curDate가 cycleEnd를 초과한 후 마지막 주가 정확히 7개일때를 의미, 이미 위에서 추가됨
  //   // frag.appendChild(weekRow); 
  // }
  calendarBody.appendChild(frag);
  afterRender(); // adjustCalendarHeight 호출
}

function updateSummary(transactions){
  let inc = 0, exp = 0;
  (transactions||[]).forEach(t => {
    if (t && typeof t.amount !== 'undefined') { // t와 t.amount 유효성 검사
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
    if (bal < 0) balEl.classList.add('negative');
    else balEl.classList.remove('negative');
  }
}

/* === 설정 데이터 === */
function loadInitialData() {
  // !! 중요 !!
  // google.script.run은 외부 호스팅에서 수정 필요. 임시로 빈 데이터 또는 기본값 사용.
  console.warn("loadInitialData: google.script.run.getAppSetupData 호출은 외부 호스팅에서 수정 필요합니다. 임시 데이터를 사용합니다.");
  expenseCategoriesData = {"생활용품": ["세제", "휴지"], "식비": ["점심", "저녁", "간식"]}; // 예시 데이터
  paymentMethodsData = [{name: "현대카드", isCard: true, target: 500000}, {name: "국민카드", isCard: true, target: 300000}, {name: "현금", isCard: false}]; // 예시 데이터
  incomeSourcesData = ["월급", "부수입"]; // 예시 데이터
  populateFormDropdowns();
  populateCardSelector();
  displayCardData(); // 카드가 선택되어 있다면 데이터를 바로 표시하도록 추가

  /* // 기존 google.script.run 호출 부분 (나중에 수정 필요)
  google.script.run
    .withSuccessHandler(setup => {
      if (setup.error) { showToast('설정 데이터를 불러오지 못했습니다: ' + setup.error, true); return; }
      expenseCategoriesData = setup.expenseCategories || {};
      paymentMethodsData    = setup.paymentMethods    || [];
      incomeSourcesData     = setup.incomeSources     || [];
      populateFormDropdowns();
      populateCardSelector();
      displayCardData(); // 로드 후 카드 데이터 표시
    })
    .withFailureHandler(err => {
      console.error('getAppSetupData 실패', err);
      showToast('설정 데이터를 불러오지 못했습니다.', true);
    })
    .getAppSetupData();
  */
}

/* === 입력·폼 === */
function setupEventListeners() {
  const transactionForm = document.getElementById('transactionForm');
  if (transactionForm) {
    transactionForm.addEventListener('submit', handleTransactionSubmit);
  }
  // 기타 이벤트 리스너 (탭 버튼, 월 이동 버튼 등)는 HTML onclick에서 직접 호출되므로 여기서는 생략.
  // 만약 프로그래매틱하게 추가해야 할 리스너가 있다면 여기에 추가.
}

function toggleTypeSpecificFields() {
  const typeRadio = document.querySelector('input[name="type"]:checked');
  if (!typeRadio) return;
  const type = typeRadio.value;
  const expenseFields = document.getElementById('expenseSpecificFields');
  const incomeFields = document.getElementById('incomeSpecificFields');
  if (expenseFields) expenseFields.style.display = type === '지출' ? 'block' : 'none';
  if (incomeFields) incomeFields.style.display  = type === '수입' ? 'block' : 'none';
}

function populateFormDropdowns() {
  const pm = document.getElementById('paymentMethod');
  if (pm) {
    pm.innerHTML = '<option value="">선택하세요</option>';
    (paymentMethodsData||[]).forEach(m=>{ const o=document.createElement('option'); o.value=o.textContent=m.name; pm.appendChild(o); });
  }

  const mainSel = document.getElementById('mainCategory');
  if (mainSel) {
    mainSel.innerHTML = '<option value="">선택하세요</option>';
    for (const k in expenseCategoriesData) { const o=document.createElement('option'); o.value=o.textContent=k; mainSel.appendChild(o); }
    updateSubCategories(); // 주 카테고리 로드 후 하위 카테고리 업데이트
  }
  
  const incSel = document.getElementById('incomeSource');
  if (incSel) {
    incSel.innerHTML='<option value="">선택하세요</option>';
    (incomeSourcesData||[]).forEach(s=>{ const o=document.createElement('option'); o.value=o.textContent=s; incSel.appendChild(o); });
  }
}

function updateSubCategories() {
  const mainCategorySelect = document.getElementById('mainCategory');
  const subCategorySelect = document.getElementById('subCategory');
  if (!mainCategorySelect || !subCategorySelect) return;

  const mainCategoryValue = mainCategorySelect.value;
  subCategorySelect.innerHTML = '<option value="">선택하세요</option>'; // Clear previous options
  
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
function handleTransactionSubmit(e) {
  e.preventDefault();
  
  const form = e.target;
  const fd = new FormData(form);
  const transactionData = {};
  fd.forEach((v, k) => transactionData[k] = v);

  // UI 즉시 업데이트 (Optimistic Update)
  const isEditing = currentEditingTransaction && typeof currentEditingTransaction.row !== 'undefined';
  const originalData = JSON.parse(localStorage.getItem('transactions_' + currentCycleMonth) || '[]');
  let optimisticData = JSON.parse(JSON.stringify(originalData)); // Deep copy

  if (isEditing) {
    const index = optimisticData.findIndex(t => t && typeof t.row !== 'undefined' && t.row.toString() === currentEditingTransaction.row.toString());
    if (index > -1) {
      const updatedItem = { ...optimisticData[index], ...transactionData };
      if (updatedItem.type === '수입') {
        updatedItem.category1 = transactionData.incomeSource || ''; // FormData에서 직접 가져옴
        updatedItem.category2 = '';
        delete updatedItem.mainCategory; delete updatedItem.subCategory; delete updatedItem.paymentMethod;
      } else { // 지출
        updatedItem.category1 = transactionData.mainCategory || ''; // FormData에서 직접 가져옴
        updatedItem.category2 = transactionData.subCategory || '';  // FormData에서 직접 가져옴
        updatedItem.paymentMethod = transactionData.paymentMethod || ''; // FormData에서 직접 가져옴
        delete updatedItem.incomeSource;
      }
      optimisticData[index] = updatedItem;
    }
  } else {
    const newItem = { ...transactionData, row: `temp-${Date.now()}` }; // 임시 ID
    if (newItem.type === '수입') {
      newItem.category1 = transactionData.incomeSource || '';
      newItem.category2 = '';
    } else { // 지출
      newItem.category1 = transactionData.mainCategory || '';
      newItem.category2 = transactionData.subCategory || '';
      // newItem.paymentMethod는 FormData에서 이미 포함됨
    }
    optimisticData.push(newItem);
  }
  
  localStorage.setItem('transactions_' + currentCycleMonth, JSON.stringify(optimisticData));
  renderCalendarAndSummary(optimisticData);
  showToast(isEditing ? '수정 사항을 서버에 전송 중...' : '저장 사항을 서버에 전송 중...');
  closeModal();

  // !! 중요 !!
  // google.script.run은 외부 호스팅에서 수정 필요.
  console.warn("handleTransactionSubmit: google.script.run 호출은 외부 호스팅에서 수정 필요합니다.");
  // 성공/실패 시 UI 롤백 로직은 일단 유지. 실제 서버 호출은 나중에 구현.
  if (isEditing) {
    transactionData.id_to_update = currentEditingTransaction.row; // 실제 ID 전달
    // google.script.run.withSuccessHandler(res => { ... }).updateTransaction(transactionData);
    console.log("수정 데이터 (서버 전송 대기):", transactionData);
    // 임시로 성공 처리 후 캐시만 업데이트하는 것처럼
    setTimeout(() => { 
        showToast('수정 완료 (실제 서버 연동 필요)', false);
        // 실제로는 서버에서 최신 데이터를 다시 받아와야 함
        // google.script.run.getTransactions(currentCycleMonth)...
    }, 1000);

  } else {
    // google.script.run.withSuccessHandler(res => { ... }).addTransaction(transactionData);
    console.log("추가 데이터 (서버 전송 대기):", transactionData);
    // 임시로 성공 처리 후 캐시만 업데이트하는 것처럼
    setTimeout(() => {
        showToast('저장 완료 (실제 서버 연동 필요)', false);
        // 실제로는 서버에서 최신 데이터를 다시 받아와야 함
        // google.script.run.getTransactions(currentCycleMonth)...
    }, 1000);
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
  
  toggleTypeSpecificFields(); // 라디오 버튼 기본값에 따라 필드 표시
  
  const dailyList = document.getElementById('dailyTransactionList');
  const dailySection = document.getElementById('dailyTransactions');
  const toggleBtn = document.getElementById('toggleDailyTransactions');
  
  if (dailyList) dailyList.innerHTML = '불러오는 중...';
  if (dailySection) dailySection.style.display = 'none'; 
  if (toggleBtn) toggleBtn.textContent = '거래 내역 보기';

  const transactionModal = document.getElementById('transactionModal');
  if (transactionModal) transactionModal.style.display = 'flex'; 
  
  loadDailyTransactions(dateStr); 
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

    // "거래 내역 숨기기" 시 폼 초기화 (날짜는 보존)
    const preservedDate = document.getElementById('transactionDate').value;
    const transactionForm = document.getElementById('transactionForm');
    if (transactionForm) transactionForm.reset();
    const transactionDateInput = document.getElementById('transactionDate');
    if (transactionDateInput) transactionDateInput.value = preservedDate;

    const modalTitle = document.getElementById('modalTitle');
    if (modalTitle) modalTitle.textContent = '거래 추가';
    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) deleteBtn.style.display = 'none';
    currentEditingTransaction = null;
    toggleTypeSpecificFields();
  }
}

function loadDailyTransactions(dateStr) {
  const list = document.getElementById('dailyTransactionList');
  // const dailySection = document.getElementById('dailyTransactions'); // 현재 사용 안함
  if (!list) return;

  list.textContent = '불러오는 중...';

  // !! 중요 !!
  // google.script.run은 외부 호스팅에서 수정 필요. 임시 데이터 사용.
  console.warn("loadDailyTransactions: google.script.run.getTransactionsByDate 호출은 외부 호스팅에서 수정 필요합니다.");
  const exampleTransactions = [
    // {type: '지출', content: '점심식사', amount: 8000, paymentMethod: '현대카드', category1: '식비', category2: '점심', row: 1},
    // {type: '수입', content: '월급', amount: 2000000, category1: '월급', row: 2}
  ];
  // UI 테스트를 위해 빈 배열로 설정하거나, 위와 같이 샘플 데이터를 넣어볼 수 있습니다.
  setTimeout(() => displayDailyTransactions(exampleTransactions, dateStr), 500);

  /* // 기존 google.script.run 호출 부분
  google.script.run
    .withSuccessHandler(function(arr) {
      displayDailyTransactions(arr, dateStr);
    })
    .withFailureHandler(function(err) {
      console.error("getTransactionsByDate 실패:", err);
      if (list) list.textContent = '거래 내역을 불러오는 중 오류가 발생했습니다.';
    })
    .getTransactionsByDate(dateStr);
  */
}

function displayDailyTransactions(arr, dateStr) { // loadDailyTransactions의 콜백으로 분리
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;

  if (arr && arr.error) {
    list.textContent = '내역을 불러오는 중 오류: ' + arr.error;
    return;
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    list.textContent = '해당 날짜의 거래 내역이 없습니다.';
    return;
  }

  list.innerHTML = '';
  arr.forEach(function(t) {
    if (!t || typeof t.type === 'undefined') return; // 데이터 유효성 검사

    const d = document.createElement('div');
    d.classList.add(
      'transaction-item',
      t.type === '수입' ? 'income' : 'expense'
    );
    
    let txt = `[${t.type}] ${t.content || '(내용 없음)'}: ${Number(t.amount || 0).toLocaleString()}원`;
    if (t.type === '지출' && t.paymentMethod) txt += ` (${t.paymentMethod})`;
    if (t.category1) txt += ` - ${t.category1}`;
    if (t.category2) txt += ` / ${t.category2}`;
    d.textContent = txt;
    d.style.cursor = 'pointer';
    d.title = '클릭하여 이 내용 수정하기';
    
    d.addEventListener('click', function() {
      populateFormForEdit(t); // 여기서 t는 서버에서 받아온 전체 객체
    });
    list.appendChild(d);
  });
}


function populateFormForEdit(transaction) {
  if (!transaction || typeof transaction.row === 'undefined') {
    console.error('populateFormForEdit: 전달된 거래 객체에 row 필드가 없습니다.', transaction);
    showToast('거래 정보를 불러오지 못했습니다. (ID 누락)', true);
    return;
  }

  currentEditingTransaction = transaction; 
  const transactionForm = document.getElementById('transactionForm');
  if (transactionForm) transactionForm.reset();
  
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = '거래 수정';

  // 공통 입력값
  const dateInput = document.getElementById('transactionDate');
  const amountInput = document.getElementById('transactionAmount');
  const contentInput = document.getElementById('transactionContent');

  if (dateInput) dateInput.value = transaction.date || '';
  if (amountInput) amountInput.value = transaction.amount || '';
  if (contentInput) contentInput.value = transaction.content || '';

  // 유형 라디오
  document.querySelectorAll('input[name="type"]').forEach(r => {
    r.checked = (r.value === transaction.type);
  });
  toggleTypeSpecificFields(); // 유형에 따라 관련 필드 표시/숨김

  if (transaction.type === '지출') {
    const paymentMethodSelect = document.getElementById('paymentMethod');
    const mainCategorySelect = document.getElementById('mainCategory');
    const subCategorySelect = document.getElementById('subCategory');

    if (paymentMethodSelect) paymentMethodSelect.value = transaction.paymentMethod || '';
    if (mainCategorySelect) mainCategorySelect.value = transaction.category1 || '';
    updateSubCategories(); // 주 카테고리 변경에 따른 하위 카테고리 업데이트
    if (subCategorySelect) subCategorySelect.value = transaction.category2 || '';
  } else { // 수입
    const incomeSourceSelect = document.getElementById('incomeSource');
    if (incomeSourceSelect) incomeSourceSelect.value = transaction.category1 || ''; // 수입에서는 category1을 수입원으로 사용
  }

  const deleteBtn = document.getElementById('deleteBtn');
  if (deleteBtn) deleteBtn.style.display = 'block'; // 수정 모드이므로 삭제 버튼 표시
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
    cardPerformanceMonthDate = new Date(); // 카드 뷰를 열 때마다 현재 달로 초기화
    // populateCardSelector(); // 카테고리 등 초기 데이터 로드 시 이미 호출됨
    displayCardData(); // 카드 선택기가 변경되지 않아도 데이터를 표시하도록
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
    const o=document.createElement('option'); o.value=o.textContent=c.name; sel.appendChild(o);
  });
  if (currentCard && sel.querySelector(`option[value="${currentCard}"]`)) {
    sel.value = currentCard; 
  } else if (sel.options.length > 1) {
    // sel.value = sel.options[1].value; // 카드가 있다면 첫번째 카드를 자동으로 선택 (선택사항)
  }
}

function changeCardMonth(d){ 
  cardPerformanceMonthDate.setMonth(cardPerformanceMonthDate.getMonth()+d); 
  displayCardData(); 
}

function displayCardData(){
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

  // !! 중요 !!
  // google.script.run은 외부 호스팅에서 수정 필요. 임시 데이터 또는 UI 표시.
  console.warn("displayCardData: google.script.run.getCardData 호출은 외부 호스팅에서 수정 필요합니다.");
  det.innerHTML = `<p>${card} 카드 데이터를 불러오는 중... (서버 연동 필요)</p>`;
  if(loader) loader.style.display = 'none';

  /* // 기존 google.script.run 호출 부분
  google.script.run
    .withSuccessHandler(d => {
      if(loader) loader.style.display = 'none';
      if (!d || d.error){
        det.innerHTML = `<p>${d ? d.error : '카드 데이터 오류'}</p>`;
        return;
      }
      const billingMonth = d.cycleMonthForBilling || d.billingCycleMonthForCard || '확인 필요';
      const perfRefMonth = d.actualCurrentCalendarMonth || d.performanceReferenceMonth || perfMonth;
      const billingAmt = Number(d.billingAmount) || 0;
      const perfAmt = Number(d.performanceAmount) || 0;
      const targetAmt = Number(d.performanceTarget) || 0;
      const rate = targetAmt > 0 ? ((perfAmt/targetAmt)*100).toFixed(1)+'%' : '0%';

      det.innerHTML = `
        <h4>${d.cardName || card}</h4>
        <p><strong>청구 기준월:</strong> ${billingMonth} (18일~다음달 17일)</p>
        <p><strong>청구 예정 금액:</strong> ${billingAmt.toLocaleString()}원</p><hr>
        <p><strong>실적 산정월:</strong> ${perfRefMonth}</p>
        <p><strong>현재 사용액(실적):</strong> ${perfAmt.toLocaleString()}원</p>
        <p><strong>실적 목표 금액:</strong> ${targetAmt.toLocaleString()}원</p>
        <p><strong>달성률:</strong> ${rate}</p>
        <p style="font-size:0.8em;color:grey;">(실적은 카드사의 실제 집계와 다를 수 있습니다)</p>`;
    })
    .withFailureHandler(err => {
      if(loader) loader.style.display = 'none';
      det.innerHTML = '<p>카드 데이터를 불러오는 데 실패했습니다.</p>';
      console.error('getCardData 실패', err);
      showToast('카드 데이터 로드 중 오류가 발생했습니다.', true);
    })
    .getCardData(card, currentCycleMonth, perfMonth); // currentCycleMonth도 전달 (필요시 백엔드에서 사용)
  */
}

/* === 거래 삭제 === */
function handleDelete() {
  if (!currentEditingTransaction || typeof currentEditingTransaction.row === 'undefined') {
    showToast('삭제할 거래를 먼저 선택하거나, 유효한 거래가 아닙니다.', true);
    return;
  }

  const rowId = currentEditingTransaction.row; 
  const isTemp = typeof rowId === 'string' && rowId.startsWith('temp-');

  const key = 'transactions_' + currentCycleMonth;
  const originalData = JSON.parse(localStorage.getItem(key) || '[]');
  
  // 프런트 즉시 반영 (Optimistic Update)
  const filteredData = originalData.filter(t => t && typeof t.row !== 'undefined' && t.row.toString() !== rowId.toString());
  localStorage.setItem(key, JSON.stringify(filteredData));
  renderCalendarAndSummary(filteredData);
  closeModal();
  showToast(isTemp ? '임시 입력을 삭제했습니다.' : '삭제를 서버에 전송 중...');

  if (isTemp) return; // 임시 항목은 서버에 삭제 요청 불필요

  // !! 중요 !!
  // google.script.run은 외부 호스팅에서 수정 필요.
  console.warn("handleDelete: google.script.run.deleteTransaction 호출은 외부 호스팅에서 수정 필요합니다.");
  // 임시로 성공 처리
  setTimeout(() => {
    showToast('삭제 완료 (실제 서버 연동 필요)', false);
    // 실제로는 서버에서 최신 데이터를 다시 받아와야 함
    // google.script.run.getTransactions(currentCycleMonth)...
  }, 1000);

  /* // 기존 google.script.run 호출 부분
  google.script.run
    .withSuccessHandler(res => {
      if (!res || !res.success) {
        localStorage.setItem(key, JSON.stringify(originalData)); // 실패 시 롤백
        renderCalendarAndSummary(originalData);
        showToast(res?.message || '삭제 실패!', true);
      } else {
        showToast('삭제 완료!');
        // 성공 시 이미 localStorage는 업데이트 되었으므로, 화면만 최신 상태임.
        // 필요하다면 여기서 getTransactions를 다시 호출하여 서버와 완벽 동기화.
      }
    })
    .withFailureHandler(err => {
      localStorage.setItem(key, JSON.stringify(originalData)); // 실패 시 롤백
      renderCalendarAndSummary(originalData);
      showToast('삭제 실패! 네트워크를 확인하세요.', true);
      console.error('deleteTransaction 실패:', err);
    })
    .deleteTransaction(Number(rowId)); // rowId는 실제 시트 행 번호여야 함
  */
}