import { Viewer, Ion, Color, SceneMode, ShadowMode, Cartesian3, EllipsoidTerrainProvider } from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { config } from '../config';

/**
 * Creates the single Cesium Viewer used by the app. All default widgets are disabled: the UI is our own HUD.
 */
export function createViewer(container: HTMLElement): Viewer {
  if (config.ionToken) {
    Ion.defaultAccessToken = config.ionToken;
  } else {
    // Prevent Cesium from trying its default (rate-limited) ion token for anything.
    Ion.defaultAccessToken = '';
  }

  const viewer = new Viewer(container, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    vrButton: false,
    shouldAnimate: true,
    sceneMode: SceneMode.SCENE3D,
    baseLayer: false, // imagery is managed by ImageryLayer in layers/
    terrainProvider: new EllipsoidTerrainProvider(),
    requestRenderMode: false,
    msaaSamples: 4,
    shadows: false,
    terrainShadows: ShadowMode.DISABLED,
    contextOptions: {
      webgl: { powerPreference: 'high-performance', antialias: true },
    },
  });

  const { scene } = viewer;
  scene.globe.baseColor = Color.fromCssColorString('#0b1118');
  scene.globe.showGroundAtmosphere = true;
  scene.globe.enableLighting = true;
  scene.globe.depthTestAgainstTerrain = false;
  scene.backgroundColor = Color.fromCssColorString('#04070c');
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  scene.fog.density = 0.0004;
  scene.fog.screenSpaceErrorFactor = 4;
  scene.postProcessStages.fxaa.enabled = true;
  scene.highDynamicRange = false;
  scene.screenSpaceCameraController.minimumZoomDistance = 30;
  scene.screenSpaceCameraController.maximumZoomDistance = 30_000_000;
  scene.screenSpaceCameraController.enableCollisionDetection = true;
  // Reasonable performance defaults on integrated GPUs.
  viewer.resolutionScale = Math.min(window.devicePixelRatio, 1.5) / window.devicePixelRatio;
  viewer.scene.camera.position = new Cartesian3(); // placeholder, CameraController sets the real view

  // Remove Cesium credit widget's default styling; we render attribution ourselves via CreditDisplay.
  const creditContainer = viewer.cesiumWidget.creditContainer as HTMLElement;
  creditContainer.style.display = 'none';

  return viewer;
}
