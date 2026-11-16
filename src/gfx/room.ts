/**
 * Simulated living-room backdrop for the non-headset fallback. Everything is boxes and
 * a procedural wood texture. It matches the default shell box so cracks/shards line up with the walls.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  ConeGeometry,
  CircleGeometry,
  Color,
} from 'three';
import { type Box } from '../core/cracks';
import { woodTexture } from './tex';

export class SimulatedRoom extends Group {
  readonly lamp = new PointLight(0xffd9a0, 6, 9, 1.6);

  constructor(box: Box) {
    super();
    const { center: c, half: h } = box;
    const wood = woodTexture();
    wood.repeat.set(h.x, h.z);
    const mat = (color: number) => new MeshLambertMaterial({ color });
    const add = (m: Mesh, x: number, y: number, z: number): Mesh => {
      m.position.set(x, y, z);
      this.add(m);
      return m;
    };

    // floor, ceiling, walls
    const floor = add(new Mesh(new PlaneGeometry(h.x * 2, h.z * 2).rotateX(-Math.PI / 2), new MeshLambertMaterial({ map: wood })), c.x, 0, c.z);
    floor.name = 'roomFloor';
    add(new Mesh(new PlaneGeometry(h.x * 2, h.z * 2).rotateX(Math.PI / 2), mat(0xe9e4dc)), c.x, c.y + h.y, c.z);
    const wallColor = 0xd7cfc2;
    add(new Mesh(new PlaneGeometry(h.x * 2, h.y * 2), mat(wallColor)), c.x, c.y, c.z - h.z); // front (facing +z)
    const back = add(new Mesh(new PlaneGeometry(h.x * 2, h.y * 2).rotateY(Math.PI), mat(wallColor)), c.x, c.y, c.z + h.z);
    back.name = 'backWall';
    add(new Mesh(new PlaneGeometry(h.z * 2, h.y * 2).rotateY(Math.PI / 2), mat(0xcfc6b8)), c.x - h.x, c.y, c.z);
    add(new Mesh(new PlaneGeometry(h.z * 2, h.y * 2).rotateY(-Math.PI / 2), mat(0xcfc6b8)), c.x + h.x, c.y, c.z);
    // skirting board
    for (const [w, d, x, z, ry] of [
      [h.x * 2, 0.02, c.x, c.z - h.z + 0.01, 0],
      [h.z * 2, 0.02, c.x - h.x + 0.01, c.z, Math.PI / 2],
      [h.z * 2, 0.02, c.x + h.x - 0.01, c.z, Math.PI / 2],
    ] as const) {
      const m = add(new Mesh(new BoxGeometry(w, 0.12, d), mat(0xf4f0ea)), x, 0.06, z);
      m.rotation.y = ry;
    }

    // window on the front wall (the bright light source)
    const win = add(
      new Mesh(new PlaneGeometry(1.8, 1.3), new MeshBasicMaterial({ color: new Color(0xcfe9ff).multiplyScalar(1.15) })),
      c.x + 1.5,
      1.55,
      c.z - h.z + 0.01,
    );
    win.name = 'window';
    for (const [w, hh, x, y] of [
      [1.9, 0.06, 0, 0.68],
      [1.9, 0.06, 0, -0.68],
      [0.06, 1.38, -0.93, 0],
      [0.06, 1.38, 0.93, 0],
      [0.04, 1.3, 0, 0],
      [1.8, 0.04, 0, 0],
    ] as const)
      add(new Mesh(new BoxGeometry(w, hh, 0.04), mat(0xf4f0ea)), win.position.x + x, win.position.y + y, win.position.z + 0.01);

    // sofa (back wall), coffee table, rug, plant, shelf, lamp
    const sofa = new Group();
    const fabric = mat(0x5b6b7a);
    const seat = new Mesh(new BoxGeometry(2.1, 0.4, 0.9), fabric);
    seat.position.set(0, 0.25, 0);
    const back2 = new Mesh(new BoxGeometry(2.1, 0.55, 0.22), fabric);
    back2.position.set(0, 0.62, 0.33);
    sofa.add(seat, back2);
    for (const s of [-1, 1]) {
      const arm = new Mesh(new BoxGeometry(0.2, 0.5, 0.9), fabric);
      arm.position.set(s * 1.05, 0.4, 0);
      sofa.add(arm);
    }
    sofa.position.set(c.x - 0.4, 0, c.z + h.z - 0.6);
    sofa.rotation.y = Math.PI;
    this.add(sofa);

    const rug = add(new Mesh(new CircleGeometry(1.5, 40).rotateX(-Math.PI / 2), mat(0x7a4b4b)), c.x, 0.005, c.z + 0.6);
    rug.scale.set(1.2, 1, 0.9);
    const table = new Mesh(new BoxGeometry(1.1, 0.04, 0.6), mat(0x3d2b20));
    add(table, c.x - 0.4, 0.42, c.z + h.z - 1.9);
    for (const [x, z] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]] as const)
      add(new Mesh(new BoxGeometry(0.05, 0.4, 0.05), mat(0x3d2b20)), table.position.x + x, 0.2, table.position.z + z);

    const plant = new Group();
    plant.add(new Mesh(new CylinderGeometry(0.17, 0.12, 0.34, 8), mat(0xb5683f)));
    const leaves = new Mesh(new ConeGeometry(0.34, 1.0, 7), mat(0x3d7a4c));
    leaves.position.y = 0.8;
    plant.add(leaves);
    plant.position.set(c.x - h.x + 0.5, 0.17, c.z - h.z + 0.6);
    this.add(plant);

    const shelf = new Group();
    shelf.add(new Mesh(new BoxGeometry(0.9, 1.9, 0.32), mat(0x4a3526)));
    for (let i = 0; i < 4; i++) {
      const b = new Mesh(new BoxGeometry(0.7, 0.28, 0.2), mat([0xb04a3a, 0x3a6ea5, 0xd9b44a, 0x4f8a5b][i]));
      b.position.set(0, -0.7 + i * 0.5, 0.08);
      shelf.add(b);
    }
    shelf.position.set(c.x - h.x + 0.25, 0.95, c.z + 1.4);
    shelf.rotation.y = Math.PI / 2;
    this.add(shelf);

    const lampBase = add(new Mesh(new CylinderGeometry(0.02, 0.1, 1.4, 6), mat(0x222222)), c.x + h.x - 0.6, 0.7, c.z + h.z - 0.7);
    const shade = add(new Mesh(new ConeGeometry(0.22, 0.28, 10, 1, true), new MeshBasicMaterial({ color: 0xffe2b0 })), lampBase.position.x, 1.5, lampBase.position.z);
    shade.rotation.x = Math.PI;
    this.lamp.position.set(lampBase.position.x, 1.45, lampBase.position.z);
    this.add(this.lamp);
  }
}
