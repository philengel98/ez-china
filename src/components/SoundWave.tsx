import React, { useEffect, useRef } from 'react';

interface SoundWaveProps {
  volume: number; // 0.0 to 1.0 (RMS)
  isListening: boolean;
}

const SoundWave: React.FC<SoundWaveProps> = ({ volume, isListening }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const phaseRef = useRef<number>(0);
  const smoothedVolumeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawWave = (
      shift: number, 
      amplitude: number, 
      color: string, 
      lineWidth: number, 
      opacity: number
    ) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = opacity;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;
      
      // Use more points for a smoother curve
      const points = 100;
      
      for (let i = 0; i <= points; i++) {
        const x = (i / points) * width;
        
        // Sine wave formula: y = amplitude * sin(frequency * x + phase)
        // We add some horizontal compression at the edges for a "football" shape
        const edgeSmoothing = Math.sin((i / points) * Math.PI);
        const y = centerY + Math.sin(i * 0.15 + phaseRef.current + shift) * amplitude * edgeSmoothing;
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Smooth the volume input to avoid jitter
      // Sensitivity boost: volume * 8.0 on iOS vs volume * 3.5 on web
      // iOS RMS values are often in the 0.01-0.05 range, while web is often higher.
      const isNative = typeof window !== 'undefined' && (window as any).Capacitor?.getPlatform() !== 'web';
      const scale = isNative ? 8.0 : 3.5;
      const targetVolume = isListening ? Math.max(0.02, volume * scale) : 0;
      smoothedVolumeRef.current += (targetVolume - smoothedVolumeRef.current) * 0.15;
      
      const baseAmplitude = smoothedVolumeRef.current * (canvas.height * 0.45);
      
      // Update phase for movement
      phaseRef.current += 0.12;

      // Draw 3 layers of waves with different properties
      // Layer 1: Core wave
      drawWave(0, baseAmplitude, '#ef4444', 3, 0.8);
      
      // Layer 2: Faster, smaller wave (Purple/Red)
      drawWave(phaseRef.current * 0.5, baseAmplitude * 0.6, '#a855f7', 2, 0.4);
      
      // Layer 3: Slower, offset wave (Orange/Red)
      drawWave(-phaseRef.current * 0.3, baseAmplitude * 0.4, '#f97316', 1.5, 0.3);

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [volume, isListening]);

  return (
    <div className="w-full h-32 flex items-center justify-center overflow-hidden">
      <div className="relative w-full max-w-md h-full">
        {/* Shadow glow effect */}
        {isListening && (
          <div className="absolute inset-0 bg-red-500/10 blur-3xl rounded-full scale-75 animate-pulse" />
        )}
        <canvas
          ref={canvasRef}
          width={400}
          height={128}
          className="w-full h-full relative z-10"
        />
      </div>
    </div>
  );
};

export default SoundWave;
