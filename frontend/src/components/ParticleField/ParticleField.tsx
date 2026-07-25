import { useEffect, useRef } from 'react';
import styles from './ParticleField.module.css';

/**
 * Ambient canvas backdrop — drifting gold/white embers plus the occasional
 * shooting star. Mounted once at the App shell level so every page shares the
 * same premium, alive-feeling background instead of a flat dark page.
 */
export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Narrowed once, captured here — TS can't carry the null-check across the
    // class bodies below, so this gives them a definitely-non-null reference.
    const el = canvas;

    let animationFrame: number;
    let particles: Particle[] = [];
    let shootingStars: ShootingStar[] = [];

    const resize = () => {
      el.width = window.innerWidth;
      el.height = window.innerHeight;
    };

    class Particle {
      x: number;
      y: number;
      size: number;
      speed: number;
      opacity: number;
      color: string;

      constructor() {
        this.x = Math.random() * el.width;
        this.y = Math.random() * el.height;
        this.size = Math.random() * 2.4 + 0.8;
        this.speed = Math.random() * 0.35 + 0.12;
        this.opacity = Math.random();
        this.color = Math.random() > 0.5 ? '#D4AF37' : '#F5F0D8';
      }

      update() {
        this.y -= this.speed;
        this.opacity = Math.sin(Date.now() / 1100 + this.x) * 0.5 + 0.5;
        if (this.y < 0) this.y = el.height;
      }

      draw() {
        if (!ctx) return;
        ctx.save();
        ctx.globalAlpha = this.opacity * 0.55;
        ctx.fillStyle = this.color;
        ctx.shadowBlur = this.color === '#D4AF37' ? 9 : 5;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    class ShootingStar {
      x: number;
      y: number;
      length: number;
      speed: number;
      opacity: number;
      color: string;

      constructor() {
        this.x = Math.random() * el.width;
        this.y = Math.random() * el.height * 0.4;
        this.length = Math.random() * 60 + 40;
        this.speed = Math.random() * 13 + 9;
        this.opacity = 1;
        this.color = Math.random() > 0.5 ? '#D4AF37' : '#F8F4E0';
      }

      update() {
        this.x += this.speed;
        this.y += this.speed * 0.6;
        this.opacity -= 0.018;
      }

      draw() {
        if (!ctx) return;
        ctx.save();
        ctx.globalAlpha = this.opacity;
        const gradient = ctx.createLinearGradient(this.x, this.y, this.x + this.length, this.y + this.length * 0.6);
        gradient.addColorStop(0, this.color);
        gradient.addColorStop(1, 'transparent');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 16;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x + this.length, this.y + this.length * 0.6);
        ctx.stroke();
        ctx.restore();
      }
    }

    const initParticles = () => {
      particles = Array.from({ length: 70 }, () => new Particle());
    };

    const animate = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, el.width, el.height);

      particles.forEach((p) => {
        p.update();
        p.draw();
      });

      shootingStars.forEach((s, i) => {
        s.update();
        s.draw();
        if (s.opacity <= 0) shootingStars.splice(i, 1);
      });
      if (Math.random() < 0.012) shootingStars.push(new ShootingStar());

      animationFrame = requestAnimationFrame(animate);
    };

    resize();
    initParticles();
    animate();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
