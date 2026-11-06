import * as THREE from 'three';

/**
 * Pool de luzes pontuais.
 *
 * Cenas com dezenas de luminárias (postes, apliques, becos) estouram o custo
 * do shader PBR se todas virarem PointLight de verdade. O pool mantém um
 * número fixo de luzes reais e reposiciona as mais próximas da câmera, então
 * a contagem de luzes nunca muda — sem recompilar shaders nem engasgar.
 */
export class LightPool {
  constructor(parent, { count = 6, color = 0xffb46a, distance = 16, decay = 2 } = {}) {
    this.fixtures = [];
    this.lights = Array.from({ length: count }, () => {
      const light = new THREE.PointLight(color, 0, distance, decay);
      light.castShadow = false;
      parent.add(light);
      return light;
    });
  }

  /**
   * @param {object} fixture { position: Vector3, color, intensity, distance, decay }
   */
  add(fixture) {
    const entry = {
      position: fixture.position.clone(),
      color: new THREE.Color(fixture.color ?? 0xffb46a),
      intensity: fixture.intensity ?? 1,
      distance: fixture.distance ?? 16,
      decay: fixture.decay ?? 2,
      enabled: true,
      tag: fixture.tag ?? null,
    };
    this.fixtures.push(entry);
    return entry;
  }

  update(cameraPosition) {
    const scored = [];
    for (const fixture of this.fixtures) {
      if (!fixture.enabled || fixture.intensity <= 0.02) continue;
      const dx = fixture.position.x - cameraPosition.x;
      const dy = fixture.position.y - cameraPosition.y;
      const dz = fixture.position.z - cameraPosition.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > (fixture.distance + 18) ** 2) continue;
      scored.push({ fixture, distanceSq });
    }
    scored.sort((a, b) => a.distanceSq - b.distanceSq);

    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const entry = scored[i];
      if (!entry) {
        light.intensity = 0;
        light.visible = false;
        continue;
      }
      const { fixture } = entry;
      light.visible = true;
      light.position.copy(fixture.position);
      light.color.copy(fixture.color);
      light.distance = fixture.distance;
      light.decay = fixture.decay;
      light.intensity = fixture.intensity;
    }
  }
}
