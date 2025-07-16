import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebApp from '@twa-dev/sdk';
import { gameAPI } from './supabase';

// Типы для игры
interface Position {
  x: number;
  y: number;
}

type Direction = 'up' | 'down' | 'left' | 'right';
type GameState = 'menu' | 'playing' | 'won' | 'lost';

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

// Размещение приза в сложном диапазоне для шанса победы ~7%
const placePrize = (maze: number[][], playerPos: Position): Position => {
  const passages: Position[] = [];
  for (let y = 0; y < maze.length; y++) {
    for (let x = 0; x < maze[y].length; x++) {
      if (maze[y][x] === 0 && (x !== playerPos.x || y !== playerPos.y)) {
        passages.push({ x, y });
      }
    }
  }
  
  // Размещаем приз на расстоянии 10-20 шагов от игрока для сложности
  const validPrizes = passages.filter(pos => {
    const distance = Math.abs(pos.x - playerPos.x) + Math.abs(pos.y - playerPos.y);
    return distance >= 10 && distance <= 20;
  });
  
  // Если нет подходящих позиций в нужном диапазоне, берем самые дальние
  if (validPrizes.length === 0) {
    const sortedByDistance = passages.sort((a, b) => {
      const distA = Math.abs(a.x - playerPos.x) + Math.abs(a.y - playerPos.y);
      const distB = Math.abs(b.x - playerPos.x) + Math.abs(b.y - playerPos.y);
      return distB - distA;
    });
    
    // Берем один из 3 самых дальних
    const farPrizes = sortedByDistance.slice(0, 3);
    return farPrizes[Math.floor(Math.random() * farPrizes.length)];
  }
  
  return validPrizes[Math.floor(Math.random() * validPrizes.length)];
};

const MazeGame = ({ user, theme }: MazeGameProps) => {
  const [gameState, setGameState] = useState<GameState>('menu');
  const [maze, setMaze] = useState<number[][]>([]);
  const [playerPos, setPlayerPos] = useState<Position>({ x: 1, y: 1 });
  const [prizePos, setPrizePos] = useState<Position>({ x: 0, y: 0 });
  const [timeLeft, setTimeLeft] = useState(30);
  const [hasFreeTry, setHasFreeTry] = useState(true);
  const [stepCount, setStepCount] = useState(0);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [gameStartTime, setGameStartTime] = useState<number>(0);
  const [cooldownTime, setCooldownTime] = useState(0);
  const [playerStats, setPlayerStats] = useState({
    total_attempts: 0,
    total_wins: 0,
    total_spent_stars: 0
  });
  
  // Добавляем ref для таймера
  const timerRef = useRef<NodeJS.Timeout | null>(null);

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
  
  // Движение игрока
  const movePlayer = useCallback((direction: Direction) => {
    if (gameState !== 'playing') return;
    
    const directions = getAvailableDirections();
    if (!directions.includes(direction)) return;
    
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
  }, [gameState, getAvailableDirections]);
  
  // Завершение игры и сохранение результатов
  const finishGameSession = useCallback(async (won: boolean) => {
    if (!currentSessionId || !user?.id) return;
    
    const timeSpent = Math.floor((Date.now() - gameStartTime) / 1000);
    const finalPosition = { x: playerPos.x, y: playerPos.y };
    
    try {
      await gameAPI.finishGame(currentSessionId, won, stepCount, timeSpent, finalPosition);
      
      // Обновляем статистику игрока
      const newStats = await gameAPI.getPlayerStats(user.id);
      setPlayerStats(newStats);
    } catch (error) {
      console.error('Ошибка завершения игровой сессии:', error);
    }
  }, [currentSessionId, user?.id, gameStartTime]); // Убрали playerPos и stepCount

  // Получение приза (ИСПРАВЛЕНО)
  const claimPrize = useCallback(async () => {
    try {
      // Передаем ID пользователя и сессии для проверки
      const prizeLink = await gameAPI.getAvailablePrize(user?.id, currentSessionId);
      
      if (prizeLink && prizeLink !== 'https://example.com/demo-prize') {
        // Перенаправляем на реальный приз
        window.open(prizeLink, '_blank');
      } else if (prizeLink === 'https://example.com/demo-prize') {
        alert('🎉 Поздравляем с победой!\n\n⚠️ К сожалению, реальные призы временно закончились, но ваша победа засчитана!\n\nСледите за обновлениями - скоро добавим новые призы!');
      } else {
        alert('❌ Ошибка: Приз недоступен.\n\nВозможные причины:\n• Платеж не подтвержден\n• Сессия не найдена\n• Технические неполадки\n\nОбратитесь в поддержку.');
      }
    } catch (error) {
      console.error('Ошибка получения приза:', error);
      alert('Произошла ошибка при получении приза. Обратитесь в поддержку.');
    }
  }, [user?.id, currentSessionId]);

  // Проверка победы после каждого хода
  useEffect(() => {
    if (gameState === 'playing' && checkForPrize()) {
      setGameState('won');
      finishGameSession(true);
    }
  }, [gameState, checkForPrize, finishGameSession]);
  
  // Обработка свайпов
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    (e.target as any).touchStartX = touch.clientX;
    (e.target as any).touchStartY = touch.clientY;
  }, []);
  
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const target = e.target as any;
    if (!target.touchStartX || !target.touchStartY) return;
    
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - target.touchStartX;
    const deltaY = touch.clientY - target.touchStartY;
    
    const minSwipeDistance = 50;
    
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (Math.abs(deltaX) > minSwipeDistance) {
        movePlayer(deltaX > 0 ? 'right' : 'left');
      }
    } else {
      if (Math.abs(deltaY) > minSwipeDistance) {
        movePlayer(deltaY > 0 ? 'down' : 'up');
      }
    }
  }, [movePlayer]);
  
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
  
  // Загрузка данных игрока при старте
  useEffect(() => {
    const loadPlayerData = async () => {
      if (!user?.id) return;
      
      try {
        // Проверяем доступность бесплатной попытки
        const canPlay = await gameAPI.canPlayFree(user.id);
        setHasFreeTry(canPlay);
        
        // Загружаем статистику игрока
        const stats = await gameAPI.getPlayerStats(user.id);
        setPlayerStats(stats);
        
        // Если не может играть бесплатно, получаем время до следующей попытки
        if (!canPlay) {
          const timeUntil = await gameAPI.getTimeUntilNextFree(user.id);
          setCooldownTime(timeUntil);
        }
      } catch (error) {
        console.error('Ошибка загрузки данных игрока:', error);
      }
    };
    
    loadPlayerData();
  }, [user]);

  // Таймер cooldown
  useEffect(() => {
    if (cooldownTime > 0 && !hasFreeTry) {
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
  }, [cooldownTime, hasFreeTry]);

  // Инициализация игры
  const startGame = useCallback(async (isFree = true) => {
    if (!user?.id) {
      console.error('Пользователь не найден');
      return;
    }

    try {
      // Регистрируем попытку в базе данных
      const sessionId = await gameAPI.registerAttempt(
        user.id,
        user.first_name,
        user.username,
        isFree
      );
      
      if (!sessionId) {
        console.error('Не удалось зарегистрировать попытку');
        return;
      }
      
      setCurrentSessionId(sessionId);
      setGameStartTime(Date.now());
      
      const newMaze = generateMaze(); // 17x17 теперь
      const startPos: Position = { x: 3, y: 3 }; // Ближе к углу для усложнения
      const prize = placePrize(newMaze, startPos);
      
      setMaze(newMaze);
      setPlayerPos(startPos);
      setPrizePos(prize);
      setTimeLeft(30);
      setStepCount(0);
      setGameState('playing');
      
      if (isFree) {
        setHasFreeTry(false);
        // Обновляем cooldown
        const timeUntil = await gameAPI.getTimeUntilNextFree(user.id);
        setCooldownTime(timeUntil);
      }
    } catch (error) {
      console.error('Ошибка старта игры:', error);
    }
  }, [user]);
  
  // Функция оплаты в звёздах
  const buyAttempt = useCallback(async () => {
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
              startGame(false);
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
            '⭐ Потратить 2 звезды на дополнительную попытку?\n\n(Режим тестирования - реальной оплаты не будет)',
            async (confirmed: boolean) => {
              setIsPaymentProcessing(false);
              if (confirmed) {
                // Симулируем успешную оплату
                await gameAPI.verifyAndRecordPayment(user.id, paymentData.payload);
                startGame(false);
              }
            }
          );
        } else {
          // Совсем простой fallback
          setIsPaymentProcessing(false);
          startGame(false);
        }
      }
      
    } catch (error) {
      console.error('Ошибка создания платежа:', error);
      setIsPaymentProcessing(false);
      
      if (WebApp.showAlert) {
        WebApp.showAlert('Ошибка создания платежа. Попробуйте позже.');
      }
    }
  }, [isPaymentProcessing, user, startGame]);
  
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
  
  const availableDirections = getAvailableDirections();
  const bgColor = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
  const textColor = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const buttonColor = theme === 'dark' ? 'bg-gray-700' : 'bg-gray-200';
  const activeButtonColor = 'bg-blue-500';
  
  if (gameState === 'menu') {
    return (
      <div className={`min-h-screen ${bgColor} ${textColor} flex flex-col justify-center items-center p-4`}>
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">🎯 Maze Prize</h1>
          {user && (
            <p className="text-lg mb-2">Привет, {user.first_name}! 👋</p>
          )}
          <p className="text-lg mb-4">Найди приз за 30 секунд!</p>
          <p className="text-sm mb-4 opacity-75">
            Приз: <span className="font-bold text-green-500">$10</span>
          </p>
          
          {/* Статистика игрока */}
          <div className="text-sm mb-6 opacity-75">
            <p>🎯 Побед: {playerStats.total_wins} из {playerStats.total_attempts}</p>
            {playerStats.total_attempts > 0 && (
              <p>📈 Винрейт: {Math.round((playerStats.total_wins / playerStats.total_attempts) * 100)}%</p>
            )}
            {playerStats.total_spent_stars > 0 && (
              <p>⭐ Потрачено звёзд: {playerStats.total_spent_stars}</p>
            )}
          </div>
          
          <div className="space-y-4">
            {hasFreeTry ? (
              <button
                onClick={() => startGame(true)}
                className="w-full bg-blue-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
              >
                🆓 Бесплатная попытка
              </button>
            ) : (
              <button
                className="w-full bg-gray-400 text-white py-3 px-6 rounded-lg text-lg font-semibold opacity-50"
                disabled
              >
                ⏰ Следующая бесплатная попытка через {Math.floor(cooldownTime / 60)}:{(cooldownTime % 60).toString().padStart(2, '0')}
              </button>
            )}
            
            <button
              onClick={buyAttempt}
              disabled={isPaymentProcessing}
              className={`w-full py-3 px-6 rounded-lg text-lg font-semibold ${
                isPaymentProcessing 
                  ? 'bg-gray-400 opacity-50' 
                  : 'bg-yellow-500 hover:bg-yellow-600'
              } text-white`}
            >
              {isPaymentProcessing ? '⏳ Обработка...' : '⭐ Купить попытку (2 звезды)'}
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  if (gameState === 'playing') {
    return (
      <div 
        className={`min-h-screen ${bgColor} ${textColor} flex flex-col`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Верхняя панель */}
        <div className="flex justify-between items-center p-4 border-b border-gray-300">
          <div className="text-lg font-semibold">
            ⏱️ {timeLeft}s
          </div>
          <div className="text-sm opacity-75">
            Шагов: {stepCount}
          </div>
          <div className="text-lg font-semibold">
            🎯 $10
          </div>
        </div>
        
        {/* Основной экран - показывает только доступные направления */}
        <div className="flex-1 flex flex-col justify-center items-center p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-4">🚶 Вы здесь</h2>
            <p className="text-lg opacity-75">Куда можно пойти?</p>
          </div>
          
          {/* Крестовина направлений */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div></div>
            <button
              onClick={() => movePlayer('up')}
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
              onClick={() => movePlayer('left')}
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
              onClick={() => movePlayer('right')}
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
              onClick={() => movePlayer('down')}
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
          
          {/* Список доступных направлений */}
          <div className="text-center">
            <p className="text-sm opacity-75 mb-2">Доступные пути:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {availableDirections.map(dir => (
                <span key={dir} className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm">
                  {dir === 'up' ? '↑ Север' : 
                   dir === 'down' ? '↓ Юг' : 
                   dir === 'left' ? '← Запад' : 
                   '→ Восток'}
                </span>
              ))}
              {availableDirections.length === 0 && (
                <span className="text-red-500">Тупик!</span>
              )}
            </div>
          </div>
        </div>
        
        {/* Подсказка */}
        <div className="p-4 border-t border-gray-300 text-center">
          <p className="text-sm opacity-75">
            💡 Свайп или нажмите стрелки для движения
          </p>
        </div>
      </div>
    );
  }
  
  if (gameState === 'won') {
    return (
      <div className={`min-h-screen ${bgColor} ${textColor} flex flex-col justify-center items-center p-4`}>
        <div className="text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-3xl font-bold mb-4">Поздравляем!</h1>
          <p className="text-lg mb-2">Вы нашли приз!</p>
          <p className="text-sm opacity-75 mb-6">
            За {25 - timeLeft} секунд и {stepCount} шагов {/* Изменили с 30 на 25 */}
          </p>
          <p className="text-2xl font-bold text-green-500 mb-8">💰 $10</p>
          
          <div className="space-y-4">
            <button
              onClick={claimPrize}
              className="w-full bg-green-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
            >
              🎁 Получить приз $10
            </button>
            
            <button
              onClick={() => setGameState('menu')}
              className="w-full bg-blue-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
            >
              🔄 Играть ещё
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  if (gameState === 'lost') {
    return (
      <div className={`min-h-screen ${bgColor} ${textColor} flex flex-col justify-center items-center p-4`}>
        <div className="text-center">
          <div className="text-6xl mb-4">⏰</div>
          <h1 className="text-3xl font-bold mb-4">Время вышло!</h1>
          <p className="text-lg mb-2">Вы сделали {stepCount} шагов</p>
          <p className="text-sm opacity-75 mb-6">
            Приз был в {Math.abs(prizePos.x - playerPos.x) + Math.abs(prizePos.y - playerPos.y)} шагах от вас
          </p>
          
          <div className="space-y-4">
            <button
              onClick={buyAttempt}
              disabled={isPaymentProcessing}
              className={`w-full py-3 px-6 rounded-lg text-lg font-semibold ${
                isPaymentProcessing 
                  ? 'bg-gray-400 opacity-50' 
                  : 'bg-yellow-500 hover:bg-yellow-600'
              } text-white`}
            >
              {isPaymentProcessing ? '⏳ Обработка...' : '⭐ Попробовать ещё (2 звезды)'}
            </button>
            
            <button
              onClick={() => setGameState('menu')}
              className="w-full bg-gray-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
            >
              🏠 В главное меню
            </button>
          </div>
        </div>
      </div>
    );
  }
};

export default MazeGame;