import React, { useState, useEffect } from 'react';
import { updateAttendance, updateBulkAttendance, db } from '../../services/firebase';
import { ref, onValue } from 'firebase/database';

const TeacherDashboard = ({ teacher, appData, onLogout }) => {
  const [activeTab, setActiveTab] = useState(teacher.hr ? 'hr' : 'club');
  const [students, setStudents] = useState([]);
  const [attendanceData, setAttendanceData] = useState({});
  const [editingReason, setEditingReason] = useState({}); // { studentId: "reason text" }
  
  const today = new Date().toISOString().split('T')[0];
  const currentHour = new Date().getHours();
  const isLocked = currentHour >= 17;

  useEffect(() => {
    const loadStudents = () => {
      const list = [];
      const hrKey = teacher.hr;
      const clubKey = teacher.club;

      for (const [stId, data] of Object.entries(appData.students)) {
        let isMatch = false;
        if (activeTab === 'hr' && hrKey) {
          const grade = stId[0];
          const classNum = parseInt(stId.slice(1, 3), 10);
          if (hrKey === `${grade}학년 ${classNum}반`) isMatch = true;
        } else if (activeTab === 'club' && clubKey) {
          if (data.club === clubKey) isMatch = true;
        }
        if (isMatch) list.push(data);
      }
      list.sort((a, b) => parseInt(a.id) - parseInt(b.id));
      setStudents(list);
    };

    loadStudents();
  }, [activeTab, teacher, appData]);

  useEffect(() => {
    const attendanceRef = ref(db, `attendance/${today}`);
    const unsubscribe = onValue(attendanceRef, (snapshot) => {
      setAttendanceData(snapshot.val() || {});
    });
    return () => unsubscribe();
  }, [today]);

  const handleBulkCheck = async () => {
    if (isLocked) return alert("오후 5시 이후에는 수정할 수 없습니다.");
    if (!window.confirm("현재 명단의 모든 학생을 1~4교시 출석 처리하시겠습니까?")) return;
    
    const allStudentsUpdates = {};
    students.forEach(st => {
      allStudentsUpdates[st.id] = {};
      [1, 2, 3, 4].forEach(p => {
        allStudentsUpdates[st.id][p] = { status: true, reason: "" };
      });
    });
    
    try {
      await updateBulkAttendance(today, allStudentsUpdates);
      alert("일괄 출석 처리가 완료되었습니다.");
    } catch (e) {
      alert("오류가 발생했습니다.");
    }
  };

  const toggleAttendance = async (studentId, period, currentStatus, currentReason) => {
    if (isLocked) return alert("오후 5시 이후에는 수정할 수 없습니다.");
    const newStatus = !currentStatus;
    
    try {
      await updateAttendance(today, studentId, period, newStatus, currentReason);
    } catch (e) {
      alert("수정 실패");
    }
  };

  const handleReasonChange = (studentId, value) => {
    setEditingReason(prev => ({ ...prev, [studentId]: value }));
  };

  const saveReason = async (studentId, absentPeriods) => {
    if (isLocked) return;
    const reasonText = editingReason[studentId] || "";
    
    // 결석된 모든 교시에 동일한 사유를 저장합니다 (단일 비고란 적용)
    const updatesForStudent = {};
    [1, 2, 3, 4].forEach(p => {
      const d = attendanceData[studentId]?.[p];
      // 결석인 교시에만 사유를 넣고, 출석인 교시는 사유를 비웁니다.
      if (d && !d.status) {
        updatesForStudent[p] = { status: false, reason: reasonText };
      } else {
        const isPresent = d?.status ?? false;
        if (!isPresent) { // 데이터가 없어서 기본값 결석인 경우
          updatesForStudent[p] = { status: false, reason: reasonText };
        }
      }
    });
    
    if (Object.keys(updatesForStudent).length > 0) {
      const allUpdates = { [studentId]: updatesForStudent };
      try {
        await updateBulkAttendance(today, allUpdates);
      } catch(e) {
        alert("사유 저장 실패");
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F9F8] p-2 md:p-4 pb-20 font-sans">
      {/* 글래스모피즘 헤더 */}
      <header className="sticky top-0 z-10 flex flex-col md:flex-row justify-between items-start md:items-center bg-white/70 backdrop-blur-md p-3 md:p-4 rounded-xl shadow-sm mb-4 border border-white/40">
        <div>
          <p className="text-xs text-gray-500 mb-0.5">충남고등학교 외부활동용 출석체크</p>
          <h1 className="text-lg md:text-xl font-bold text-gray-800">{teacher.name} 선생님</h1>
          {isLocked && <p className="text-red-500 font-bold text-xs mt-1">수정 마감됨</p>}
        </div>
        
        <div className="flex w-full md:w-auto gap-2 mt-3 md:mt-0">
          {teacher.hr && (
            <button 
              onClick={() => setActiveTab('hr')}
              className={`flex-1 md:flex-none px-3 py-1.5 text-sm rounded-lg font-bold transition-all shadow-sm ${activeTab === 'hr' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}
            >
              학급 ({teacher.hr})
            </button>
          )}
          {teacher.club && (
            <button 
              onClick={() => setActiveTab('club')}
              className={`flex-1 md:flex-none px-3 py-1.5 text-sm rounded-lg font-bold transition-all shadow-sm ${activeTab === 'club' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}
            >
              동아리 ({teacher.club})
            </button>
          )}
        </div>
      </header>

      {/* 액션 버튼 */}
      <div className="flex justify-between items-center mb-3 px-1">
        <button 
          onClick={handleBulkCheck} 
          disabled={isLocked}
          className={`px-3 py-2 text-sm rounded-lg font-bold text-white shadow-md transition-all ${isLocked ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#34C759] hover:bg-[#28A745] active:scale-95'}`}
        >
          ✅ 1~4교시 일괄 출석
        </button>
        <button onClick={onLogout} className="px-3 py-1.5 text-xs bg-gray-200/80 backdrop-blur-sm rounded-lg hover:bg-gray-300 font-semibold shadow-sm border border-gray-300/50">
          로그아웃
        </button>
      </div>

      {/* 표 (Table) - 글래스모피즘 적용 */}
      <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-gray-200/50 overflow-x-auto">
        <table className="w-full text-left border-collapse whitespace-nowrap text-xs md:text-sm">
          <thead>
            <tr className="bg-gray-100/50 border-b border-gray-200">
              <th className="p-2 font-bold text-gray-600 text-center">학번</th>
              <th className="p-2 font-bold text-gray-600 text-center">이름</th>
              <th className="p-2 font-bold text-gray-600 text-center">1교시</th>
              <th className="p-2 font-bold text-gray-600 text-center">2교시</th>
              <th className="p-2 font-bold text-gray-600 text-center">3교시</th>
              <th className="p-2 font-bold text-gray-600 text-center">4교시</th>
              <th className="p-2 font-bold text-gray-600">비고 (사유)</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
              <tr>
                <td colSpan="7" className="p-8 text-center text-gray-500 bg-white/50">
                  해당 명단에 배정된 학생이 없습니다.
                </td>
              </tr>
            ) : (
              students.map(st => {
                const periods = [1, 2, 3, 4];
                const absentPeriods = periods.filter(p => {
                  const d = attendanceData[st.id]?.[p];
                  return d ? !d.status : true; 
                });
                
                // 표시할 사유: 입력중인 텍스트가 있으면 그것을, 아니면 기존 데이터의 첫 번째 사유를 표시
                let displayReason = editingReason[st.id] ?? "";
                if (displayReason === "" && absentPeriods.length > 0) {
                  for (let p of absentPeriods) {
                    if (attendanceData[st.id]?.[p]?.reason) {
                      displayReason = attendanceData[st.id][p].reason;
                      break;
                    }
                  }
                }

                return (
                  <tr key={st.id} className="border-b border-gray-100/50 hover:bg-gray-50/80 transition-colors">
                    <td className="p-2 text-center text-gray-500 font-medium">{st.id}</td>
                    <td className="p-2 text-center font-bold text-gray-800">
                      {st.name}
                      {st.phone && <div className="text-[10px] text-gray-400 font-normal leading-tight">{st.phone}</div>}
                    </td>
                    
                    {periods.map(p => {
                      const d = attendanceData[st.id]?.[p];
                      const isPresent = d?.status ?? false;
                      const currentReason = displayReason;
                      
                      return (
                        <td key={p} className="p-1 md:p-2 text-center align-middle">
                          <label className="relative inline-flex items-center cursor-pointer m-0 p-0">
                            <input 
                              type="checkbox" 
                              className="sr-only peer"
                              checked={isPresent}
                              disabled={isLocked}
                              onChange={() => toggleAttendance(st.id, p, isPresent, currentReason)}
                            />
                            <div className={`w-10 h-5 bg-[#FF3B30]/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:shadow-sm after:border-gray-200 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#34C759] ${isLocked ? 'opacity-50' : ''}`}></div>
                            <span className="absolute left-1.5 text-[9px] font-bold text-[#FF3B30] peer-checked:hidden">결석</span>
                            <span className="absolute right-1 text-[9px] font-bold text-white hidden peer-checked:block">출석</span>
                          </label>
                        </td>
                      );
                    })}
                    
                    <td className="p-2">
                      {absentPeriods.length > 0 ? (
                        <input
                          type="text"
                          placeholder="사유 (조퇴 등)"
                          value={editingReason[st.id] !== undefined ? editingReason[st.id] : displayReason}
                          onChange={(e) => handleReasonChange(st.id, e.target.value)}
                          onBlur={() => saveReason(st.id, absentPeriods)}
                          disabled={isLocked}
                          className="border border-gray-300/60 bg-white/50 rounded-md px-2 py-1 text-xs w-28 md:w-40 focus:outline-none focus:ring-2 focus:ring-blue-400/50 shadow-inner"
                        />
                      ) : (
                        <span className="text-[10px] text-gray-400 italic block mt-1">해당없음</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TeacherDashboard;
