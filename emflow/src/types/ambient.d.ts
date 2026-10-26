/// <reference types="vite/client" />

import type { ThreeElements } from "@react-three/fiber";

// Make <mesh/>, <ambientLight/>, etc. valid JSX for @react-three/fiber
declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }

  /** Injected by vite.config.ts (define) */
  const __EMFLOW_VERSION__: string;
  const __EMFLOW_BUILD_TIMESTAMP__: string;
}

export {};
