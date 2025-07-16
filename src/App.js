import React, { useEffect, useState } from 'react';
import WebApp from '@twa-dev/sdk';
import MazeGame from './maze_game.tsx';
import './App.css';

function App() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    try {
      WebApp.expand();
      
      // Убираем кнопку возвращения
      WebApp.MainButton.hide();
      
      // Получаем данные пользователя
      const userData = WebApp.initDataUnsafe?.user;
      if (userData) {
        setUser(userData);
      }
      
      // Устанавливаем тему
      const colorScheme = WebApp.colorScheme || 'light';
      setTheme(colorScheme);
      
      // Обновляем CSS переменные в соответствии с темой Telegram
      if (WebApp.themeParams) {
        document.documentElement.style.setProperty('--tg-bg-color', WebApp.themeParams.bg_color || '#ffffff');
        document.documentElement.style.setProperty('--tg-text-color', WebApp.themeParams.text_color || '#000000');
        document.documentElement.style.setProperty('--tg-button-color', WebApp.themeParams.button_color || '#007bff');
        document.documentElement.style.setProperty('--tg-button-text-color', WebApp.themeParams.button_text_color || '#ffffff');
      }
      
      WebApp.ready();
      setIsReady(true);
    } catch (error) {
      console.log('Telegram WebApp not available, running in browser mode');
      setIsReady(true);
    }
  }, []);

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl">🎯</div>
          <p>Загрузка игры...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <MazeGame user={user} theme={theme} />
    </div>
  );
}

export default App;
