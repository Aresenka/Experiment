import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebApp from '@twa-dev/sdk';
import { gameAPI } from './supabase';

// Типы для игры
interface Position {
  x: number;
  y: number;
}

type Direction = 'up' | 'down' | 'left' | 'right';
type GameState = 'menu' | 'playing' | 'won' | 'lost' | 'leaderboards' | 'donations';
type GameMode = 'training' | 'real';

interface MazeGameProps {
  user?: any;
  theme?: 'light' | 'dark';
}

// Генерация лабиринта алгоритмом рекурсивного backtracking
// Размер 17x17 для повышенной сложности и низкого винрейта ~7%
const generateMaze = (width = 17, height = 17): number[][] => {
  const maze: number[][] = Array(height).fill(null).map(() => Array(width).fill(1)); // 1 = стена
  
  const directions: [number, number][] = [
    [0, -2], [2, 0], [0, 2], [-2, 0] // север, восток, юг, запад (шаг 2)
  ];
  
  const stack: [number, number][] = [];
  const start: [number, number] = [1, 1];
  maze[start[1]][start[0]] = 0; // 0 = проход
  stack.push(start);
  
  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1];
    const neighbors: [number, number][] = [];
    
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && maze[ny][nx] === 1) {
        neighbors.push([nx, ny]);
      }
    }
    
    if (neighbors.length > 0) {
      const [nx, ny] = neighbors[Math.floor(Math.random() * neighbors.length)];
      maze[ny][nx] = 0;
      maze[y + (ny - y) / 2][x + (nx - x) / 2] = 0; // убираем стену между
      stack.push([nx, ny]);
    } else {
      stack.pop();
    }
  }
  
  return maze;
};


const MazeGame = ({ user, theme }: MazeGameProps) => {
  // Список дебаг пользователей (вы + партнеры)
  const DEBUG_USER_IDS = [
    // 379502446,  // @Scilef
    282577511, //@Wezekable
    // 409022180 //@mdakekv
  ];
  // Список пользователей, которым разрешено играть с ПК (для разработки)
  // Чтобы добавить себя: раскомментируйте строку ниже и замените на свой Telegram ID
  const ALLOW_PC_PLAY: number[] = [
    379502446, // @Scilef
  ];
  const isDebugUser = user?.id && DEBUG_USER_IDS.includes(user.id);

  // Вспомогательная функция для проверки мобильного устройства через браузер
  const checkBrowserMobileDevice = useCallback(() => {
    // Проверяем User Agent
    const userAgent = navigator.userAgent.toLowerCase();
    const mobileKeywords = ['android', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone', 'mobile', 'tablet'];
    const hasMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));
    
    // Проверяем размер экрана (мобильные устройства обычно имеют ширину меньше 768px)
    const isMobileScreen = window.innerWidth <= 768;
    
    // Проверяем наличие сенсорного экрана
    const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    return hasMobileUA || (isMobileScreen && hasTouchScreen);
  }, []);

  // Функция проверки мобильного устройства с использованием Telegram WebApp SDK
  const isMobileDevice = useCallback(() => {
    // Приоритет: используем Telegram WebApp SDK для определения платформы
    if (WebApp && WebApp.platform) {
      const platform = WebApp.platform.toLowerCase();
      console.log('Telegram WebApp platform:', platform);
      
      // Telegram WebApp платформы: android, ios, macos, windows, linux, web
      const mobilePlatforms = ['android', 'ios'];
      const isTelegramMobile = mobilePlatforms.includes(platform);
      
      // Если это веб-версия в Telegram, дополнительно проверяем устройство
      if (platform === 'web') {
        return checkBrowserMobileDevice();
      }
      
      return isTelegramMobile;
    }
    
    // Fallback: проверяем через браузер, если SDK недоступен
    return checkBrowserMobileDevice();
  }, [checkBrowserMobileDevice]);

  // Проверяем, может ли пользователь играть с ПК
  const canPlayOnPC = user?.id && ALLOW_PC_PLAY.includes(user.id);
  
  // Проверяем, разрешена ли игра на текущем устройстве
  const isDeviceAllowed = isMobileDevice() || canPlayOnPC;

  // НАСТРОЙКИ БАЛАНСА ИГРЫ (легко настраивать)
  const GAME_SETTINGS = {
    MIN_PRIZE_VALUE: 0.5,
    // Размер лабиринта
    MAZE_SIZE: 19,
    
    // Время на игру (секунды)
    GAME_TIME: 30,
    
    // Стоимость платной попытки
    PAID_ATTEMPT_COST: 9,
    
    // Размещение приза
    PRIZE_MIN_DISTANCE: 15,  // минимальное расстояние до приза
    PRIZE_MAX_DISTANCE: 30,  // максимальное расстояние до приза
    
    // Стартовая позиция игрока
    START_X: 1,
    START_Y: 1,
  };

  const [gameState, setGameState] = useState<GameState>('menu');
  const [gameMode, setGameMode] = useState<GameMode>('training');
  const [maze, setMaze] = useState<number[][]>([]);
  const [playerPos, setPlayerPos] = useState<Position>({ x: 1, y: 1 }); // Начальная позиция, будет перезаписана при старте игры
  const [prizePos, setPrizePos] = useState<Position>({ x: 0, y: 0 });
  const [timeLeft, setTimeLeft] = useState(GAME_SETTINGS.GAME_TIME);
  const [hasFreeTry, setHasFreeTry] = useState(true);
  const [stepCount, setStepCount] = useState(0);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [gameStartTime, setGameStartTime] = useState<number>(0);
  const [cooldownTime, setCooldownTime] = useState(0);
  const [prizeValue, setPrizeValue] = useState<string>(`от ${GAME_SETTINGS.MIN_PRIZE_VALUE}$`); // Стоимость текущего приза
  const [playerStats, setPlayerStats] = useState({
    total_attempts: 0,
    total_wins: 0,
    total_spent_stars: 0
  });
  
  // Добавляем ref для таймера
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // ДОБАВЛЯЕМ новые состояния для защиты от повторного получения приза
  const [isPrizeClaimed, setIsPrizeClaimed] = useState(false);
  const [isClaimingPrize, setIsClaimingPrize] = useState(false);
  const [prizeClaimAttempts, setPrizeClaimAttempts] = useState(0); // НОВОЕ: счетчик попыток
  const [lastActionTime, setLastActionTime] = useState(0); // НОВОЕ: защита от спама
  const [showMap, setShowMap] = useState(false); // Состояние для показа/скрытия карты

  // Добавляем состояния для управления звуком
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);

  // Инициализация Telegram WebApp
  useEffect(() => {
    WebApp.requestFullscreen();
    WebApp.disableVerticalSwipes();
    WebApp.disableClosingConfirmation();
    WebApp.expand();
    
    // Блокируем смену ориентации на портретную
    const lockOrientation = async () => {
      try {
        // Проверяем поддержку Screen Orientation API
        const screenAny = window.screen as any;
        if (screenAny.orientation && typeof screenAny.orientation.lock === 'function') {
          await screenAny.orientation.lock('portrait');
          console.log('Ориентация заблокирована на портретную');
        } else if (screenAny.lockOrientation) {
          // Fallback для старых браузеров
          screenAny.lockOrientation('portrait');
          console.log('Ориентация заблокирована через legacy API');
        }
      } catch (error) {
        console.log('Не удалось заблокировать ориентацию:', error);
        
        // Fallback: добавляем CSS стили для принудительной портретной ориентации
        const style = document.createElement('style');
        style.textContent = `
          @media screen and (orientation: landscape) {
            html {
              transform: rotate(-90deg);
              transform-origin: left top;
              width: 100vh;
              overflow-x: hidden;
              position: absolute;
              top: 100%;
              left: 0;
            }
          }
        `;
        document.head.appendChild(style);
      }
    };
    
    lockOrientation();
    
    // Отключаем стандартные жесты браузера для свайпов
    const preventSwipe = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        e.preventDefault();
      }
    };
    
    document.addEventListener('touchmove', preventSwipe, { passive: false });
    
    return () => {
      document.removeEventListener('touchmove', preventSwipe);
    };
  }, []);

  // Проверка доступных направлений
  const getAvailableDirections = useCallback((): Direction[] => {
    const directions: Direction[] = [];
    const { x, y } = playerPos;
    
    if (maze[y - 1] && maze[y - 1][x] === 0) directions.push('up');
    if (maze[y + 1] && maze[y + 1][x] === 0) directions.push('down');
    if (maze[y] && maze[y][x - 1] === 0) directions.push('left');
    if (maze[y] && maze[y][x + 1] === 0) directions.push('right');
    
    return directions;
  }, [maze, playerPos]);
  
  // Проверка, нашёл ли игрок приз
  const checkForPrize = useCallback(() => {
    return playerPos.x === prizePos.x && playerPos.y === prizePos.y;
  }, [playerPos, prizePos]);
  
  // Создание аудио объектов для звуков
  const stepAudio = useRef<HTMLAudioElement | null>(null);
  const btnAudio = useRef<HTMLAudioElement | null>(null);
  const bgAudio = useRef<HTMLAudioElement | null>(null);
  const [audioInitialized, setAudioInitialized] = useState(false);
  const [btnAudioInitialized, setBtnAudioInitialized] = useState(false);
  const [bgAudioInitialized, setBgAudioInitialized] = useState(false);
  
  // Инициализация аудио при первом рендере
  useEffect(() => {
    // Звук шагов
    stepAudio.current = new Audio('/step.mp3');
    stepAudio.current.volume = 0.3;
    stepAudio.current.preload = 'auto';
    
    // Звук кнопок
    btnAudio.current = new Audio('/btn.mp3');
    btnAudio.current.volume = 0.4;
    btnAudio.current.preload = 'auto';

    // Фоновая музыка
    bgAudio.current = new Audio('/bg.mp3');
    bgAudio.current.volume = 0.2;
    bgAudio.current.loop = true;
    bgAudio.current.preload = 'auto';
    
    // Обработчики для звука шагов
    stepAudio.current.addEventListener('canplaythrough', () => {
      console.log('Аудио файл шагов загружен и готов к воспроизведению');
      setAudioInitialized(true);
    });
    
    stepAudio.current.addEventListener('error', (e) => {
      console.error('Ошибка загрузки аудио файла шагов:', e);
    });

    // Обработчики для звука кнопок
    btnAudio.current.addEventListener('canplaythrough', () => {
      console.log('Аудио файл кнопок загружен и готов к воспроизведению');
      setBtnAudioInitialized(true);
    });
    
    btnAudio.current.addEventListener('error', (e) => {
      console.error('Ошибка загрузки аудио файла кнопок:', e);
    });

    // Обработчики для фоновой музыки
    bgAudio.current.addEventListener('canplaythrough', () => {
      console.log('Фоновая музыка загружена и готова к воспроизведению');
      setBgAudioInitialized(true);
    });
    
    bgAudio.current.addEventListener('error', (e) => {
      console.error('Ошибка загрузки фоновой музыки:', e);
    });

    return () => {
      // Очистка при размонтировании
      if (bgAudio.current) {
        bgAudio.current.pause();
      }
    };
  }, []);

  // Инициализация аудио контекста при первом взаимодействии
  const initializeAudio = useCallback(async () => {
    if (stepAudio.current && !audioInitialized) {
      try {
        stepAudio.current.volume = 0;
        await stepAudio.current.play();
        stepAudio.current.pause();
        stepAudio.current.currentTime = 0;
        stepAudio.current.volume = 0.3;
        console.log('Аудио контекст шагов инициализирован');
      } catch (error) {
        console.log('Не удалось инициализировать аудио контекст шагов:', error);
      }
    }

    if (btnAudio.current && !btnAudioInitialized) {
      try {
        btnAudio.current.volume = 0;
        await btnAudio.current.play();
        btnAudio.current.pause();
        btnAudio.current.currentTime = 0;
        btnAudio.current.volume = 0.4;
        console.log('Аудио контекст кнопок инициализирован');
      } catch (error) {
        console.log('Не удалось инициализировать аудио контекст кнопок:', error);
      }
    }

    if (bgAudio.current && !bgAudioInitialized && musicEnabled) {
      try {
        bgAudio.current.volume = 0;
        await bgAudio.current.play();
        bgAudio.current.pause();
        bgAudio.current.currentTime = 0;
        bgAudio.current.volume = 0.2;
        console.log('Аудио контекст фоновой музыки инициализирован');
      } catch (error) {
        console.log('Не удалось инициализировать фоновую музыку:', error);
      }
    }
  }, [audioInitialized, btnAudioInitialized, bgAudioInitialized, musicEnabled]);

  // Функция воспроизведения звука шага
  const playStepSound = useCallback(async () => {
    if (!soundsEnabled) return;
    
    // Инициализируем аудио при первом взаимодействии
    if (!audioInitialized) {
      await initializeAudio();
    }

    if (stepAudio.current && audioInitialized) {
      try {
        stepAudio.current.currentTime = 0;
        const playPromise = stepAudio.current.play();
        
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.log('Не удалось воспроизвести звук шага:', error);
          });
        }
      } catch (error) {
        console.log('Ошибка воспроизведения звука шага:', error);
      }
    }
  }, [audioInitialized, soundsEnabled, initializeAudio]);

  // Функция воспроизведения звука шага с задержкой
  const playStepSoundWithDelay = useCallback(async () => {
    if (!soundsEnabled) return;
    
    // Инициализируем аудио при первом взаимодействии
    if (!audioInitialized) {
      await initializeAudio();
    }

    if (stepAudio.current && audioInitialized) {
      try {
        stepAudio.current.currentTime = 0;
        const playPromise = stepAudio.current.play();
        
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.log('Не удалось воспроизвести звук шага:', error);
          });
        }
        
        // Добавляем задержку для синхронизации
        await new Promise(resolve => setTimeout(resolve, 150));
      } catch (error) {
        console.log('Ошибка воспроизведения звука шага:', error);
      }
    }
  }, [audioInitialized, soundsEnabled, initializeAudio]);

  // Функция воспроизведения звука кнопки
  const playBtnSound = useCallback(async () => {
    // Отмечаем первое взаимодействие пользователя
    if (!hasUserInteracted) {
      setHasUserInteracted(true);
    }
    
    if (!soundsEnabled) return;
    
    // Инициализируем аудио при первом взаимодействии
    if (!btnAudioInitialized) {
      await initializeAudio();
    }

    if (btnAudio.current && btnAudioInitialized) {
      try {
        btnAudio.current.currentTime = 0;
        const playPromise = btnAudio.current.play();
        
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.log('Не удалось воспроизвести звук кнопки:', error);
          });
        }
      } catch (error) {
        console.log('Ошибка воспроизведения звука кнопки:', error);
      }
    }
  }, [btnAudioInitialized, initializeAudio, soundsEnabled, hasUserInteracted]);

  // Функция воспроизведения звука кнопки с задержкой
  const playBtnSoundWithDelay = useCallback(async () => {
    // Отмечаем первое взаимодействие пользователя
    if (!hasUserInteracted) {
      setHasUserInteracted(true);
    }
    
    if (!soundsEnabled) return;
    
    // Инициализируем аудио при первом взаимодействии
    if (!btnAudioInitialized) {
      await initializeAudio();
    }

    if (btnAudio.current && btnAudioInitialized) {
      try {
        btnAudio.current.currentTime = 0;
        const playPromise = btnAudio.current.play();
        
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.log('Не удалось воспроизвести звук кнопки:', error);
          });
        }
        
        // Добавляем задержку для синхронизации
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.log('Ошибка воспроизведения звука кнопки:', error);
      }
    }
  }, [btnAudioInitialized, initializeAudio, soundsEnabled, hasUserInteracted]);

  // Функция управления фоновой музыкой
  const toggleBackgroundMusic = useCallback(async () => {
    if (!bgAudio.current) return;

    // Музыка играет только в лабиринте
    const shouldPlayMusic = musicEnabled && gameState === 'playing';

    if (shouldPlayMusic) {
      // Включаем музыку
      if (!bgAudioInitialized) {
        await initializeAudio();
      }
      
      if (bgAudioInitialized) {
        try {
          bgAudio.current.currentTime = 0;
          bgAudio.current.volume = 0.2;
          await bgAudio.current.play();
        } catch (error) {
          console.log('Не удалось запустить фоновую музыку:', error);
        }
      }
    } else {
      // Выключаем музыку
      bgAudio.current.pause();
    }
  }, [musicEnabled, bgAudioInitialized, initializeAudio, gameState]);

  // Запуск/остановка фоновой музыки при изменении состояния игры или настроек
  useEffect(() => {
    if (hasUserInteracted) {
      toggleBackgroundMusic();
    }
  }, [musicEnabled, gameState, hasUserInteracted, toggleBackgroundMusic]);



  // Движение игрока
  const movePlayer = useCallback(async (direction: Direction) => {
    if (gameState !== 'playing') return;
    
    const directions = getAvailableDirections();
    if (!directions.includes(direction)) return;
    
    // Воспроизводим звук шага и ждем его завершения
    await playStepSoundWithDelay();
    
    setPlayerPos(prev => {
      const newPos = { ...prev };
      switch (direction) {
        case 'up': newPos.y -= 1; break;
        case 'down': newPos.y += 1; break;
        case 'left': newPos.x -= 1; break;
        case 'right': newPos.x += 1; break;
      }
      return newPos;
    });
    
    setStepCount(prev => prev + 1);
  }, [gameState, getAvailableDirections, playStepSoundWithDelay]);
  
  // Завершение игры и сохранение результатов
  const finishGameSession = useCallback(async (won: boolean) => {
    if (!currentSessionId || !user?.id) return;
    
    const timeSpent = Math.floor((Date.now() - gameStartTime) / 1000);
    const finalPosition = { x: playerPos.x, y: playerPos.y };
    const exitPosition = { x: prizePos.x, y: prizePos.y }; // В тренировочном режиме это выход
    
    try {
      if (gameMode === 'training') {
        // Используем API для тренировочного режима
        await gameAPI.finishTrainingSession(
          currentSessionId, 
          won, 
          stepCount, 
          timeSpent, 
          finalPosition, 
          exitPosition
        );
        
        // Обновляем статистику тренировок
        const newStats = await gameAPI.getTrainingStats(user.id);
        setPlayerStats({
          total_attempts: newStats.total_attempts,
          total_wins: newStats.total_wins,
          total_spent_stars: 0, // В тренировочном режиме не тратим звёзды
        });
      } else {
        // Используем старый API для реального режима
        await gameAPI.finishGame(currentSessionId, won, stepCount, timeSpent, finalPosition);
        
        // Обновляем статистику игрока
        const newStats = await gameAPI.getPlayerStats(user.id);
        setPlayerStats(newStats);
      }
    } catch (error) {
      console.error('Ошибка завершения игровой сессии:', error);
    }
  }, [currentSessionId, user?.id, gameStartTime, gameMode, stepCount, playerPos, prizePos]);

  // Функция выхода в меню во время игры
  const exitToMenu = useCallback(async () => {
    // Воспроизводим звук кнопки и ждем
    await playBtnSoundWithDelay();
    
    // Показываем подтверждение
    const confirmed = window.confirm('Вы уверены, что хотите выйти в меню? Прогресс игры будет потерян.');
    if (!confirmed) return;

    // Завершаем игровую сессию как проигрыш
    if (currentSessionId && user?.id) {
      await finishGameSession(false);
    }

    // Очищаем таймер
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Сбрасываем состояния игры
    setCurrentSessionId(null);
    setGameStartTime(0);
    setStepCount(0);
    setTimeLeft(GAME_SETTINGS.GAME_TIME);
    setIsPrizeClaimed(false);
    setIsClaimingPrize(false);
    setPrizeClaimAttempts(0);
    setShowMap(false);

    // Возвращаемся в меню
    setGameState('menu');
  }, [currentSessionId, user?.id, finishGameSession, playBtnSoundWithDelay]);

  // Получение приза (ИСПРАВЛЕНО - усиленная защита от повторных вызовов)
  const claimPrize = useCallback(async () => {
    // НЕ позволяем получать приз, если устройство не разрешено
    if (!isDeviceAllowed) {
      console.error('Получение приза недоступно на данном устройстве');
      return;
    }
    
    // Усиленная защита от повторных вызовов
    if (isPrizeClaimed || isClaimingPrize || !user?.id || !currentSessionId || prizeClaimAttempts >= 3) {
      if (prizeClaimAttempts >= 3) {
        alert('❌ Превышено количество попыток получения приза. Обратитесь в поддержку.');
      }
      return;
    }

    setIsClaimingPrize(true);
    setPrizeClaimAttempts(prev => prev + 1);

    try {
      // Добавляем дополнительную задержку для предотвращения спама
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Передаем дополнительные параметры для валидации
      const prizeLink = await gameAPI.getAvailablePrize(user.id, currentSessionId, {
        gameState: gameState,
        timeLeft: timeLeft,
        stepCount: stepCount,
        attemptNumber: prizeClaimAttempts
      });
      
      if (prizeLink && prizeLink !== 'https://example.com/demo-prize') {
        setIsPrizeClaimed(true);
        window.open(prizeLink, '_blank');
      } else if (prizeLink === 'https://example.com/demo-prize') {
        setIsPrizeClaimed(true);
        alert('🎉 Поздравляем с победой!\n\n⚠️ К сожалению, реальные призы временно закончились, но ваша победа засчитана!\n\nСледите за обновлениями - скоро добавим новые призы!');
      } else {
        alert('❌ Ошибка: Приз недоступен.\n\nВозможные причины:\n• Приз уже был получен\n• Сессия невалидна\n• Технические неполадки\n\nОбратитесь в поддержку.');
      }
    } catch (error) {
      console.error('Ошибка получения приза:', error);
      alert('Произошла ошибка при получении приза. Обратитесь в поддержку.');
    } finally {
      setIsClaimingPrize(false);
    }
  }, [user?.id, currentSessionId, isPrizeClaimed, isClaimingPrize, prizeClaimAttempts, gameState, timeLeft, stepCount, isDeviceAllowed]);

  // Проверка победы после каждого хода
  useEffect(() => {
    if (gameState === 'playing' && checkForPrize()) {
      setGameState('won');
      finishGameSession(true);
    }
  }, [gameState, checkForPrize, finishGameSession]);
  
  // Обработка клавиш
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); movePlayer('up'); break;
      case 'ArrowDown': e.preventDefault(); movePlayer('down'); break;
      case 'ArrowLeft': e.preventDefault(); movePlayer('left'); break;
      case 'ArrowRight': e.preventDefault(); movePlayer('right'); break;
    }
  }, [movePlayer]);
  
  // Переписываем таймер
  useEffect(() => {
    if (gameState === 'playing') {
      // Очищаем предыдущий таймер
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      
      // Запускаем новый таймер
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            setGameState('lost');
            // Завершаем игру
            if (currentSessionId && user?.id) {
              const timeSpent = Math.floor((Date.now() - gameStartTime) / 1000);
              gameAPI.finishGame(currentSessionId, false, stepCount, timeSpent, { x: playerPos.x, y: playerPos.y });
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      // Очищаем таймер когда игра не идет
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    
    // Cleanup при размонтировании
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [gameState]); // Только зависимость от gameState
  
  // Загрузка данных игрока при старте (ИЗМЕНЕНО для дебага)
  useEffect(() => {
    const loadPlayerData = async () => {
      if (!user?.id) return;
      
      // НЕ загружаем данные, если устройство не разрешено
      if (!isDeviceAllowed) return;
      
      try {
        // СОЗДАЕМ ИГРОКА ЗАРАНЕЕ (НОВОЕ)
        if (!isDebugUser) {
          try {
            await gameAPI.ensurePlayerExists(user.id, user.first_name, user.username);
          } catch (error) {
            console.error('Ошибка создания игрока:', error);
            // Не критичная ошибка, продолжаем
          }
        }
        
        // Для дебаг пользователя всегда разрешаем бесплатную игру
        if (isDebugUser) {
          setHasFreeTry(true);
          setCooldownTime(0);
        } else {
          // Проверяем доступность бесплатной попытки
          const canPlay = await gameAPI.canPlayFree(user.id);
          setHasFreeTry(canPlay);
          
          // Если не может играть бесплатно, получаем время до следующей попытки
          if (!canPlay) {
            const timeUntil = await gameAPI.getTimeUntilNextFree(user.id);
            setCooldownTime(timeUntil);
          }
        }
        
        // Загружаем статистику тренировок
        const stats = await gameAPI.getTrainingStats(user.id);
        setPlayerStats({
          total_attempts: stats.total_attempts,
          total_wins: stats.total_wins,
          total_spent_stars: 0, // В новой модели показываем уровень поддержки отдельно
        });
        
        // В новой модели не нужна стоимость приза для главного экрана
        // setPrizeValue остается пустым
      } catch (error) {
        console.error('Ошибка загрузки данных игрока:', error);
      }
    };
    
    loadPlayerData();
  }, [user, isDebugUser, isDeviceAllowed]);

  // Таймер cooldown (ИЗМЕНЕНО для дебага)
  useEffect(() => {
    // НЕ запускаем таймер, если устройство не разрешено
    if (!isDeviceAllowed) return;
    
    if (cooldownTime > 0 && !hasFreeTry && !isDebugUser) {
      const timer = setInterval(() => {
        setCooldownTime(prev => {
          if (prev <= 1) {
            setHasFreeTry(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => clearInterval(timer);
    }
  }, [cooldownTime, hasFreeTry, isDebugUser, isDeviceAllowed]);

  // Инициализация игры (ДОПОЛНЕНО - сброс счетчика попыток)
  const startGame = useCallback(async (mode: GameMode = 'training') => {
    // Воспроизводим звук кнопки и ждем
    await playBtnSoundWithDelay();
    
    // НЕ позволяем начать игру, если устройство не разрешено
    if (!isDeviceAllowed) {
      console.error('Игра недоступна на данном устройстве');
      return;
    }
    
    // ДОБАВЛЕНО: защита от спама
    const now = Date.now();
    if (now - lastActionTime < 1000) { // 1 секунда между стартами игр
      alert('⏱️ Подождите немного между играми');
      return;
    }
    setLastActionTime(now);
    
    if (!user?.id) {
      console.error('Пользователь не найден');
      return;
    }

    // Сбрасываем состояние приза при старте новой игры
    setIsPrizeClaimed(false);
    setIsClaimingPrize(false);
    setPrizeClaimAttempts(0); // НОВОЕ: сбрасываем счетчик
    setShowMap(false); // Сбрасываем показ карты
    setGameMode(mode); // Устанавливаем режим игры

    try {
      // Для тренировочного режима не нужны проверки доступности
      if (mode === 'real' && !isDebugUser) {
        const canPlay = await gameAPI.canPlayFree(user.id);
        if (!canPlay) {
          alert('❌ Попытка недоступна. Подождите окончания кулдауна.');
          return;
        }
      }

      // Регистрируем игровую сессию в зависимости от режима
      let sessionId;
      if (isDebugUser) {
        sessionId = crypto.randomUUID();
      } else if (mode === 'training') {
        // Используем новый API для тренировочного режима
        sessionId = await gameAPI.registerTrainingSession(
          user.id,
          user.first_name,
          user.username
        );
        
        if (!sessionId) {
          alert('❌ Не удалось зарегистрировать тренировочную сессию. Попробуйте позже.');
          return;
        }
      } else {
        // Регистрируем попытку в базе данных для реального режима
        sessionId = await gameAPI.registerAttempt(
          user.id,
          user.first_name,
          user.username,
          mode === 'real'
        );
        
        if (!sessionId) {
          alert('❌ Не удалось зарегистрировать попытку. Попробуйте позже.');
          return;
        }
      }
      
      setCurrentSessionId(sessionId);
      setGameStartTime(Date.now());
      
      // Обновляем стоимость приза на каждую новую игру
      try {
        const prizeVal = await gameAPI.getAvailablePrizeValue();
        setPrizeValue(prizeVal);
      } catch (error) {
        console.error('Ошибка обновления стоимости приза:', error);
      }
      
      // ПАРАМЕТРЫ ДЛЯ НАСТРОЙКИ СЛОЖНОСТИ:
      const mazeSize = GAME_SETTINGS.MAZE_SIZE;
      const newMaze = generateMaze(mazeSize, mazeSize);
      const startPos = getRandomStartPosition(newMaze); // Случайная стартовая позиция
      const prize = placePrize(newMaze, startPos);
      
      setMaze(newMaze);
      setPlayerPos(startPos);
      setPrizePos(prize);
      setTimeLeft(GAME_SETTINGS.GAME_TIME); // Уменьшаем время с 30 до 25 секунд
      setStepCount(0);
      setGameState('playing');
      
      if (mode === 'real' && !isDebugUser) {
        setHasFreeTry(false);
        // Обновляем cooldown
        const timeUntil = await gameAPI.getTimeUntilNextFree(user.id);
        setCooldownTime(timeUntil);
      }
    } catch (error) {
      console.error('Ошибка старта игры:', error);
    }
  }, [user, isDebugUser, lastActionTime, isDeviceAllowed, playBtnSoundWithDelay]);
  
  // Функция оплаты в звёздах
  const buyAttempt = useCallback(async () => {
    // Воспроизводим звук кнопки и ждем
    await playBtnSoundWithDelay();
    
    // НЕ позволяем покупать попытки, если устройство не разрешено
    if (!isDeviceAllowed) {
      console.error('Покупка недоступна на данном устройстве');
      return;
    }
    
    // ДОБАВЛЕНО: защита от спама
    const now = Date.now();
    if (now - lastActionTime < 2000) { // 2 секунды между действиями
      alert('⏱️ Подождите немного между действиями');
      return;
    }
    setLastActionTime(now);
    
    if (isPaymentProcessing || !user?.id) return;
    
    setIsPaymentProcessing(true);
    
    try {
      // Создаем инвойс через Supabase Edge Function
      const paymentData = await gameAPI.createPaymentInvoice(
        user.id, 
        user.username || user.first_name
      );
      
      if (!paymentData?.invoice_url) {
        throw new Error('Не удалось создать инвойс');
      }
      
      // Открываем инвойс в Telegram
      if (WebApp.openInvoice && paymentData.invoice_url !== 'https://t.me/invoice/test') {
        WebApp.openInvoice(paymentData.invoice_url, async (status: string) => {
          setIsPaymentProcessing(false);
          
          if (status === 'paid') {
            // Проверяем и записываем платеж
            const isVerified = await gameAPI.verifyAndRecordPayment(
              user.id, 
              paymentData.payload
            );
            
            if (isVerified) {
              console.log('Платеж подтвержден и записан');
              startGame('real');
            } else {
              if (WebApp.showAlert) {
                WebApp.showAlert('Платеж не подтвержден. Попробуйте еще раз.');
              }
            }
          } else if (status === 'cancelled') {
            console.log('Платеж отменен пользователем');
          } else {
            console.log('Платеж не удался:', status);
          }
        });
      } else {
        // Режим разработки или тестовая ссылка - показываем подтверждение
        console.log('Режим разработки/тестирования - показываем подтверждение');
        
        if (WebApp.showConfirm) {
          WebApp.showConfirm(
            `⭐ Потратить ${GAME_SETTINGS.PAID_ATTEMPT_COST} звезды на дополнительную попытку?\n\n(Режим тестирования - реальной оплаты не будет)`,
            async (confirmed: boolean) => {
              setIsPaymentProcessing(false);
              if (confirmed) {
                // Симулируем успешную оплату
                await gameAPI.verifyAndRecordPayment(user.id, paymentData.payload);
                startGame('real');
              }
            }
          );
        } else {
          // Совсем простой fallback
          setIsPaymentProcessing(false);
          startGame('real');
        }
      }
      
    } catch (error) {
      console.error('Ошибка создания платежа:', error);
      setIsPaymentProcessing(false);
      
      if (WebApp.showAlert) {
        WebApp.showAlert('Ошибка создания платежа. Попробуйте позже.');
      }
    }
  }, [isPaymentProcessing, user, startGame, lastActionTime, isDeviceAllowed, playBtnSoundWithDelay]);
  
  // Обработчики событий
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
  
  // Определение темы
  useEffect(() => {
    // Здесь будет интеграция с Telegram.WebApp.colorScheme
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // setTheme(isDark ? 'dark' : 'light'); // This line is removed as theme is now a prop
  }, []);

  // Выбор случайной стартовой позиции из проходов лабиринта
  const getRandomStartPosition = useCallback((maze: number[][]): Position => {
    const passages: Position[] = [];
    
    // Собираем все проходы и считаем количество доступных направлений
    for (let y = 0; y < maze.length; y++) {
      for (let x = 0; x < maze[y].length; x++) {
        if (maze[y][x] === 0) {
          // Считаем доступные направления из этой позиции
          let directions = 0;
          if (y > 0 && maze[y - 1][x] === 0) directions++; // вверх
          if (y < maze.length - 1 && maze[y + 1][x] === 0) directions++; // вниз
          if (x > 0 && maze[y][x - 1] === 0) directions++; // влево
          if (x < maze[0].length - 1 && maze[y][x + 1] === 0) directions++; // вправо
          
          // Избегаем тупиков (позиций с только одним направлением)
          if (directions >= 2) {
            passages.push({ x, y });
          }
        }
      }
    }
    
    // Если нет подходящих позиций, берем любые проходы
    if (passages.length === 0) {
      for (let y = 0; y < maze.length; y++) {
        for (let x = 0; x < maze[y].length; x++) {
          if (maze[y][x] === 0) {
            passages.push({ x, y });
          }
        }
      }
    }
    
    // Разделяем позиции на категории для разнообразия
    const corners = passages.filter(pos => {
      const distToCorner = Math.min(
        pos.x + pos.y, // верхний левый
        (maze[0].length - 1 - pos.x) + pos.y, // верхний правый
        pos.x + (maze.length - 1 - pos.y), // нижний левый
        (maze[0].length - 1 - pos.x) + (maze.length - 1 - pos.y) // нижний правый
      );
      return distToCorner <= 4; // В пределах 4 шагов от угла
    });
    
    const edges = passages.filter(pos => 
      pos.x <= 2 || pos.x >= maze[0].length - 3 || 
      pos.y <= 2 || pos.y >= maze.length - 3
    );
    
    const center = passages.filter(pos => 
      pos.x > maze[0].length / 3 && pos.x < 2 * maze[0].length / 3 &&
      pos.y > maze.length / 3 && pos.y < 2 * maze.length / 3
    );
    
    // Случайно выбираем категорию (70% углы/края, 30% центр для баланса сложности)
    const rand = Math.random();
    let availablePositions: Position[];
    
    if (rand < 0.4 && corners.length > 0) {
      availablePositions = corners; // 40% углы
    } else if (rand < 0.7 && edges.length > 0) {
      availablePositions = edges;   // 30% края
    } else if (center.length > 0) {
      availablePositions = center;  // 30% центр
    } else {
      availablePositions = passages; // fallback
    }
    
    return availablePositions[Math.floor(Math.random() * availablePositions.length)];
  }, []);

  // Размещение приза в сложном диапазоне для снижения винрейта (ИЗМЕНЕНО)
  const placePrize = useCallback((maze: number[][], playerPos: Position): Position => {
    const passages: Position[] = [];
    for (let y = 0; y < maze.length; y++) {
      for (let x = 0; x < maze[y].length; x++) {
        if (maze[y][x] === 0 && (x !== playerPos.x || y !== playerPos.y)) {
          passages.push({ x, y });
        }
      }
    }
    
    // НОВЫЕ ПАРАМЕТРЫ для снижения винрейта:
    // Увеличиваем минимальное расстояние до приза
    const minDistance = GAME_SETTINGS.PRIZE_MIN_DISTANCE; // было 10
    const maxDistance = GAME_SETTINGS.PRIZE_MAX_DISTANCE; // было 20
    
    const validPrizes = passages.filter(pos => {
      const distance = Math.abs(pos.x - playerPos.x) + Math.abs(pos.y - playerPos.y);
      return distance >= minDistance && distance <= maxDistance;
    });
    
    // Если нет подходящих позиций в нужном диапазоне, берем только самый дальний
    if (validPrizes.length === 0) {
      const sortedByDistance = passages.sort((a, b) => {
        const distA = Math.abs(a.x - playerPos.x) + Math.abs(a.y - playerPos.y);
        const distB = Math.abs(b.x - playerPos.x) + Math.abs(b.y - playerPos.y);
        return distB - distA;
      });
      
      // Берем ТОЛЬКО самый дальний (было: один из 3 самых дальних)
      return sortedByDistance[0];
    }
    
    return validPrizes[Math.floor(Math.random() * validPrizes.length)];
  }, []);

  // Компонент визуализации карты для дебага
  const MazeDebugView = () => {
    if (!isDebugUser || maze.length === 0) return null;
    
    const cellSize = Math.min(Math.floor(300 / maze.length), 20);
    
    return (
      <div className="mb-4 p-4 bg-gray-800 rounded-lg">
        <h3 className="text-sm font-bold mb-2 text-center text-white">🔧 Карта лабиринта (дебаг)</h3>
        <div 
          className="mx-auto grid border border-gray-600"
          style={{ 
            gridTemplateColumns: `repeat(${maze[0]?.length || 0}, ${cellSize}px)`,
            width: 'fit-content'
          }}
        >
          {maze.map((row, y) =>
            row.map((cell, x) => {
              const isPlayer = playerPos.x === x && playerPos.y === y;
              const isPrize = prizePos.x === x && prizePos.y === y;
              const isWall = cell === 1;
              
              let bgColor = isWall ? 'bg-gray-700' : 'bg-gray-200';
              let content = '';
              
              if (isPlayer) {
                bgColor = 'bg-blue-500';
                content = '🚶';
              } else if (isPrize) {
                bgColor = 'bg-green-500';
                content = gameMode === 'training' ? '🚪' : '🎁';
              }
              
              return (
                <div
                  key={`${x}-${y}`}
                  className={`${bgColor} border border-gray-500 flex items-center justify-center text-xs`}
                  style={{ 
                    width: `${cellSize}px`, 
                    height: `${cellSize}px`,
                    fontSize: `${Math.max(cellSize - 8, 8)}px`
                  }}
                >
                  {content}
                </div>
              );
            })
          )}
        </div>
        <div className="text-xs mt-2 text-gray-300 text-center">
          <div>Расстояние до приза: {Math.abs(prizePos.x - playerPos.x) + Math.abs(prizePos.y - playerPos.y)} шагов</div>
          <div>Стартовая позиция: ({playerPos.x}, {playerPos.y})</div>
          <div>Позиция приза: ({prizePos.x}, {prizePos.y})</div>
        </div>
      </div>
    );
  };

  // Компонент лидербордов
  const LeaderboardsScreen = () => {
    const [selectedCategory, setSelectedCategory] = useState<'steps' | 'time' | 'winrate' | 'supporters'>('steps');
    const [leaderboardData, setLeaderboardData] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Загрузка данных лидерборда
    useEffect(() => {
      const loadLeaderboard = async () => {
        setIsLoading(true);
        try {
          let data: any[] = [];
          switch (selectedCategory) {
            case 'steps':
              data = await gameAPI.getLeaderboardBestSteps(20);
              break;
            case 'time':
              data = await gameAPI.getLeaderboardBestTime(20);
              break;
            case 'winrate':
              data = await gameAPI.getLeaderboardWinRate(20);
              break;
            case 'supporters':
              data = await gameAPI.getLeaderboardSupporters(20);
              break;
          }
          setLeaderboardData(data);
        } catch (error) {
          console.error('Ошибка загрузки лидерборда:', error);
          setLeaderboardData([]);
        } finally {
          setIsLoading(false);
        }
      };

      loadLeaderboard();
    }, [selectedCategory]);

    const categories = [
      { id: 'steps', label: '🚀 Лучшие шаги', icon: '🚀' },
      { id: 'time', label: '⚡ Лучшее время', icon: '⚡' },
      { id: 'winrate', label: '🎯 Винрейт', icon: '🎯' },
      { id: 'supporters', label: '💖 Меценаты', icon: '💖' }
    ];

    const formatValue = (category: string, item: any) => {
      switch (category) {
        case 'steps':
          return `${item.best_training_steps} шагов`;
        case 'time':
          return `${item.best_training_time}с`;
        case 'winrate':
          return `${item.total_training_wins}/${item.total_training_attempts}`;
        case 'supporters':
          return `${item.total_donated_stars} ⭐`;
        default:
          return '';
      }
    };

    const getPlayerName = (item: any) => {
      return item.username ? `@${item.username}` : `ID${item.telegram_id}`;
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className={`${bgColor} ${textColor} p-6 rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col`}>
          <h2 className="text-2xl font-bold mb-4 text-center">🏆 Лидерборды</h2>
          
          {/* Категории */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id as any)}
                className={`py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-blue-500 text-white'
                    : theme === 'dark' ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
          
          {/* Список лидеров */}
          <div className="flex-1 overflow-y-auto mb-4">
            {isLoading ? (
              <div className="text-center py-8">
                <p className="opacity-75">Загрузка...</p>
              </div>
            ) : leaderboardData.length === 0 ? (
              <div className="text-center py-8">
                <p className="opacity-75">Пока нет данных</p>
              </div>
            ) : (
              <div className="space-y-2">
                {leaderboardData.map((item, index) => (
                  <div 
                    key={`${item.telegram_id}-${index}`}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold w-8">
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
                      </span>
                      <div>
                        <p className="font-semibold">{getPlayerName(item)}</p>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <p className="font-bold text-blue-500">
                        {formatValue(selectedCategory, item)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setGameState('menu');
            }}
            className="w-full bg-gray-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
          >
            ❌ Назад
          </button>
        </div>
      </div>
    );
  };

  // Компонент меню донатов
  const DonationMenu = () => {
    const donationBundles = [
      { stars: 1, label: '1 ⭐' },
      { stars: 5, label: '5 ⭐' },
      { stars: 10, label: '10 ⭐' },
      { stars: 100, label: '100 ⭐' },
      { stars: 1000, label: '1000 ⭐' },
      { stars: 5000, label: '5000 ⭐' },
      { stars: 10000, label: '10000 ⭐' },
      { stars: 50000, label: '50000 ⭐' },
      { stars: 100000, label: '100000 ⭐' }
    ];

    const handleDonation = async (stars: number) => {
      // Воспроизводим звук кнопки и ждем
      await playBtnSoundWithDelay();
      
      if (isPaymentProcessing || !user?.id) return;
      
      setIsPaymentProcessing(true);
      
      try {
        // Создаем инвойс через API
        const paymentData = await gameAPI.createDonationInvoice(
          user.id, 
          user.username || user.first_name,
          stars
        );
        
        if (!paymentData?.invoice_url) {
          throw new Error('Не удалось создать инвойс для доната');
        }
        
        // Открываем инвойс в Telegram
        if (WebApp.openInvoice && paymentData.invoice_url !== 'https://t.me/invoice/test') {
          WebApp.openInvoice(paymentData.invoice_url, async (status: string) => {
            setIsPaymentProcessing(false);
            
            if (status === 'paid') {
              // Проверяем и записываем донат
              const isVerified = await gameAPI.verifyAndRecordDonation(
                user.id, 
                paymentData.payload,
                stars
              );
              
              if (isVerified) {
                console.log('Донат подтвержден и записан');
                alert(`💖 Спасибо за поддержку проекта!\n\nВаш донат: ${stars} ⭐ засчитан!`);
                setGameState('menu');
              } else {
                if (WebApp.showAlert) {
                  WebApp.showAlert('Донат не подтвержден. Попробуйте еще раз.');
                }
              }
            } else if (status === 'cancelled') {
              console.log('Донат отменен пользователем');
            }
          });
        } else {
          // Режим разработки или тестовая ссылка
          if (WebApp.showConfirm) {
            WebApp.showConfirm(
              `💖 Поддержать проект на ${stars} ⭐?\n\n(Режим тестирования - реальной оплаты не будет)`,
              async (confirmed: boolean) => {
                setIsPaymentProcessing(false);
                if (confirmed) {
                  // Симулируем успешный донат
                  await gameAPI.verifyAndRecordDonation(user.id, paymentData.payload, stars);
                  alert(`💖 Спасибо за поддержку проекта!\n\nВаш донат: ${stars} ⭐ засчитан! (тест)`);
                  setGameState('menu');
                }
              }
            );
          } else {
            // Простой fallback
            setIsPaymentProcessing(false);
            alert(`💖 Спасибо за поддержку проекта!\n\nВаш донат: ${stars} ⭐ засчитан! (тест)`);
            setGameState('menu');
          }
        }
        
      } catch (error) {
        console.error('Ошибка доната:', error);
        setIsPaymentProcessing(false);
        alert('Произошла ошибка при создании доната. Попробуйте позже.');
      }
    };

    return (
      <div className="flex flex-col text-center max-w-md w-full">
        <h2 className="text-2xl font-bold mb-4 text-center">💖 Поддержать проект</h2>
        <p className="text-sm mb-6 text-center opacity-75">
          Выберите сумму для поддержки разработки игры
        </p>
        
        <div className="grid grid-cols-3 gap-3 mb-6">
          {donationBundles.map((bundle) => (
            <button
              key={bundle.stars}
              onClick={() => handleDonation(bundle.stars)}
              disabled={isPaymentProcessing}
              className={`py-3 px-4 rounded-lg text-sm font-semibold ${
                isPaymentProcessing
                  ? 'bg-gray-400 opacity-50'
                  : 'bg-yellow-500 hover:bg-yellow-600'
              } text-white transition-colors`}
            >
              {bundle.label}
            </button>
          ))}
        </div>
        
        <button
          onClick={async () => {
            await playBtnSoundWithDelay();
            setGameState('menu');
          }}
          className="w-full bg-gray-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
        >
          ❌ Назад
        </button>
      </div>
    );
  };

  // Компонент карты лабиринта для экрана конца игры
  const EndGameMazeView = () => {
    if (maze.length === 0) return null;
    
    const cellSize = Math.min(Math.floor(280 / maze.length), 18);
    const mapBgColor = theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100';
    const mapBorderColor = theme === 'dark' ? 'border-gray-600' : 'border-gray-300';
    const wallColor = theme === 'dark' ? 'bg-gray-700' : 'bg-gray-400';
    const pathColor = theme === 'dark' ? 'bg-gray-200' : 'bg-white';
    const infoTextColor = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';
    
    return (
      <div className={`flex flex-col items-center mb-6 p-4 ${mapBgColor} rounded-lg ${mapBorderColor} border`}>
        <h3 className={`text-sm font-bold mb-3 text-center ${textColor}`}>🗺️ Карта лабиринта</h3>
        <div 
          className={`mx-auto grid ${mapBorderColor} border`}
          style={{ 
            gridTemplateColumns: `repeat(${maze[0]?.length || 0}, ${cellSize}px)`,
            width: 'fit-content'
          }}
        >
          {maze.map((row, y) =>
            row.map((cell, x) => {
              const isPlayer = playerPos.x === x && playerPos.y === y;
              const isPrize = prizePos.x === x && prizePos.y === y;
              const isWall = cell === 1;
              
              let bgColor = isWall ? wallColor : pathColor;
              let content = '';
              
              if (isPlayer) {
                bgColor = 'bg-blue-500';
                content = '🚶';
              } else if (isPrize) {
                bgColor = 'bg-green-500';
                content = gameMode === 'training' ? '🚪' : '🎁';
              }
              
              return (
                <div
                  key={`${x}-${y}`}
                  className={`${bgColor} ${mapBorderColor} border flex items-center justify-center text-xs`}
                  style={{ 
                    width: `${cellSize}px`, 
                    height: `${cellSize}px`,
                    fontSize: `${Math.max(cellSize - 6, 8)}px`
                  }}
                >
                  {content}
                </div>
              );
            })
          )}
        </div>
        <div className={`text-xs mt-3 ${infoTextColor} text-center space-y-1`}>
          <div>📍 Расстояние до {gameMode === 'training' ? 'выхода' : 'приза'}: {Math.abs(prizePos.x - playerPos.x) + Math.abs(prizePos.y - playerPos.y)} шагов</div>
          <div className="flex justify-center gap-4">
            <span>🚶 Ваша позиция</span>
            <span>{gameMode === 'training' ? '🚪 Выход' : '🎁 Приз'}</span>
          </div>
        </div>
      </div>
    );
  };
  
  const availableDirections = getAvailableDirections();
  const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
  const textColor = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const buttonColor = theme === 'dark' ? 'bg-gray-700' : 'bg-gray-200';
  const activeButtonColor = 'bg-blue-500';
  
  // Блокировка доступа с ПК для пользователей не из списка разрешенных
  if (!isDeviceAllowed) {
    const platformInfo = WebApp?.platform || 'unknown';
    const isTelegramWebApp = !!(WebApp && WebApp.initData);
    
    return (
      <div className={`min-h-screen ${bgColor} ${textColor} flex flex-col justify-center items-center p-4`}>
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">📱</div>
          <h1 className="text-2xl font-bold mb-4">Игра доступна только на мобильных устройствах</h1>
          <p className="text-lg mb-4 opacity-75">
            Для лучшего игрового опыта используйте телефон или планшет
          </p>
          <div className="text-sm opacity-60 space-y-2">
            <p>📲 Откройте игру в Telegram на мобильном устройстве</p>
            
            {/* Отладочная информация для разработчиков */}
            {(user?.id || isDebugUser) && (
              <div className="text-xs mt-4 bg-gray-600 p-3 rounded space-y-1">
                <p><strong>Отладочная информация:</strong></p>
                {user?.id && <p>User ID: {user.id}</p>}
                <p>Telegram Platform: {platformInfo}</p>
                <p>Is Telegram WebApp: {isTelegramWebApp ? 'Yes' : 'No'}</p>
                <p>User Agent: {navigator.userAgent.substring(0, 50)}...</p>
                <p>Screen: {window.innerWidth}x{window.innerHeight}</p>
                <p>Touch Support: {'ontouchstart' in window ? 'Yes' : 'No'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  
  if (gameState === 'menu') {
    return (
      <div
        className={`min-h-screen ${bgColor} ${textColor} flex flex-col justify-center items-center px-4 pb-safe-area-inset-bottom relative`}
        style={{ 
          overflow: 'hidden',
        }}
      >
        {/* Элементы управления в безопасной зоне */}
        <div 
          className="flex gap-2 absolute top-6 left-1/2 -translate-x-1/2 z-10"
        >
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setSoundsEnabled(!soundsEnabled);
            }}
            className={`p-2 rounded-lg transition-colors ${
              soundsEnabled 
                ? 'bg-green-500 hover:bg-green-600' 
                : 'bg-gray-500 hover:bg-gray-600'
            } text-white`}
            title={soundsEnabled ? 'Отключить звуки' : 'Включить звуки'}
          >
            {soundsEnabled ? '🔊' : '🔇'}
          </button>
          
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setMusicEnabled(!musicEnabled);
            }}
            className={`p-2 rounded-lg transition-colors ${
              musicEnabled 
                ? 'bg-blue-500 hover:bg-blue-600' 
                : 'bg-gray-500 hover:bg-gray-600'
            } text-white`}
            title={musicEnabled ? 'Отключить музыку' : 'Включить музыку'}
          >
            🎵
          </button>
        </div>

        <div className="text-center max-w-sm mx-auto">
          <h1 className="text-3xl font-bold mb-4 mt-0">💰 Money Maze</h1>
          {user && (
            <p className="text-lg mb-2">Привет, {user.first_name}! 👋</p>
          )}
          {isDebugUser && (
            <p className="text-sm mb-2 bg-yellow-500 text-black px-3 py-1 rounded">
              🔧 РЕЖИМ ОТЛАДКИ
            </p>
          )}
          <p className="text-lg mb-4">Ты попал в лабиринт и должен найти выход за {GAME_SETTINGS.GAME_TIME} секунд, чтобы победить</p>
          <p className="text-sm mb-4 opacity-75">
            🎯 Тренировочный режим - бесплатная игра за место в лидербордах
          </p>
          <p className="text-sm mb-4 opacity-75">
            💰 Основной режим игры (находится в разработке) - найди приз и получи деньги
          </p>
          
          {/* Статистика игрока */}
          <div className="text-sm mb-6 opacity-75">
            {playerStats.total_attempts > 0 && (
            <p>🎯 Побед: {playerStats.total_wins} из {playerStats.total_attempts} ({Math.round((playerStats.total_wins / playerStats.total_attempts) * 100)}%)</p>
            )}
            {playerStats.total_spent_stars > 0 && (
              <p>Спасибо за поддержку! {playerStats.total_spent_stars}⭐</p>
            )}
          </div>

          {/* Кнопка лидербордов */}
          <div className="mb-4">
            <button
              onClick={async () => {
                await playBtnSoundWithDelay();
                setGameState('leaderboards');
              }}
              className="w-full bg-[#a259ff] hover:bg-[#8a42ff] text-white py-2 px-4 rounded-lg text-sm font-semibold transition-colors"
            >
              🏆 Лидерборды
            </button>
          </div>
          
          <div className="space-y-4">
            {/* Неактивная кнопка "Играть" для будущего режима с призами */}
            <button
              className="w-full bg-gray-400 text-white py-3 px-6 rounded-lg text-lg font-semibold opacity-50"
              disabled
            >
              🎮 Играть (скоро)
            </button>
            
            {/* Тренировка - всегда доступна */}
            <button
              onClick={() => startGame('training')}
              className="w-full bg-blue-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
            >
              🎯 Тренировка {isDebugUser ? '(debug)' : ''}
            </button>
            
            {/* Кнопка поддержки проекта */}
            {!isDebugUser && (
              <button
                onClick={async () => {
                  await playBtnSoundWithDelay();
                  setGameState('donations');
                }}
                disabled={isPaymentProcessing}
                className={`w-full py-3 px-6 rounded-lg text-lg font-semibold ${
                  isPaymentProcessing 
                    ? 'bg-gray-400 opacity-50' 
                    : 'bg-yellow-500 hover:bg-yellow-600'
                } text-white`}
              >
                {isPaymentProcessing ? '⏳ Обработка...' : `⭐ Поддержать проект`}
              </button>
            )}
          </div>
        </div>
        

      </div>
    );
  }
  
  if (gameState === 'leaderboards') {
    return (
      <div 
        className={`min-h-screen ${bgColor} ${textColor} p-4 relative`}
      >
        {/* Элементы управления в безопасной зоне */}
        <div 
          className="flex gap-2 absolute top-6 left-1/2 -translate-x-1/2 z-10"
        >
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setSoundsEnabled(!soundsEnabled);
            }}
            className={`p-2 rounded-lg transition-colors ${
              soundsEnabled 
                ? 'bg-green-500 hover:bg-green-600' 
                : 'bg-gray-500 hover:bg-gray-600'
            } text-white`}
            title={soundsEnabled ? 'Отключить звуки' : 'Включить звуки'}
          >
            {soundsEnabled ? '🔊' : '🔇'}
          </button>
          
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setMusicEnabled(!musicEnabled);
            }}
            className={`p-2 rounded-lg transition-colors ${
              musicEnabled 
                ? 'bg-blue-500 hover:bg-blue-600' 
                : 'bg-gray-500 hover:bg-gray-600'
            } text-white`}
            title={musicEnabled ? 'Отключить музыку' : 'Включить музыку'}
          >
            🎵
          </button>
        </div>
        
        <LeaderboardsScreen />
      </div>
    );
  }
  
  if (gameState === 'donations') {
    return (
      <div 
        className={`flex flex-col justify-center items-center min-h-screen ${bgColor} ${textColor} p-4 relative`}
      >
        {/* Элементы управления в безопасной зоне */}
        <div 
          className="flex gap-2 absolute top-6 left-1/2 -translate-x-1/2 z-10"
        >
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setSoundsEnabled(!soundsEnabled);
            }}
            className={`p-2 rounded-lg transition-colors ${
              soundsEnabled 
                ? 'bg-green-500 hover:bg-green-600' 
                : 'bg-gray-500 hover:bg-gray-600'
            } text-white`}
            title={soundsEnabled ? 'Отключить звуки' : 'Включить звуки'}
          >
            {soundsEnabled ? '🔊' : '🔇'}
          </button>
          
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setMusicEnabled(!musicEnabled);
            }}
            className={`p-2 rounded-lg transition-colors ${
              musicEnabled 
                ? 'bg-blue-500 hover:bg-blue-600' 
                : 'bg-gray-500 hover:bg-gray-600'
            } text-white`}
            title={musicEnabled ? 'Отключить музыку' : 'Включить музыку'}
          >
            🎵
          </button>
        </div>
        
        <DonationMenu />
      </div>
    );
  }
  
  if (gameState === 'playing') {
    return (
      <div 
        className={`min-h-screen ${bgColor} ${textColor} flex flex-col justify-center items-center pt-[10vh] relative`}
      >
        <div 
          className="absolute flex gap-1 z-10 top-[4vh] left-1/2 -translate-x-1/2"
        >
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setSoundsEnabled(!soundsEnabled);
            }}
            className={`p-1 rounded text-xs ${
              soundsEnabled ? 'text-green-500' : 'text-gray-400'
            }`}
            title={soundsEnabled ? 'Отключить звуки' : 'Включить звуки'}
          >
            {soundsEnabled ? '🔊' : '🔇'}
          </button>
          
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setMusicEnabled(!musicEnabled);
            }}
            className={`p-1 rounded text-xs ${
              musicEnabled ? 'text-blue-500' : 'text-gray-400'
            }`}
            title={musicEnabled ? 'Отключить музыку' : 'Включить музыку'}
          >
            🎵
          </button>
        </div>

        {/* Верхняя панель */}
        <div 
          className="flex w-full justify-between items-center border-b border-gray-300"
        >
          {/* Центральная информация */}
          <div className="flex w-full justify-between items-center ">
            <div className="text-lg font-semibold">
              ⏱️ {timeLeft}s
            </div>
            <div className="text-sm opacity-75">
              Шагов: {stepCount}
            </div>
            <div className="text-lg font-semibold">
              <button
                onClick={exitToMenu}
                className="text-lg font-semibold text-red-500 hover:text-red-600 transition-colors"
              >
                ❌
              </button>
            </div>
          </div>
        </div>
        
        {/* Дебаг карта для отладки */}
        {isDebugUser && <MazeDebugView />}
        
        {/* Основной экран - показывает только доступные направления */}
        <div className="flex-1 flex flex-col justify-center items-center p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-4">Ищи выход</h2>
            <p className="text-lg opacity-75">Стрелки покажут куда можно идти</p>
          </div>
          
          {/* Крестовина направлений */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div></div>
            <button
              onClick={async () => {
                await movePlayer('up');
              }}
              className={`w-16 h-16 rounded-lg text-2xl font-bold transition-all ${
                availableDirections.includes('up') 
                  ? `${activeButtonColor} text-white shadow-lg` 
                  : `${buttonColor} opacity-30`
              }`}
              disabled={!availableDirections.includes('up')}
            >
              ↑
            </button>
            <div></div>
            
            <button
              onClick={async () => {
                await movePlayer('left');
              }}
              className={`w-16 h-16 rounded-lg text-2xl font-bold transition-all ${
                availableDirections.includes('left') 
                  ? `${activeButtonColor} text-white shadow-lg` 
                  : `${buttonColor} opacity-30`
              }`}
              disabled={!availableDirections.includes('left')}
            >
              ←
            </button>
            <div className="w-16 h-16 rounded-lg bg-gray-500 flex items-center justify-center text-2xl">
              🚶
            </div>
            <button
              onClick={async () => {
                await movePlayer('right');
              }}
              className={`w-16 h-16 rounded-lg text-2xl font-bold transition-all ${
                availableDirections.includes('right') 
                  ? `${activeButtonColor} text-white shadow-lg` 
                  : `${buttonColor} opacity-30`
              }`}
              disabled={!availableDirections.includes('right')}
            >
              →
            </button>
            
            <div></div>
            <button
              onClick={async () => {
                await movePlayer('down');
              }}
              className={`w-16 h-16 rounded-lg text-2xl font-bold transition-all ${
                availableDirections.includes('down') 
                  ? `${activeButtonColor} text-white shadow-lg` 
                  : `${buttonColor} opacity-30`
              }`}
              disabled={!availableDirections.includes('down')}
            >
              ↓
            </button>
            <div></div>
          </div>
        </div>
      </div>
    );
  }
  
  if (gameState === 'won') {
    return (
      <div 
        className={`min-h-screen ${bgColor} ${textColor} flex flex-col justify-center items-center p-4 relative`}
      >
        {/* Элементы управления в безопасной зоне */}
        <div 
          className="fixed flex gap-2 absolute top-6 left-1/2 -translate-x-1/2 z-10"
        >
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setSoundsEnabled(!soundsEnabled);
            }}
            className={`p-2 rounded-lg transition-colors ${
              soundsEnabled 
                ? 'bg-green-500 hover:bg-green-600' 
                : 'bg-gray-500 hover:bg-gray-600'
            } text-white`}
            title={soundsEnabled ? 'Отключить звуки' : 'Включить звуки'}
          >
            {soundsEnabled ? '🔊' : '🔇'}
          </button>
          
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setMusicEnabled(!musicEnabled);
            }}
            className={`p-2 rounded-lg transition-colors ${
              musicEnabled 
                ? 'bg-blue-500 hover:bg-blue-600' 
                : 'bg-gray-500 hover:bg-gray-600'
            } text-white`}
            title={musicEnabled ? 'Отключить музыку' : 'Включить музыку'}
          >
            🎵
          </button>
        </div>
        <div className="text-center max-w-md w-full">
          <div className="text-6xl mb-4">{gameMode === 'training' ? '🚪' : '🎉'}</div>
          <h1 className="text-3xl font-bold mb-4">
            {gameMode === 'training' ? 'Выход найден!' : 'Поздравляем!'}
          </h1>
          <p className="text-lg mb-2">
            {gameMode === 'training' ? 'Вы нашли выход из лабиринта!' : 'Вы нашли приз!'}
          </p>
          <p className="text-sm opacity-75 mb-6">
            За {GAME_SETTINGS.GAME_TIME - timeLeft} секунд и {stepCount} шагов
          </p>
          {gameMode === 'real' && (
            <p className="text-2xl font-bold text-green-500 mb-8">💰 {prizeValue}</p>
          )}
          
          {/* Кнопка показа карты и сама карта */}
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setShowMap(!showMap);
            }}
            className={`w-full mb-4 py-2 px-4 rounded-lg text-sm font-medium ${
              theme === 'dark' ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
            } ${textColor} transition-colors`}
          >
            {showMap ? '🗺️ Скрыть карту' : '🗺️ Показать карту'}
          </button>
          
          {showMap && <EndGameMazeView />}
          
          {/* Показываем статус получения приза */}
          {isPrizeClaimed && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900 rounded-lg">
              <p className="text-green-800 dark:text-green-200 text-sm">
                ✅ Приз успешно получен!
              </p>
            </div>
          )}
          
          <div className="space-y-4">
            {gameMode === 'real' ? (
              // Кнопки получения приза только в реальном режиме
              isDebugUser ? (
                <button
                  onClick={async () => {
                    await playBtnSoundWithDelay();
                    if (!isPrizeClaimed) {
                      setIsPrizeClaimed(true);
                      alert('🔧 ДЕБАГ РЕЖИМ\n\nВ реальном режиме здесь был бы получен приз.\nВы можете изучать параметры генерации лабиринта.');
                    }
                  }}
                  disabled={isPrizeClaimed}
                  className={`w-full py-3 px-6 rounded-lg text-lg font-semibold ${
                    isPrizeClaimed 
                      ? 'bg-gray-400 text-white opacity-50' 
                      : 'bg-yellow-500 text-white hover:bg-yellow-600'
                  }`}
                >
                  {isPrizeClaimed 
                    ? '✅ Приз получен (дебаг)' 
                    : `🔧 [ДЕБАГ] Получить приз ${prizeValue}`
                  }
                </button>
              ) : (
                <button
                  onClick={async () => {
                    await playBtnSoundWithDelay();
                    await claimPrize();
                  }}
                  disabled={isPrizeClaimed || isClaimingPrize}
                  className={`w-full py-3 px-6 rounded-lg text-lg font-semibold ${
                    isPrizeClaimed 
                      ? 'bg-gray-400 text-white opacity-50' 
                      : isClaimingPrize 
                      ? 'bg-yellow-500 text-white opacity-70'
                      : 'bg-green-500 text-white hover:bg-green-600'
                  }`}
                >
                  {isPrizeClaimed 
                    ? '✅ Приз получен' 
                    : isClaimingPrize 
                    ? '⏳ Получение приза...' 
                    : `🎁 Получить приз ${prizeValue}`
                  }
                </button>
              )
            ) : (
              // В тренировочном режиме показываем поздравление с выходом
              <div className="text-center p-4 bg-green-100 dark:bg-green-900 rounded-lg">
                <p className="text-green-800 dark:text-green-200 text-lg font-semibold mb-2">
                  🎉 Вы нашли выход!
                </p>
                <p className="text-green-700 dark:text-green-300 text-sm">
                  Отлично! Результат засчитан в статистику тренировок.
                </p>
              </div>
            )}
            
            <button
              onClick={async () => {
                await playBtnSound();
                startGame(gameMode);
              }}
              className="w-full bg-blue-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
            >
              🔄 Сыграть ещё
            </button>
            
            <button
              onClick={async () => {
                await playBtnSoundWithDelay();
                setGameState('menu');
              }}
              className="w-full bg-gray-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
            >
              🏠 На главный экран
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  if (gameState === 'lost') {
    return (
      <div 
        className={`min-h-screen ${bgColor} ${textColor} flex flex-col justify-center items-center p-4 relative`}
      >
        {/* Элементы управления в безопасной зоне */}
        <div 
          className="flex gap-2 absolute top-6 left-1/2 -translate-x-1/2 z-10"
        >
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setSoundsEnabled(!soundsEnabled);
            }}
            className={`p-2 rounded-lg transition-colors ${
              soundsEnabled 
                ? 'bg-green-500 hover:bg-green-600' 
                : 'bg-gray-500 hover:bg-gray-600'
            } text-white`}
            title={soundsEnabled ? 'Отключить звуки' : 'Включить звуки'}
          >
            {soundsEnabled ? '🔊' : '🔇'}
          </button>
          
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setMusicEnabled(!musicEnabled);
            }}
            className={`p-2 rounded-lg transition-colors ${
              musicEnabled 
                ? 'bg-blue-500 hover:bg-blue-600' 
                : 'bg-gray-500 hover:bg-gray-600'
            } text-white`}
            title={musicEnabled ? 'Отключить музыку' : 'Включить музыку'}
          >
            🎵
          </button>
        </div>
        <div className="text-center max-w-md w-full">
          <div className="text-6xl mb-4">⏰</div>
          <h1 className="text-3xl font-bold mb-4">Время вышло!</h1>
          <p className="text-lg mb-2">Вы сделали {stepCount} шагов</p>
          <p className="text-sm opacity-75 mb-6">
            {gameMode === 'training' ? 'Выход' : 'Приз'} был в {Math.abs(prizePos.x - playerPos.x) + Math.abs(prizePos.y - playerPos.y)} шагах от вас
          </p>
          
          {/* Кнопка показа карты и сама карта */}
          <button
            onClick={async () => {
              await playBtnSoundWithDelay();
              setShowMap(!showMap);
            }}
            className={`w-full mb-4 py-2 px-4 rounded-lg text-sm font-medium ${
              theme === 'dark' ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
            } ${textColor} transition-colors`}
          >
            {showMap ? '🗺️ Скрыть карту' : '🗺️ Показать карту'}
          </button>
          
          {showMap && <EndGameMazeView />}
          
          <div className="space-y-4">
            <button
              onClick={async () => {
                await playBtnSound();
                startGame(gameMode);
              }}
              className="w-full bg-blue-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
            >
              🔄 Сыграть ещё
            </button>
            
            {gameMode === 'real' && !isDebugUser && (
              <button
                onClick={buyAttempt}
                disabled={isPaymentProcessing}
                className={`w-full py-3 px-6 rounded-lg text-lg font-semibold ${
                  isPaymentProcessing 
                    ? 'bg-gray-400 opacity-50' 
                    : 'bg-yellow-500 hover:bg-yellow-600'
                } text-white`}
              >
                {isPaymentProcessing ? '⏳ Обработка...' : `⭐ Попробовать ещё (${GAME_SETTINGS.PAID_ATTEMPT_COST} звезд)`}
              </button>
            )}
            
            <button
              onClick={async () => {
                await playBtnSoundWithDelay();
                setGameState('menu');
              }}
              className="w-full bg-gray-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
            >
              🏠 На главный экран
            </button>
          </div>
        </div>
      </div>
    );
  }
};

export default MazeGame;