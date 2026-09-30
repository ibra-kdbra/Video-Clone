import { LazyMotion, MotionConfig } from 'motion/react';

import { whenIdle } from '../lib/useIdle.js';

// Loaded once the browser is idle after the first render, off the page's critical path. Until
// then, animated elements simply appear in their final state.
const loadFeatures = () => whenIdle().then(() => import('./motionFeatures.js')).then((module) => module.default);

/**
 * Animation setup for the whole app. The animation engine loads after the page has rendered, so
 * it never delays the first paint, and every animation follows the visitor's "reduce motion"
 * setting (MotionConfig reducedMotion="user").
 */
export default function Motion({ children }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
