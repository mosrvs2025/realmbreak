import { Color, Mesh, PlaneGeometry, ShaderMaterial, AdditiveBlending } from 'three';
import { PAL } from './palette';

/** Head-locked energy aura. A child of the camera, so it works identically in desktop and XR. */
export class AuraVignette extends Mesh {
  private readonly mat: ShaderMaterial;
  private time = 0;

  constructor() {
    const mat = new ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uA: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new Color().copy(PAL.player) },
        uPulse: { value: 1 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uA, uTime, uPulse; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p * vec2(1.0, 0.95));
          float edge = smoothstep(0.42, 1.0, r);
          float swirl = 0.85 + 0.15 * sin(atan(p.y, p.x) * 5.0 + uTime * 2.0 * uPulse);
          float pulse = 1.0 + 0.25 * sin(uTime * 5.0) * uPulse;
          float a = edge * edge * swirl * pulse * uA;
          gl_FragColor = vec4(uColor * 1.2, clamp(a, 0.0, 0.85));
        }`,
    });
    super(new PlaneGeometry(1.25, 1.25), mat);
    this.mat = mat;
    this.position.z = -0.32;
    this.renderOrder = 999;
    this.frustumCulled = false;
    this.visible = false;
  }

  update(dt: number, intensity: number, reduced: boolean, villain = false): void {
    this.time += dt;
    this.visible = intensity > 0.01;
    this.mat.uniforms.uA.value = intensity * 0.75;
    this.mat.uniforms.uTime.value = this.time;
    this.mat.uniforms.uPulse.value = reduced ? 0 : 1;
    this.mat.uniforms.uColor.value.copy(villain ? PAL.villain : PAL.player);
  }
}
