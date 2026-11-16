import { type V3, add, scale, v3 } from '../src/core/math';
import { type Handedness, type HandPose, buildHandPose } from '../src/core/gestures';

/**
 * Synthetic hand. `facing` = direction the palm points, `fwd` = direction the fingers point.
 * Joint layout follows a real hand: for a right hand with the palm down and fingers forward (-Z),
 * the index knuckle is on -X and the pinky knuckle on +X.
 */
export function makeHand(opts: {
  handedness: Handedness;
  at: V3;
  fingers: V3; // direction fingers point
  across: V3; // direction from index knuckle toward pinky knuckle
  curl: number; // distance of fingertips from the palm centre
}): HandPose {
  const { at, fingers, across, curl } = opts;
  const wrist = add(at, scale(fingers, -0.07));
  const meta = (k: number) => add(add(at, scale(fingers, 0.02)), scale(across, k * 0.02));
  // curled fingers bend back toward the palm: tips sit `curl` away from the palm centre
  const tipDir = (k: number) => add(at, add(scale(fingers, curl), scale(across, k * 0.015)));
  return buildHandPose(opts.handedness, {
    wrist,
    indexMeta: meta(-1.5),
    middleMeta: meta(-0.5),
    ringMeta: meta(0.5),
    pinkyMeta: meta(1.5),
    thumbTip: add(at, v3(0, 0.0, 0)),
    indexTip: tipDir(-1.5),
    middleTip: tipDir(-0.5),
    ringTip: tipDir(0.5),
    pinkyTip: tipDir(1.5),
  });
}
