const PLAYER_HEIGHT = 1.7;

/**
 * Colisão horizontal com suporte a andares e rampas do saguão principal.
 * Caixas podem limitar a colisão a uma faixa vertical (por exemplo, o corrimão da galeria).
 */
export class CollisionWorld {
  constructor() {
    this.boxes = [];
    this.ramps = [];
    this.platforms = [];
    this.floors = [];
  }

  addBox(cx, cz, w, d, { y0 = -Infinity, y1 = Infinity } = {}) {
    this.boxes.push({
      minX: cx - w / 2, maxX: cx + w / 2,
      minZ: cz - d / 2, maxZ: cz + d / 2,
      y0, y1,
    });
  }

  addRamp(ramp) { this.ramps.push(ramp); }
  addPlatform(platform) { this.platforms.push(platform); }
  addFloor(floor) { this.floors.push(floor); }

  floorY(x, z, y) {
    for (const platform of this.platforms) {
      if (y >= platform.minEntryY && x >= platform.minX && x <= platform.maxX && z >= platform.minZ && z <= platform.maxZ) {
        return platform.y;
      }
    }
    for (const ramp of this.ramps) {
      if (z < ramp.minZ || z > ramp.maxZ) continue;
      const t = Math.min(1, Math.max(0, (z - ramp.zFrom) / (ramp.zTo - ramp.zFrom)));
      if (ramp.centerXFrom !== undefined) {
        const centerX = ramp.centerXFrom + (ramp.centerXTo - ramp.centerXFrom) * t;
        if (Math.abs(x - centerX) > ramp.halfWidth) continue;
      } else if (x < ramp.minX || x > ramp.maxX) {
        continue;
      }
      return ramp.yFrom + (ramp.yTo - ramp.yFrom) * t;
    }
    for (const floor of this.floors) {
      if (x >= floor.minX && x <= floor.maxX && z >= floor.minZ && z <= floor.maxZ) return floor.y;
    }
    return null;
  }

  collides(x, z, radius, y = 0) {
    for (const box of this.boxes) {
      if (y + PLAYER_HEIGHT <= box.y0 || y >= box.y1 - 0.05) continue;
      const cx = Math.min(Math.max(x, box.minX), box.maxX);
      const cz = Math.min(Math.max(z, box.minZ), box.maxZ);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  // Move por eixo permite deslizar ao longo das paredes.
  move(x, z, dx, dz, radius = 0.34, y = 0) {
    let nx = x, nz = z;
    const canMoveTo = (nextX, nextZ) => {
      if (this.collides(nextX, nextZ, radius, y)) return false;
      const support = [
        [nextX, nextZ],
        [nextX - radius, nextZ], [nextX + radius, nextZ],
        [nextX, nextZ - radius], [nextX, nextZ + radius],
      ];
      return support.every(([sx, sz]) => {
        const floor = this.floorY(sx, sz, y);
        return floor !== null && floor >= y - 0.45 && floor <= y + 0.45;
      });
    };
    if (canMoveTo(x + dx, z)) nx = x + dx;
    if (canMoveTo(nx, z + dz)) nz = z + dz;
    return { x: nx, z: nz };
  }
}
