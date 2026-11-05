import * as THREE from 'three';

const imageUrls = import.meta.glob([
  '../../assets/_bg/stage01_room00_*.png',
  '../../assets/_bg/stage01_room16_*.png',
  '../../assets/_bg/stage01_room23_*.png',
], {
  eager: true,
  import: 'default',
  query: '?url',
});

const loader = new THREE.TextureLoader();
const views = new Map(
  Object.entries(imageUrls).map(([path, url]) => {
    const name = path.split(/[\\/]/).pop().replace('.png', '');
    const texture = loader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    return [name, texture];
  }),
);

function makeView(id, image, anchor, offset, look, mapping, fov = 48) {
  const texture = views.get(image);
  if (!texture) throw new Error(`Fundo de câmera fixa não encontrado: ${image}`);
  const perspectiveCamera = new THREE.PerspectiveCamera(fov, 4 / 3, 0.1, 200);
  perspectiveCamera.position.set(
    anchor[0] + offset[0],
    anchor[1] + offset[1],
    anchor[2] + offset[2],
  );
  perspectiveCamera.lookAt(
    anchor[0] + look[0],
    anchor[1] + look[1],
    anchor[2] + look[2],
  );
  perspectiveCamera.updateProjectionMatrix();
  perspectiveCamera.updateMatrixWorld(true);

  const anchorPoint = new THREE.Vector3(...anchor);
  const anchorDepth = anchorPoint.clone().applyMatrix4(perspectiveCamera.matrixWorldInverse).z * -1;
  const scalePoint = mapping.scalePoint
    ? new THREE.Vector3(...mapping.scalePoint).applyMatrix4(perspectiveCamera.matrixWorldInverse)
    : null;
  const referenceDepth = scalePoint ? -scalePoint.z : anchorDepth;
  const referenceScale = mapping.scaleAt ?? mapping.scale;
  const point = new THREE.Vector3();
  const cameraPoint = new THREE.Vector3();
  const homography = mapping.calibration ? solveHomography(mapping.calibration) : null;
  return {
    id, texture, anchor, offset, look, mapping, fov,
    contains(state) {
      if (mapping.walkableWorlds) {
        return mapping.walkableWorlds.some((polygon) => insideWorld(state, polygon));
      }
      return !mapping.walkableWorld || insideWorld(state, mapping.walkableWorld);
    },
    project(state) {
      point.set(state.x, state.y, state.z);
      cameraPoint.copy(point).applyMatrix4(perspectiveCamera.matrixWorldInverse);
      const dx = state.x - anchor[0];
      const dy = state.y - anchor[1];
      const dz = state.z - anchor[2];
      const depth = Math.max(0.1, -cameraPoint.z);
      const calibratedScale = mapping.scaleRange
        ? 1 / THREE.MathUtils.lerp(
          1 / mapping.scaleRange[1],
          1 / mapping.scaleRange[3],
          THREE.MathUtils.clamp((state.z - mapping.scaleRange[0]) / (mapping.scaleRange[2] - mapping.scaleRange[0]), 0, 1),
        )
        : referenceScale * referenceDepth / depth;
      const scale = Math.max(0.045, Math.min(0.32, calibratedScale));
      if (homography) {
        const denominator = homography[6] * state.x + homography[7] * state.z + 1;
        const x = (homography[0] * state.x + homography[1] * state.z + homography[2]) / denominator;
        const y = (homography[3] * state.x + homography[4] * state.z + homography[5]) / denominator;
        return {
          x, y: y + dy * mapping.levelAxis[1],
          scale,
        };
      }
      return {
        x: mapping.screen[0] + dx * mapping.xAxis[0] + dy * mapping.levelAxis[0] + dz * mapping.zAxis[0],
        y: mapping.screen[1] + dx * mapping.xAxis[1] + dy * mapping.levelAxis[1] + dz * mapping.zAxis[1],
        scale,
      };
    },
  };
}

function solveHomography(points) {
  if (points.length !== 4) throw new Error('A calibração de fundo exige quatro pontos de piso.');
  const matrix = points.map(([x, z, u, v]) => [
    x, z, 1, 0, 0, 0, -u * x, -u * z, u,
  ]).concat(points.map(([x, z, u, v]) => [
    0, 0, 0, x, z, 1, -v * x, -v * z, v,
  ]));

  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (Math.abs(matrix[pivot][column]) < 1e-10) throw new Error('Pontos de calibração de fundo inválidos.');
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    const divisor = matrix[column][column];
    for (let value = column; value <= 8; value++) matrix[column][value] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let value = column; value <= 8; value++) matrix[row][value] -= factor * matrix[column][value];
    }
  }
  return matrix.map((row) => row[8]);
}

const screenRect = (left, bottom, right, top) => [
  [left, bottom], [right, bottom], [right, top], [left, top],
];

// Control points use world X/Z followed by normalized image X/Y from the 320x240 backgrounds.
const mainHallFloor = [
  [-10, 20, -0.78, -0.84], [10, 20, 0.78, -0.84],
  [-10, -12, -0.29, 0.16], [10, -12, 0.29, 0.16],
];
const receptionDeskMask = [
  [-0.48, -0.2], [0.42, -0.2], [0.48, -0.36],
  [0.34, -0.58], [-0.34, -0.58], [-0.48, -0.4],
];
const leftStairWalk = [[-8.8, 0.1], [-5.4, 0.1], [-5.4, -1], [-6.25, -12], [-9.45, -12]];
const rightStairWalk = [[5.4, 0.1], [8.8, 0.1], [8.8, -1], [9.45, -12], [6.25, -12]];
const leftStairApproach = [[-6.3, 0.1], [-3.1, 0.1], [-3.1, -8.1], [-6.3, -8.1]];
const rightStairApproach = [[3.1, 0.1], [6.3, 0.1], [6.3, -8.1], [3.1, -8.1]];
const stairFloor = [
  [-9.45, -1, -0.34, -0.08], [9.45, -1, 0.34, -0.08],
  [-9.45, -12, -0.27, 0.3], [9.45, -12, 0.27, 0.3],
];
const leftHallFloor = [
  [-11, 14, -0.82, -0.82], [-4, 14, 0.2, -0.82],
  [-11, -2, -0.6, 0.16], [-4, -2, 0.15, 0.16],
];
const rightHallFloor = [
  [4, 14, -0.2, -0.82], [11, 14, 0.82, -0.82],
  [4, -2, -0.15, 0.16], [11, -2, 0.6, 0.16],
];
const galleryFrontFloor = [
  [-10, 19, -0.8, -0.82], [10, 19, 0.8, -0.82],
  [-10, 11, -0.55, -0.24], [10, 11, 0.55, -0.24],
];
const galleryLeftFloor = [
  [-11, 12, 0.05, -0.82], [-9, 12, 0.72, -0.82],
  [-11, 0, 0.16, 0.14], [-9, 0, 0.72, 0.14],
];
const galleryRightFloor = [
  [9, 12, -0.72, -0.82], [11, 12, -0.05, -0.82],
  [9, 0, -0.72, 0.14], [11, 0, -0.16, 0.14],
];
const upperHallFloor = [
  [-10, 6, -0.72, -0.82], [10, 6, 0.72, -0.82],
  [-10, -6, -0.38, 0.18], [10, -6, 0.38, 0.18],
];
const upperRearFloor = [
  [-10, -15, -0.82, -0.48], [10, -15, 0.82, -0.48],
  [-10, -8, -0.6, 0.08], [10, -8, 0.6, 0.08],
];
const statueFloor = [
  [-4, -7, -0.35, -0.84], [4, -7, 0.62, -0.84],
  [-4, -14, -0.2, -0.12], [4, -14, 0.42, -0.12],
];
const insideWorld = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    const dx = xj - xi, dz = zj - zi;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq === 0 ? 0 : THREE.MathUtils.clamp(((point.x - xi) * dx + (point.z - zi) * dz) / lengthSq, 0, 1);
    const edgeX = xi + t * dx, edgeZ = zi + t * dz;
    if ((point.x - edgeX) ** 2 + (point.z - edgeZ) ** 2 <= 1e-8) return true;
    if ((zi > point.z) !== (zj > point.z)
      && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

const lobbyViews = {
  entry: makeView('hall-entry', 'stage01_room16_12', [0, 0, 7.5], [0, 12, 17], [0, 3, -13],
    { screen: [-0.12, -0.12], xAxis: [0.035, 0], levelAxis: [0, 0.025], zAxis: [-0.045, -0.038], scale: 0.105, calibration: mainHallFloor, walkableWorld: [[-11.4, 15], [11.4, 15], [11.4, 22.8], [-11.4, 22.8]] }),
  reception: makeView('hall-reception', 'stage01_room16_12', [0, 0, 7.5], [0, 12, 17], [0, 3, -13],
    { screen: [-0.12, -0.12], xAxis: [0.035, 0], levelAxis: [0, 0.025], zAxis: [-0.045, -0.038], scale: 0.105, calibration: mainHallFloor, walkableWorld: [[-11.4, -8], [11.4, -8], [11.4, 15.25], [-11.4, 15.25]], occlusion: [receptionDeskMask] }),
  mainFloorLeft: makeView('hall-main-floor-left', 'stage01_room16_14', [-7, 0, 8], [-10, 7, 12], [0, 3, -12],
    { screen: [0, -0.28], xAxis: [0.035, 0], levelAxis: [0, 0.03], zAxis: [0, -0.018], scale: 0.105, calibration: leftHallFloor, walkableWorld: [[-11.4, -2], [-4.6, -2], [-4.6, 15.25], [-11.4, 15.25]] }),
  mainFloorRight: makeView('hall-main-floor-right', 'stage01_room16_14', [7, 0, 8], [10, 7, 12], [0, 3, -12],
    { screen: [0, -0.28], xAxis: [0.035, 0], levelAxis: [0, 0.03], zAxis: [0, -0.018], scale: 0.105, calibration: rightHallFloor, walkableWorld: [[4.6, -2], [11.4, -2], [11.4, 15.25], [4.6, 15.25]] }),
  stairs: makeView('hall-stairs', 'stage01_room16_12', [0, 0.12, -1], [0, 8, 17], [0, 3, -13],
    { screen: [0, 0.1], xAxis: [0.022, 0], levelAxis: [0, 0], zAxis: [0, -0.007], scale: 0.105, calibration: stairFloor, walkableWorlds: [leftStairWalk, rightStairWalk, leftStairApproach, rightStairApproach] }),
  northExit: makeView('hall-green-exit', 'stage01_room16_12', [0, 0, -14.3], [0, 7, 18], [0, 2.5, 10],
    { screen: [0, 0.2], xAxis: [0.08, 0], levelAxis: [0, 0.02], zAxis: [0, -0.08], scale: 0.07, calibration: [
      [-1.15, -14.6, -0.14, 0.22], [1.15, -14.6, 0.14, 0.22],
      [-3.2, -10.2, -0.48, -0.14], [3.2, -10.2, 0.48, -0.14],
    ], walkableWorld: [[-1.15, -14.6], [1.15, -14.6], [3.2, -10.2], [-3.2, -10.2]] }),
  statue: makeView('hall-statue', 'stage01_room16_8', [0, 0, -12], [0, 7, 15], [0, 3, -13],
    { screen: [0, -0.45], xAxis: [0.04, 0], levelAxis: [0, 0.03], zAxis: [0, -0.015], scale: 0.105, calibration: statueFloor, walkableWorld: [[-5.8, -14], [5.8, -14], [5.8, -8], [-5.8, -8]] }),
  upperFront: makeView('gallery-front', 'stage01_room16_13', [0, 4.6, 14], [0, 7, 14], [0, 3, -13],
    { screen: [0, -0.18], xAxis: [0.035, 0], levelAxis: [0, 0.04], zAxis: [0, -0.02], scale: 0.105, calibration: galleryFrontFloor, walkableWorld: [[-11.4, 11], [11.4, 11], [11.4, 19], [-11.4, 19]] }),
  upperLeft: makeView('gallery-left', 'stage01_room16_9', [-10, 4.6, 6], [0, 7, 11], [0, 1.2, -13],
    { screen: [0, -0.55], xAxis: [0.012, 0], levelAxis: [0, 0.03], zAxis: [0.018, 0.008], scale: 0.095, calibration: galleryLeftFloor, walkableWorld: [[-11.3, 0], [-8.7, 0], [-8.7, 12], [-11.3, 12]] }),
  upperRight: makeView('gallery-right', 'stage01_room16_10', [10, 4.6, 6], [0, 7, 11], [0, 1.2, -13],
    { screen: [0, -0.55], xAxis: [0.012, 0], levelAxis: [0, 0.03], zAxis: [0.018, 0.008], scale: 0.095, calibration: galleryRightFloor, walkableWorld: [[8.7, 0], [11.3, 0], [11.3, 12], [8.7, 12]] }),
  upperHall: makeView('gallery-hall', 'stage01_room23_5', [0, 4.6, 0], [0, 7, 14], [0, 3, -13],
    { screen: [0, -0.45], xAxis: [0.035, 0], levelAxis: [0, 0.03], zAxis: [0, -0.025], scale: 0.09, calibration: upperHallFloor, walkableWorld: [[-11.4, -8], [11.4, -8], [11.4, 6], [-11.4, 6]] }),
  upperRear: makeView('gallery-rear', 'stage01_room23_0', [0, 4.6, -13], [0, 9, 17], [0, 3, -15],
    { screen: [0, -0.12], xAxis: [0.035, 0], levelAxis: [0, 0.03], zAxis: [0, -0.016], scale: 0.095, calibration: upperRearFloor, walkableWorld: [[-11.4, -15.5], [11.4, -15.5], [11.4, -8], [-11.4, -8]] }),
};

const streetCuts = [-2, 7, 16, 25, 34, 43, 52, 61, 71];
const streetCutY = [-0.65, -0.48, -0.32, -0.18, -0.04, 0.08, 0.18, 0.28, 0.36];
const streetCutScale = [0.15, 0.135, 0.12, 0.11, 0.1, 0.09, 0.08, 0.07, 0.06];
const streetFloor = (index) => {
  const nearZ = streetCuts[index], farZ = streetCuts[index + 1];
  return [
    [-10, nearZ, -0.82, streetCutY[index]], [10, nearZ, 0.82, streetCutY[index]],
    [-5, farZ, -0.42, streetCutY[index + 1]], [5, farZ, 0.42, streetCutY[index + 1]],
  ];
};
const streetWalkArea = (index) => {
  const nearZ = streetCuts[index], farZ = streetCuts[index + 1];
  return [[-11, nearZ], [11, nearZ], [7, farZ], [-7, farZ]];
};
const streetMapping = (index) => ({
  screen: [0, streetCutY[index]], xAxis: [0.035, 0], yAxis: [0, 0],
  levelAxis: [0, 0.02], zAxis: [0, 0.03], scale: 0.1,
  scaleRange: [streetCuts[index], streetCutScale[index], streetCuts[index + 1], streetCutScale[index + 1]],
  calibration: streetFloor(index), walkableWorld: streetWalkArea(index),
});

const streetViews = [
  makeView('street-0', 'stage01_room00_0', [0, 0, 2.5], [0, 5, -15], [0, 1.2, 15],
    streetMapping(0)),
  makeView('street-1-left', 'stage01_room00_1', [-3, 0, 11.5], [-3, 5, -13], [0, 1.2, 15],
    streetMapping(1)),
  makeView('street-1-right', 'stage01_room00_2', [3, 0, 11.5], [3, 5, -13], [0, 1.2, 15],
    streetMapping(1)),
  makeView('street-2', 'stage01_room00_3', [0, 0, 20.5], [0, 5, -14], [0, 1.2, 15],
    streetMapping(2)),
  makeView('street-3', 'stage01_room00_4', [0, 0, 29.5], [0, 5, -14], [0, 1.2, 15],
    streetMapping(3)),
  makeView('street-4', 'stage01_room00_5', [0, 0, 38.5], [0, 5, -14], [0, 1.2, 15],
    streetMapping(4)),
  makeView('street-5', 'stage01_room00_6', [0, 0, 47.5], [0, 5, -14], [0, 1.2, 15],
    streetMapping(5)),
  makeView('street-6', 'stage01_room00_7', [0, 0, 56.5], [0, 5, -14], [0, 1.2, 15],
    streetMapping(6)),
  makeView('street-7', 'stage01_room00_8', [0, 0, 65.5], [0, 5, -14], [0, 1.2, 15],
    streetMapping(7)),
];

function positionView(view) {
  return {
    ...view,
    position: view.anchor.map((coordinate, index) => coordinate + view.offset[index]),
    target: view.anchor.map((coordinate, index) => coordinate + view.look[index]),
    project: view.project,
  };
}

export function fixedViewFor(location, state) {
  if (location === 'street') {
    const index = Math.min(7, Math.max(0, Math.floor((state.z + 2) / 9)));
    const view = index === 1
      ? streetViews[state.x < 0 ? 1 : 2]
      : streetViews[index === 0 ? 0 : index + 1];
    return positionView(view);
  }

  const stairView = positionView(lobbyViews.stairs);
  if (state.y < 4.6 && stairView.contains(state)) return stairView;

  if (state.y > 3.5) {
    if (state.z < -8) return positionView(lobbyViews.upperRear);
    if (state.z > 12) return positionView(lobbyViews.upperFront);
    if (state.z > 10 && Math.abs(state.x) > 8) return positionView(state.x < 0 ? lobbyViews.upperLeft : lobbyViews.upperRight);
    if (state.z > 10) return positionView(lobbyViews.upperFront);
    if (state.z >= 0 && Math.abs(state.x) > 8) return positionView(state.x < 0 ? lobbyViews.upperLeft : lobbyViews.upperRight);
    return positionView(lobbyViews.upperHall);
  }

  if (stairView.contains(state)) return stairView;

  if (state.z < -13.1) return positionView(lobbyViews.northExit);
  if (state.z < -8) return positionView(lobbyViews.statue);
  if (Math.abs(state.x) > 5 && state.z < 15.25) {
    return positionView(state.x < 0 ? lobbyViews.mainFloorLeft : lobbyViews.mainFloorRight);
  }
  if (state.z < 15) return positionView(lobbyViews.reception);
  return positionView(lobbyViews.entry);
}
