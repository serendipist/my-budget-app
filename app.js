// ===================================================================
// ▼▼▼ Code.gs 파일 전체를 아래 코드로 교체해주세요. ▼▼▼
// ===================================================================

/* ── 0. 전역 상수 ───────────────────────────────── */
const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_NAMES = {
  TRANSACTIONS       : 'Transactions',
  EXPENSE_CATEGORIES : 'ExpenseCategories',
  PAYMENT_METHODS    : 'PaymentMethods',
  INCOME_SOURCES     : 'IncomeSources',
};

const COL_INDICES = { 
  TIMESTAMP: 1,      // A열 - 입력 타임스탬프
  DATE: 2,           // B열 - 거래 날짜
  TYPE: 3,           // C열 - 유형 (수입/지출)
  AMOUNT: 4,         // D열 - 금액
  CONTENT: 5,        // E열 - 내용
  PAYMENT_METHOD: 6, // F열 - 결제수단 (지출 시)
  CATEGORY1: 7,      // G열 - 주 카테고리 (지출) 또는 수입원 (수입)
  CATEGORY2: 8,      // H열 - 하위 카테고리 (지출 시)
  CYCLE_MONTH: 9     // I열 - 주기월
};
const MAX_COLS_TRANSACTIONS = Math.max(...Object.values(COL_INDICES));

/* ── 1. 시트 및 캐시 헬퍼 ────────────────── */
let _ss;
const _sheetCache = {};

function getSS() {
  return _ss || (_ss = SpreadsheetApp.getActiveSpreadsheet());
}

function getSheet(name) {
  if (!_sheetCache[name]) {
    const sheet = getSS().getSheetByName(name);
    if (!sheet) throw new Error(`시트 '${name}'를 찾을 수 없습니다.`);
    _sheetCache[name] = sheet;
  }
  return _sheetCache[name];
}

function getCached(key, supplierFn, ttlSec = 3600) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  
  if (hit) {
    try { 
      return JSON.parse(hit); 
    } catch (e) { 
      Logger.log(`캐시 파싱 오류: ${e.message}`);
    }
  }
  
  const fresh = supplierFn();
  if (fresh !== undefined && fresh !== null && !fresh.error) {
    try { 
      cache.put(key, JSON.stringify(fresh), ttlSec); 
    } catch (e) { 
      Logger.log(`캐시 저장 오류: ${e.message}`);
    }
  }
  return fresh;
}

function getParameter(e, name) {
  return e?.parameter?.[name] ?? undefined;
}

/* ── 2. API 요청 처리 doGet(e) 함수 ───────────────── */
function doGet(e) {
  Logger.log(`API Request Received: ${e.queryString || ""}`);
  const githubOrigin = 'https://serendipist.github.io';
  let responseData;

  try {
    const action = getParameter(e, 'action');
    if (!action) throw new Error("Action 파라미터가 필요합니다.");

    switch (action) {
      case 'getAppSetupData':
        responseData = getAppSetupData(getParameter(e, 'initialCycleMonth'));
        break;
      case 'getTransactions':
        responseData = getTransactions(getParameter(e, 'cycleMonth'));
        break;
      case 'getTransactionsByDate':
        responseData = getTransactionsByDate(getParameter(e, 'date'));
        break;
      case 'getCardData':
        responseData = getCardData(
          getParameter(e, 'cardName'), 
          getParameter(e, 'cycleMonthForBilling'), 
          getParameter(e, 'performanceReferenceMonth')
        );
        break;
      case 'getExistingYears':
        responseData = getExistingYears();
        break;
      case 'searchTransactions':
        responseData = searchTransactions(getParameter(e, 'term'), getParameter(e, 'year'));
        break;
      case 'addTransaction':
      case 'updateTransaction':
        const dataStr = getParameter(e, 'transactionDataString');
        if (!dataStr) throw new Error("transactionDataString 파라미터가 필요합니다.");
        const transactionData = JSON.parse(dataStr);
        responseData = (action === 'addTransaction') ? 
          addTransaction(transactionData) : 
          updateTransaction(transactionData);
        break;
      case 'deleteTransaction':
        const rowIdStr = getParameter(e, 'id_to_delete');
        if (!rowIdStr) throw new Error("id_to_delete 파라미터가 필요합니다.");
        responseData = deleteTransaction(Number(rowIdStr));
        break;
      default:
        throw new Error(`지원되지 않는 작업입니다: ${action}`);
    }

    if (responseData && responseData.success === false) {
      throw new Error(responseData.error || '내부 작업 실패');
    }

  } catch (error) {
    Logger.log(`Error in doGet: ${error.message} (Action: ${getParameter(e, 'action')})`);
    responseData = { success: false, error: error.message };
  }

  return ContentService.createTextOutput(JSON.stringify(responseData))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', githubOrigin);
}

/* ── 3. 날짜 및 포맷 유틸리티 함수들 ─────────────────── */
function formatDate(val) {
  if (!val) return '';
  
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  
  // 문자열인 경우 날짜 형식으로 변환
  const dateStr = String(val).substring(0, 10).replace(/[./]/g, '-');
  return dateStr;
}

function formatCycleMonth(val) {
  if (!val) return '';
  
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  
  // 문자열에서 연도-월 추출
  const match = String(val).match(/^(\d{4})[.\-/ ]?(\d{1,2})/);
  if (match) {
    return `${match[1]}-${String(match).padStart(2, '0')}`;
  }
  
  return '';
}

/* ── 4. 데이터 조회 함수들 ─────────────────── */
function getExistingYears() {
  try {
    const sheet = getSheet(SHEET_NAMES.TRANSACTIONS);
    const lastRow = sheet.getLastRow();
    
    if (lastRow < 2) {
      return { success: true, data: [] };
    }
    
    const cycleMonthColumn = sheet.getRange(2, COL_INDICES.CYCLE_MONTH, lastRow - 1, 1).getValues();
    
    const yearSet = new Set();
    cycleMonthColumn.forEach(row => {
      const cycleMonth = row[0];
      if (cycleMonth && String(cycleMonth).length >= 4) {
        yearSet.add(String(cycleMonth).substring(0, 4));
      }
    });
    
    const years = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
    
    Logger.log(`Found existing years: ${years.join(', ')}`);
    return { success: true, data: years };
    
  } catch (err) {
    Logger.log(`[Code.gs] getExistingYears 오류: ${err.message}`);
    return { success: false, error: '연도 목록을 불러오는 중 오류가 발생했습니다.' };
  }
}

function searchTransactions(searchTerm, targetYear) {
  try {
    if (!searchTerm || !targetYear) {
      throw new Error("검색어와 연도 값은 필수입니다.");
    }

    const sheet = getSheet(SHEET_NAMES.TRANSACTIONS);
    const lastRow = sheet.getLastRow();
    
    if (lastRow < 2) {
      return { success: true, data: [] };
    }

    const allData = sheet.getRange(2, 1, lastRow - 1, MAX_COLS_TRANSACTIONS).getValues();
    const results = [];
    
    allData.forEach((row, index) => {
      const content = String(row[COL_INDICES.CONTENT - 1]);
      const cycleMonth = formatCycleMonth(row[COL_INDICES.CYCLE_MONTH - 1]);
      
      // 연도 매칭 검사
      const yearMatch = (targetYear === 'all') || (cycleMonth && cycleMonth.startsWith(targetYear));
      
      // 내용에 검색어 포함 검사
      const contentMatch = content.includes(searchTerm);
      
      if (yearMatch && contentMatch) {
        results.push({
          row: index + 2,
          date: formatDate(row[COL_INDICES.DATE - 1]),
          type: String(row[COL_INDICES.TYPE - 1]),
          amount: Number(row[COL_INDICES.AMOUNT - 1]) || 0,
          content: content,
          paymentMethod: String(row[COL_INDICES.PAYMENT_METHOD - 1] || ''),
          category1: String(row[COL_INDICES.CATEGORY1 - 1] || ''),
          category2: String(row[COL_INDICES.CATEGORY2 - 1] || ''),
          cycleMonth: cycleMonth
        });
      }
    });

    // 날짜 역순으로 정렬
    results.sort((a, b) => b.date.localeCompare(a.date));
    
    return { success: true, data: results };
    
  } catch (err) {
    Logger.log(`[Code.gs] searchTransactions 오류: ${err.message}`);
    return { success: false, error: '거래 내역 검색 중 오류가 발생했습니다.' };
  }
}

function getTransactions(cycleMonth) {
  const cacheKey = 'trans_' + cycleMonth;
  
  return getCached(cacheKey, () => {
    try {
      const sheet = getSheet(SHEET_NAMES.TRANSACTIONS);
      const lastRow = sheet.getLastRow();
      
      if (lastRow < 2) {
        return { success: true, data: [] };
      }

      const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      const transactionList = [];
      
      rows.forEach((row, index) => {
        const rowCycleMonth = formatCycleMonth(row[COL_INDICES.CYCLE_MONTH - 1]);
        
        if (rowCycleMonth === cycleMonth) {
          transactionList.push({
            row: index + 2,
            date: formatDate(row[COL_INDICES.DATE - 1]),
            type: String(row[COL_INDICES.TYPE - 1]),
            amount: Number(row[COL_INDICES.AMOUNT - 1]) || 0,
            content: String(row[COL_INDICES.CONTENT - 1]),
            paymentMethod: String(row[COL_INDICES.PAYMENT_METHOD - 1] || ''),
            category1: String(row[COL_INDICES.CATEGORY1 - 1] || ''),
            category2: String(row[COL_INDICES.CATEGORY2 - 1] || ''),
            cycleMonth: cycleMonth
          });
        }
      });
      
      return { success: true, data: transactionList };
      
    } catch (err) {
      Logger.log(`getTransactions 오류: ${err.message}`);
      return { success: false, error: '거래 내역 조회 중 오류가 발생했습니다.' };
    }
  }, 21600); // 6시간 캐시
}

function getTransactionsByDate(dateStr) {
  try {
    // 날짜 형식 검증
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new Error(`잘못된 date 형식: ${dateStr}`);
    }

    const sheet = getSheet(SHEET_NAMES.TRANSACTIONS);
    const lastRow = sheet.getLastRow();
    
    if (lastRow < 2) {
      return { success: true, data: [] };
    }

    const allValues = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const transactions = [];
    
    allValues.forEach((row, index) => {
      const rowDate = formatDate(row[COL_INDICES.DATE - 1]);
      
      if (rowDate === dateStr) {
        transactions.push({
          row: index + 2,
          date: dateStr,
          type: String(row[COL_INDICES.TYPE - 1]),
          amount: Number(row[COL_INDICES.AMOUNT - 1]) || 0,
          content: String(row[COL_INDICES.CONTENT - 1]),
          paymentMethod: String(row[COL_INDICES.PAYMENT_METHOD - 1] || ''),
          category1: String(row[COL_INDICES.CATEGORY1 - 1] || ''),
          category2: String(row[COL_INDICES.CATEGORY2 - 1] || '')
        });
      }
    });

    return { success: true, data: transactions };
    
  } catch (err) {
    Logger.log(`getTransactionsByDate 오류: ${err.stack}`);
    return { success: false, error: '일일 거래 조회 중 오류' };
  }
}

/* ── 5. 거래 데이터 CUD 함수들 ─────────────────── */
function addTransaction(transactionData) {
  try {
    const sheet = getSheet(SHEET_NAMES.TRANSACTIONS);
    
    // 날짜 파싱 및 주기월 계산
    const [year, month, day] = String(transactionData.date).split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    
    // 18일 기준으로 주기월 결정
    const cycleMonthDate = new Date(
      dateObj.getFullYear(), 
      dateObj.getMonth() + (day < 18 ? -1 : 0), 
      1
    );
    const cycleMonth = Utilities.formatDate(cycleMonthDate, Session.getScriptTimeZone(), 'yyyy-MM');
    
    // 지출/수입 여부 확인
    const isExpense = transactionData.type === '지출';
    
    // 새 행 데이터 구성
    const newRow = new Array(MAX_COLS_TRANSACTIONS).fill(null);
    newRow[COL_INDICES.TIMESTAMP - 1] = new Date();
    newRow[COL_INDICES.DATE - 1] = transactionData.date;
    newRow[COL_INDICES.TYPE - 1] = transactionData.type;
    newRow[COL_INDICES.AMOUNT - 1] = Number(transactionData.amount) || 0;
    newRow[COL_INDICES.CONTENT - 1] = transactionData.content;
    newRow[COL_INDICES.PAYMENT_METHOD - 1] = isExpense ? (transactionData.paymentMethod || '') : null;
    newRow[COL_INDICES.CATEGORY1 - 1] = isExpense ? 
      (transactionData.mainCategory ?? '') : 
      (transactionData.incomeSource ?? '');
    newRow[COL_INDICES.CATEGORY2 - 1] = isExpense ? (transactionData.subCategory ?? '') : '';
    newRow[COL_INDICES.CYCLE_MONTH - 1] = cycleMonth;
    
    // 시트에 추가
    sheet.appendRow(newRow);
    SpreadsheetApp.flush();
    
    // 캐시 무효화
    CacheService.getScriptCache().remove('trans_' + cycleMonth);
    
    return { 
      success: true, 
      message: '거래가 추가되었습니다.',
      newRowId: sheet.getLastRow()
    };
    
  } catch (err) {
    Logger.log(`addTransaction 오류: ${err.stack}`);
    return { 
      success: false, 
      message: `거래 추가 중 오류: ${err.message}` 
    };
  }
}

function updateTransaction(data) {
  try {
    const sheet = getSheet(SHEET_NAMES.TRANSACTIONS);
    const rowIndex = data.id_to_update;
    
    if (!rowIndex || rowIndex <= 1) {
      throw new Error('유효하지 않은 행 번호입니다.');
    }

    // 기존 주기월 가져오기 (캐시 무효화용)
    const previousCycleMonth = formatCycleMonth(
      sheet.getRange(rowIndex, COL_INDICES.CYCLE_MONTH).getValue()
    );
    
    // 새 날짜 파싱 및 주기월 계산
    const [year, month, day] = String(data.date).split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const newCycleMonthDate = new Date(
      dateObj.getFullYear(), 
      dateObj.getMonth() + (day < 18 ? -1 : 0), 
      1
    );
    const newCycleMonth = Utilities.formatDate(newCycleMonthDate, Session.getScriptTimeZone(), 'yyyy-MM');
    
    // 지출/수입 여부 확인
    const isExpense = data.type === '지출';
    
    // 업데이트할 행 데이터 구성
    const updatedRow = new Array(MAX_COLS_TRANSACTIONS).fill(null);
    updatedRow[COL_INDICES.TIMESTAMP - 1] = sheet.getRange(rowIndex, COL_INDICES.TIMESTAMP).getValue();
    updatedRow[COL_INDICES.DATE - 1] = data.date;
    updatedRow[COL_INDICES.TYPE - 1] = data.type;
    updatedRow[COL_INDICES.AMOUNT - 1] = Number(data.amount) || 0;
    updatedRow[COL_INDICES.CONTENT - 1] = data.content;
    updatedRow[COL_INDICES.PAYMENT_METHOD - 1] = isExpense ? (data.paymentMethod || '') : null;
    updatedRow[COL_INDICES.CATEGORY1 - 1] = isExpense ? 
      (data.mainCategory ?? '') : 
      (data.incomeSource ?? '');
    updatedRow[COL_INDICES.CATEGORY2 - 1] = isExpense ? (data.subCategory ?? '') : '';
    updatedRow[COL_INDICES.CYCLE_MONTH - 1] = newCycleMonth;
    
    // 시트 업데이트
    sheet.getRange(rowIndex, 1, 1, MAX_COLS_TRANSACTIONS).setValues([updatedRow]);
    SpreadsheetApp.flush();
    
    // 캐시 무효화 (이전 주기월과 새 주기월 모두)
    const cache = CacheService.getScriptCache();
    if (previousCycleMonth) cache.remove('trans_' + previousCycleMonth);
    if (newCycleMonth) cache.remove('trans_' + newCycleMonth);
    
    return { 
      success: true, 
      message: '거래가 수정되었습니다.',
      cycleMonthForRefresh: newCycleMonth 
    };
    
  } catch (err) {
    Logger.log(`updateTransaction 오류: ${err.stack}`);
    return { 
      success: false, 
      message: `거래 수정 중 오류: ${err.message}` 
    };
  }
}

function deleteTransaction(rowIndex) {
  let cycleMonthForRefresh = '';
  
  try {
    const sheet = getSheet(SHEET_NAMES.TRANSACTIONS);
    
    if (!rowIndex || rowIndex <= 1) {
      throw new Error('유효하지 않은 행 번호입니다.');
    }

    // 삭제할 거래의 주기월 가져오기 (캐시 무효화용)
    cycleMonthForRefresh = formatCycleMonth(
      sheet.getRange(rowIndex, COL_INDICES.CYCLE_MONTH).getValue()
    );
    
    // 행 삭제
    sheet.deleteRow(rowIndex);
    SpreadsheetApp.flush();
    
    // 캐시 무효화
    if (cycleMonthForRefresh) {
      CacheService.getScriptCache().remove('trans_' + cycleMonthForRefresh);
    }
    
    return { 
      success: true, 
      message: '거래가 삭제되었습니다.',
      cycleMonthForRefresh 
    };
    
  } catch (err) {
    Logger.log(`deleteTransaction 오류: ${err.stack}`);
    
    // 오류 발생 시에도 캐시 무효화 시도
    if (cycleMonthForRefresh) {
      try {
        CacheService.getScriptCache().remove('trans_' + cycleMonthForRefresh);
      } catch (cacheErr) {
        Logger.log(`캐시 무효화 실패: ${cacheErr.message}`);
      }
    }
    
    return { 
      success: false, 
      message: `삭제 중 오류: ${err.message}` 
    };
  }
}

/* ── 6. 앱 설정 및 기준 데이터 조회 함수들 ─────────────────── */
function getAppSetupData(initialCycleMonth) {
  try {
    // 기본 설정 데이터 로드
    const categories = getExpenseCategories();
    const methods = getPaymentMethods();
    const sources = getIncomeSources();
    
    // 초기 거래 데이터 로드 (옵션)
    let initialTransactionsData = { data: [], success: true };
    
    if (initialCycleMonth) {
      const transResult = getTransactions(initialCycleMonth);
      if (!transResult.success) {
        initialTransactionsData = { 
          data: [], 
          success: false, 
          error: transResult.error 
        };
      } else {
        initialTransactionsData.data = transResult.data;
      }
    }
    
    // 응답 데이터 구성
    const response = {
      success: true,
      expenseCategories: categories.error ? {} : categories,
      paymentMethods: methods.error ? [] : methods,
      incomeSources: sources.error ? [] : sources,
      initialTransactions: initialTransactionsData.data
    };
    
    // 오류 발생한 부분이 있는지 체크
    const hasErrors = categories.error || methods.error || sources.error || !initialTransactionsData.success;
    if (hasErrors) {
      response.success = false;
      response.error = "초기 설정 데이터 일부 로딩 실패";
    }
    
    return response;
    
  } catch (err) {
    Logger.log(`getAppSetupData 오류: ${err.stack}`);
    return { 
      success: false, 
      error: `앱 초기 설정 데이터 로딩 중 오류 발생: ${err.message}` 
    };
  }
}

function getExpenseCategories() {
  try {
    return getCached('expenseCategories_v2', () => {
      const sheet = getSheet(SHEET_NAMES.EXPENSE_CATEGORIES);
      const lastRow = sheet.getLastRow();
      
      if (lastRow < 2) {
        return {};
      }
      
      const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      const categoryMap = {};
      
      values.forEach(([mainCategory, subCategory]) => {
        if (!mainCategory) return;
        
        const main = String(mainCategory).trim();
        if (!categoryMap[main]) {
          categoryMap[main] = [];
        }
        
        if (subCategory) {
          categoryMap[main].push(String(subCategory).trim());
        }
      });
      
      return categoryMap;
    });
    
  } catch (err) {
    Logger.log(`getExpenseCategories 오류: ${err.message}`);
    return { error: "비용 카테고리 로드 실패" };
  }
}

function getPaymentMethods() {
  try {
    return getCached('paymentMethods_v2', () => {
      const sheet = getSheet(SHEET_NAMES.PAYMENT_METHODS);
      const lastRow = sheet.getLastRow();
      
      if (lastRow < 2) {
        return [];
      }
      
      const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
      
      return values
        .filter(row => row[0]) // 이름이 있는 것만
        .map(([name, isCardStr, target]) => ({
          name: String(name).trim(),
          isCard: String(isCardStr).toLowerCase() === 'true',
          target: Number(target) || 0
        }));
    });
    
  } catch (err) {
    Logger.log(`getPaymentMethods 오류: ${err.message}`);
    return { error: "결제 수단 로드 실패" };
  }
}

function getIncomeSources() {
  try {
    return getCached('incomeSources_v2', () => {
      const sheet = getSheet(SHEET_NAMES.INCOME_SOURCES);
      const lastRow = sheet.getLastRow();
      
      if (lastRow < 2) {
        return [];
      }
      
      return sheet.getRange(2, 1, lastRow - 1, 1)
        .getValues()
        .flat()
        .map(source => String(source).trim())
        .filter(Boolean);
    });
    
  } catch (err) {
    Logger.log(`getIncomeSources 오류: ${err.message}`);
    return { error: "수입원 로드 실패" };
  }
}

function getCardData(cardName, cycleMonthForBilling, performanceReferenceMonth) {
  try {
    if (!cardName) {
      throw new Error('카드명이 필요합니다.');
    }
    
    const sheet = getSheet(SHEET_NAMES.TRANSACTIONS);
    
    // 청구월 거래 내역에서 해당 카드 사용액 계산
    const allTransactionsForBillingMonth = getTransactions(cycleMonthForBilling);
    if (!allTransactionsForBillingMonth.success) {
      throw new Error(allTransactionsForBillingMonth.error);
    }
    
    let billingAmount = 0;
    (allTransactionsForBillingMonth.data || []).forEach(transaction => {
      if (transaction.paymentMethod === cardName && transaction.type === '지출') {
        billingAmount += transaction.amount;
      }
    });
    
    // 실적 기준월의 카드 사용액 계산
    const performanceYear = Number(String(performanceReferenceMonth).slice(0, 4));
    const performanceMonth = Number(String(performanceReferenceMonth).slice(5));
    let performanceAmount = 0;
    
    if (sheet.getLastRow() > 1) {
      const allRows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
      
      allRows.forEach(row => {
        const dateObj = new Date(row[COL_INDICES.DATE - 1]);
        const isTargetCard = String(row[COL_INDICES.PAYMENT_METHOD - 1]) === cardName;
        const isExpense = String(row[COL_INDICES.TYPE - 1]) === '지출';
        const isTargetMonth = dateObj.getFullYear() === performanceYear && 
                             (dateObj.getMonth() + 1) === performanceMonth;
        
        if (isTargetCard && isExpense && isTargetMonth) {
          performanceAmount += Number(row[COL_INDICES.AMOUNT - 1]) || 0;
        }
      });
    }
    
    // 카드 목표 금액 조회
    const paymentMethods = getPaymentMethods();
    if (paymentMethods.error) {
      throw new Error(paymentMethods.error);
    }
    
    const cardInfo = (paymentMethods || []).find(method => method.name === cardName);
    
    return {
      success: true,
      cardName,
      billingAmount,
      performanceAmount,
      performanceTarget: cardInfo ? cardInfo.target : 0,
      billingCycleMonthForCard: cycleMonthForBilling,
      performanceReferenceMonthForDisplay: performanceReferenceMonth
    };
    
  } catch (err) {
    Logger.log(`getCardData 오류: ${err.stack}`);
    return { 
      success: false, 
      error: '카드 데이터 조회 오류' 
    };
  }
}

/* ── 7. 이벤트 핸들러 ─────────────────── */
function onEdit(e) {
  const sheet = e.range.getSheet();
  const cache = CacheService.getScriptCache();
  
  // 지출 카테고리 시트 편집 시 캐시 무효화
  if (sheet.getName() === SHEET_NAMES.EXPENSE_CATEGORIES) {
    cache.remove('expenseCategories_v2');
    Logger.log('지출 카테고리 캐시 무효화');
    return;
  }
  
  // 거래 시트 편집 시 해당 주기월 캐시 무효화
  if (sheet.getName() === SHEET_NAMES.TRANSACTIONS) {
    const cycleMonth = formatCycleMonth(
      sheet.getRange(e.range.getRow(), COL_INDICES.CYCLE_MONTH).getValue()
    );
    if (cycleMonth) {
      cache.remove('trans_' + cycleMonth);
      Logger.log(`거래 데이터 캐시 무효화: ${cycleMonth}`);
    }
  }
  
  // 결제 수단 시트 편집 시 캐시 무효화
  if (sheet.getName() === SHEET_NAMES.PAYMENT_METHODS) {
    cache.remove('paymentMethods_v2');
    Logger.log('결제 수단 캐시 무효화');
  }
  
  // 수입원 시트 편집 시 캐시 무효화
  if (sheet.getName() === SHEET_NAMES.INCOME_SOURCES) {
    cache.remove('incomeSources_v2');
    Logger.log('수입원 캐시 무효화');
  }
}
