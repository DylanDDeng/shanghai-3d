import * as THREE from 'three';
import type { ThreeOverlay } from './ThreeOverlay';

export type PrecipitationKind = 'rain' | 'snow';

/**
 * GPU-friendly precipitation: a single Points object in the camera's ENU frame. Particles live in a box
 * around the camera and wrap vertically, so the effect follows the camera anywhere over the city.
 */
export class Precipitation {
  private points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private removeTicker: () => void;
  private readonly box = { half: 180, height: 220 };

  constructor(
    private readonly overlay: ThreeOverlay,
    readonly kind: PrecipitationKind,
    count = kind === 'rain' ? 9000 : 5000,
  ) {
    const { half, height } = this.box;
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = (Math.random() * 2 - 1) * half;
      this.positions[i * 3 + 1] = (Math.random() * 2 - 1) * half;
      this.positions[i * 3 + 2] = Math.random() * height - height / 2;
      this.velocities[i] = kind === 'rain' ? 60 + Math.random() * 40 : 4 + Math.random() * 4;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({
      color: kind === 'rain' ? 0x9fc5e8 : 0xffffff,
      size: kind === 'rain' ? 1.4 : 2.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: kind === 'rain' ? 0.55 : 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geom, material);
    this.points.frustumCulled = false;
    overlay.enu.add(this.points);
    this.removeTicker = overlay.addTicker((dt) => this.tick(dt));
  }

  private tick(dt: number) {
    const { half, height } = this.box;
    const n = this.velocities.length;
    const drift = this.kind === 'snow' ? Math.sin(performance.now() / 900) * 1.5 : 6;
    for (let i = 0; i < n; i++) {
      let z = this.positions[i * 3 + 2] - this.velocities[i] * dt;
      let x = this.positions[i * 3] + drift * dt;
      if (z < -height / 2) z += height;
      if (x > half) x -= 2 * half;
      this.positions[i * 3] = x;
      this.positions[i * 3 + 2] = z;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.removeTicker();
    this.overlay.enu.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
