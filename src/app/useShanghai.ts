import { useEffect, useRef, useState } from 'react';
import { ShanghaiScene } from '../scene/ShanghaiScene';
import { useAppStore } from '../stores/useAppStore';
import type { SceneAPI } from '../scene/SceneAPI';

declare global {
  interface Window {
    /** Public Scene API, also exposed for debugging and for AI-agent tooling. */
    Shanghai?: SceneAPI;
  }
}

/** Creates the ShanghaiScene once, binds its events to the store, and runs the initial fly-in. */
export function useShanghai(containerRef: React.RefObject<HTMLDivElement | null>) {
  const sceneRef = useRef<ShanghaiScene | null>(null);
  const [scene, setScene] = useState<ShanghaiScene | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || sceneRef.current) return;
    const store = useAppStore.getState();
    let disposed = false;
    let instance: ShanghaiScene;
    try {
      instance = new ShanghaiScene(el, {
        onLayerReport: (id, patch) => useAppStore.getState().patchLayer(id, patch),
        onProgress: (m) => useAppStore.getState().setLoadingMessage(m),
        onSelect: (s) => useAppStore.getState().setSelection(s),
        onHoverDistrict: (id) => useAppStore.getState().setHoveredDistrict(id),
        onCamera: (c) => useAppStore.getState().setCamera(c),
        onPerf: (p) => useAppStore.getState().setPerf(p),
        onTime: (t) => useAppStore.getState().setTime(t),
        onWeather: (w) => useAppStore.getState().setWeather(w),
        onLayerVisibility: (id, visible) => useAppStore.getState().patchLayer(id, { visible }),
      });
    } catch (e) {
      console.error(e);
      store.setFatalError(`Failed to create the 3D scene (WebGL required).\n${(e as Error).stack ?? e}`);
      return;
    }
    sceneRef.current = instance;
    setScene(instance);
    window.Shanghai = instance;
    if (import.meta.env.DEV)
      (window as unknown as { __shanghaiStore: typeof useAppStore }).__shanghaiStore = useAppStore;

    (async () => {
      // Sync initial layer visibility from the store defaults.
      for (const l of Object.values(useAppStore.getState().layers))
        instance.layers.setVisible(l.id, l.visible);
      await instance.initialize();
      if (disposed) return;
      useAppStore.getState().setReady(true);
      // Cinematic entry: from space to the whole municipality, then into the inner city.
      await instance.camera.flyToShanghai({ duration: 4.5 });
      if (disposed) return;
      await instance.camera.flyToInnerCity({ duration: 3.5, heading: 15 });
    })().catch((e) => {
      if (disposed) return; // StrictMode double-mount: the first instance was torn down mid-init
      console.error(e);
      useAppStore.getState().setFatalError(String((e as Error).stack ?? e));
    });

    return () => {
      disposed = true;
      console.info('[app] disposing scene instance');
      instance.dispose();
      sceneRef.current = null;
      window.Shanghai = undefined;
    };
  }, [containerRef]);

  return scene;
}
