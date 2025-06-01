// app.js - 오류 수정된 최종 버전
const EXPENSE_CATEGORIES_CACHE_KEY = 'expenseCategoriesCache_v2';
const PAYMENT_METHODS_CACHE_KEY = 'paymentMethodsCache_v2';
const INCOME_SOURCES_CACHE_KEY = 'incomeSourcesCache_v2';
const CACHE_EXPIRY_TIME = 5 * 60 * 1000; // 5분
const API_RETRY_COUNT = 3;
const API_RETRY_DELAY = 1000;

const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjP671pu6MMLKhmTXHwqCu-wci-Y-RM0Sl5TlQO0HmGsyrH83DBj6dsh62LqHIf-YD/exec";

/* === 전역 상태 관리 === */
const AppState = {
  currentDisplayDate: new Date(),
  currentCycleMonth: '',
  cardPerformanceMonthDate: new Date(),
  expenseCategoriesData: {},
  paymentMethodsData: [],
  incomeSourcesData: [],
  currentEditingTransaction: null,
  isOnline: navigator.onLine,
  pendingRequests: new Map(),
  memoryCache: new Map(),
  initialDataLoaded: false,
  currentTransactions: []
};

/* === 유틸리티 함수들 === */
const Utils = {
  // 배열 검증 헬퍼
  ensureArray(data) {
    if (Array.isArray(data)) return data;
    if (data === null || data === undefined) return [];
    console.warn('[Utils.ensureArray] 배열이 아닌 데이터를 배열로 변환:', typeof data, data);
    return [];
  },

  // 개선된 메모이제이션 헬퍼
  memoize(fn, ttl = 60000) {
    const cache = new Map();
    const memoized = (...args) => {
      const key = JSON.stringify(args);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.value;
      }
      const result = fn.apply(this, args);
      cache.set(key, { value: result, timestamp: Date.now() });
      setTimeout(() => cache.delete(key), ttl);
      return result;
    };
    memoized.cache = cache;
    memoized.clearCache = (specificKey = null) => {
      if (specificKey) {
        cache.delete(JSON.stringify([specificKey]));
      } else {
        cache.clear();
      }
    };
    return memoized;
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  getCachedData(key) {
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_EXPIRY_TIME) {
          return data;
        }
        localStorage.removeItem(key);
      }
    } catch (e) {
      console.error('Cache retrieval error:', e);
      localStorage.removeItem(key);
    }
    return null;
  },

  setCachedData(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.error('Cache storage error:', e);
    }
  },

  getMemoryCache(key) {
    const cached = AppState.memoryCache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data;
    }
    AppState.memoryCache.delete(key);
    return null;
  },

  setMemoryCache(key, data, ttl = 60000) {
    AppState.memoryCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }
};

/* === 향상된 API 호출 (POST 지원 추가) === */
async function callAppsScriptApi(actionName, params = {}, retryCount = 0, usePost = false) {
  const requestKey = `${actionName}_${JSON.stringify(params)}_${usePost}`;
  
  if (AppState.pendingRequests.has(requestKey)) {
    return AppState.pendingRequests.get(requestKey);
  }

  console.log(`[API] Calling: ${actionName} (attempt ${retryCount + 1}, method: ${usePost ? 'POST' : 'GET'})`);

  const requestPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15초 타임아웃

      let response;
      
      if (usePost) {
        // POST 방식
        const formData = new FormData();
        formData.append('action', actionName);
        for (const key in params) {
          formData.append(key, params[key]);
        }

        response = await fetch(APPS_SCRIPT_API_ENDPOINT, { 
          method: 'POST',
          body: formData,
          signal: controller.signal,
          keepalive: true
        });
      } else {
        // GET 방식
        const url = new URL(APPS_SCRIPT_API_ENDPOINT);
        url.searchParams.append('action', actionName);
        for (const key in params) {
          url.searchParams.append(key, params[key]);
        }

        response = await fetch(url.toString(), { 
          method: 'GET',
          signal: controller.signal,
          keepalive: true
        });
      }
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success === false) {
        throw new Error(result.error || `API 요청 실패: ${actionName}`);
      }

      return result.data !== undefined ? result.data : result;

    } catch (error) {
      if (retryCount < API_RETRY_COUNT && error.name !== 'AbortError') {
        console.log(`[API] Retrying ${actionName} in ${API_RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, API_RETRY_DELAY));
        return callAppsScriptApi(actionName, params, retryCount + 1, usePost);
      }
      
      console.error(`[API] Failed after ${retryCount + 1} attempts:`, error);
      if (typeof showToast === 'function') {
        showToast(`API 요청 실패: ${error.message}`, true);
      }
      throw error;
    } finally {
      AppState.pendingRequests.delete(requestKey);
    }
  })();

  AppState.pendingRequests.set(requestKey, requestPromise);
  return requestPromise;
}

// 배치 API 호출
async function callBatchApi(requests) {
  try {
    const batchData = await callAppsScriptApi('getBatchData', {
      requests: JSON.stringify(requests)
    }, 0, true); // POST 방식 사용
    return batchData;
  } catch (error) {
    console.error('Batch API call failed, falling back to individual calls:', error);
    const results = {};
    
    // 개별 호출 시 병렬 처리 및 에러 처리 개선
    const individualPromises = Object.entries(requests).map(async ([key, { action, params }]) => {
      try {
        const result = await callAppsScriptApi(action, params, 0, false); // GET 방식으로 폴백
        return { key, result, success: true };
      } catch (err) {
        console.error(`Individual API call failed for ${key}:`, err);
        return { key, result: { error: err.message }, success: false };
      }
    });
    
    const individualResults = await Promise.allSettled(individualPromises);
    
    individualResults.forEach(({ status, value }) => {
      if (status === 'fulfilled' && value) {
        results[value.key] = value.result;
      }
    });
    
    return results;
  }
}

/* === 뷰포트 최적화 === */
function setViewportHeightVar() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h}px`);
}

const debouncedViewportUpdate = Utils.debounce(setViewportHeightVar, 100);
['load', 'resize', 'orientationchange'].forEach(evt => 
  window.addEventListener(evt, debouncedViewportUpdate)
);
setViewportHeightVar();

/* === 온라인/오프라인 상태 관리 === */
window.addEventListener('online', () => {
  AppState.isOnline = true;
  showToast('연결이 복구되었습니다. 동기화 중...', false);
  syncPendingChanges();
});

window.addEventListener('offline', () => {
  AppState.isOnline = false;
  showToast('오프라인 모드입니다.', true);
});

async function syncPendingChanges() {
  const pendingChanges = Utils.getCachedData('pendingChanges');
  if (pendingChanges && pendingChanges.length > 0) {
    for (const change of pendingChanges) {
      try {
        await callAppsScriptApi(change.action, change.params, 0, true);
      } catch (error) {
        console.error('Sync failed for:', change, error);
      }
    }
    localStorage.removeItem('pendingChanges');
  }
}

/* === 개선된 앱 초기화 === */
window.onload = async () => {
  console.log("[App] Initializing application...");
  
  try {
    determineInitialCycleMonth();
    setupEventListeners();
    showLoadingState(true);

    // 통합된 초기 데이터 로드
    await loadInitialDataOptimizedIntegrated();
    
    showView('calendarView');
    toggleTypeSpecificFields();
    
    const transactionModal = document.getElementById('transactionModal');
    if (transactionModal) {
      transactionModal.style.display = 'none';
    }

    registerServiceWorker();
    showToast('앱이 성공적으로 로드되었습니다.', false);

  } catch (error) {
    console.error('[App] Initialization failed:', error);
    showToast('앱 초기화 중 오류가 발생했습니다.', true);
  } finally {
    showLoadingState(false);
  }
};

/* === 통합된 초기 데이터 로딩 === */
async function loadInitialDataOptimizedIntegrated() {
  console.log("[App] Loading initial data with integrated approach...");
  
  // 1. 캐시에서 먼저 로드
  const cachedData = loadFromCache();
  const cachedTransactions = Utils.getCachedData('transactions_' + AppState.currentCycleMonth);
  
  if (cachedData.hasAllData) {
    console.log('[App] Applying cached setup data');
    applyDataToState(cachedData);
    renderSetupUI();
  }
  
  // ⚠️ 수정: 배열 검증 추가
  const validTransactions = Utils.ensureArray(cachedTransactions);
  if (validTransactions.length > 0) {
    console.log('[App] Applying cached transactions');
    AppState.currentTransactions = validTransactions;
    renderCalendarAndSummaryOptimized(validTransactions);
  } else {
    console.log('[App] No valid cached transactions, showing empty calendar');
    AppState.currentTransactions = [];
    renderCalendarAndSummaryOptimized([]);
  }

  // 2. 백그라운드에서 모든 데이터를 한 번에 로드
  try {
    const freshData = await callBatchApi({
      setupData: { 
        action: 'getAppSetupData', 
        params: { initialCycleMonth: AppState.currentCycleMonth } 
      },
      transactions: { 
        action: 'getTransactions', 
        params: { cycleMonth: AppState.currentCycleMonth } 
      }
    });

    let hasSetupChanges = false;
    let hasTransactionChanges = false;

    // 설정 데이터 처리
    if (freshData.setupData && !freshData.setupData.error) {
      hasSetupChanges = updateDataIfChanged(freshData.setupData);
      if (hasSetupChanges || !cachedData.hasAllData) {
        renderSetupUI();
        if (hasSetupChanges) {
          showToast('설정 데이터가 업데이트되었습니다.', false);
        }
      }
    }

    // ⚠️ 수정: 거래내역 처리 시 배열 검증 강화
    if (freshData.transactions) {
      const freshTransactions = Utils.ensureArray(freshData.transactions);
      const cachedTransactionsArray = Utils.ensureArray(cachedTransactions);
      
      hasTransactionChanges = cachedTransactionsArray.length === 0 || 
        JSON.stringify(freshTransactions) !== JSON.stringify(cachedTransactionsArray);
      
      if (hasTransactionChanges) {
        console.log('[App] Updating transactions with fresh data');
        AppState.currentTransactions = freshTransactions;
        Utils.setCachedData('transactions_' + AppState.currentCycleMonth, freshTransactions);
        Utils.setMemoryCache('transactions_' + AppState.currentCycleMonth, freshTransactions);
        renderCalendarAndSummaryOptimized(freshTransactions);
        
        if (cachedTransactionsArray.length > 0) {
          showToast('달력이 최신 데이터로 업데이트되었습니다.', false);
        }
      }
    }

    AppState.initialDataLoaded = true;

    // 다음/이전 달 데이터 미리 로드
    preloadAdjacentMonthsData();

  } catch (error) {
    console.error('Integrated data load failed:', error);
    if (!cachedData.hasAllData && validTransactions.length === 0) {
      showToast('초기 데이터 로드에 실패했습니다.', true);
    }
  }
}

function loadFromCache() {
  const cachedCategories = Utils.getCachedData(EXPENSE_CATEGORIES_CACHE_KEY);
  const cachedMethods = Utils.getCachedData(PAYMENT_METHODS_CACHE_KEY);
  const cachedSources = Utils.getCachedData(INCOME_SOURCES_CACHE_KEY);

  return {
    expenseCategories: cachedCategories,
    paymentMethods: cachedMethods,
    incomeSources: cachedSources,
    hasAllData: !!(cachedCategories && cachedMethods && cachedSources)
  };
}

function applyDataToState(data) {
  if (data.expenseCategories) AppState.expenseCategoriesData = data.expenseCategories;
  if (data.paymentMethods) AppState.paymentMethodsData = data.paymentMethods;
  if (data.incomeSources) AppState.incomeSourcesData = data.incomeSources;
}

function updateDataIfChanged(freshData) {
  let hasChanges = false;

  if (freshData.expenseCategories && 
      JSON.stringify(AppState.expenseCategoriesData) !== JSON.stringify(freshData.expenseCategories)) {
    AppState.expenseCategoriesData = freshData.expenseCategories;
    Utils.setCachedData(EXPENSE_CATEGORIES_CACHE_KEY, freshData.expenseCategories);
    hasChanges = true;
  }

  if (freshData.paymentMethods && 
      JSON.stringify(AppState.paymentMethodsData) !== JSON.stringify(freshData.paymentMethods)) {
    AppState.paymentMethodsData = freshData.paymentMethods;
    Utils.setCachedData(PAYMENT_METHODS_CACHE_KEY, freshData.paymentMethods);
    hasChanges = true;
  }

  if (freshData.incomeSources && 
      JSON.stringify(AppState.incomeSourcesData) !== JSON.stringify(freshData.incomeSources)) {
    AppState.incomeSourcesData = freshData.incomeSources;
    Utils.setCachedData(INCOME_SOURCES_CACHE_KEY, freshData.incomeSources);
    hasChanges = true;
  }

  return hasChanges;
}

async function preloadAdjacentMonthsData() {
  const nextMonth = new Date(AppState.currentDisplayDate);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const prevMonth = new Date(AppState.currentDisplayDate);
  prevMonth.setMonth(prevMonth.getMonth() - 1);

  const nextCycleMonth = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  const prevCycleMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;

  try {
    await Promise.allSettled([
      callAppsScriptApi('getTransactions', { cycleMonth: nextCycleMonth }),
      callAppsScriptApi('getTransactions', { cycleMonth: prevCycleMonth })
    ]);
    console.log('[App] Adjacent months data preloaded');
  } catch (error) {
    console.log('[App] Preloading failed, but continuing...');
  }
}

/* === 개선된 달력 업데이트 === */
async function updateCalendarDisplayOptimized() {
  const calendarBody = document.getElementById('calendarBody');
  
  if (!calendarBody) {
    console.error("calendarBody element not found");
    return;
  }

  console.log("[App] Updating calendar display for:", AppState.currentCycleMonth);
  showLoadingState(true, 'calendar');

  // 1. 메모리 캐시 확인
  const memoryCached = Utils.getMemoryCache('transactions_' + AppState.currentCycleMonth);
  if (memoryCached) {
    const validMemoryTransactions = Utils.ensureArray(memoryCached);
    console.log('[App] Rendering from memory cache');
    AppState.currentTransactions = validMemoryTransactions;
    renderCalendarAndSummaryOptimized(validMemoryTransactions);
    showLoadingState(false, 'calendar');
    return;
  }

  // 2. localStorage 캐시 확인
  const cachedTransactions = Utils.getCachedData('transactions_' + AppState.currentCycleMonth);
  const validCachedTransactions = Utils.ensureArray(cachedTransactions);
  
  if (validCachedTransactions.length > 0) {
    console.log('[App] Rendering from localStorage cache');
    AppState.currentTransactions = validCachedTransactions;
    renderCalendarAndSummaryOptimized(validCachedTransactions);
    Utils.setMemoryCache('transactions_' + AppState.currentCycleMonth, validCachedTransactions);
  } else {
    console.log('[App] No cached transactions, showing empty calendar');
    AppState.currentTransactions = [];
    renderCalendarAndSummaryOptimized([]);
  }

  // 3. 백그라운드에서 최신 데이터 확인 (초기 로드 완료된 경우에만)
  if (AppState.initialDataLoaded) {
    try {
      const latestTransactions = await callAppsScriptApi('getTransactions', { 
        cycleMonth: AppState.currentCycleMonth 
      });

      const validLatestTransactions = Utils.ensureArray(latestTransactions);
      
      const hasChanges = validCachedTransactions.length === 0 || 
        JSON.stringify(validLatestTransactions) !== JSON.stringify(validCachedTransactions);

      if (hasChanges) {
        console.log('[App] Updating with latest transactions from server');
        AppState.currentTransactions = validLatestTransactions;
        Utils.setCachedData('transactions_' + AppState.currentCycleMonth, validLatestTransactions);
        Utils.setMemoryCache('transactions_' + AppState.currentCycleMonth, validLatestTransactions);
        renderCalendarAndSummaryOptimized(validLatestTransactions);
        
        if (validCachedTransactions.length > 0) {
          showToast('달력이 최신 데이터로 업데이트되었습니다.', false);
        }
      }
    } catch (error) {
      console.error('Calendar data refresh failed:', error);
      if (validCachedTransactions.length === 0) {
        showToast('거래 내역을 불러오는데 실패했습니다.', true);
      }
    }
  }
  
  showLoadingState(false, 'calendar');
}

// ⚠️ 수정: 배열 검증이 포함된 달력 렌더링
function renderCalendarAndSummaryOptimized(transactions) {
  const validTransactions = Utils.ensureArray(transactions);
  console.log(`[renderCalendarAndSummaryOptimized] Processing ${validTransactions.length} transactions`);
  
  const year = parseInt(AppState.currentCycleMonth.split('-')[0], 10);
  const month = parseInt(AppState.currentCycleMonth.split('-')[1], 10);
  
  document.getElementById('currentMonthYear').textContent = 
    `${year}년 ${String(month).padStart(2,'0')}월 주기`;
    
  renderCalendarOptimized(year, month, validTransactions);
  updateSummaryOptimized(validTransactions);
}

// ⚠️ 수정: 배열 검증 강화된 달력 렌더링 함수
const renderCalendarOptimized = Utils.memoize(function(year, monthOneBased, transactions) {
  const validTransactions = Utils.ensureArray(transactions);
  console.log(`[renderCalendarOptimized] Rendering calendar with ${validTransactions.length} transactions`);
  
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) {
    console.error('[renderCalendarOptimized] calendarBody element not found');
    return;
  }
  
  const fragment = document.createDocumentFragment();
  
  const transMap = new Map();
  validTransactions.forEach(t => {
    if (t && t.date) {
      if (!transMap.has(t.date)) {
        transMap.set(t.date, []);
      }
      transMap.get(t.date).push(t);
    }
  });

  const cycleStart = new Date(year, monthOneBased - 1, 18);
  const cycleEnd = new Date(year, monthOneBased, 17);
  let curDate = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  
  const startDayOfWeek = cycleStart.getDay();

  for (let i = 0; i < startDayOfWeek; i++) {
    const td = document.createElement('td');
    td.className = 'other-month';
    weekRow.appendChild(td);
  }

  while (curDate <= cycleEnd) {
    const td = document.createElement('td');
    const dSpan = document.createElement('span');
    dSpan.className = 'date-number';
    dSpan.textContent = curDate.getDate();
    td.appendChild(dSpan);

    const dStr = `${curDate.getFullYear()}-${String(curDate.getMonth()+1).padStart(2,'0')}-${String(curDate.getDate()).padStart(2,'0')}`;
    td.dataset.date = dStr;
    td.className = 'calendar-date';
    
    const dayTransactions = transMap.get(dStr) || [];
    dayTransactions.forEach(t => {
      if (t && typeof t.amount !== 'undefined') {
        const div = document.createElement('div');
        div.className = `transaction-item ${t.type === '수입' ? 'income' : 'expense'}`;
        div.textContent = `${Number(t.amount).toLocaleString()}원`;
        td.appendChild(div);
      }
    });

    weekRow.appendChild(td);

    if (curDate.getDay() === 6 || curDate.getTime() === cycleEnd.getTime()) {
      if (curDate.getDay() !== 6 && curDate.getTime() === cycleEnd.getTime()) {
        for (let i = curDate.getDay() + 1; i <= 6; i++) {
          const emptyTd = document.createElement('td');
          emptyTd.className = 'other-month';
          weekRow.appendChild(emptyTd);
        }
      }
      fragment.appendChild(weekRow);
      if (curDate.getTime() !== cycleEnd.getTime()) {
        weekRow = document.createElement('tr');
      }
    }
    curDate.setDate(curDate.getDate() + 1);
  }

  calendarBody.innerHTML = '';
  calendarBody.appendChild(fragment);
}, 5000);

// ⚠️ 수정: 배열 검증이 포함된 요약 업데이트
const updateSummaryOptimized = Utils.memoize(function(transactions) {
  const validTransactions = Utils.ensureArray(transactions);
  console.log(`[updateSummaryOptimized] Processing ${validTransactions.length} transactions for summary`);
  
  let inc = 0, exp = 0;
  
  validTransactions.forEach(t => {
    if (t && typeof t.amount !== 'undefined') {
      const amount = Number(t.amount) || 0;
      if (t.type === '수입') {
        inc += amount;
      } else {
        exp += amount;
      }
    }
  });

  const balance = inc - exp;
  
  requestAnimationFrame(() => {
    const incomeEl = document.getElementById('totalIncome');
    const expenseEl = document.getElementById('totalExpense');
    const balanceEl = document.getElementById('totalBalance');
    
    if (incomeEl) incomeEl.textContent = `₩${inc.toLocaleString()}`;
    if (expenseEl) expenseEl.textContent = `₩${exp.toLocaleString()}`;
    
    if (balanceEl) {
      balanceEl.textContent = `₩${balance.toLocaleString()}`;
      balanceEl.className = 'total-balance';
      if (balance < 0) balanceEl.classList.add('negative');
    }
  });
}, 1000);

/* === 향상된 이벤트 처리 === */
function setupEventListeners() {
  const form = document.getElementById('transactionForm');
  const calendarBody = document.getElementById('calendarBody');
  const mainCategory = document.getElementById('mainCategory');
  
  if (form) {
    form.addEventListener('submit', handleTransactionSubmitOptimized);
  }
  
  if (calendarBody) {
    calendarBody.addEventListener('click', function(e) {
      const dateCell = e.target.closest('.calendar-date');
      if (dateCell && dateCell.dataset.date) {
        openModalOptimized(dateCell.dataset.date);
      }
    });
  }

  if (mainCategory) {
    mainCategory.addEventListener('change', 
      Utils.debounce(() => {
        updateSubCategories();
      }, 100)
    );
  }

  document.querySelectorAll('input[name="type"]').forEach(radio => {
    radio.addEventListener('change', toggleTypeSpecificFields);
  });
}

/* === POST 방식으로 개선된 거래 처리 === */
async function handleTransactionSubmitOptimized(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const transactionData = Object.fromEntries(formData.entries());

  if (!validateTransactionData(transactionData)) {
    return;
  }

  const isEditing = AppState.currentEditingTransaction && 
    typeof AppState.currentEditingTransaction.row !== 'undefined';

  const { optimisticData, originalData } = performOptimisticUpdate(transactionData, isEditing);

  showLoadingState(true, 'save');
  closeModal();

  try {
    const action = isEditing ? 'updateTransaction' : 'addTransaction';
    const params = isEditing ? 
      { 
        transactionData: JSON.stringify({...transactionData, id_to_update: AppState.currentEditingTransaction.row}) 
      } :
      { transactionData: JSON.stringify(transactionData) };

    const result = await callAppsScriptApi(action, params, 0, true);

    if (result.success) {
      showToast(isEditing ? '수정 완료!' : '저장 완료!', false);
      invalidateTransactionCache();
      await updateCalendarDisplayOptimized();
    } else {
      throw new Error(result.message || '서버 처리 실패');
    }
  } catch (error) {
    console.error('Transaction submit failed:', error);
    showToast(`${isEditing ? '수정' : '저장'} 실패: ${error.message}`, true);
    rollbackOptimisticUpdate(originalData);
  } finally {
    showLoadingState(false, 'save');
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

function performOptimisticUpdate(transactionData, isEditing) {
  const originalData = Utils.ensureArray(AppState.currentTransactions);
  const optimisticData = [...originalData];

  if (isEditing) {
    const index = optimisticData.findIndex(t => 
      t && t.row?.toString() === AppState.currentEditingTransaction.row?.toString());
    if (index > -1) {
      optimisticData[index] = { ...optimisticData[index], ...transactionData };
      applyTransactionCategories(optimisticData[index], transactionData);
    }
  } else {
    const newItem = { ...transactionData, row: `temp-${Date.now()}` };
    applyTransactionCategories(newItem, transactionData);
    optimisticData.push(newItem);
  }

  AppState.currentTransactions = optimisticData;
  const cacheKey = 'transactions_' + AppState.currentCycleMonth;
  Utils.setCachedData(cacheKey, optimisticData);
  Utils.setMemoryCache(cacheKey, optimisticData);
  renderCalendarAndSummaryOptimized(optimisticData);

  return { optimisticData, originalData };
}

function applyTransactionCategories(item, data) {
  if (data.type === '수입') {
    item.category1 = data.incomeSource || '';
    item.category2 = '';
  } else {
    item.category1 = data.mainCategory || '';
    item.category2 = data.subCategory || '';
  }
}

function rollbackOptimisticUpdate(originalData) {
  const validOriginalData = Utils.ensureArray(originalData);
  AppState.currentTransactions = validOriginalData;
  const cacheKey = 'transactions_' + AppState.currentCycleMonth;
  Utils.setCachedData(cacheKey, validOriginalData);
  Utils.setMemoryCache(cacheKey, validOriginalData);
  renderCalendarAndSummaryOptimized(validOriginalData);
}

function invalidateTransactionCache() {
  const cacheKey = 'transactions_' + AppState.currentCycleMonth;
  localStorage.removeItem(cacheKey);
  AppState.memoryCache.delete(cacheKey);
}

/* === 개선된 카테고리 검증 및 처리 === */
function validateCategoryData() {
  if (!AppState.initialDataLoaded) {
    console.warn('[validateCategoryData] 초기 데이터가 아직 로드되지 않았습니다.');
    return false;
  }
  
  if (!AppState.expenseCategoriesData || Object.keys(AppState.expenseCategoriesData).length === 0) {
    console.error('[validateCategoryData] 비용 카테고리 데이터가 없습니다.');
    showToast('카테고리 데이터를 불러오지 못했습니다. 새로고침을 시도해주세요.', true);
    return false;
  }
  return true;
}

/* === 완전 개선된 populateFormForEdit === */
function populateFormForEdit(transaction) {
  if (!transaction || typeof transaction.row === 'undefined') {
    console.error('[populateFormForEdit] 유효하지 않은 거래 데이터입니다:', transaction);
    showToast('거래 정보를 불러오지 못했습니다. (ID 누락)', true); 
    return;
  }

  console.log('[populateFormForEdit] 수정할 거래 데이터:', JSON.parse(JSON.stringify(transaction)));
  
  if (transaction.type === '지출' && !validateCategoryData()) {
    console.warn('[populateFormForEdit] 카테고리 데이터가 준비되지 않아 수정을 연기합니다.');
    setTimeout(() => populateFormForEdit(transaction), 500);
    return;
  }
  
  AppState.currentEditingTransaction = transaction; 
  
  const form = document.getElementById('transactionForm');
  if (form) form.reset();
  
  document.getElementById('modalTitle').textContent = '거래 수정';

  // 공통 필드
  document.getElementById('transactionDate').value = transaction.date || '';
  document.getElementById('transactionAmount').value = transaction.amount || '';
  document.getElementById('transactionContent').value = transaction.content || '';

  // 거래 유형
  document.querySelectorAll('input[name="type"]').forEach(r => {
    r.checked = (r.value === transaction.type);
  });
  
  toggleTypeSpecificFields();

  if (transaction.type === '지출') {
    console.log('[populateFormForEdit] 지출 유형 수정 시작');
    
    const paymentMethodSelect = document.getElementById('paymentMethod');
    if (paymentMethodSelect) {
      paymentMethodSelect.value = transaction.paymentMethod || '';
      console.log(`[populateFormForEdit] 결제수단 설정: '${paymentMethodSelect.value}'`);
    }
    
    const mainCategorySelect = document.getElementById('mainCategory');
    if (mainCategorySelect) {
      mainCategorySelect.value = transaction.category1 || ''; 
      console.log(`[populateFormForEdit] 주 카테고리 설정: '${mainCategorySelect.value}'`);
      
      if (transaction.category1 && mainCategorySelect.value !== transaction.category1) {
        console.warn(`[populateFormForEdit] 주 카테고리 설정 실패. 사용 가능한 옵션:`, 
          Array.from(mainCategorySelect.options).map(opt => opt.value));
      }
    }

    updateSubCategoriesForEdit(transaction.category1, transaction.category2);

  } else if (transaction.type === '수입') {
    console.log('[populateFormForEdit] 수입 유형 수정 시작');
    const incomeSourceSelect = document.getElementById('incomeSource');
    if (incomeSourceSelect) {
      incomeSourceSelect.value = transaction.category1 || '';
      console.log(`[populateFormForEdit] 수입원 설정: '${incomeSourceSelect.value}'`);
    }
  }

  document.getElementById('deleteBtn').style.display = 'block';
}

// 폼 수정용 하위 카테고리 처리
function updateSubCategoriesForEdit(mainCategoryValue, subCategoryValue) {
  updateSubCategories.clearCache();
  updateSubCategories();
  
  requestAnimationFrame(() => {
    const subCategorySelect = document.getElementById('subCategory');
    if (subCategorySelect && subCategoryValue) {
      subCategorySelect.value = subCategoryValue;
      console.log(`[updateSubCategoriesForEdit] 하위 카테고리 설정 완료: '${subCategorySelect.value}'`);
      
      if (subCategorySelect.value !== subCategoryValue) {
        console.warn(`[updateSubCategoriesForEdit] 하위 카테고리 '${subCategoryValue}' 설정 실패`);
        showToast(`하위 카테고리 '${subCategoryValue}'를 찾을 수 없습니다.`, true);
      }
    }
  });
}

/* === UI 상태 관리 === */
function showLoadingState(show, type = 'global') {
  const loaders = {
    global: document.getElementById('loader'),
    calendar: document.querySelector('.calendar-loader'),
    save: document.querySelector('.save-loader')
  };

  if (loaders[type]) {
    loaders[type].style.display = show ? 'block' : 'none';
  }

  if (type === 'global' && !loaders.global) {
    document.body.style.cursor = show ? 'wait' : 'default';
  }
}

function debugFormState() {
  console.log('=== 폼 상태 디버깅 ===');
  console.log('현재 수정 중인 거래:', AppState.currentEditingTransaction);
  console.log('주 카테고리 값:', document.getElementById('mainCategory')?.value);
  console.log('하위 카테고리 값:', document.getElementById('subCategory')?.value);
  console.log('사용 가능한 주 카테고리:', Object.keys(AppState.expenseCategoriesData));
  console.log('초기 데이터 로드 완료:', AppState.initialDataLoaded);
  console.log('현재 거래 내역 수:', AppState.currentTransactions.length);
  
  const mainCat = document.getElementById('mainCategory')?.value;
  if (mainCat && AppState.expenseCategoriesData[mainCat]) {
    console.log(`'${mainCat}'의 하위 카테고리:`, AppState.expenseCategoriesData[mainCat]);
  }
  console.log('===================');
}

/* === 나머지 함수들 === */
function determineInitialCycleMonth() {
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getDate() < 18 ? today.getMonth() - 1 : today.getMonth();
  
  if (month < 0) {
    month = 11;
    year -= 1;
  }
  
  AppState.currentDisplayDate = new Date(year, month, 18);
  AppState.currentCycleMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
  console.log("[App] Initial cycle month:", AppState.currentCycleMonth);
}

async function changeMonth(delta) {
  AppState.currentDisplayDate.setMonth(AppState.currentDisplayDate.getMonth() + delta);
  const year = AppState.currentDisplayDate.getFullYear();
  const month = AppState.currentDisplayDate.getMonth();
  AppState.currentCycleMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
  await updateCalendarDisplayOptimized();
}

function renderSetupUI() {
  populateFormDropdowns();
  populateCardSelector();
}

function populateFormDropdowns() {
  const paymentSelect = document.getElementById('paymentMethod');
  if (paymentSelect) {
    paymentSelect.innerHTML = '<option value="">선택하세요</option>';
    AppState.paymentMethodsData.forEach(method => {
      const option = document.createElement('option');
      option.value = method.name;
      option.textContent = method.name;
      paymentSelect.appendChild(option);
    });
  }

  const mainCategorySelect = document.getElementById('mainCategory');
  if (mainCategorySelect) {
    mainCategorySelect.innerHTML = '<option value="">선택하세요</option>';
    Object.keys(AppState.expenseCategoriesData).forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      mainCategorySelect.appendChild(option);
    });
  }

  updateSubCategories();

  const incomeSelect = document.getElementById('incomeSource');
  if (incomeSelect) {
    incomeSelect.innerHTML = '<option value="">선택하세요</option>';
    AppState.incomeSourcesData.forEach(source => {
      const option = document.createElement('option');
      option.value = source;
      option.textContent = source;
      incomeSelect.appendChild(option);
    });
  }
}

const updateSubCategories = Utils.memoize(function(mainCategoryValue = null) {
  const mainCategorySelect = document.getElementById('mainCategory');
  const subCategorySelect = document.getElementById('subCategory');
  
  if (!mainCategorySelect || !subCategorySelect) {
    console.warn('[updateSubCategories] select 요소를 찾을 수 없습니다.');
    return;
  }

  const categoryValue = mainCategoryValue || mainCategorySelect.value;
  console.log(`[updateSubCategories] 카테고리 처리: '${categoryValue}'`);
  
  const currentSubValue = subCategorySelect.value;
  subCategorySelect.innerHTML = '<option value="">선택하세요</option>';

  if (AppState.expenseCategoriesData[categoryValue]) {
    const subCategories = AppState.expenseCategoriesData[categoryValue];
    console.log(`[updateSubCategories] 하위 카테고리 ${subCategories.length}개 추가`);
    
    subCategories.forEach(subCategory => {
      const option = document.createElement('option');
      option.value = subCategory;
      option.textContent = subCategory;
      subCategorySelect.appendChild(option);
    });
    
    if (currentSubValue && subCategories.includes(currentSubValue)) {
      subCategorySelect.value = currentSubValue;
      console.log(`[updateSubCategories] 이전 값 복원: '${currentSubValue}'`);
    }
  }
}, 1000);

async function openModalOptimized(dateStr) {
  if (!AppState.initialDataLoaded) {
    showToast('데이터 로딩 중입니다. 잠시 후 다시 시도해주세요.', true);
    return;
  }

  document.getElementById('transactionForm').reset();
  AppState.currentEditingTransaction = null;
  document.getElementById('deleteBtn').style.display = 'none';
  document.getElementById('modalTitle').textContent = '거래 추가';
  document.getElementById('transactionDate').value = dateStr;
  toggleTypeSpecificFields();

  const dailyList = document.getElementById('dailyTransactionList');
  const dailySection = document.getElementById('dailyTransactions');
  
  if (dailyList) dailyList.innerHTML = '불러오는 중...';
  if (dailySection) dailySection.style.display = 'none';
  
  document.getElementById('toggleDailyTransactions').textContent = '거래 내역 보기';
  document.getElementById('transactionModal').style.display = 'flex';

  await loadDailyTransactionsOptimized(dateStr);
}

async function loadDailyTransactionsOptimized(dateStr) {
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;

  try {
    const dailyData = await callAppsScriptApi('getTransactionsByDate', { date: dateStr });
    const validDailyData = Utils.ensureArray(dailyData);
    displayDailyTransactionsOptimized(validDailyData, dateStr);
  } catch (error) {
    console.error('Daily transactions load failed:', error);
    list.textContent = '일일 거래 내역 로딩 실패.';
  }
}

function displayDailyTransactionsOptimized(transactions, dateStr) {
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;

  const validTransactions = Utils.ensureArray(transactions);
  
  if (validTransactions.length === 0) {
    list.textContent = '해당 날짜의 거래 내역이 없습니다.';
    return;
  }

  const fragment = document.createDocumentFragment();
  
  validTransactions.forEach(transaction => {
    if (!transaction || typeof transaction.type === 'undefined') return;

    const div = document.createElement('div');
    div.classList.add('transaction-item', transaction.type === '수입' ? 'income' : 'expense');
    
    let text = `[${transaction.type}] ${transaction.content || '(내용 없음)'}: ${Number(transaction.amount || 0).toLocaleString()}원`;
    if (transaction.type === '지출' && transaction.paymentMethod) {
      text += ` (${transaction.paymentMethod})`;
    }
    if (transaction.category1) text += ` - ${transaction.category1}`;
    if (transaction.category2) text += ` / ${transaction.category2}`;
    
    div.textContent = text;
    div.style.cursor = 'pointer';
    div.title = '클릭하여 수정하기';
    div.dataset.transaction = JSON.stringify(transaction);
    
    fragment.appendChild(div);
  });

  list.innerHTML = '';
  list.appendChild(fragment);
  
  if (!list.hasAttribute('data-listener-added')) {
    list.addEventListener('click', function(e) {
      const transactionItem = e.target.closest('.transaction-item');
      if (transactionItem && transactionItem.dataset.transaction) {
        const transaction = JSON.parse(transactionItem.dataset.transaction);
        populateFormForEdit(transaction);
      }
    });
    list.setAttribute('data-listener-added', 'true');
  }
}

function toggleTypeSpecificFields() {
  const typeRadio = document.querySelector('input[name="type"]:checked');
  const type = typeRadio ? typeRadio.value : '지출';

  if (!typeRadio) {
    const defaultExpenseRadio = document.querySelector('input[name="type"][value="지출"]');
    if (defaultExpenseRadio) defaultExpenseRadio.checked = true;
  }

  const expenseFields = document.getElementById('expenseSpecificFields');
  const incomeFields = document.getElementById('incomeSpecificFields');

  if (expenseFields) expenseFields.style.display = type === '지출' ? 'block' : 'none';
  if (incomeFields) incomeFields.style.display = type === '수입' ? 'block' : 'none';
}

function closeModal() {
  document.getElementById('transactionModal').style.display = 'none';
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
    AppState.currentEditingTransaction = null;
    toggleTypeSpecificFields();
  }
}

function showView(id) {
  document.querySelectorAll('.tab-content').forEach(content => 
    content.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  document.querySelectorAll('.tab-button').forEach(button => 
    button.classList.remove('active'));
  document.querySelector(`.tab-button[onclick="showView('${id}')"]`)?.classList.add('active');

  if (id === 'cardView') {
    AppState.cardPerformanceMonthDate = new Date();
    displayCardDataOptimized();
  }
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) {
    console.log(`[Toast] ${isError ? 'ERROR' : 'INFO'}: ${message}`);
    return;
  }

  toast.textContent = message;
  toast.style.backgroundColor = isError ? '#dc3545' : '#28a745';
  toast.style.visibility = 'visible';
  toast.style.opacity = '1';

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.style.visibility = 'hidden', 500);
  }, 3000);
}

function populateCardSelector() {
  const selector = document.getElementById('cardSelector');
  if (!selector) return;

  const currentCard = selector.value;
  selector.innerHTML = '<option value="">카드를 선택하세요</option>';

  AppState.paymentMethodsData
    .filter(method => method.isCard)
    .forEach(card => {
      const option = document.createElement('option');
      option.value = card.name;
      option.textContent = card.name;
      selector.appendChild(option);
    });

  if (currentCard && selector.querySelector(`option[value="${currentCard}"]`)) {
    selector.value = currentCard;
  }
}

async function changeCardMonth(delta) {
  AppState.cardPerformanceMonthDate.setMonth(AppState.cardPerformanceMonthDate.getMonth() + delta);
  await displayCardDataOptimized();
}

async function displayCardDataOptimized() {
  const cardSelector = document.getElementById('cardSelector');
  const cardDetails = document.getElementById('cardDetails');
  const cardMonthLabel = document.getElementById('cardMonthLabel');

  if (!cardSelector || !cardDetails || !cardMonthLabel) return;

  const selectedCard = cardSelector.value;
  if (!selectedCard) {
    cardDetails.innerHTML = '<p>카드를 선택해주세요.</p>';
    cardMonthLabel.textContent = '';
    return;
  }

  showLoadingState(true, 'global');

  const performanceMonth = `${AppState.cardPerformanceMonthDate.getFullYear()}-${String(AppState.cardPerformanceMonthDate.getMonth() + 1).padStart(2, '0')}`;
  cardMonthLabel.textContent = `${performanceMonth} 기준`;

  try {
    const cardData = await callAppsScriptApi('getCardData', {
      cardName: selectedCard,
      cycleMonthForBilling: AppState.currentCycleMonth,
      performanceReferenceMonth: performanceMonth
    });

    if (!cardData || cardData.success === false) {
      cardDetails.innerHTML = `<p>${cardData?.error || '카드 데이터 로딩 중 오류가 발생했습니다.'}</p>`;
      return;
    }

    const billingAmount = Number(cardData.billingAmount) || 0;
    const performanceAmount = Number(cardData.performanceAmount) || 0;
    const targetAmount = Number(cardData.performanceTarget) || 0;
    const achievementRate = targetAmount > 0 ? 
      ((performanceAmount / targetAmount) * 100).toFixed(1) + '%' : '0%';

    cardDetails.innerHTML = `
      <h4>${cardData.cardName || selectedCard}</h4>
      <p><strong>청구 기준월:</strong> ${cardData.billingCycleMonthForCard || AppState.currentCycleMonth} (18일~다음달 17일)</p>
      <p><strong>청구 예정 금액:</strong> ${billingAmount.toLocaleString()}원</p>
      <hr>
      <p><strong>실적 산정월:</strong> ${cardData.performanceReferenceMonthForDisplay || performanceMonth}</p>
      <p><strong>현재 사용액(실적):</strong> ${performanceAmount.toLocaleString()}원</p>
      <p><strong>실적 목표 금액:</strong> ${targetAmount.toLocaleString()}원</p>
      <p><strong>달성률:</strong> ${achievementRate}</p>
      <p style="font-size:0.8em;color:grey;">(실적은 카드사의 실제 집계와 다를 수 있습니다)</p>
    `;

  } catch (error) {
    console.error('Card data loading failed:', error);
    cardDetails.innerHTML = '<p>카드 데이터를 불러오는 데 실패했습니다.</p>';
  } finally {
    showLoadingState(false, 'global');
  }
}

async function handleDelete() {
  if (!AppState.currentEditingTransaction || 
      typeof AppState.currentEditingTransaction.row === 'undefined') {
    showToast('삭제할 거래를 먼저 선택하거나, 유효한 거래가 아닙니다.', true);
    return;
  }

  const rowId = AppState.currentEditingTransaction.row;
  const isTemp = typeof rowId === 'string' && rowId.startsWith('temp-');
  const originalData = Utils.ensureArray(AppState.currentTransactions);

  const filteredData = originalData.filter(t => 
    t && typeof t.row !== 'undefined' && t.row.toString() !== rowId.toString());

  AppState.currentTransactions = filteredData;
  const cacheKey = 'transactions_' + AppState.currentCycleMonth;
  Utils.setCachedData(cacheKey, filteredData);
  Utils.setMemoryCache(cacheKey, filteredData);
  renderCalendarAndSummaryOptimized(filteredData);
  closeModal();

  if (isTemp) {
    showToast('임시 입력을 삭제했습니다.');
    return;
  }

  showToast('삭제를 서버에 전송 중...');

  try {
    const result = await callAppsScriptApi('deleteTransaction', { 
      id_to_delete: Number(rowId) 
    }, 0, true);

    if (result.success) {
      showToast(result.message || '삭제 완료!', false);
      invalidateTransactionCache();
      await updateCalendarDisplayOptimized();
    } else {
      throw new Error(result.message || '서버에서 삭제 실패');
    }
  } catch (error) {
    console.error('Delete failed:', error);
    showToast(`삭제 실패: ${error.message}`, true);
    
    AppState.currentTransactions = originalData;
    const cacheKey = 'transactions_' + AppState.currentCycleMonth;
    Utils.setCachedData(cacheKey, originalData);
    Utils.setMemoryCache(cacheKey, originalData);
    renderCalendarAndSummaryOptimized(originalData);
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' })
      .then(registration => {
        console.log('[App] Service Worker registered successfully. Scope:', registration.scope);
      })
      .catch(error => {
        console.error('[App] Service Worker registration failed:', error);
      });
  }
}
