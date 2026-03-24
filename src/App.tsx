import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameOver, setGameOver] = useState(false);
  const [gameStateReact, setGameStateReact] = useState<'StartMenu' | 'Playing' | 'GameOver' | 'Paused'>('StartMenu');
  const isPausedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 音效系统 (Audio System)
    let audioCtx: AudioContext | null = null;

    const initAudio = () => {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    };

    const playLaserSound = () => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.type = 'square';
      
      // 频率从高到低滑动 (High to low frequency sweep)
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 0.1);
      
      // 音量包络 (Volume envelope)
      gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime); // 降低音量避免刺耳
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    };

    const playExplosionSound = (isBoss: boolean = false) => {
      if (!audioCtx) return;
      
      const duration = isBoss ? 0.5 : 0.2;
      const bufferSize = audioCtx.sampleRate * duration;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      
      // 填充白噪音 (Fill with white noise)
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = buffer;
      
      // 低通滤波器产生低沉的爆破声 (Lowpass filter for boomy sound)
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(isBoss ? 400 : 1000, audioCtx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + duration);
      
      const gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(isBoss ? 0.3 : 0.15, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      
      noiseSource.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      noiseSource.start();
    };

    // 游戏常量 (Game constants)
    const CANVAS_WIDTH = 480;
    const CANVAS_HEIGHT = 800;
    
    // 玩家状态 (Player state)
    const player = {
      x: CANVAS_WIDTH / 2 - 30, // 水平居中 (Center horizontally)
      y: CANVAS_HEIGHT - 100,    // 靠近底部 (Near the bottom)
      width: 60,
      height: 60,
      speed: 5,                 // 移动速度 (Movement speed)
      color: '#0066cc',         // 飞机颜色 (Plane color)
      lastShotTime: 0,          // 上次射击时间 (Last shot time)
      fireRate: 230,            // 射击间隔，毫秒 (Fire rate in ms) - 攻速提升30% (300 / 1.3)
      hp: 100,                  // 玩家生命值 (Player HP)
      maxHp: 100,               // 玩家最大生命值 (Player Max HP)
      shield: 0,                // 护盾值 (Shield HP)
      isRaged: false,           // 是否狂怒状态 (Is Raged)
      shieldTimer: 0,           // 护盾持续时间计时器 (Shield timer)
      rageTimer: 0,             // 狂怒持续时间计时器 (Rage timer)
      lastDamageTime: 0,        // 上次受伤时间 (Last damage time)
      nextHealTime: 0,          // 下次恢复生命时间 (Next heal time)
      pierceTimer: 0,           // 穿透子弹持续时间计时器 (Pierce timer)
      invincibleTimer: 0,       // 无敌状态持续时间计时器 (Invincible timer)
      pierceCount: 0,           // 穿透子弹技能储存数量 (Pierce skill count)
      invincibleCount: 0,       // 无敌技能储存数量 (Invincible skill count)
      hitFlashTimer: 0          // 受击闪烁计时器 (Hit flash timer)
    };

    // 子弹数组 (Bullets array)
    let bullets: { x: number; y: number; width: number; height: number; speed: number; color: string; isPiercing?: boolean; bounces?: number; vx?: number; vy?: number; hitEnemies?: Set<Enemy> }[] = [];
    let enemyBullets: { x: number; y: number; width: number; height: number; speed: number; color: string; damage?: number }[] = [];

    // 技能数组 (Skills array)
    type Skill = { x: number; y: number; width: number; height: number; speed: number; type: 'pierce' | 'invincible' };
    let skills: Skill[] = [];
    let lastSkillSpawnTime = 0;
    const skillSpawnRate = 20000; // 20秒生成一个技能 (Spawn 1 skill every 20 seconds, 60% of original rate)

    // 增益道具数组 (Power-ups array)
    type PowerUp = { x: number; y: number; width: number; height: number; speed: number; type: 'shield' | 'rage' | 'bomb' | 'health' };
    let powerUps: PowerUp[] = [];

    // 敌机数组 (Enemies array)
    type Enemy = {
      x: number; y: number; width: number; height: number; speed: number; color: string;
      type: 'normal' | 'boss' | 'purple'; hp: number; maxHp: number;
      rotation?: number; lastShotTime?: number; isShooting?: boolean; shootTimer?: number;
      vx?: number; moveTimer?: number; hitFlashTimer?: number;
    };
    let enemies: Enemy[] = [];
    let lastEnemySpawnTime = 0;
    const enemySpawnRate = 1000; // 1秒生成一个敌机 (Spawn 1 enemy every second)

    // 游戏状态 (Game state)
    let score = 0;
    let gameState: 'StartMenu' | 'Playing' | 'GameOver' | 'Paused' = 'StartMenu';
    
    const setGameState = (newState: 'StartMenu' | 'Playing' | 'GameOver' | 'Paused') => {
      gameState = newState;
      setGameStateReact(newState);
    };

    let screenShakeUntil = 0;
    let screenShakeMagnitude = 5;

    // 粒子系统 (Particle system)
    type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number };
    let particles: Particle[] = [];
    
    const createExplosion = (x: number, y: number, isBoss: boolean) => {
      playExplosionSound(isBoss); // 播放爆炸音效 (Play explosion sound)
      const count = isBoss ? 40 : 15;
      const colors = ['#ff4500', '#ff8c00', '#ffd700', '#ff0000'];
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * (isBoss ? 6 : 4) + 1;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 500, // 500ms
          maxLife: 500,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: Math.random() * 4 + 2
        });
      }
    };

    // 星空背景 (Starry background)
    // 1. 最远的一层：缓慢移动的稀疏星星 (Layer 1: Slow, sparse stars)
    const bgStars = Array.from({ length: 60 }, () => ({
      x: Math.random() * CANVAS_WIDTH,
      y: Math.random() * CANVAS_HEIGHT,
      radius: Math.random() * 0.8 + 0.2, // 0.2 - 1.0
      speed: Math.random() * 0.5 + 0.2,  // 0.2 - 0.7
      alpha: Math.random() * 0.3 + 0.1   // 0.1 - 0.4
    }));

    // 2. 中间一层：稍微快一点的密集星团 (Layer 2: Faster, dense stars)
    const midStars = Array.from({ length: 150 }, () => ({
      x: Math.random() * CANVAS_WIDTH,
      y: Math.random() * CANVAS_HEIGHT,
      radius: Math.random() * 1.5 + 0.8, // 0.8 - 2.3
      speed: Math.random() * 1.5 + 1.0,  // 1.0 - 2.5
      alpha: Math.random() * 0.5 + 0.4   // 0.4 - 0.9
    }));

    // 3. 最近的一层：偶尔飘过的星云碎片 (Layer 3: Passing nebula fragments)
    type NebulaBlob = { offsetX: number; offsetY: number; radius: number };
    type Nebula = { x: number; y: number; speed: number; color: string; alpha: number; blobs: NebulaBlob[] };
    
    const createNebula = (startY?: number): Nebula => {
      const colors = ['#4b0082', '#00008b', '#483d8b', '#8a2be2', '#9400d3', '#00ced1', '#ff1493'];
      const blobs: NebulaBlob[] = [];
      const numBlobs = Math.floor(Math.random() * 4) + 3; // 3 to 6 blobs per nebula
      for (let i = 0; i < numBlobs; i++) {
        blobs.push({
          offsetX: (Math.random() - 0.5) * 120,
          offsetY: (Math.random() - 0.5) * 120,
          radius: Math.random() * 40 + 30
        });
      }
      return {
        x: Math.random() * CANVAS_WIDTH,
        y: startY !== undefined ? startY : -200 - Math.random() * 300,
        speed: Math.random() * 2 + 2.5, // 2.5 - 4.5
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: Math.random() * 0.1 + 0.05, // 0.05 - 0.15
        blobs
      };
    };
    
    // 初始化时在屏幕各处散布一些星云
    let nebulas: Nebula[] = Array.from({ length: 4 }, () => createNebula(Math.random() * CANVAS_HEIGHT));

    // 碰撞检测辅助函数 (Collision detection helper)
    const checkCollision = (rect1: {x: number, y: number, width: number, height: number}, rect2: {x: number, y: number, width: number, height: number}) => {
      return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
      );
    };

    // 绘制战机辅助函数 (Draw jet helper)
    const drawJet = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string, isEnemy: boolean) => {
      ctx.save();
      ctx.translate(x + width / 2, y + height / 2);
      if (isEnemy) {
        ctx.rotate(Math.PI);
      }

      const w = width;
      const h = height;

      // 引擎火焰 (Engine flames)
      ctx.fillStyle = '#00ffff';
      ctx.beginPath();
      ctx.moveTo(-w * 0.15, h * 0.4);
      ctx.lineTo(-w * 0.15, h * 0.4 + Math.random() * h * 0.4 + h * 0.2);
      ctx.lineTo(-w * 0.05, h * 0.4);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(w * 0.15, h * 0.4);
      ctx.lineTo(w * 0.15, h * 0.4 + Math.random() * h * 0.4 + h * 0.2);
      ctx.lineTo(w * 0.05, h * 0.4);
      ctx.fill();

      // 主翼 (Main wings)
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.1);
      ctx.lineTo(w * 0.45, h * 0.2);
      ctx.lineTo(w * 0.45, h * 0.3);
      ctx.lineTo(w * 0.15, h * 0.25);
      ctx.lineTo(0, h * 0.1);
      ctx.lineTo(-w * 0.15, h * 0.25);
      ctx.lineTo(-w * 0.45, h * 0.3);
      ctx.lineTo(-w * 0.45, h * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 导弹 (Missiles)
      ctx.fillStyle = '#fff';
      ctx.fillRect(-w * 0.4, h * 0.15, w * 0.04, h * 0.2);
      ctx.fillRect(-w * 0.3, h * 0.1, w * 0.04, h * 0.2);
      ctx.fillRect(w * 0.4 - w * 0.04, h * 0.15, w * 0.04, h * 0.2);
      ctx.fillRect(w * 0.3 - w * 0.04, h * 0.1, w * 0.04, h * 0.2);

      // 尾翼 (Tail wings)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-w * 0.1, h * 0.3);
      ctx.lineTo(-w * 0.25, h * 0.45);
      ctx.lineTo(-w * 0.1, h * 0.45);
      ctx.lineTo(0, h * 0.35);
      ctx.lineTo(w * 0.1, h * 0.45);
      ctx.lineTo(w * 0.25, h * 0.45);
      ctx.lineTo(w * 0.1, h * 0.3);
      ctx.fill();
      ctx.stroke();

      // 机身 (Fuselage)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.45); // 机鼻 (Nose tip)
      ctx.lineTo(w * 0.12, -h * 0.2);
      ctx.lineTo(w * 0.15, h * 0.4);
      ctx.lineTo(-w * 0.15, h * 0.4);
      ctx.lineTo(-w * 0.12, -h * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 黄色装饰 (Yellow accents)
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.2);
      ctx.lineTo(w * 0.12, -h * 0.1);
      ctx.lineTo(-w * 0.12, -h * 0.1);
      ctx.fill();

      // 雷达罩 (Nose cone)
      ctx.fillStyle = '#E0E0E0';
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.5);
      ctx.lineTo(w * 0.06, -h * 0.35);
      ctx.lineTo(-w * 0.06, -h * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 驾驶舱 (Cockpit)
      ctx.fillStyle = '#4682B4';
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.15, w * 0.06, h * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFF';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    };

    // 绘制直升机辅助函数 (Draw helicopter helper)
    const drawHelicopter = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string, rotation: number) => {
      ctx.save();
      ctx.translate(x + width / 2, y + height / 2);
      ctx.rotate(Math.PI); // 朝下 (Facing down)

      const w = width;
      const h = height;

      // 引擎火焰 (Engine flames)
      ctx.fillStyle = '#00ffff';
      ctx.beginPath();
      ctx.moveTo(-w * 0.2, h * 0.45);
      ctx.lineTo(-w * 0.2, h * 0.45 + Math.random() * h * 0.3 + h * 0.2);
      ctx.lineTo(-w * 0.1, h * 0.45);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(w * 0.2, h * 0.45);
      ctx.lineTo(w * 0.2, h * 0.45 + Math.random() * h * 0.3 + h * 0.2);
      ctx.lineTo(w * 0.1, h * 0.45);
      ctx.fill();

      // 侧翼 (Side wings)
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w * 0.5, h * 0.1);
      ctx.lineTo(w * 0.5, h * 0.2);
      ctx.lineTo(w * 0.2, h * 0.2);
      ctx.lineTo(0, h * 0.1);
      ctx.lineTo(-w * 0.2, h * 0.2);
      ctx.lineTo(-w * 0.5, h * 0.2);
      ctx.lineTo(-w * 0.5, h * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 导弹挂载 (Missiles)
      ctx.fillStyle = '#fff';
      ctx.fillRect(-w * 0.4, h * 0.05, w * 0.04, h * 0.2);
      ctx.fillRect(-w * 0.3, h * 0.05, w * 0.04, h * 0.2);
      ctx.fillRect(w * 0.4 - w * 0.04, h * 0.05, w * 0.04, h * 0.2);
      ctx.fillRect(w * 0.3 - w * 0.04, h * 0.05, w * 0.04, h * 0.2);

      // 尾部 (Tail)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-w * 0.15, h * 0.2);
      ctx.lineTo(-w * 0.1, h * 0.5);
      ctx.lineTo(w * 0.1, h * 0.5);
      ctx.lineTo(w * 0.15, h * 0.2);
      ctx.fill();
      ctx.stroke();

      // 尾翼 (Tail wings)
      ctx.beginPath();
      ctx.moveTo(-w * 0.1, h * 0.45);
      ctx.lineTo(-w * 0.25, h * 0.5);
      ctx.lineTo(-w * 0.25, h * 0.55);
      ctx.lineTo(w * 0.25, h * 0.55);
      ctx.lineTo(w * 0.25, h * 0.5);
      ctx.lineTo(w * 0.1, h * 0.45);
      ctx.fill();
      ctx.stroke();

      // 机身主体 (Main fuselage)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.2, h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 驾驶舱 (Cockpit)
      ctx.fillStyle = '#2F4F4F';
      ctx.beginPath();
      ctx.ellipse(0, -h * 0.2, w * 0.1, h * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFF';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 螺旋桨 (Rotors)
      ctx.save();
      ctx.translate(0, -h * 0.05); // Rotor center
      ctx.rotate(rotation);
      
      ctx.fillStyle = '#333';
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 2;
      
      // Blade 1
      ctx.beginPath();
      ctx.rect(-w * 0.05, -h * 0.6, w * 0.1, h * 1.2);
      ctx.fill();
      ctx.stroke();
      
      // Blade 2
      ctx.beginPath();
      ctx.rect(-h * 0.6, -w * 0.05, h * 1.2, w * 0.1);
      ctx.fill();
      ctx.stroke();
      
      // Rotor hub
      ctx.fillStyle = '#666';
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      ctx.restore();

      ctx.restore();
    };

    // 按键状态 (Input state)
    const keys = {
      w: false,
      a: false,
      s: false,
      d: false,
      ' ': false, // 空格键 (Spacebar)
      '1': false, // 技能1: 穿透 (Skill 1: Pierce)
      '2': false  // 技能2: 无敌 (Skill 2: Invincible)
    };

    // 处理按下按键事件 (Handle keydown events)
    const handleKeyDown = (e: KeyboardEvent) => {
      initAudio(); // 初始化或恢复音频上下文 (Init or resume audio context)
      const key = e.key.toLowerCase();
      
      if (gameState === 'StartMenu' && key === 'enter') {
        setGameState('Playing');
        isPausedRef.current = false;
        // 清空敌机和子弹 (Clear enemies and bullets)
        enemies.length = 0;
        bullets.length = 0;
        enemyBullets.length = 0;
        powerUps.length = 0;
        particles.length = 0;
        score = 0;
        player.hp = player.maxHp;
        player.x = CANVAS_WIDTH / 2 - 30;
        player.y = CANVAS_HEIGHT - 100;
        player.shield = 0;
        player.isRaged = false;
        player.pierceCount = 0;
        player.invincibleCount = 0;
        player.invincibleTimer = 0;
        player.pierceTimer = 0;
        player.hitFlashTimer = 0;
        player.rageTimer = 0;
        player.shieldTimer = 0;
        return;
      }

      if ((key === 'p' || key === 'escape') && (gameState === 'Playing' || gameState === 'Paused')) {
        isPausedRef.current = !isPausedRef.current;
        return;
      }

      if (keys.hasOwnProperty(key)) {
        keys[key as keyof typeof keys] = true;
      }
    };

    // 处理松开按键事件 (Handle keyup events)
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (keys.hasOwnProperty(key)) {
        keys[key as keyof typeof keys] = false;
      }
    };

    // 监听键盘事件 (Listen for keyboard events)
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    let animationFrameId: number;
    let lastRealTime = Date.now();
    let gameTime = 0;

    // 游戏主循环 (Game loop)
    const gameLoop = () => {
      const currentRealTime = Date.now();
      const deltaTime = currentRealTime - lastRealTime;
      lastRealTime = currentRealTime;

      if (gameState === 'Playing' && isPausedRef.current) {
        setGameState('Paused');
      } else if (gameState === 'Paused' && !isPausedRef.current) {
        setGameState('Playing');
      }

      if (gameState === 'Playing') {
        gameTime += deltaTime;
      }
      const now = gameTime;

      // 1. 始终更新并绘制星空背景 (Always update and draw starry background)
      bgStars.forEach(star => {
        star.y += star.speed;
        if (star.y > CANVAS_HEIGHT) {
          star.y = 0;
          star.x = Math.random() * CANVAS_WIDTH;
        }
      });
      midStars.forEach(star => {
        star.y += star.speed;
        if (star.y > CANVAS_HEIGHT) {
          star.y = 0;
          star.x = Math.random() * CANVAS_WIDTH;
        }
      });
      nebulas.forEach((nebula, index) => {
        nebula.y += nebula.speed;
        if (nebula.y - 150 > CANVAS_HEIGHT) {
          nebulas[index] = createNebula();
        }
      });

      // 清空画布并填充黑色背景 (Clear canvas with black background)
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // 应用屏幕抖动 (Apply screen shake)
      ctx.save();
      if (gameState === 'Playing' && now < screenShakeUntil) {
        const dx = (Math.random() - 0.5) * screenShakeMagnitude;
        const dy = (Math.random() - 0.5) * screenShakeMagnitude;
        ctx.translate(dx, dy);
      } else if (now >= screenShakeUntil) {
        screenShakeMagnitude = 5; // 恢复默认抖动幅度 (Reset default magnitude)
      }

      // 绘制最远层星星 (Draw background stars)
      bgStars.forEach(star => {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // 绘制中间层星星 (Draw middle stars)
      midStars.forEach(star => {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // 绘制最近层星云 (Draw nebulas)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      nebulas.forEach(nebula => {
        ctx.fillStyle = nebula.color;
        ctx.globalAlpha = nebula.alpha;
        ctx.beginPath();
        nebula.blobs.forEach(blob => {
          ctx.moveTo(nebula.x + blob.offsetX + blob.radius, nebula.y + blob.offsetY);
          ctx.arc(nebula.x + blob.offsetX, nebula.y + blob.offsetY, blob.radius, 0, Math.PI * 2);
        });
        ctx.fill();
      });
      ctx.restore();

      if (gameState === 'StartMenu') {
        ctx.restore(); // 恢复屏幕抖动的 translate (Restore screen shake translate)
        
        // 绘制开始菜单 (Draw Start Menu)
        ctx.save();
        ctx.textAlign = 'center';
        
        // 标题：雷霆战机 (Title: Thunder Fighter)
        ctx.font = 'bold 50px monospace';
        ctx.fillStyle = '#00ffff';
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 20;
        ctx.fillText('《雷霆战机》', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 3);
        
        // 绘制一架战机作为装饰 (Draw a fighter plane as decoration)
        ctx.shadowBlur = 0; // 移除发光效果 (Remove glow effect for the plane)
        drawJet(ctx, CANVAS_WIDTH / 2 - 30, CANVAS_HEIGHT / 2 - 60, 60, 60, '#0066cc', false);

        // 闪烁的提示文字 (Blinking prompt text)
        if (Math.floor(currentRealTime / 500) % 2 === 0) {
          ctx.font = '20px monospace';
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 0;
          ctx.fillText('按下 Enter 键开始游戏', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50);
        }
        ctx.restore();
        
        animationFrameId = requestAnimationFrame(gameLoop);
        return;
      }

      if (gameState === 'GameOver') {
        ctx.restore(); // 恢复屏幕抖动的 translate (Restore screen shake translate)
        
        if (!gameOver) {
          setGameOver(true);
          setGameStateReact('GameOver');
        }
        // 绘制游戏结束画面 (Draw game over screen)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = 'white';
        ctx.font = '40px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        ctx.font = '20px monospace';
        ctx.fillText(`Score: ${score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
        
        return; // 停止循环 (Stop the loop)
      }

      // 2. 游戏进行中逻辑 (Playing state logic)
      if (gameState === 'Playing') {
        // 根据按键更新玩家位置 (Update player position based on keys)
        if (keys.w) player.y -= player.speed;
        if (keys.s) player.y += player.speed;
        if (keys.a) player.x -= player.speed;
        if (keys.d) player.x += player.speed;

      // 限制玩家在画布范围内移动 (Constrain player to canvas bounds)
      if (player.x < 0) player.x = 0;
      if (player.x + player.width > CANVAS_WIDTH) player.x = CANVAS_WIDTH - player.width;
      if (player.y < 0) player.y = 0;
      if (player.y + player.height > CANVAS_HEIGHT) player.y = CANVAS_HEIGHT - player.height;

      // 发射子弹 (Shoot bullets)
      // 激活技能 (Activate skills)
      if (keys['1'] && player.pierceCount > 0 && now > player.pierceTimer) {
        player.pierceCount--;
        player.pierceTimer = now + 5000;
        keys['1'] = false; // 防止长按连续消耗 (Prevent continuous consumption if held)
      }
      if (keys['2'] && player.invincibleCount > 0 && now > player.invincibleTimer) {
        player.invincibleCount--;
        player.invincibleTimer = now + 6000;
        keys['2'] = false; // 防止长按连续消耗 (Prevent continuous consumption if held)
      }

      // 检查增益持续时间 (Check power-up durations)
      if (player.shield > 0 && now > player.shieldTimer) {
        player.shield = 0;
      }
      if (player.isRaged && now > player.rageTimer) {
        player.isRaged = false;
      }

      const currentFireRate = player.isRaged ? player.fireRate / 2 : player.fireRate;
      const isPiercing = now <= player.pierceTimer;
      const bulletColor = isPiercing ? '#ffaa00' : 'red';
      
      if (keys[' '] && now - player.lastShotTime > currentFireRate) {
        playLaserSound(); // 播放激光音效 (Play laser sound)
        if (player.isRaged) {
          bullets.push({ x: player.x + player.width / 2 - 2, y: player.y, width: 4, height: 15, speed: 10, color: bulletColor, isPiercing, bounces: 0, vx: 0, vy: -10, hitEnemies: new Set() });
          bullets.push({ x: player.x + player.width / 2 - 20, y: player.y + 10, width: 4, height: 15, speed: 10, color: bulletColor, isPiercing, bounces: 0, vx: -2, vy: -10, hitEnemies: new Set() });
          bullets.push({ x: player.x + player.width / 2 + 16, y: player.y + 10, width: 4, height: 15, speed: 10, color: bulletColor, isPiercing, bounces: 0, vx: 2, vy: -10, hitEnemies: new Set() });
        } else {
          bullets.push({
            x: player.x + player.width / 2 - 2, // 子弹从飞机中间射出 (Bullet from center)
            y: player.y,                        // 子弹从飞机顶部射出 (Bullet from top)
            width: 4,
            height: 15,
            speed: 10,
            color: bulletColor,
            isPiercing,
            bounces: 0,
            vx: 0,
            vy: -10,
            hitEnemies: new Set()
          });
        }
        player.lastShotTime = now;
      }

      // 更新子弹位置 (Update bullet positions)
      bullets.forEach(bullet => {
        if (bullet.isPiercing) {
          bullet.x += bullet.vx || 0;
          bullet.y += bullet.vy || -bullet.speed;
          
          if ((bullet.bounces || 0) < 2) {
            if (bullet.x <= 0) {
              bullet.x = 0;
              bullet.vx = -(bullet.vx || 0);
              bullet.bounces = (bullet.bounces || 0) + 1;
            } else if (bullet.x + bullet.width >= CANVAS_WIDTH) {
              bullet.x = CANVAS_WIDTH - bullet.width;
              bullet.vx = -(bullet.vx || 0);
              bullet.bounces = (bullet.bounces || 0) + 1;
            }
            
            if (bullet.y <= 0) {
              bullet.y = 0;
              bullet.vy = -(bullet.vy || -bullet.speed);
              if (bullet.vx === 0) {
                bullet.vx = (Math.random() > 0.5 ? 1 : -1) * 3;
              }
              bullet.bounces = (bullet.bounces || 0) + 1;
            } else if (bullet.y + bullet.height >= CANVAS_HEIGHT) {
              bullet.y = CANVAS_HEIGHT - bullet.height;
              bullet.vy = -(bullet.vy || -bullet.speed);
              bullet.bounces = (bullet.bounces || 0) + 1;
            }
          }
        } else {
          bullet.x += bullet.vx || 0;
          bullet.y -= bullet.speed;
        }
      });

      // 移除飞出屏幕的子弹 (Remove off-screen bullets)
      bullets = bullets.filter(bullet => bullet.y + bullet.height > 0 && bullet.y < CANVAS_HEIGHT && bullet.x + bullet.width > 0 && bullet.x < CANVAS_WIDTH);

      // 生成技能 (Spawn skills)
      if (now - lastSkillSpawnTime > skillSpawnRate) {
        const type = Math.random() > 0.5 ? 'pierce' : 'invincible';
        skills.push({
          x: Math.random() * (CANVAS_WIDTH - 30),
          y: -30,
          width: 30,
          height: 30,
          speed: 3,
          type
        });
        lastSkillSpawnTime = now;
      }

      // 生成敌机 (Spawn enemies)
      if (now - lastEnemySpawnTime > enemySpawnRate) {
        const elapsedTime = now - gameStartTime;
        let bossProb = 0;
        let purpleProb = 0;

        if (elapsedTime < 30000) {
          // 0-30秒: 100% 普通战机
          bossProb = 0;
          purpleProb = 0;
        } else if (elapsedTime < 75000) {
          // 30秒-1分15秒: 30% boss, 70% 普通战机
          bossProb = 0.3;
          purpleProb = 0;
        } else if (elapsedTime < 150000) {
          // 1分15秒-2分30秒: 30% boss, 20% 紫色战机, 50% 普通战机
          bossProb = 0.3;
          purpleProb = 0.2;
        } else {
          // 2分30秒之后: 40% boss, 40% 紫色战机, 20% 普通战机
          bossProb = 0.4;
          purpleProb = 0.4;
        }

        const r = Math.random();
        if (r < bossProb) { // 生成 Boss
          const size = 120;
          enemies.push({
            x: Math.random() * (CANVAS_WIDTH - size),
            y: -size,
            width: size,
            height: size,
            speed: 1.5,
            color: '#cc0000',
            type: 'boss',
            hp: 5,
            maxHp: 5,
            rotation: 0,
            lastShotTime: 0,
            isShooting: false,
            shootTimer: now
          });
        } else if (r < bossProb + purpleProb) { // 生成紫色敌机
          const size = 60;
          enemies.push({
            x: Math.random() * (CANVAS_WIDTH - size),
            y: -size,
            width: size,
            height: size,
            speed: 2,
            vx: (Math.random() - 0.5) * 4, // 随机水平速度
            color: 'purple',
            type: 'purple',
            hp: 1,
            maxHp: 1,
            lastShotTime: 0,
            moveTimer: now
          });
        } else { // 生成普通敌机
          const size = 60;
          enemies.push({
            x: Math.random() * (CANVAS_WIDTH - size), // 随机水平位置 (Random horizontal position)
            y: -size,                                 // 从屏幕顶部上方开始 (Start above top edge)
            width: size,
            height: size,
            speed: Math.random() * 2 + 2,             // 敌机下落速度 (Enemy falling speed)
            color: '#cc0000',                         // 敌机颜色 (Enemy color)
            type: 'normal',
            hp: 1,
            maxHp: 1
          });
        }
        lastEnemySpawnTime = now;
      }

      // 更新敌机位置 (Update enemy positions)
      enemies.forEach(enemy => {
        enemy.y += enemy.speed;
        if (enemy.type === 'boss') {
          enemy.rotation = (enemy.rotation || 0) + 0.2;
          
          // Boss 射击逻辑 (Boss shooting logic)
          // 射击 2 秒，停歇 2 秒 (Shoots for 2s, stops for 2s)
          if (now - (enemy.shootTimer || 0) > 2000) {
            enemy.isShooting = !enemy.isShooting;
            enemy.shootTimer = now;
          }

          if (enemy.isShooting && now - (enemy.lastShotTime || 0) > 300) { // 射击间隔 300ms
            enemyBullets.push({
              x: enemy.x + enemy.width / 2 - 4,
              y: enemy.y + enemy.height,
              width: 8,
              height: 20,
              speed: 7,
              color: '#ffaa00',
              damage: 20
            });
            enemy.lastShotTime = now;
          }
        } else if (enemy.type === 'purple') {
          // 随机移动 (Random movement)
          enemy.x += (enemy.vx || 0);
          
          // 碰壁反弹 (Bounce off walls)
          if (enemy.x <= 0) {
            enemy.x = 0;
            enemy.vx = Math.abs(enemy.vx || 2);
          } else if (enemy.x + enemy.width >= CANVAS_WIDTH) {
            enemy.x = CANVAS_WIDTH - enemy.width;
            enemy.vx = -Math.abs(enemy.vx || 2);
          }

          // 每隔一段时间随机改变水平方向 (Change direction randomly)
          if (now - (enemy.moveTimer || 0) > 1000) {
            enemy.vx = (Math.random() - 0.5) * 4;
            enemy.moveTimer = now;
          }

          // 射击逻辑 (Shooting logic) - 保持原本的攻速
          const purpleFireRate = 250; 
          if (now - (enemy.lastShotTime || 0) > purpleFireRate) {
            enemyBullets.push({
              x: enemy.x + enemy.width / 2 - 4,
              y: enemy.y + enemy.height,
              width: 8,
              height: 20,
              speed: 8,
              color: 'purple',
              damage: 10
            });
            enemy.lastShotTime = now;
          }
        }
      });

      // 移除飞出屏幕底部的敌机 (Remove off-screen enemies)
      enemies = enemies.filter(enemy => enemy.y < CANVAS_HEIGHT);

      // 更新敌方子弹位置 (Update enemy bullet positions)
      enemyBullets.forEach(bullet => {
        bullet.y += bullet.speed;
      });

      // 移除飞出屏幕底部的敌方子弹 (Remove off-screen enemy bullets)
      enemyBullets = enemyBullets.filter(bullet => bullet.y < CANVAS_HEIGHT);

      // 碰撞检测：子弹与敌机 (Collision: Bullets vs Enemies)
      for (let i = bullets.length - 1; i >= 0; i--) {
        for (let j = enemies.length - 1; j >= 0; j--) {
          if (checkCollision(bullets[i], enemies[j])) {
            const bullet = bullets[i];
            const enemy = enemies[j];
            
            if (bullet.isPiercing && bullet.hitEnemies?.has(enemy)) {
              continue; // 穿透子弹已经击中过该敌机，跳过 (Piercing bullet already hit this enemy, skip)
            }

            if (bullet.isPiercing) {
              bullet.hitEnemies?.add(enemy);
            } else {
              bullets.splice(i, 1); // 移除子弹 (Remove bullet)
            }
            
            enemies[j].hp -= 1;
            enemies[j].hitFlashTimer = now + 2000; // 2000ms hit flash
            if (enemies[j].hp <= 0) {
              createExplosion(enemies[j].x + enemies[j].width / 2, enemies[j].y + enemies[j].height / 2, enemies[j].type === 'boss');
              if (enemies[j].type === 'boss') {
                screenShakeUntil = now + 300; // 300ms screen shake
                screenShakeMagnitude = 15; // 3x magnitude
                score += 50;
                // 掉落增益道具 (Drop power-up)
                const types: ('shield' | 'rage' | 'bomb' | 'health')[] = ['shield', 'rage', 'bomb', 'health'];
                const dropType = types[Math.floor(Math.random() * types.length)];
                powerUps.push({
                  x: enemies[j].x + enemies[j].width / 2 - 15,
                  y: enemies[j].y + enemies[j].height / 2 - 15,
                  width: 30,
                  height: 30,
                  speed: 2,
                  type: dropType
                });
              } else if (enemies[j].type === 'purple') {
                score += 30;
              } else {
                score += 10;
              }
              enemies.splice(j, 1); // 移除敌机 (Remove enemy)
            }
            
            if (!bullet.isPiercing) {
              break;                // 子弹已销毁，跳出内层循环 (Bullet destroyed, break inner loop)
            }
          }
        }
      }

      // 碰撞检测：敌方子弹与玩家 (Collision: Enemy Bullets vs Player)
      for (let i = enemyBullets.length - 1; i >= 0; i--) {
        if (checkCollision(enemyBullets[i], player)) {
          const damage = enemyBullets[i].damage || 20;
          enemyBullets.splice(i, 1);
          
          if (now <= player.invincibleTimer) {
            continue; // 无敌状态免伤 (Invincible state, no damage)
          }

          player.lastDamageTime = now;
          player.nextHealTime = now + 5000;
          player.hitFlashTimer = now + 2000;
          if (player.shield > 0) {
            player.shield -= damage;
            if (player.shield < 0) {
              player.hp += player.shield;
              player.shield = 0;
            }
          } else {
            player.hp -= damage;
          }
          if (player.hp <= 0) {
            gameState = 'GameOver';
          }
        }
      }

      // 碰撞检测：玩家与敌机 (Collision: Player vs Enemies)
      for (let i = enemies.length - 1; i >= 0; i--) {
        if (checkCollision(player, enemies[i])) {
          if (now <= player.invincibleTimer) {
            if (enemies[i].type !== 'boss') {
              createExplosion(enemies[i].x + enemies[i].width / 2, enemies[i].y + enemies[i].height / 2, false);
              enemies.splice(i, 1); // 无敌状态直接撞毁普通/紫色敌机 (Destroy normal/purple enemies instantly when invincible)
            }
            continue;
          }

          player.lastDamageTime = now;
          player.nextHealTime = now + 5000;
          player.hitFlashTimer = now + 2000;
          
          if (enemies[i].type === 'boss') {
            createExplosion(player.x + player.width / 2, player.y + player.height / 2, true);
            player.hp = 0; // 撞击 Boss 直接阵亡 (Instant death on boss collision)
            gameState = 'GameOver';
            break; // 游戏结束，跳出循环
          } else {
            // 撞击普通或紫色敌机扣 50 血 (Lose 50 HP on normal/purple collision)
            const damage = 50;
            if (player.shield > 0) {
              player.shield -= damage;
              if (player.shield < 0) {
                player.hp += player.shield;
                player.shield = 0;
              }
            } else {
              player.hp -= damage;
            }
            
            createExplosion(enemies[i].x + enemies[i].width / 2, enemies[i].y + enemies[i].height / 2, false);
            enemies.splice(i, 1); // 撞毁敌机 (Destroy the enemy)
            
            if (player.hp <= 0) {
              createExplosion(player.x + player.width / 2, player.y + player.height / 2, true);
              gameState = 'GameOver';
              break;
            }
          }
        }
      }

      // 更新技能位置 (Update skill positions)
      skills.forEach(s => s.y += s.speed);
      skills = skills.filter(s => s.y < CANVAS_HEIGHT);

      // 碰撞检测：玩家与技能 (Collision: Player vs Skills)
      for (let i = skills.length - 1; i >= 0; i--) {
        if (checkCollision(player, skills[i])) {
          const s = skills[i];
          skills.splice(i, 1);
          if (s.type === 'pierce') {
            player.pierceCount++; // 储存穿透技能 (Store pierce skill)
          } else if (s.type === 'invincible') {
            player.invincibleCount++; // 储存无敌技能 (Store invincible skill)
          }
        }
      }

      // 更新增益道具位置 (Update power-ups)
      powerUps.forEach(p => p.y += p.speed);
      powerUps = powerUps.filter(p => p.y < CANVAS_HEIGHT);

      // 碰撞检测：玩家与增益道具 (Collision: Player vs Power-ups)
      for (let i = powerUps.length - 1; i >= 0; i--) {
        if (checkCollision(player, powerUps[i])) {
          const p = powerUps[i];
          powerUps.splice(i, 1);
          if (p.type === 'shield') {
            player.shield += 50;
            player.shieldTimer = now + 5000; // 持续 5 秒
          } else if (p.type === 'rage') {
            player.isRaged = true;
            player.rageTimer = now + 5000; // 持续 5 秒
          } else if (p.type === 'bomb') {
            player.lastDamageTime = now;
            player.nextHealTime = now + 5000;
            player.hitFlashTimer = now + 2000;
            if (player.shield > 0) {
              player.shield = 0; // 护盾抵挡一次炸弹 (Shield blocks one bomb)
            } else {
              player.hp -= 50;
            }
            if (player.hp <= 0) gameState = 'GameOver';
          } else if (p.type === 'health') {
            player.hp = Math.min(player.maxHp, player.hp + 30);
          }
        }
      }

      // 自我恢复血量逻辑 (Auto-heal logic)
      if (now >= player.nextHealTime && player.hp > 0 && player.hp < player.maxHp) {
        player.hp = Math.min(player.maxHp, player.hp + 10);
        player.nextHealTime = now + 5000;
      }

        // 更新粒子 (Update particles)
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 16; // 假设 60fps，约 16ms 每帧
          if (p.life <= 0) {
            particles.splice(i, 1);
          }
        }
      }

      // 绘制玩家飞机 (Draw player plane)
      ctx.save();
      if (player.hitFlashTimer && now < player.hitFlashTimer) {
        if (Math.floor(now / 100) % 2 === 0) {
          ctx.filter = 'brightness(1000%)';
        }
      }
      if (now <= player.invincibleTimer) {
        // 无敌状态特效 (Invincible effect)
        ctx.globalAlpha = 0.7 + Math.sin(now / 100) * 0.3; // 闪烁效果
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 20;
        drawJet(ctx, player.x, player.y, player.width, player.height, '#00ffff', false);
      } else {
        if (player.isRaged) {
          ctx.shadowColor = 'red';
          ctx.shadowBlur = 15;
          drawJet(ctx, player.x, player.y, player.width, player.height, player.color, false);
        } else {
          drawJet(ctx, player.x, player.y, player.width, player.height, player.color, false);
        }
      }
      ctx.restore();

      // 绘制技能倒计时条 (Draw skill duration bars)
      const barWidth = 40;
      const barHeight = 4;
      let barOffsetY = player.y + player.height + 10;
      
      if (now <= player.pierceTimer) {
        const remaining = player.pierceTimer - now;
        const ratio = Math.max(0, remaining / 5000); // 穿透持续 5000ms
        ctx.fillStyle = 'rgba(255, 170, 0, 0.3)';
        ctx.fillRect(player.x + (player.width - barWidth) / 2, barOffsetY, barWidth, barHeight);
        ctx.fillStyle = '#ffaa00';
        ctx.fillRect(player.x + (player.width - barWidth) / 2, barOffsetY, barWidth * ratio, barHeight);
        barOffsetY += barHeight + 2;
      }
      
      if (now <= player.invincibleTimer) {
        const remaining = player.invincibleTimer - now;
        const ratio = Math.max(0, remaining / 6000); // 无敌持续 6000ms
        ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
        ctx.fillRect(player.x + (player.width - barWidth) / 2, barOffsetY, barWidth, barHeight);
        ctx.fillStyle = '#00ffff';
        ctx.fillRect(player.x + (player.width - barWidth) / 2, barOffsetY, barWidth * ratio, barHeight);
      }

      // 绘制子弹 (Draw bullets)
      bullets.forEach(bullet => {
        ctx.fillStyle = bullet.color;
        ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
      });

      // 绘制敌方子弹 (Draw enemy bullets)
      enemyBullets.forEach(bullet => {
        ctx.fillStyle = bullet.color;
        ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
      });

      // 绘制敌机 (Draw enemies)
      enemies.forEach(enemy => {
        ctx.save();
        if (enemy.hitFlashTimer && now < enemy.hitFlashTimer) {
          if (Math.floor(now / 100) % 2 === 0) {
            ctx.filter = 'brightness(1000%)';
          }
        }
        if (enemy.type === 'boss') {
          drawHelicopter(ctx, enemy.x, enemy.y, enemy.width, enemy.height, enemy.color, enemy.rotation || 0);
          ctx.restore(); // 恢复滤镜，避免血条也被闪白 (Restore filter to avoid flashing HP bar)
          // 绘制 Boss 血条 (Draw boss HP bar)
          ctx.fillStyle = 'red';
          ctx.fillRect(enemy.x, enemy.y - 10, enemy.width, 5);
          ctx.fillStyle = '#00ff00';
          ctx.fillRect(enemy.x, enemy.y - 10, enemy.width * (enemy.hp / enemy.maxHp), 5);
        } else {
          drawJet(ctx, enemy.x, enemy.y, enemy.width, enemy.height, enemy.color, true);
          ctx.restore();
        }
      });

      // 绘制粒子 (Draw particles)
      particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.restore();
      });

      // 绘制增益道具 (Draw power-ups)
      powerUps.forEach(p => {
        ctx.fillStyle = p.type === 'shield' ? '#00ffff' : p.type === 'rage' ? '#ff00ff' : p.type === 'bomb' ? '#333333' : '#00ff00';
        ctx.beginPath();
        ctx.arc(p.x + p.width / 2, p.y + p.height / 2, p.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = '16px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.type === 'shield' ? 'S' : p.type === 'rage' ? 'R' : p.type === 'bomb' ? 'B' : 'H', p.x + p.width / 2, p.y + p.height / 2);
      });

      // 绘制技能 (Draw skills)
      skills.forEach(s => {
        ctx.save();
        ctx.translate(s.x + s.width / 2, s.y + s.height / 2);
        ctx.rotate(Math.PI / 4); // 旋转45度变成菱形 (Rotate 45 degrees to make a diamond)
        ctx.fillStyle = s.type === 'pierce' ? '#ffaa00' : '#00ffff'; 
        ctx.shadowColor = s.type === 'pierce' ? '#ffaa00' : '#00ffff';
        ctx.shadowBlur = 15;
        ctx.fillRect(-s.width / 2, -s.height / 2, s.width, s.height);
        ctx.restore();
        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.type === 'pierce' ? 'P' : 'I', s.x + s.width / 2, s.y + s.height / 2);
      });

      // 绘制玩家 HP (Draw player HP)
      ctx.fillStyle = 'red';
      ctx.fillRect(10, 40, 200, 20);
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(10, 40, 200 * (Math.max(0, player.hp) / player.maxHp), 20);
      ctx.fillStyle = 'white';
      ctx.font = '16px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`HP: ${Math.max(0, player.hp)}/${player.maxHp}`, 15, 55);

      // 绘制护盾 (Draw Shield)
      if (player.shield > 0) {
        ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
        ctx.fillRect(10, 65, 200, 10);
        ctx.fillStyle = '#00ffff';
        ctx.fillRect(10, 65, 200 * Math.min(player.shield / 100, 1), 10);
        ctx.fillStyle = 'white';
        ctx.font = '12px monospace';
        ctx.fillText(`Shield: ${player.shield}`, 15, 74);
        
        // 绘制玩家身上的护盾光环 (Draw shield aura around player)
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(player.x + player.width / 2, player.y + player.height / 2, player.width / 2 + 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 绘制储存的技能 (Draw stored skills)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(10, 85, 200, 30);
      
      ctx.fillStyle = '#ffaa00';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`[1] 穿透(P): ${player.pierceCount}`, 15, 105);
      
      ctx.fillStyle = '#00ffff';
      ctx.fillText(`[2] 无敌(I): ${player.invincibleCount}`, 115, 105);

      // 绘制分数 (Draw score)
      ctx.fillStyle = 'white';
      ctx.font = '20px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`Score: ${score}`, 10, 30);

      // 恢复屏幕抖动的 translate (Restore screen shake translate)
      ctx.restore();

      if (gameState === 'Paused') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 40px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      }

      // 3. 请求下一帧 (Request next frame)
      animationFrameId = requestAnimationFrame(gameLoop);
    };

    // 启动游戏循环 (Start the game loop)
    gameLoop();

    // 组件卸载时清理事件监听和动画帧 (Cleanup on unmount)
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center relative">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={480}
          height={800}
          className="shadow-2xl shadow-blue-500/20 rounded-lg"
          style={{ display: 'block' }}
        />
        {(gameStateReact === 'Playing' || gameStateReact === 'Paused') && (
          <button
            onClick={() => {
              isPausedRef.current = !isPausedRef.current;
            }}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-sm transition-colors border border-white/20 text-white z-10"
            title={gameStateReact === 'Paused' ? "Resume" : "Pause"}
          >
            {gameStateReact === 'Paused' ? <Play size={24} /> : <Pause size={24} />}
          </button>
        )}
        {gameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {/* 占位，对齐 Canvas 内部的文字位置 */}
            <div className="h-[120px]"></div>
            <button
              onClick={() => window.location.reload()}
              className="pointer-events-auto px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-mono rounded-full shadow-lg transition-colors border border-blue-400"
            >
              重新开始 (Restart)
            </button>
          </div>
        )}
      </div>
      {/* 提示信息 */}
      <div className="absolute top-4 text-white/50 text-sm font-mono text-center pointer-events-none">
        使用 W A S D 控制移动<br />
        按 空格键 发射子弹
      </div>
    </div>
  );
}
