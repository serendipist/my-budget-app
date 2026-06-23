import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, update } from 'firebase/database';

// TODO: 선생님의 실제 Firebase 프로젝트 정보로 교체해야 합니다.
// 개발/테스트용 임시 설정 (이후 Vercel 환경변수로 뺄 예정입니다)
const firebaseConfig = {
  apiKey: "AIzaSyBdj0uPtrkuEoBNkR-uN4nigbY1Tigh6pA",
  authDomain: "attendance-app-f0d06.firebaseapp.com",
  projectId: "attendance-app-f0d06",
  storageBucket: "attendance-app-f0d06.firebasestorage.app",
  messagingSenderId: "803982676925",
  appId: "1:803982676925:web:987911178e0e37ce2fb8d4",
  databaseURL: "https://attendance-app-f0d06-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

// DB 쓰기 함수 (학생 출결 업데이트)
export const updateAttendance = (date, studentId, period, status, reason = "") => {
  // period: 1, 2, 3, 4 (교시)
  // status: true (출석), false (결석)
  const attendanceRef = ref(db, `attendance/${date}/${studentId}/${period}`);
  return set(attendanceRef, { status, reason });
};

// 학생 일괄 출석 업데이트 (다수 학생)
export const updateBulkAttendance = (date, allStudentsUpdates) => {
  // allStudentsUpdates: { studentId: { 1: {status, reason}, 2: ... }, ... }
  const updates = {};
  for (const [studentId, periods] of Object.entries(allStudentsUpdates)) {
    for (const [period, data] of Object.entries(periods)) {
      updates[`attendance/${date}/${studentId}/${period}`] = data;
    }
  }
  return update(ref(db), updates);
};
