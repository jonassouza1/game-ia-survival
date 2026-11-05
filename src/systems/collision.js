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
      if (z < ramp.minZ - 0.08 || z > ramp.maxZ + 0.08) continue;
      const span = ramp.zTo - ramp.zFrom;
      const t = Math.min(1, Math.max(0, (z - ramp.zFrom) / (Math.abs(span) < 1e-6 ? 1 : span)));
      if (ramp.centerXFrom !== undefined) {
        const centerX = ramp.centerXAt ? ramp.centerXAt(t) : ramp.centerXFrom + (ramp.centerXTo - ramp.centerXFrom) * t;
        // A folga considera o raio do jogador: os pontos de apoio dos pés não
        // devem cair no piso inferior quando o centro ainda está sobre a escada.
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
      const centerFloor = this.floorY(nextX, nextZ, y);
      if (centerFloor === null || centerFloor < y - 0.58 || centerFloor > y + 0.58) return false;
      // A borda dos degraus não pode exigir que os cinco pontos de apoio estejam
      // na mesma superfície: isso prendia o jogador no último degrau e nas curvas.
      const support = [
        [nextX - radius * 0.78, nextZ], [nextX + radius * 0.78, nextZ],
        [nextX, nextZ - radius * 0.78], [nextX, nextZ + radius * 0.78],
      ];
      let supported = 0;
      for (const [sx, sz] of support) {
        const floor = this.floorY(sx, sz, y);
        if (floor !== null && Math.abs(floor - centerFloor) <= 0.68) supported++;
      }
      return supported >= 2;
    };
    // Divide o deslocamento em passos curtos para evitar atravessar móveis/colunas
    // em frames lentos e manter o deslizamento ao longo das paredes.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / Math.max(0.12, radius * 0.42)));
    const stepX = dx / steps, stepZ = dz / steps;
    for (let i = 0; i < steps; i++) {
      if (canMoveTo(nx + stepX, nz)) nx += stepX;
      if (canMoveTo(nx, nz + stepZ)) nz += stepZ;
    }
    return { x: nx, z: nz };
  }
}
