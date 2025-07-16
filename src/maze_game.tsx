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



const MazeGame = ({ user, theme }: MazeGameProps) => {
  // Список дебаг пользователей (вы + партнеры)
  const DEBUG_USER_IDS = [
    379502446,  // @Scilef
    282577511, //@Wezekable
    // 409022180 //@mdakekv
  ];
  const isDebugUser = user?.id && DEBUG_USER_IDS.includes(user.id);

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

  // Получение приза (ИСПРАВЛЕНО - защита от повторных вызовов)
  const claimPrize = useCallback(async () => {
    // Защита от повторных вызовов
    if (isPrizeClaimed || isClaimingPrize || !user?.id || !currentSessionId) {
      return;
    }

    setIsClaimingPrize(true);

    try {
      // Передаем ID пользователя и сессии для проверки
      const prizeLink = await gameAPI.getAvailablePrize(user.id, currentSessionId);
      
      if (prizeLink && prizeLink !== 'https://example.com/demo-prize') {
        // Отмечаем приз как полученный ПЕРЕД открытием ссылки
        setIsPrizeClaimed(true);
        // Перенаправляем на реальный приз
        window.open(prizeLink, '_blank');
      } else if (prizeLink === 'https://example.com/demo-prize') {
        setIsPrizeClaimed(true);
        alert('🎉 Поздравляем с победой!\n\n⚠️ К сожалению, реальные призы временно закончились, но ваша победа засчитана!\n\nСледите за обновлениями - скоро добавим новые призы!');
      } else {
        alert('❌ Ошибка: Приз недоступен.\n\nВозможные причины:\n• Платеж не подтвержден\n• Сессия не найдена\n• Технические неполадки\n\nОбратитесь в поддержку.');
      }
    } catch (error) {
      console.error('Ошибка получения приза:', error);
      alert('Произошла ошибка при получении приза. Обратитесь в поддержку.');
    } finally {
      setIsClaimingPrize(false);
    }
  }, [user?.id, currentSessionId, isPrizeClaimed, isClaimingPrize]);

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
  
  // Загрузка данных игрока при старте (ИЗМЕНЕНО для дебага)
  useEffect(() => {
    const loadPlayerData = async () => {
      if (!user?.id) return;
      
      try {
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
        
        // Загружаем статистику игрока
        const stats = await gameAPI.getPlayerStats(user.id);
        setPlayerStats(stats);
        
        // Загружаем стоимость доступного приза
        const prizeVal = await gameAPI.getAvailablePrizeValue();
        setPrizeValue(prizeVal);
      } catch (error) {
        console.error('Ошибка загрузки данных игрока:', error);
      }
    };
    
    loadPlayerData();
  }, [user, isDebugUser]);

  // Таймер cooldown (ИЗМЕНЕНО для дебага)
  useEffect(() => {
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
  }, [cooldownTime, hasFreeTry, isDebugUser]);

  // Инициализация игры (ДОПОЛНЕНО - сброс состояния приза)
  const startGame = useCallback(async (isFree = true) => {
    if (!user?.id) {
      console.error('Пользователь не найден');
      return;
    }

    // Сбрасываем состояние приза при старте новой игры
    setIsPrizeClaimed(false);
    setIsClaimingPrize(false);

    try {
      // Для дебаг пользователя не регистрируем попытки в БД
      let sessionId;
      if (isDebugUser) {
        sessionId = `debug_${Date.now()}`;
      } else {
        // Регистрируем попытку в базе данных
        sessionId = await gameAPI.registerAttempt(
          user.id,
          user.first_name,
          user.username,
          isFree
        );
        
        if (!sessionId) {
          console.error('Не удалось зарегистрировать попытку');
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
      
      if (isFree && !isDebugUser) {
        setHasFreeTry(false);
        // Обновляем cooldown
        const timeUntil = await gameAPI.getTimeUntilNextFree(user.id);
        setCooldownTime(timeUntil);
      }
    } catch (error) {
      console.error('Ошибка старта игры:', error);
    }
  }, [user, isDebugUser]);
  
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
            `⭐ Потратить ${GAME_SETTINGS.PAID_ATTEMPT_COST} звезды на дополнительную попытку?\n\n(Режим тестирования - реальной оплаты не будет)`,
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
                content = '🎁';
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
          {isDebugUser && (
            <p className="text-sm mb-2 bg-yellow-500 text-black px-3 py-1 rounded">
              🔧 РЕЖИМ ОТЛАДКИ
            </p>
          )}
          <p className="text-lg mb-4">Найди приз за {GAME_SETTINGS.GAME_TIME} секунд!</p>
          <p className="text-sm mb-4 opacity-75">
            Приз: <span className="font-bold text-green-500">{prizeValue}</span>
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
            {hasFreeTry || isDebugUser ? (
              <button
                onClick={() => startGame(true)}
                className="w-full bg-blue-500 text-white py-3 px-6 rounded-lg text-lg font-semibold"
              >
                🆓 Бесплатная попытка {isDebugUser ? '(∞)' : ''}
              </button>
            ) : (
              <button
                className="w-full bg-gray-400 text-white py-3 px-6 rounded-lg text-lg font-semibold opacity-50"
                disabled
              >
                ⏰ Следующая бесплатная попытка через {Math.floor(cooldownTime / 60)}:{(cooldownTime % 60).toString().padStart(2, '0')}
              </button>
            )}
            
            {!isDebugUser && (
              <button
                onClick={buyAttempt}
                disabled={isPaymentProcessing}
                className={`w-full py-3 px-6 rounded-lg text-lg font-semibold ${
                  isPaymentProcessing 
                    ? 'bg-gray-400 opacity-50' 
                    : 'bg-yellow-500 hover:bg-yellow-600'
                } text-white`}
              >
                {isPaymentProcessing ? '⏳ Обработка...' : `⭐ Купить попытку (${GAME_SETTINGS.PAID_ATTEMPT_COST} звезд)`}
              </button>
            )}
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
            🎯 {prizeValue}
          </div>
        </div>
        
        {/* Дебаг карта для отладки */}
        {isDebugUser && <MazeDebugView />}
        
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
            За {GAME_SETTINGS.GAME_TIME - timeLeft} секунд и {stepCount} шагов
          </p>
          <p className="text-2xl font-bold text-green-500 mb-8">💰 {prizeValue}</p>
          
          {/* Показываем статус получения приза */}
          {isPrizeClaimed && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900 rounded-lg">
              <p className="text-green-800 dark:text-green-200 text-sm">
                ✅ Приз успешно получен!
              </p>
            </div>
          )}
          
          <div className="space-y-4">
            {isDebugUser ? (
              <button
                onClick={() => {
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
                onClick={claimPrize}
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
            )}
            
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
            {!isDebugUser && (
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