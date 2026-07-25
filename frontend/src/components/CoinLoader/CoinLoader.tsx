import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import styles from './CoinLoader.module.css';

interface CoinLoaderProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function CoinLoader({ size = 'md', label }: CoinLoaderProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    // 1. KILL SWITCH: Destroy any ghost canvases from React StrictMode causing double-renders
    mountRef.current.innerHTML = '';

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    // 2. Scene Setup
    const scene = new THREE.Scene();
    scene.background = null;

    // 3. Camera Setup (Position 18 for correct scale, looking exactly at the center)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
    camera.position.set(0, 0, 18);
    camera.lookAt(0, 0, 0);

    // 4. Renderer Setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // 5. THE POSITION FIX: Force canvas to pin perfectly to container bounds
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    
    mountRef.current.appendChild(renderer.domElement);

    // 6. Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.8);
    mainLight.position.set(10, 10, 10);
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.9);
    fillLight.position.set(-10, -10, -10);
    scene.add(fillLight);

    let coin: THREE.Mesh;

    // 7. Texture & Material Loading
    const loader = new THREE.TextureLoader();
    
    loader.load('/512_tinified.png', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      
      // THE PERFECT BALANCE: Stop the crawling lines but keep it HD
      texture.generateMipmaps = false; // Must be true if using a Mipmap filter below!
      texture.minFilter = THREE.LinearMipmapNearestFilter; 
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      
      texture.center.set(0.5, 0.5);
      texture.repeat.set(0.83, 0.85);

      const backTexture = texture.clone();
      backTexture.rotation = Math.PI;
      backTexture.needsUpdate = true;

      // The metallic edge
      const edgeMaterial = new THREE.MeshStandardMaterial({
        color: 0xFFC000,
        metalness: 1.0,
        roughness: 0.35,
      });

      // Front and back using BasicMaterial to keep the image bright and untouched by shadows
      // alphaTest: 0.5 cuts out the background transparent pixels without breaking 3D depth
      const frontMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        alphaTest: 0.5,
      });

      const backMaterial = new THREE.MeshBasicMaterial({
        map: backTexture,
        color: 0xffffff,
        alphaTest: 0.5,
      });

      const geometry = new THREE.CylinderGeometry(4, 4, 0.3, 100);
      coin = new THREE.Mesh(geometry, [edgeMaterial, frontMaterial, backMaterial]);

      coin.rotation.z = Math.PI / 2;
      coin.rotation.y = Math.PI / 2;
      scene.add(coin);
    });

    // 8. Animation Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (coin) {
        // INCREASED SPEED: Bumped from 0.015 to 0.025
        const baseSpeed = 0.05; 
        const pulse = Math.cos(coin.rotation.y * 2);
        const dynamicSpeed = baseSpeed * (1 + 0.7 * pulse);
        coin.rotation.y += dynamicSpeed;
      }
      
      renderer.render(scene, camera);
    };

    animate();

    // 9. Handle Resize
    const handleResize = () => {
      if (!mountRef.current) return;
      const newWidth = mountRef.current.clientWidth;
      const newHeight = mountRef.current.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };
    
    // Quick timeout to ensure container has dimensions before sizing
    setTimeout(handleResize, 50);
    window.addEventListener('resize', handleResize);

    // 10. Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div className={styles.wrap}>
      <div ref={mountRef} className={`${styles.canvasContainer} ${styles[size]}`} />
      {label && <p className={styles.label}>{label}</p>}
    </div>
  );
}