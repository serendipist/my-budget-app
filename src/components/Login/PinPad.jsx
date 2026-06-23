import React, { useState } from 'react';

const PinPad = ({ onLogin }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const handleNumberClick = (num) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
      setError('');
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin.length === 4) {
      const success = onLogin(pin);
      if (!success) {
        setError('비밀번호가 올바르지 않습니다.');
        setPin('');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F9F8] flex items-center justify-center p-4 font-sans">
      <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-md border border-gray-200/50 p-6 md:p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="충남고 로고" className="h-16 mx-auto mb-4 object-contain" />
          <p className="text-xs text-gray-500 mb-1">2026학년도</p>
          <h1 className="text-xl font-bold text-gray-800">충남고등학교 외부활동용 출석체크</h1>
          <p className="text-sm text-gray-500 mt-2">부여받은 PIN 번호를 입력하세요</p>
        </div>
        
        <div className="flex justify-center gap-4 mb-8">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? 'bg-blue-600' : 'bg-gray-200'}`} />
          ))}
        </div>

        {error && <p className="text-red-500 text-center mb-4 text-sm font-medium">{error}</p>}

        <div className="grid grid-cols-3 gap-4 mb-6">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => handleNumberClick(num.toString())}
              className="h-16 text-2xl font-semibold bg-gray-50 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
            >
              {num}
            </button>
          ))}
          <div className="h-16"></div>
          <button
            onClick={() => handleNumberClick('0')}
            className="h-16 text-2xl font-semibold bg-gray-50 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            className="h-16 text-lg font-semibold text-gray-600 bg-gray-50 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            지우기
          </button>
        </div>

        <button
          onClick={handleSubmit}
          disabled={pin.length !== 4}
          className={`w-full py-4 rounded-xl text-white font-bold text-lg transition-colors ${
            pin.length === 4 ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-300 cursor-not-allowed'
          }`}
        >
          확인
        </button>
      </div>
    </div>
  );
};

export default PinPad;
