// app.js - 모든 검토사항 반영된 최종 버전

// --- 캐시 및 API 설정 ---
const EXPENSE_CATEGORIES_CACHE_KEY = 'expenseCategoriesCache_v2';
const PAYMENT_METHODS_CACHE_KEY = 'paymentMethodsCache_v2';
const INCOME_SOURCES_CACHE_KEY = 'incomeSourcesCache_v2';
const TRANSACTIONS_CACHE_PREFIX = 'transactions_v2_'; // 월별 거래내역 캐시 접두사
const CACHE_EXPIRY_TIME = 15 * 60 * 1000; // 15분 (설정 데이터용)
const TRANSACTION_CACHE_EXPIRY_TIME = 5 * 60 * 1000; // 5분 (거래내역 데이터용)
const MEMORY_CACHE_DEFAULT_TTL = 60 * 1000; // 1분 (메모리 캐시 기본 TTL)

const API_RETRY_COUNT = 2; // 재시도 횟수
const API_RETRY_DELAY = 1500; // 재시도 간 지연 시간 (ms)
const API_TIMEOUT = 15000; // API 요청 타임아웃 15초

// ▼▼▼ 선생님의 실제 앱스 스크립트 웹앱 배포 URL로 반드시 교체해주세요!!! ▼▼▼
const APPS_SCRIPT_API_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjP671pu6MMLKhmTXHwqCu-wci-Y-RM0Sl5TlQO0HmGsyrH83DBj6dsh62LqHIf-YD/exec"; 
// ▲▲▲ 선생님의 실제 배포 URL을 다시 한번 확인해주세요. ▲▲▲


/* === 전역 상태 관리 객체 === */
const AppState = {
  currentDisplayDate: new Date(),
  currentCycleMonth: '',
  cardPerformanceMonthDate: new Date(),
  expenseCategoriesData: {},
  paymentMethodsData: [],
  incomeSourcesData: [],
  currentEditingTransaction: null,
  isOnline: navigator.onLine,
  pendingRequests: new Map(), // 진행 중인 API 요청 추적 (중복 방지용)
  memoryCache: new Map(),     // 단기 인메모리 캐시
  initialDataLoaded: {        // 초기 데이터 로드 상태 플래그
    setup: false,
    transactions: false
  },
  currentTransactions: []     // 현재 달력에 표시된 거래내역
};

/* === 유틸리티 함수 객체 === */
const Utils = {
  memoize(fn, ttl = MEMORY_CACHE_DEFAULT_TTL) {
    const cache = new Map();
    const memoized = (...args) => {
      const key = JSON.stringify(args);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.timestamp < ttl) {
        return cached.value;
      }
      const result = fn.apply(this, args);
      cache.set(key, { value: result, timestamp: Date.now() });
      if (ttl > 0) { // TTL이 0보다 클 때만 삭제 타이머 설정
          setTimeout(() => cache.delete(key), ttl);
      }
      return result;
    };
    memoized.clearCache = (argsToClear = null) => {
      if (argsToClear) {
        const keyToClear = JSON.stringify(argsToClear);
        cache.delete(keyToClear);
        console.log(`[Memoize] Cleared cache for key: ${keyToClear}`);
      } else {
        cache.clear();
        console.log('[Memoize] Cleared all cache for function:', fn.name);
      }
    };
    return memoized;
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const context = this;
      const later = () => {
        timeout = null;
        func.apply(context, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  getCachedData(key, expiryTime = CACHE_EXPIRY_TIME) {
    try {
      const cachedItem = localStorage.getItem(key);
      if (cachedItem) {
        const { data, timestamp } = JSON.parse(cachedItem);
        if (Date.now() - timestamp < expiryTime) {
          return data;
        }
        localStorage.removeItem(key);
        console.log(`[Cache] Expired localStorage item removed: ${key}`);
      }
    } catch (e) {
      console.error(`[Cache] Error retrieving or parsing localStorage item ${key}:`, e);
      localStorage.removeItem(key);
    }
    return null;
  },

  setCachedData(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({
        data,
        timestamp: Date.now() 
        // TTL은 getCachedData에서 expiryTime 인자로 받아 처리
      }));
    } catch (e) {
      console.error(`[Cache] Error setting localStorage item ${key}:`, e);
      // 로컬 스토리지 용량 초과 등의 문제 발생 가능
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

  setMemoryCache(key, data, ttl = MEMORY_CACHE_DEFAULT_TTL) {
    AppState.memoryCache.set(key, { data, timestamp: Date.now(), ttl });
  }
};

/* === 향상된 API 호출 (POST 지원, 타임아웃, 재시도) === */
async function callAppsScriptApi(actionName, params = {}, method = 'GET', retryCount = 0) {
  const requestBodyForPost = (method === 'POST') ? params : {}; // POST일 경우 params가 body가 됨
  const paramsForGet = (method === 'GET') ? params : {};      // GET일 경우 params가 query string이 됨
  
  // 중복 방지 키는 action과 GET 파라미터 기준 (POST 바디는 복잡하므로 단순화)
  const requestKey = `${actionName}_${JSON.stringify(paramsForGet)}_${method}`;
  
  if (AppState.pendingRequests.has(requestKey)) {
    console.log(`[API] Deduplicating request for: ${requestKey}`);
    return AppState.pendingRequests.get(requestKey);
  }

  console.log(`[API] Calling: ${actionName} (Attempt ${retryCount + 1}, Method: ${method})`, 
              method === 'GET' ? `Params: ${JSON.stringify(paramsForGet)}` : `Body: ${JSON.stringify(requestBodyForPost)}`);

  const requestPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[API] Request for ${actionName} timed out after ${API_TIMEOUT}ms.`);
      controller.abort();
    }, API_TIMEOUT);

    try {
      let response;
      const url = new URL(APPS_SCRIPT_API_ENDPOINT);
      url.searchParams.append('action', actionName); // action은 항상 URL 파라미터로

      if (method === 'POST') {
        // Code.gs의 doPost(e)는 e.postData.contents로 JSON 문자열을 받도록 구현해야 함
        response = await fetch(url.toString(), { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }, // JSON으로 보낼 경우
          body: JSON.stringify(requestBodyForPost), // params 객체 전체를 JSON 문자열로
          signal: controller.signal,
          keepalive: true // 페이지를 벗어나도 요청이 완료되도록 시도 (선택적)
        });
      } else { // GET
        for (const key in paramsForGet) {
          url.searchParams.append(key, paramsForGet[key]);
        }
        response = await fetch(url.toString(), { 
          method: 'GET',
          signal: controller.signal,
          keepalive: true
        });
      }
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        // 서버에서 구체적인 오류 메시지를 보냈을 수 있으므로 text()로 먼저 읽어봄
        const errorText = await response.text().catch(() => `Status ${response.status}`);
        console.error(`[API] HTTP Error ${response.status} for ${actionName}: ${errorText}`);
        throw new Error(`서버 응답 오류 (${response.status})`);
      }

      const result = await response.json();
      
      if (result.success === false) {
        console.error(`[API] Action "${actionName}" returned server-side error:`, result.error);
        throw new Error(result.error || `"${actionName}" API 요청 실패 (서버 로직 오류)`);
      }
      return result.data !== undefined ? result.data : result; // {success:true, data: ...} 또는 {success:true, ...}

    } catch (error) {
      clearTimeout(timeoutId); // 타임아웃 발생 시 또는 다른 fetch 오류 시 타이머 정리
      if (error.name === 'AbortError') { // 타임아웃으로 인한 중단
        console.error(`[API] Request for ${actionName} aborted due to timeout.`);
        // 재시도 로직에서 AbortError는 재시도하지 않도록 수정
      }

      if (retryCount < API_RETRY_COUNT && error.name !== 'AbortError') {
        console.log(`[API] Retrying ${actionName} (attempt ${retryCount + 1}) in ${API_RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, API_RETRY_DELAY));
        // 재귀 호출 시 retryCount를 증가시키고, 원래 메소드(usePost) 유지
        return callAppsScriptApi(actionName, params, retryCount + 1, method === 'POST');
      }
      
      console.error(`[API] Failed action "${actionName}" after ${retryCount + 1} attempts:`, error);
      if (typeof showToast === 'function') {
        showToast(`"${actionName}" 요청 실패: ${error.message}`, true);
      }
      throw error;
    } finally {
      AppState.pendingRequests.delete(requestKey);
    }
  })();

  AppState.pendingRequests.set(requestKey, requestPromise);
  return requestPromise;
}

// 배치 API 호출 (POST 방식 사용 권장)
async function callBatchApi(requestsObject) { // { key1: {action, params}, key2: {action, params} }
  console.log("[API] Calling Batch API with requests:", requestsObject);
  try {
    // Code.gs의 doPost(e) 또는 doGet(e)에서 'getBatchData' action을 처리하고,
    // e.parameter.requests 또는 e.postData.contents.requests로 JSON 문자열을 받아야 함
    const batchResults = await callAppsScriptApi('getBatchData', 
      { requestsString: JSON.stringify(requestsObject) }, // GET 방식일 경우
      0, 
      false // GET으로 우선 구현, POST로 변경 시 true 및 Code.gs 수정 필요
    ); 
    // batchResults는 { key1: {success, data/error}, key2: {success, data/error} } 형태일 것으로 기대
    console.log("[API] Batch API response:", batchResults);
    return batchResults;
  } catch (error) {
    console.error('Batch API call itself failed, falling back to individual calls (if any):', error);
    // 개별 호출로 폴백하는 로직 (선택적, 현재는 에러만 반환)
    // 이 경우, 개별 호출을 병렬로 실행하고 결과를 취합해야 함
    // const results = {};
    // const promises = Object.entries(requestsObject).map(async ([key, req]) => {
    //   try {
    //     results[key] = await callAppsScriptApi(req.action, req.params, 0, false);
    //   } catch (individualError) {
    //     results[key] = { success: false, error: individualError.message };
    //   }
    // });
    // await Promise.all(promises);
    // return results;
    throw error; // 일단 배치 실패 시 전체 실패로 처리
  }
}

/* === 뷰포트 최적화 === */
// (setViewportHeightVar, debouncedViewportUpdate, 이벤트 리스너는 이전과 동일)
function setViewportHeightVar() { /* ... */ }
const debouncedViewportUpdate = Utils.debounce(setViewportHeightVar, 100);
['load', 'resize', 'orientationchange'].forEach(evt => window.addEventListener(evt, debouncedViewportUpdate));
setViewportHeightVar();


/* === 온라인/오프라인 상태 관리 === */
window.addEventListener('online', () => {
  AppState.isOnline = true;
  showToast('온라인 상태입니다. 변경사항 동기화를 시도합니다.', false);
  syncPendingChanges(); 
});
window.addEventListener('offline', () => {
  AppState.isOnline = false;
  showToast('오프라인 상태입니다. 변경사항은 연결 시 동기화됩니다.', true);
});

async function syncPendingChanges() {
  const pending = Utils.getCachedData('pendingChanges'); // 'pendingChanges'는 배열이라고 가정
  if (pending && Array.isArray(pending) && pending.length > 0) {
    console.log(`[Sync] Found ${pending.length} pending changes. Attempting to sync.`);
    let remainingChanges = [...pending];
    for (const change of pending) {
      try {
        // 데이터 변경 작업은 POST가 더 적합할 수 있음
        await callAppsScriptApi(change.action, change.params, 0, change.method === 'POST'); 
        // 성공한 항목은 남은 목록에서 제거
        remainingChanges = remainingChanges.filter(item => item !== change); 
        console.log(`[Sync] Successfully synced:`, change);
      } catch (error) {
        console.error('[Sync] Failed to sync change, will retry later:', change, error);
        // 실패 시 해당 항목은 남겨두고 다음 동기화 시도
      }
    }
    if (remainingChanges.length > 0) {
      Utils.setCachedData('pendingChanges', remainingChanges);
      showToast(`${remainingChanges.length}개의 변경사항 동기화 실패. 다음에 재시도합니다.`, true);
    } else {
      localStorage.removeItem('pendingChanges');
      showToast('모든 변경사항이 성공적으로 동기화되었습니다.', false);
    }
  } else {
    console.log('[Sync] No pending changes to sync.');
  }
}
// 오프라인 시 변경사항을 pendingChanges에 저장하는 로직은 handleTransactionSubmitOptimized 등에 추가 필요

/* === 앱 초기화 === */
window.onload = async () => {
  console.log("[App.js] Initializing application...");
  showLoadingState(true);
  try {
    determineInitialCycleMonth();
    setupEventListeners();
    await loadInitialDataAndRender(); // 설정 및 첫 달 거래내역 통합 로드 및 렌더링
    showView('calendarView');
    toggleTypeSpecificFields();
    document.getElementById('transactionModal').style.display = 'none';
    registerServiceWorker();
    showToast('앱이 성공적으로 로드되었습니다.', false);
    preloadAdjacentMonthsData(); // 초기 로드 후 다음/이전 달 데이터 예비 로드
  } catch (error) {
    console.error('[App.js] Initialization failed:', error);
    showToast('앱 초기화 중 오류가 발생했습니다. 새로고침 해주세요.', true);
  } finally {
    showLoadingState(false);
  }
};

async function loadInitialDataAndRender() {
  console.log("[App.js] Loading initial setup and transaction data...");
  AppState.initialDataLoaded.setup = false;
  AppState.initialDataLoaded.transactions = false;

  // 1. 캐시에서 설정 데이터 로드 및 UI 적용 시도
  const cachedSetup = loadSetupDataFromCache();
  if (cachedSetup.hasAllData) {
    applySetupDataToState(cachedSetup);
    renderSetupUI(); // 드롭다운 등 채우기
    AppState.initialDataLoaded.setup = true;
  }

  // 2. 캐시에서 현재 달 거래내역 로드 및 UI 적용 시도
  const cachedTransactions = Utils.getCachedData(TRANSACTIONS_CACHE_PREFIX + AppState.currentCycleMonth, TRANSACTION_CACHE_EXPIRY_TIME);
  if (cachedTransactions && Array.isArray(cachedTransactions)) {
    AppState.currentTransactions = cachedTransactions;
    renderCalendarAndSummaryOptimized(cachedTransactions);
    AppState.initialDataLoaded.transactions = true;
  } else {
    renderCalendarAndSummaryOptimized([]); // 빈 달력 표시
  }
  
  // 3. API를 통해 모든 최신 데이터 가져오기 (배치 또는 개별)
  try {
    console.log("[App.js] Fetching fresh data from API (setup and current month transactions)...");
    // getAppSetupData는 initialCycleMonth 거래내역을 포함하여 가져올 수 있도록 Code.gs 수정 필요
    // 여기서는 분리해서 요청하거나, getAppSetupData에서 transactions_currentCycleMonth도 함께 반환하도록 할 수 있음
    const results = await callBatchApi({
      setup: { action: 'getAppSetupData', params: { initialCycleMonth: AppState.currentCycleMonth } },
      // currentTransactions: { action: 'getTransactions', params: { cycleMonth: AppState.currentCycleMonth } } 
      // getAppSetupData가 initialTransactions를 반환한다면 위 currentTransactions는 중복일 수 있음
    });

    let setupUpdated = false;
    let transactionsUpdated = false;

    // 설정 데이터 처리
    if (results.setup && results.setup.success && results.setup.data) {
      const freshSetupData = results.setup.data;
      const hasChanges = updateSetupDataInStateAndCache(freshSetupData);
      if (hasChanges || !AppState.initialDataLoaded.setup) {
        renderSetupUI();
        if (hasChanges) showToast('앱 설정이 업데이트되었습니다.', false);
      }
      AppState.initialDataLoaded.setup = true;

      // getAppSetupData가 초기 거래내역을 반환한 경우 처리
      if (freshSetupData.initialTransactions && Array.isArray(freshSetupData.initialTransactions)) {
        const currentMonthCacheKey = TRANSACTIONS_CACHE_PREFIX + AppState.currentCycleMonth;
        const currentCachedTxs = AppState.currentTransactions; // 이미 캐시에서 로드했을 수 있음
        
        if (JSON.stringify(currentCachedTxs) !== JSON.stringify(freshSetupData.initialTransactions)) {
          AppState.currentTransactions = freshSetupData.initialTransactions;
          Utils.setCachedData(currentMonthCacheKey, AppState.currentTransactions, TRANSACTION_CACHE_EXPIRY_TIME);
          Utils.setMemoryCache(AppState.currentCycleMonth, AppState.currentTransactions, MEMORY_CACHE_DEFAULT_TTL);
          renderCalendarAndSummaryOptimized(AppState.currentTransactions);
          transactionsUpdated = true;
          console.log("[App.js] Initial transactions from API applied to calendar for month:", AppState.currentCycleMonth);
        }
      }
      AppState.initialDataLoaded.transactions = transactionsUpdated || AppState.initialDataLoaded.transactions;

    } else if (results.setup && results.setup.error) {
      console.error("Failed to fetch setup data from batch API:", results.setup.error);
      if (!AppState.initialDataLoaded.setup) showToast('초기 설정 로드 실패.', true);
    }
    
    // 만약 getAppSetupData에서 초기 거래내역을 가져오지 않는다면, 별도로 getTransactions 호출
    if (!transactionsUpdated && results.currentTransactions && results.currentTransactions.success && Array.isArray(results.currentTransactions.data)) {
        // 이 부분은 callBatchApi에서 currentTransactions 요청을 추가했을 때 해당됨
        // 현재는 getAppSetupData가 initialTransactions를 반환하는 것을 우선함
    }


  } catch (error) {
    console.error('Initial data batch/API load failed:', error);
    if (!AppState.initialDataLoaded.setup || !AppState.initialDataLoaded.transactions) {
      // showToast는 callAppsScriptApi에서 이미 호출됨
    }
  }
}

function loadSetupDataFromCache() {
  const cat = Utils.getCachedData(EXPENSE_CATEGORIES_CACHE_KEY, CACHE_EXPIRY_TIME);
  const met = Utils.getCachedData(PAYMENT_METHODS_CACHE_KEY, CACHE_EXPIRY_TIME);
  const src = Utils.getCachedData(INCOME_SOURCES_CACHE_KEY, CACHE_EXPIRY_TIME);
  return {
    expenseCategories: cat, paymentMethods: met, incomeSources: src,
    hasAllData: !!(cat && met && src)
  };
}

function applySetupDataToState(data) {
  if(data.expenseCategories) AppState.expenseCategoriesData = data.expenseCategories;
  if(data.paymentMethods) AppState.paymentMethodsData = data.paymentMethods;
  if(data.incomeSources) AppState.incomeSourcesData = data.incomeSources;
}

function updateSetupDataInStateAndCache(freshSetupData) {
  let updated = false;
  if (freshSetupData.expenseCategories && JSON.stringify(AppState.expenseCategoriesData) !== JSON.stringify(freshSetupData.expenseCategories)) {
    AppState.expenseCategoriesData = freshSetupData.expenseCategories;
    Utils.setCachedData(EXPENSE_CATEGORIES_CACHE_KEY, AppState.expenseCategoriesData, CACHE_EXPIRY_TIME);
    updated = true;
  }
  if (freshSetupData.paymentMethods && JSON.stringify(AppState.paymentMethodsData) !== JSON.stringify(freshSetupData.paymentMethods)) {
    AppState.paymentMethodsData = freshSetupData.paymentMethods;
    Utils.setCachedData(PAYMENT_METHODS_CACHE_KEY, AppState.paymentMethodsData, CACHE_EXPIRY_TIME);
    updated = true;
  }
  if (freshSetupData.incomeSources && JSON.stringify(AppState.incomeSourcesData) !== JSON.stringify(freshSetupData.incomeSources)) {
    AppState.incomeSourcesData = freshSetupData.incomeSources;
    Utils.setCachedData(INCOME_SOURCES_CACHE_KEY, AppState.incomeSourcesData, CACHE_EXPIRY_TIME);
    updated = true;
  }
  return updated;
}

async function preloadAdjacentMonthsData() { // 다음/이전달 데이터 미리 로드
  if (!AppState.isOnline) return; // 오프라인이면 실행 안 함
  const current = new Date(AppState.currentDisplayDate); // 원본 변경 방지
  current.setMonth(current.getMonth() + 1);
  const nextCycle = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
  
  current.setMonth(current.getMonth() - 2); // currentDisplayDate 기준 이전달
  const prevCycle = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;

  console.log(`[App.js] Preloading data for months: ${prevCycle} and ${nextCycle}`);
  try {
    // 중복 요청 방지를 위해 callAppsScriptApi가 처리
    const results = await Promise.allSettled([
      callAppsScriptApi('getTransactions', { cycleMonth: nextCycle }, 0, false)
        .then(data => Utils.setCachedData(TRANSACTIONS_CACHE_PREFIX + nextCycle, data, TRANSACTION_CACHE_EXPIRY_TIME)),
      callAppsScriptApi('getTransactions', { cycleMonth: prevCycle }, 0, false)
        .then(data => Utils.setCachedData(TRANSACTIONS_CACHE_PREFIX + prevCycle, data, TRANSACTION_CACHE_EXPIRY_TIME))
    ]);
    results.forEach(result => {
      if(result.status === 'rejected') console.warn('[App.js] Preloading a month failed:', result.reason);
    });
  } catch (error) {
    // Promise.allSettled는 자체적으로 에러를 throw하지 않음 (개별 promise의 status로 확인)
    console.warn('[App.js] Error during preloading adjacent months data, but this is non-critical.', error);
  }
}

/* === 달력 UI 업데이트 (최적화된 버전) === */
async function updateCalendarDisplayOptimized() {
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) { console.error("calendarBody element not found"); return; }

  console.log("[App.js] Updating calendar display for cycle:", AppState.currentCycleMonth);
  showLoadingState(true, 'calendar'); // calendar 로더 타입 사용 (CSS에 정의 필요)

  let transactionsToRender = [];
  let renderedFromCache = false;
  const cacheKey = TRANSACTIONS_CACHE_PREFIX + AppState.currentCycleMonth;

  // 1. 메모리 캐시 확인
  const memoryCached = Utils.getMemoryCache(AppState.currentCycleMonth); // 키를 월로 단순화
  if (memoryCached) {
    console.log('[App.js] Rendering calendar from memory cache for cycle:', AppState.currentCycleMonth);
    transactionsToRender = memoryCached;
    AppState.currentTransactions = memoryCached; // 전역 상태 업데이트
    renderCalendarAndSummaryOptimized(transactionsToRender);
    renderedFromCache = true;
  } else {
    // 2. localStorage 캐시 확인
    const localCached = Utils.getCachedData(cacheKey, TRANSACTION_CACHE_EXPIRY_TIME);
    if (localCached && Array.isArray(localCached)) {
      console.log('[App.js] Rendering calendar from localStorage for cycle:', AppState.currentCycleMonth);
      transactionsToRender = localCached;
      AppState.currentTransactions = localCached; // 전역 상태 업데이트
      renderCalendarAndSummaryOptimized(transactionsToRender);
      Utils.setMemoryCache(AppState.currentCycleMonth, localCached, MEMORY_CACHE_DEFAULT_TTL); // 메모리 캐시에도 저장
      renderedFromCache = true;
    } else {
      console.log('[App.js] No cache found for cycle:', AppState.currentCycleMonth, '. Displaying empty calendar initially.');
      AppState.currentTransactions = []; // 전역 상태 업데이트
      renderCalendarAndSummaryOptimized([]); // 캐시 없으면 빈 달력
    }
  }
  
  // 3. 온라인이면 네트워크에서 최신 데이터 가져오기
  if (AppState.isOnline) {
    try {
      console.log("[App.js] Fetching latest transactions from API for cycle (background):", AppState.currentCycleMonth);
      const latestTransactions = await callAppsScriptApi('getTransactions', { cycleMonth: AppState.currentCycleMonth });
      
      if (latestTransactions && Array.isArray(latestTransactions)) {
        // 데이터 변경 여부 확인 후 UI 업데이트
        if (JSON.stringify(AppState.currentTransactions) !== JSON.stringify(latestTransactions)) {
          console.log('[App.js] API data is different from cached. Updating UI and caches for cycle:', AppState.currentCycleMonth);
          AppState.currentTransactions = latestTransactions;
          Utils.setCachedData(cacheKey, latestTransactions, TRANSACTION_CACHE_EXPIRY_TIME);
          Utils.setMemoryCache(AppState.currentCycleMonth, latestTransactions, MEMORY_CACHE_DEFAULT_TTL);
          renderCalendarAndSummaryOptimized(latestTransactions); // 최신 데이터로 화면 다시 그리기
          if (renderedFromCache) { // 이미 캐시로 화면을 그렸는데, 새 데이터가 왔을 때만 알림
            showToast('달력 정보가 최신으로 업데이트 되었습니다.', false);
          }
        } else {
          console.log('[App.js] API data is same as cached for cycle:', AppState.currentCycleMonth);
        }
      }
    } catch (error) {
      console.error('[App.js] Failed to fetch latest transactions from API for cycle:', AppState.currentCycleMonth, error);
      if (!renderedFromCache) { // 캐시로 아무것도 못 보여준 상태에서 API도 실패하면 오류 토스트
         // showToast는 callAppsScriptApi 내부에서 이미 호출됨
      } else {
        // 캐시로 보여줬지만 백그라운드 업데이트 실패 시 조용한 실패 또는 가벼운 알림
        console.warn('[App.js] Background transaction update failed for cycle:', AppState.currentCycleMonth);
      }
    }
  } else if (!renderedFromCache) {
     showToast('오프라인 상태이며 표시할 캐시된 데이터가 없습니다.', true);
  }
  showLoadingState(false, 'calendar');
}


function renderCalendarAndSummaryOptimized(transactions) {
  // console.log('[Render] renderCalendarAndSummaryOptimized with transactions:', transactions ? transactions.length : 0);
  if (!AppState.currentCycleMonth) return;
  const parts = AppState.currentCycleMonth.split('-');
  if(parts.length < 2) return;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  
  const currentMonthYearEl = document.getElementById('currentMonthYear');
  if(currentMonthYearEl) currentMonthYearEl.textContent = `${year}년 ${String(month).padStart(2,'0')}월 주기`;
  
  renderCalendarOptimized(year, month, transactions || []);
  updateSummaryOptimized(transactions || []);
}

const renderCalendarOptimized = Utils.memoize(function(year, monthOneBased, transactions) {
  // console.log('[Render] renderCalendarOptimized called for', year, monthOneBased);
  const calendarBody = document.getElementById('calendarBody');
  if (!calendarBody) return;
  const fragment = document.createDocumentFragment();
  const transMap = new Map();
  (transactions||[]).forEach(t => {
    if (t && t.date) {
      if (!transMap.has(t.date)) transMap.set(t.date, []);
      transMap.get(t.date).push(t);
    }
  });

  const cycleStart = new Date(year, monthOneBased - 1, 18);
  const cycleEnd = new Date(year, monthOneBased, 17);
  let curDate = new Date(cycleStart);
  let weekRow = document.createElement('tr');
  const startDayOfWeek = cycleStart.getDay();

  for (let i = 0; i < startDayOfWeek; i++) {
    const td = document.createElement('td'); td.className = 'other-month'; weekRow.appendChild(td);
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
          const emptyTd = document.createElement('td'); emptyTd.className = 'other-month'; weekRow.appendChild(emptyTd);
        }
      }
      fragment.appendChild(weekRow);
      if (curDate.getTime() !== cycleEnd.getTime()) { weekRow = document.createElement('tr'); }
    }
    curDate.setDate(curDate.getDate() + 1);
  }
  calendarBody.innerHTML = ''; 
  calendarBody.appendChild(fragment);
}, 1000); // 달력 구조는 자주 바뀌지 않으므로 짧은 시간 캐시

const updateSummaryOptimized = Utils.memoize(function(transactions) {
  // console.log('[Render] updateSummaryOptimized with transactions:', transactions ? transactions.length : 0);
  let inc = 0, exp = 0;
  (transactions||[]).forEach(t => {
    if (t && typeof t.amount !== 'undefined') {
      const amount = Number(t.amount) || 0;
      if (t.type === '수입') inc += amount; else exp += amount;
    }
  });
  const balance = inc - exp;
  
  requestAnimationFrame(() => { // DOM 업데이트는 배치로
    const totalIncomeEl = document.getElementById('totalIncome');
    const totalExpenseEl = document.getElementById('totalExpense');
    const totalBalanceEl = document.getElementById('totalBalance');

    if(totalIncomeEl) totalIncomeEl.textContent = `₩${inc.toLocaleString()}`;
    if(totalExpenseEl) totalExpenseEl.textContent = `₩${exp.toLocaleString()}`;
    if(totalBalanceEl) {
      totalBalanceEl.textContent = `₩${balance.toLocaleString()}`;
      totalBalanceEl.className = 'total-balance';
      if (balance < 0) totalBalanceEl.classList.add('negative');
    }
  });
}, 1000); // 요약 정보도 짧은 시간 캐시

/* === 이벤트 리스너 설정 === */
function setupEventListeners() {
  document.getElementById('transactionForm').addEventListener('submit', handleTransactionSubmitOptimized);
  document.getElementById('calendarBody').addEventListener('click', function(e) {
    const dateCell = e.target.closest('.calendar-date');
    if (dateCell && dateCell.dataset.date) {
      openModalOptimized(dateCell.dataset.date);
    }
  });
  document.getElementById('mainCategory').addEventListener('change', Utils.debounce(updateSubCategories, 250));
  document.querySelectorAll('input[name="type"]').forEach(radio => {
    radio.addEventListener('change', toggleTypeSpecificFields);
  });
}

/* === 최적화된 거래 제출 (POST 사용) === */
async function handleTransactionSubmitOptimized(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const transactionData = Object.fromEntries(formData.entries());

  if (!validateTransactionData(transactionData)) return;

  const isEditing = AppState.currentEditingTransaction && typeof AppState.currentEditingTransaction.row !== 'undefined';
  const { originalData } = performOptimisticUpdate(transactionData, isEditing); // UI 즉시 업데이트

  showLoadingState(true, 'save');
  closeModal();

  try {
    const action = isEditing ? 'updateTransaction' : 'addTransaction';
    let paramsForApi = {};
    if (isEditing) {
      // 서버에 id_to_update (또는 백엔드가 인식하는 ID 필드명)와 함께 전체 데이터 전달
      paramsForApi = { ...transactionData, id_to_update: AppState.currentEditingTransaction.row };
    } else {
      paramsForApi = { ...transactionData }; 
      // 서버에서 새 ID를 생성한다고 가정. 클라이언트 임시 ID는 보내지 않음.
      // 만약 서버가 row를 받아서 사용한다면, 여기서 temp-id를 보내지 않도록 처리 필요.
      // delete paramsForApi.row; 
    }
    
    // POST 방식으로 변경하려면 Code.gs에 doPost(e) 함수가 필요하고, e.postData.contents를 JSON.parse() 해야 함
    // 여기서는 GET 방식을 유지하되, 복잡한 객체는 JSON 문자열로 변환하여 하나의 파라미터로 전달
    const result = await callAppsScriptApi(action, { transactionDataString: JSON.stringify(paramsForApi) }, 0, false); // false는 GET

    if (result.success) {
      showToast(result.message || (isEditing ? '수정 완료!' : '저장 완료!'), false);
      invalidateTransactionCache(); // 현재 달 캐시 무효화
      if (!isEditing && result.newRowId) { // 새 항목이고 서버에서 새 ID를 받았다면
          // Optimistic Update된 항목의 임시 ID를 실제 ID로 교체하는 로직 (선택적 고급 기능)
          // 지금은 updateCalendarDisplayOptimized가 전체를 다시 로드하므로 필요성이 낮음
      }
      await updateCalendarDisplayOptimized(); // 데이터 새로고침
    } else {
      throw new Error(result.message || result.error || '서버 처리 중 오류 발생');
    }
  } catch (error) {
    console.error(`[App.js] ${isEditing ? 'Update' : 'Add'} Transaction failed:`, error);
    showToast(`${isEditing ? '수정' : '저장'} 실패: ${error.message}`, true);
    rollbackOptimisticUpdate(originalData); // UI 롤백
  } finally {
    showLoadingState(false, 'save');
  }
}

function validateTransactionData(data) { /* 이전과 동일 */
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

function performOptimisticUpdate(transactionData, isEditing) {
  const cacheKey = TRANSACTIONS_CACHE_PREFIX + AppState.currentCycleMonth;
  // AppState.currentTransactions를 직접 수정하기보다, 항상 캐시->상태->UI 순으로 업데이트
  let currentMonthTransactions = Utils.getMemoryCache(AppState.currentCycleMonth) || Utils.getCachedData(cacheKey, TRANSACTION_CACHE_EXPIRY_TIME) || [];
  const originalDataForRollback = JSON.parse(JSON.stringify(currentMonthTransactions)); // 롤백용 깊은 복사

  let optimisticTransactions = JSON.parse(JSON.stringify(currentMonthTransactions));

  if (isEditing) {
    const index = optimisticTransactions.findIndex(t => t && t.row?.toString() === AppState.currentEditingTransaction.row?.toString());
    if (index > -1) {
      optimisticTransactions[index] = { ...optimisticTransactions[index], ...transactionData };
      applyTransactionCategories(optimisticTransactions[index], transactionData);
    }
  } else {
    const newItem = { ...transactionData, row: `temp-${Date.now()}` }; // 임시 ID
    applyTransactionCategories(newItem, transactionData);
    optimisticTransactions.push(newItem);
  }

  AppState.currentTransactions = optimisticTransactions;
  Utils.setCachedData(cacheKey, optimisticTransactions, TRANSACTION_CACHE_EXPIRY_TIME);
  Utils.setMemoryCache(AppState.currentCycleMonth, optimisticTransactions, MEMORY_CACHE_DEFAULT_TTL);
  renderCalendarAndSummaryOptimized(optimisticTransactions);

  return { optimisticData: optimisticTransactions, originalData: originalDataForRollback };
}

function applyTransactionCategories(item, data) { /* 이전과 동일 */
  if (data.type === '수입') {
    item.category1 = data.incomeSource || ''; item.category2 = '';
    delete item.mainCategory; delete item.subCategory; delete item.paymentMethod;
  } else {
    item.category1 = data.mainCategory || ''; item.category2 = data.subCategory || '';
    item.paymentMethod = data.paymentMethod || '';
    delete item.incomeSource;
  }
}

function rollbackOptimisticUpdate(originalDataToRestore) {
  console.warn("[App.js] Rolling back optimistic update.");
  AppState.currentTransactions = originalDataToRestore;
  const cacheKey = TRANSACTIONS_CACHE_PREFIX + AppState.currentCycleMonth;
  Utils.setCachedData(cacheKey, originalDataToRestore, TRANSACTION_CACHE_EXPIRY_TIME);
  Utils.setMemoryCache(AppState.currentCycleMonth, originalDataToRestore, MEMORY_CACHE_DEFAULT_TTL);
  renderCalendarAndSummaryOptimized(originalDataToRestore);
}

function invalidateTransactionCache() { // 현재 달 및 인접달 캐시 무효화
  console.log("[App.js] Invalidating transaction caches for current and adjacent months.");
  const keysToClear = [AppState.currentCycleMonth];
  
  const dateForNext = new Date(AppState.currentDisplayDate);
  dateForNext.setMonth(dateForNext.getMonth() + 1);
  keysToClear.push(`${dateForNext.getFullYear()}-${String(dateForNext.getMonth() + 1).padStart(2, '0')}`);
  
  const dateForPrev = new Date(AppState.currentDisplayDate);
  dateForPrev.setMonth(dateForPrev.getMonth() - 1);
  keysToClear.push(`${dateForPrev.getFullYear()}-${String(dateForPrev.getMonth() + 1).padStart(2, '0')}`);
  
  keysToClear.forEach(monthKey => {
    localStorage.removeItem(TRANSACTIONS_CACHE_PREFIX + monthKey);
    AppState.memoryCache.delete(monthKey); // 메모리 캐시 키는 월만 사용
  });
  
  // 렌더링 함수들의 메모이제이션 캐시도 비워주는 것이 좋음
  renderCalendarOptimized.clearCache();
  updateSummaryOptimized.clearCache();
}


/* === 모달 및 상세 폼 관련 함수들 === */
function populateFormForEdit(transaction) {
  if (!transaction || typeof transaction.row === 'undefined') {
    console.error('[populateFormForEdit] 유효하지 않은 거래 데이터입니다:', transaction);
    showToast('거래 정보를 불러오지 못했습니다. (ID 누락)', true); return;
  }
  console.log('[populateFormForEdit] 수정할 거래 데이터:', JSON.parse(JSON.stringify(transaction)));
  
  if (transaction.type === '지출' && (!AppState.initialDataLoaded.setup || Object.keys(AppState.expenseCategoriesData).length === 0)) {
    showToast('카테고리 정보 로딩 중입니다. 잠시 후 다시 시도해주세요.', true);
    console.warn('[populateFormForEdit] Expense category data not ready for editing transaction type:', transaction.type);
    // loadInitialDataOptimizedIntegrated(); // 필요시 데이터 재요청
    return; 
  }
  
  AppState.currentEditingTransaction = transaction;  
  document.getElementById('transactionForm').reset();
  document.getElementById('modalTitle').textContent = '거래 수정';

  document.getElementById('transactionDate').value = transaction.date || '';
  document.getElementById('transactionAmount').value = transaction.amount || '';
  document.getElementById('transactionContent').value = transaction.content || '';

  document.querySelectorAll('input[name="type"]').forEach(r => { r.checked = (r.value === transaction.type); });
  toggleTypeSpecificFields();

  if (transaction.type === '지출') {
    console.log('[populateFormForEdit] Populating expense fields.');
    document.getElementById('paymentMethod').value = transaction.paymentMethod || '';
    
    const mainCategorySelect = document.getElementById('mainCategory');
    mainCategorySelect.value = transaction.category1 || '';
    console.log(`[populateFormForEdit] Main category set to: '${mainCategorySelect.value}' (target: '${transaction.category1}')`);

    // updateSubCategories를 호출하여 하위 카테고리 목록을 올바르게 채웁니다.
    // updateSubCategories는 mainCategorySelect의 현재 값을 읽어 사용합니다.
    // 이 함수가 memoized 되어 있으므로, 이전 mainCategory 값과 같다면 캐시된 결과를 사용할 수 있습니다.
    // 만약 mainCategory 값이 바뀌었다면, memoize된 함수는 새로 실행됩니다.
    updateSubCategories(mainCategorySelect.value); // 명시적으로 현재 주 카테고리 값을 전달

    // DOM 업데이트가 반영된 후 하위 카테고리 값을 설정하기 위해 requestAnimationFrame 사용
    requestAnimationFrame(() => {
      const subCategorySelect = document.getElementById('subCategory');
      if (subCategorySelect) {
        subCategorySelect.value = transaction.category2 || '';
        console.log(`[populateFormForEdit] Sub category set to: '${subCategorySelect.value}' (target: '${transaction.category2}')`);
        if (transaction.category2 && subCategorySelect.value !== transaction.category2) {
          console.warn(`[populateFormForEdit] Sub-category '${transaction.category2}' could not be selected. Available options might be different.`);
        }
      }
    });

  } else if (transaction.type === '수입') {
    document.getElementById('incomeSource').value = transaction.category1 || ''; // category1이 수입원
  }
  document.getElementById('deleteBtn').style.display = 'block';
}

const updateSubCategories = Utils.memoize(function(mainCategoryValueFromArg = null) {
  const mainCategorySelect = document.getElementById('mainCategory');
  const subCategorySelect = document.getElementById('subCategory');
  if (!mainCategorySelect || !subCategorySelect) {
    console.warn('[updateSubCategories] Main or Sub category select element not found.');
    return;
  }

  const currentMainCategoryValue = mainCategoryValueFromArg || mainCategorySelect.value;
  console.log(`[updateSubCategories] Updating subcategories for main category: '${currentMainCategoryValue}'`);
  
  subCategorySelect.innerHTML = '<option value="">선택하세요</option>'; // Clear previous options
  
  if (AppState.expenseCategoriesData && AppState.expenseCategoriesData[currentMainCategoryValue] && Array.isArray(AppState.expenseCategoriesData[currentMainCategoryValue])) {
    AppState.expenseCategoriesData[currentMainCategoryValue].forEach(subCat => {
      const option = document.createElement('option');
      option.value = subCat;
      option.textContent = subCat;
      subCategorySelect.appendChild(option);
    });
    console.log(`[updateSubCategories] Populated ${AppState.expenseCategoriesData[currentMainCategoryValue].length} subcategories.`);
  } else {
    console.log(`[updateSubCategories] No subcategories found for main category: '${currentMainCategoryValue}'`);
  }
}, 500); // 짧은 시간(0.5초) 동안만 메모이제이션 (카테고리 데이터 변경 빈도 낮으므로 더 길게 해도 됨)


// openModalOptimized, loadDailyTransactionsOptimized, displayDailyTransactionsOptimized 함수는 이전 답변과 동일
// toggleTypeSpecificFields, closeModal, showView, showToast, populateCardSelector, changeCardMonth, displayCardDataOptimized, handleDelete, registerServiceWorker 함수는 이전 답변과 동일
// 여기에 해당 함수들을 그대로 붙여넣으면 됩니다. (내용이 길어 생략)

// --- 나머지 헬퍼 함수들 (이전 `app.js` 버전에 있던 내용) ---
// 이 함수들은 이미 위에 AppState, Utils 객체 등으로 통합되거나,
// 최적화된 함수들 (예: openModalOptimized)로 대체되었습니다.
// 만약 이전에 사용하던 특정 함수가 필요하다면, 위 코드에서 해당 기능을 하는 함수를 찾아 사용하거나,
// 필요에 맞게 조정하여 추가할 수 있습니다.
// 예시: `openModal` -> `openModalOptimized` 로 변경됨
// 예시: `loadDailyTransactions` -> `loadDailyTransactionsOptimized` 로 변경됨

// 여기서는 이전에 제공된 나머지 함수들을 그대로 가져오겠습니다.
// (populateFormForEdit는 위에서 이미 개선된 버전으로 제공했으므로, 그것을 사용합니다.)

function toggleTypeSpecificFields() { /* 이전 제공된 내용 */
  const typeRadio = document.querySelector('input[name="type"]:checked');
  let type = '지출'; 
  if (typeRadio) { type = typeRadio.value;
  } else { const defaultExpenseRadio = document.querySelector('input[name="type"][value="지출"]');
    if (defaultExpenseRadio) defaultExpenseRadio.checked = true;
  }
  document.getElementById('expenseSpecificFields').style.display = type === '지출' ? 'block' : 'none';
  document.getElementById('incomeSpecificFields').style.display  = type === '수입' ? 'block' : 'none';
}

function closeModal(){ document.getElementById('transactionModal').style.display='none'; }

function toggleDailyTransactionVisibility() { /* 이전 제공된 내용 */
  const dailySection = document.getElementById('dailyTransactions');
  const toggleBtn = document.getElementById('toggleDailyTransactions');
  const isHidden = dailySection.style.display === 'none';
  if (isHidden) {
    dailySection.style.display = 'block'; toggleBtn.textContent = '거래 내역 숨기기';
  } else {
    dailySection.style.display = 'none'; toggleBtn.textContent = '거래 내역 보기';
    const preservedDate = document.getElementById('transactionDate').value;
    document.getElementById('transactionForm').reset();
    document.getElementById('transactionDate').value = preservedDate;
    document.getElementById('modalTitle').textContent = '거래 추가';
    document.getElementById('deleteBtn').style.display = 'none';
    AppState.currentEditingTransaction = null; // AppState 사용
    toggleTypeSpecificFields();
  }
}

async function openModalOptimized(dateStr) { /* 이전 제공된 내용 (AppState 사용) */
  if (!AppState.initialDataLoaded.setup) { // 설정 데이터 로드 전이면 모달 열지 않음 (또는 로딩 표시)
    showToast('앱 설정 데이터를 로딩 중입니다. 잠시 후 다시 시도해주세요.', true);
    return;
  }
  document.getElementById('transactionForm').reset();
  AppState.currentEditingTransaction = null;
  document.getElementById('deleteBtn').style.display = 'none';
  document.getElementById('modalTitle').textContent = '거래 추가';
  document.getElementById('transactionDate').value = dateStr;
  toggleTypeSpecificFields(); // 라디오 버튼 기본값에 따라 필드 표시

  const dailyList = document.getElementById('dailyTransactionList');
  if (dailyList) dailyList.innerHTML = '일일 거래내역 불러오는 중...';
  document.getElementById('dailyTransactions').style.display = 'none'; 
  document.getElementById('toggleDailyTransactions').textContent = '거래 내역 보기';
  document.getElementById('transactionModal').style.display = 'flex'; 
  await loadDailyTransactionsOptimized(dateStr);
}

async function loadDailyTransactionsOptimized(dateStr) { /* 이전 제공된 내용 */
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;
  list.innerHTML = '불러오는 중...'; // innerHTML로 초기화
  try {
    const dailyData = await callAppsScriptApi('getTransactionsByDate', { date: dateStr });
    displayDailyTransactionsOptimized(dailyData || [], dateStr);
  } catch (error) {
    console.error(`loadDailyTransactionsOptimized API call failed for date ${dateStr}:`, error);
    if (list) list.textContent = '일일 거래 내역을 불러오는 데 실패했습니다.';
  }
}

function displayDailyTransactionsOptimized(transactions, dateStr) { /* 이전 제공된 내용 */
  const list = document.getElementById('dailyTransactionList');
  if (!list) return;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    list.textContent = '해당 날짜의 거래 내역이 없습니다.'; return;
  }
  const fragment = document.createDocumentFragment();
  transactions.forEach(function(t) {
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
    d.dataset.transaction = JSON.stringify(t); // 전체 거래 데이터를 dataset에 저장
    fragment.appendChild(d);
  });
  list.innerHTML = ''; // 이전 내용 삭제 후 새 내용 추가
  list.appendChild(fragment);

  // 이벤트 리스너는 한 번만 추가 (중복 방지)
  if (!list.hasAttribute('data-listener-added')) {
    list.addEventListener('click', function(e) {
      const transactionItem = e.target.closest('.transaction-item');
      if (transactionItem && transactionItem.dataset.transaction) {
        try {
          const transaction = JSON.parse(transactionItem.dataset.transaction);
          populateFormForEdit(transaction);
        } catch (parseError) {
          console.error("Failed to parse transaction data from dataset:", parseError);
          showToast("거래 정보를 읽는 중 오류 발생", true);
        }
      }
    });
    list.setAttribute('data-listener-added', 'true');
  }
}


function showView(id){ /* 이전 제공된 내용 (AppState 사용) */
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.tab-button').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.tab-button[onclick="showView('${id}')"]`).classList.add('active');
  if(id==='cardView'){
    AppState.cardPerformanceMonthDate = new Date(); 
    // populateCardSelector(); // renderSetupUI에서 이미 호출됨
    displayCardDataOptimized();
  }
}

function showToast(msg,isErr=false){ /* 이전 제공된 내용 */
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.backgroundColor = isErr ? '#dc3545' : '#28a745'; 
  t.style.visibility = 'visible'; t.style.opacity = '1';
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=> t.style.visibility = 'hidden', 500); }, 3000);
}

function populateCardSelector(){ /* 이전 제공된 내용 (AppState 사용) */
  const sel = document.getElementById('cardSelector');
  if (!sel) return;
  const currentCard = sel.value; 
  sel.innerHTML='<option value="">카드를 선택하세요</option>';
  (AppState.paymentMethodsData||[]).filter(m=>m.isCard).forEach(c=>{
    const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; sel.appendChild(o);
  });
  if (currentCard && sel.querySelector(`option[value="${currentCard}"]`)) { sel.value = currentCard; }
}

async function changeCardMonth(d){  /* 이전 제공된 내용 (AppState 사용) */
  AppState.cardPerformanceMonthDate.setMonth(AppState.cardPerformanceMonthDate.getMonth()+d); 
  await displayCardDataOptimized(); 
}

async function displayCardDataOptimized() { /* 이전 제공된 내용 (AppState 사용) */
  const cardSelector = document.getElementById('cardSelector');
  const cardDetails = document.getElementById('cardDetails');
  const cardMonthLabel = document.getElementById('cardMonthLabel');
  if (!cardSelector || !cardDetails || !cardMonthLabel) return;

  const selectedCard = cardSelector.value;
  if (!selectedCard) {
    cardDetails.innerHTML = '<p>카드를 선택해주세요.</p>'; cardMonthLabel.textContent = ''; return;
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
      cardDetails.innerHTML = `<p>${cardData?.error || '카드 데이터 로딩 중 오류가 발생했습니다.'}</p>`; return;
    }
    const billingAmount = Number(cardData.billingAmount) || 0;
    const performanceAmount = Number(cardData.performanceAmount) || 0;
    const targetAmount = Number(cardData.performanceTarget) || 0;
    const achievementRate = targetAmount > 0 ? ((performanceAmount / targetAmount) * 100).toFixed(1) + '%' : '0%';
    cardDetails.innerHTML = `<h4>${cardData.cardName || selectedCard}</h4> <p><strong>청구 기준월:</strong> ${cardData.billingCycleMonthForCard || AppState.currentCycleMonth} (18일~다음달 17일)</p> <p><strong>청구 예정 금액:</strong> ${billingAmount.toLocaleString()}원</p> <hr> <p><strong>실적 산정월:</strong> ${cardData.performanceReferenceMonthForDisplay || performanceMonth}</p> <p><strong>현재 사용액(실적):</strong> ${performanceAmount.toLocaleString()}원</p> <p><strong>실적 목표 금액:</strong> ${targetAmount.toLocaleString()}원</p> <p><strong>달성률:</strong> ${achievementRate}</p> <p style="font-size:0.8em;color:grey;">(실적은 카드사의 실제 집계와 다를 수 있습니다)</p>`;
  } catch (error) {
    console.error('Card data loading failed:', error);
    cardDetails.innerHTML = '<p>카드 데이터를 불러오는 데 실패했습니다.</p>';
  } finally {
    showLoadingState(false, 'global');
  }
}

async function handleDelete() { /* 이전 제공된 내용 (AppState 사용, POST용 params 수정) */
  if (!AppState.currentEditingTransaction || typeof AppState.currentEditingTransaction.row === 'undefined') {
    showToast('삭제할 거래를 먼저 선택하거나, 유효한 거래가 아닙니다.', true); return;
  }
  const rowId = AppState.currentEditingTransaction.row;
  const isTemp = typeof rowId === 'string' && rowId.startsWith('temp-');
  const originalData = [...AppState.currentTransactions]; // 롤백용 현재 상태 복사

  // Optimistic UI 업데이트
  const filteredData = AppState.currentTransactions.filter(t => t && typeof t.row !== 'undefined' && t.row.toString() !== rowId.toString());
  AppState.currentTransactions = filteredData; // 상태 업데이트
  const cacheKey = TRANSACTIONS_CACHE_PREFIX + AppState.currentCycleMonth;
  Utils.setCachedData(cacheKey, filteredData, TRANSACTION_CACHE_EXPIRY_TIME);
  Utils.setMemoryCache(AppState.currentCycleMonth, filteredData, MEMORY_CACHE_DEFAULT_TTL);
  renderCalendarAndSummaryOptimized(filteredData);
  closeModal();

  if (isTemp) { showToast('임시 입력을 삭제했습니다.'); return; }
  showToast('삭제를 서버에 전송 중...');

  try {
    // POST 방식 사용 시, body에 id_to_delete를 포함하여 전송
    const result = await callAppsScriptApi('deleteTransaction', { id_to_delete: Number(rowId) }, 0, true); 
    if (result.success) {
      showToast(result.message || '삭제 완료!', false);
      invalidateTransactionCache(); // 캐시 무효화
      await updateCalendarDisplayOptimized(); // 목록 새로고침
    } else {
      throw new Error(result.message || result.error || '서버에서 삭제 실패');
    }
  } catch (error) {
    console.error('Delete transaction API call failed:', error);
    showToast(`삭제 실패: ${error.message}`, true);
    AppState.currentTransactions = originalData; // UI 롤백
    Utils.setCachedData(cacheKey, originalData, TRANSACTION_CACHE_EXPIRY_TIME);
    Utils.setMemoryCache(AppState.currentCycleMonth, originalData, MEMORY_CACHE_DEFAULT_TTL);
    renderCalendarAndSummaryOptimized(originalData);
  }
}

function registerServiceWorker() { /* 이전 제공된 내용 */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' })
      .then(registration => { console.log('[App.js] Service Worker registered successfully. Scope:', registration.scope); })
      .catch(error => { console.error('[App.js] Service Worker registration failed:', error); });
  }
}
