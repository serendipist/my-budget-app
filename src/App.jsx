import React, { useState, useEffect } from 'react';
import PinPad from './components/Login/PinPad';
import TeacherDashboard from './components/Dashboard/TeacherDashboard';
import AdminDashboard from './components/Dashboard/AdminDashboard';
import { pinMapping, MASTER_PIN } from './config/pinMapping';
import appData from './data/appData.json';

function App() {
  const [loggedInUser, setLoggedInUser] = useState(null); // { name: "", role: "teacher" | "admin" }

  useEffect(() => {
    // 로컬 스토리지에서 자동 로그인 확인
    const savedUser = localStorage.getItem('attendance_user');
    if (savedUser) {
      const parsed = JSON.parse(savedUser);
      // 24시간 체크
      if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
        setLoggedInUser(parsed.user);
      } else {
        localStorage.removeItem('attendance_user');
      }
    }
  }, []);

  const handleLogin = (pin) => {
    if (pin === MASTER_PIN) {
      const adminUser = { name: "관리자", role: "admin" };
      setLoggedInUser(adminUser);
      localStorage.setItem('attendance_user', JSON.stringify({ user: adminUser, timestamp: Date.now() }));
      return true;
    }
    
    if (pinMapping[pin]) {
      const teacherInfo = pinMapping[pin];
      const teacherData = appData.teachers[teacherInfo.name] || {};
      const teacherUser = { ...teacherInfo, ...teacherData, role: "teacher" };
      setLoggedInUser(teacherUser);
      localStorage.setItem('attendance_user', JSON.stringify({ user: teacherUser, timestamp: Date.now() }));
      return true;
    }
    return false;
  };

  const handleLogout = () => {
    setLoggedInUser(null);
    localStorage.removeItem('attendance_user');
  };

  if (!loggedInUser) {
    return <PinPad onLogin={handleLogin} />;
  }

  if (loggedInUser.role === "admin") {
    return <AdminDashboard appData={appData} onLogout={handleLogout} />;
  }

  return <TeacherDashboard teacher={loggedInUser} appData={appData} onLogout={handleLogout} />;
}

export default App;
