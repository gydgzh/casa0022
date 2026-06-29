// MediaPipe PoseLandmarker wrapper (optional full-body tracking).
// Apache-2.0 licensed (Google).

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
// "Lite" model = ~3MB, fastest. Heavy/Full available if needed.
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export class PoseCapture {
  constructor() {
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastPose = null;
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      outputSegmentationMasks: false
    });
    return this;
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {number} timestampMs
   * @returns {{landmarks: Array<{x:number,y:number,z:number,visibility:number}>|null,
   *           world: Array<{x:number,y:number,z:number}>|null}}
   */
  detect(video, timestampMs) {
    if (!this.landmarker || video.currentTime === this.lastVideoTime) {
      return { landmarks: this.lastPose?.landmarks, world: this.lastPose?.world };
    }
    this.lastVideoTime = video.currentTime;
    const res = this.landmarker.detectForVideo(video, timestampMs);
    if (res.landmarks && res.landmarks.length > 0) {
      this.lastPose = {
        landmarks: res.landmarks[0],
        world: res.worldLandmarks?.[0] ?? null
      };
    }
    return { landmarks: this.lastPose?.landmarks, world: this.lastPose?.world };
  }

  dispose() {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
