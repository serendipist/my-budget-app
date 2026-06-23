import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../services/firebase';
import { ref, onValue } from 'firebase/database';

const AdminDashboard = ({ appData, onLogout }) => {
  const [attendanceData, setAttendanceData] = useState({});
  const [filterType, setFilterType] = useState('all'); // 'all', 'hr', 'club'
  const [filterValue, setFilterValue] = useState('');
  
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const attendanceRef = ref(db, `attendance/${today}`);
    const unsubscribe = onValue(attendanceRef, (snapshot) => {
      setAttendanceData(snapshot.val() || {});
    });
    return () => unsubscribe();
  }, [today]);

  // Extract unique classes and clubs
  const { classes, clubs } = useMemo(() => {
    const clsSet = new Set();
    const clbSet = new Set();
    Object.values(appData.students).forEach(st => {
      const grade = st.id[0];
      const classNum = parseInt(st.id.slice(1, 3), 10);
      clsSet.add(`${grade}학년 ${classNum}반`);
      if (st.club) clbSet.add(st.club);
    });
    // sort classes numerically, clubs alphabetically
    const sortedClasses = Array.from(clsSet).sort();
    const sortedClubs = Array.from(clbSet).sort();
    return { classes: sortedClasses, clubs: sortedClubs };
  }, [appData.students]);

  // Handle filter changes
  const handleFilterChange = (e) => {
    const val = e.target.value;
    if (val === 'all') {
      setFilterType('all');
      setFilterValue('');
    } else if (val.startsWith('hr:')) {
      setFilterType('hr');
      setFilterValue(val.replace('hr:', ''));
    } else if (val.startsWith('club:')) {
      setFilterType('club');
      setFilterValue(val.replace('club:', ''));
    }
  };

  // Filter students based on selection
  const filteredStudents = useMemo(() => {
    const list = Object.values(appData.students);
    list.sort((a, b) => parseInt(a.id) - parseInt(b.id));

    if (filterType === 'all') return list;
    
    return list.filter(st => {
      if (filterType === 'hr') {
        const grade = st.id[0];
        const classNum = parseInt(st.id.slice(1, 3), 10);
        return `${grade}학년 ${classNum}반` === filterValue;
      }
      if (filterType === 'club') {
        return st.club === filterValue;
      }
      return true;
    });
  }, [appData.students, filterType, filterValue]);

  const exportToCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "학번,이름,동아리,전화번호,1교시,1교시_사유,2교시,2교시_사유,3교시,3교시_사유,4교시,4교시_사유\n";

    filteredStudents.forEach(st => {
      const row = [st.id, st.name, st.club || "", st.phone || ""];
      [1, 2, 3, 4].forEach(p => {
        const d = attendanceData[st.id]?.[p] || { status: false, reason: "" };
        row.push(d.status ? "O" : "X");
        row.push(d.status ? "" : (d.reason || "결석"));
      });
      csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const fileName = filterType === 'all' ? `전체출결_${today}.csv` : `${filterValue}_출결_${today}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#F9F9F8] p-2 md:p-4 font-sans">
      <header className="sticky top-0 z-10 flex flex-col md:flex-row justify-between items-start md:items-center bg-white/70 backdrop-blur-md p-3 md:p-4 rounded-xl shadow-sm mb-4 border border-white/40">
        <div>
          <p className="text-xs text-gray-500 mb-0.5">충남고등학교 외부활동용 출석체크</p>
          <h1 className="text-lg md:text-xl font-bold text-gray-800">마스터 관리자 대시보드</h1>
        </div>
        
        <div className="flex w-full md:w-auto gap-2 mt-3 md:mt-0 flex-wrap">
          <select 
            onChange={handleFilterChange} 
            className="px-3 py-1.5 text-sm rounded-lg font-bold bg-white text-gray-700 border border-gray-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">🌐 전체 명단 보기</option>
            <optgroup label="학급별 보기">
              {classes.map(c => <option key={`hr:${c}`} value={`hr:${c}`}>{c}</option>)}
            </optgroup>
            <optgroup label="동아리별 보기">
              {clubs.map(c => <option key={`club:${c}`} value={`club:${c}`}>{c}</option>)}
            </optgroup>
          </select>

          <button onClick={exportToCSV} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow-sm">
            엑셀 다운로드
          </button>
          <button onClick={onLogout} className="px-3 py-1.5 text-xs bg-gray-200/80 rounded-lg hover:bg-gray-300 font-semibold shadow-sm border border-gray-300/50">
            로그아웃
          </button>
        </div>
      </header>

      {/* 통계 (선택된 그룹 기준) */}
      <div className="mb-3 px-1">
        <p className="text-xs text-gray-500 font-medium">현재 필터: <span className="font-bold text-gray-800">{filterType === 'all' ? '전체 명단' : filterValue}</span> ({filteredStudents.length}명)</p>
      </div>

      <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-gray-200/50 overflow-x-auto">
        <table className="w-full text-left border-collapse whitespace-nowrap text-xs md:text-sm">
          <thead>
            <tr className="bg-gray-100/50 border-b border-gray-200">
              <th className="p-2 font-bold text-gray-600 text-center">학번</th>
              <th className="p-2 font-bold text-gray-600 text-center">이름</th>
              <th className="p-2 font-bold text-gray-600">동아리</th>
              <th className="p-2 font-bold text-gray-600 text-center">1교시</th>
              <th className="p-2 font-bold text-gray-600 text-center">2교시</th>
              <th className="p-2 font-bold text-gray-600 text-center">3교시</th>
              <th className="p-2 font-bold text-gray-600 text-center">4교시</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.length === 0 ? (
              <tr><td colSpan="7" className="p-8 text-center text-gray-500">조회된 학생이 없습니다.</td></tr>
            ) : (
              filteredStudents.map(st => (
                <tr key={st.id} className="border-b border-gray-100/50 hover:bg-gray-50/80 transition-colors">
                  <td className="p-2 text-center text-gray-500 font-medium">{st.id}</td>
                  <td className="p-2 text-center font-bold text-gray-800">
                    {st.name}
                    {st.phone && <div className="text-[10px] text-gray-400 font-normal leading-tight">{st.phone}</div>}
                  </td>
                  <td className="p-2 text-xs text-gray-600">{st.club}</td>
                  {[1, 2, 3, 4].map(p => {
                    const d = attendanceData[st.id]?.[p];
                    const status = d?.status ?? false;
                    return (
                      <td key={p} className="p-1 md:p-2 text-center align-middle">
                        {status ? (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-[#34C759]/20 text-[#248A3D] font-bold text-[10px]">O 출석</span>
                        ) : (
                          <span className="inline-block px-1.5 py-0.5 rounded bg-[#FF3B30]/10 text-[#FF3B30] font-bold text-[9px]">
                            X 결석 {d?.reason && <span className="font-normal block mt-0.5">({d.reason})</span>}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminDashboard;
